import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import {
  PostStatus,
  PostVisibility,
  PrivateAccessStatus,
  PrivateLockType,
  Role,
} from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import {
  GrantPrivateAccessDto,
  UpdatePrivateAccessDto,
  UpdatePrivateSettingsDto,
  VerifyPrivatePasswordDto,
} from './dto/private-post.dto';

export interface ViewerContext {
  userId?: string | null;
  userRole?: string | null;
  shareToken?: string | null;
  unlockToken?: string | null;
  jwtAuthFailed?: boolean;
}

export interface AccessEvaluation {
  allowed: boolean;
  locked: boolean;
  isAuthor: boolean;
  isAdmin: boolean;
  isAuthorOrAdmin: boolean;
  requiresPassword: boolean;
  lockType: PrivateLockType;
  isOneTime: boolean;
  effectivePasswordHash: string | null;
  accessGrant: any | null;
}

const DEFAULT_UNLOCK_SECRET = 'inkflow_jwt_access_super_secret_key_2026';

@Injectable()
export class PrivatePostsService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  generateShareToken(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  detectLockType(secret?: string | null, explicitType?: PrivateLockType): PrivateLockType {
    const trimmed = secret?.trim();
    if (!trimmed) return PrivateLockType.NONE;
    if (explicitType && explicitType !== PrivateLockType.NONE) {
      return explicitType;
    }
    return /^\d{4,8}$/.test(trimmed) ? PrivateLockType.PIN : PrivateLockType.PASSWORD;
  }

  private getUnlockSecret(): string {
    return this.configService.get<string>('JWT_ACCESS_SECRET') || DEFAULT_UNLOCK_SECRET;
  }

  private getPasswordFingerprint(hash?: string | null): string | null {
    return hash ? hash.slice(-12) : null;
  }

  signUnlockToken(payload: {
    postId: string;
    userId?: string | null;
    pwdFp?: string | null;
    oneTimeSession?: boolean;
  }): string {
    return this.jwtService.sign(
      {
        type: 'PRIVATE_POST_UNLOCK',
        postId: payload.postId,
        userId: payload.userId || null,
        pwdFp: payload.pwdFp || null,
        oneTimeSession: Boolean(payload.oneTimeSession),
      },
      {
        secret: this.getUnlockSecret(),
        expiresIn: payload.oneTimeSession ? '2h' : '6h',
      },
    );
  }

  verifyUnlockToken(
    token: string | undefined | null,
    expectedPostId: string,
    currentUserId: string | null,
    expectedPwdFp: string | null,
    options?: { allowOneTimeSession?: boolean },
  ): boolean {
    if (!token) return false;
    try {
      const decoded = this.jwtService.verify(token, {
        secret: this.getUnlockSecret(),
      }) as any;

      if (!decoded || decoded.type !== 'PRIVATE_POST_UNLOCK') return false;
      if (decoded.postId !== expectedPostId) return false;
      if (decoded.userId && decoded.userId !== currentUserId) return false;
      if (decoded.oneTimeSession && !options?.allowOneTimeSession) return false;
      if (!decoded.oneTimeSession && expectedPwdFp && decoded.pwdFp !== expectedPwdFp) return false;

      return true;
    } catch {
      return false;
    }
  }

  sanitizePost(
    post: any,
    options?: {
      currentUserId?: string | null;
      currentUserRole?: string | null;
      includeShareToken?: boolean;
    },
  ) {
    if (!post) return post;

    const { secretPasswordHash, shareToken, privateAccesses, ...rest } = post;
    const isAuthenticated = Boolean(options?.currentUserId);
    const isAuthor = Boolean(options?.currentUserId && post.authorId === options.currentUserId);
    const isAdmin = options?.currentUserRole === Role.ADMIN;
    const includeShareToken = Boolean(options?.includeShareToken || isAuthor || isAdmin);
    const hasPassword = Boolean(secretPasswordHash);
    const lockType =
      post.privateLockType && post.privateLockType !== PrivateLockType.NONE
        ? post.privateLockType
        : hasPassword
          ? PrivateLockType.PASSWORD
          : PrivateLockType.NONE;

    return {
      ...rest,
      ...(includeShareToken && post.visibility === PostVisibility.PRIVATE
        ? { shareToken: shareToken || null }
        : {}),
      hasPassword,
      lockType,
      isPrivate: post.visibility === PostVisibility.PRIVATE,
      canEdit: Boolean(options?.currentUserId && (isAuthor || isAdmin)),
      clapsCount: isAuthenticated ? post.clapsCount : 0,
      clapsVisible: isAuthenticated,
      canInteract: isAuthenticated,
      ...(Array.isArray(privateAccesses)
        ? { sharedCount: privateAccesses.filter((a: any) => a.status === PrivateAccessStatus.ACTIVE).length }
        : {}),
    };
  }

  buildLockedPreview(post: any, evaluation: AccessEvaluation) {
    return {
      id: post.id,
      slug: post.slug,
      title: post.title,
      visibility: post.visibility,
      isPrivate: true,
      authorId: post.authorId,
      author: post.author,
      readingTimeMinutes: post.readingTimeMinutes,
      createdAt: post.createdAt,
      locked: true,
      requiresPassword: evaluation.requiresPassword,
      lockType: evaluation.lockType,
      oneTimeView: evaluation.isOneTime,
      clapsCount: 0,
      clapsVisible: false,
      canInteract: false,
    };
  }

  async evaluateAccess(
    post: any,
    viewer: ViewerContext,
    options?: { allowConsumedViewSession?: boolean; allowPinUnlockToken?: boolean },
  ): Promise<AccessEvaluation> {
    const isAuthor = Boolean(viewer.userId && post.authorId === viewer.userId);
    const isAdmin = String(viewer.userRole || '').toUpperCase() === Role.ADMIN;

    if (post.visibility !== PostVisibility.PRIVATE) {
      return {
        allowed: true,
        locked: false,
        isAuthor,
        isAdmin,
        isAuthorOrAdmin: isAuthor || isAdmin,
        requiresPassword: false,
        lockType: PrivateLockType.NONE,
        isOneTime: false,
        effectivePasswordHash: null,
        accessGrant: null,
      };
    }

    // Only Admin can bypass PIN/password and private access gates unconditionally
    if (isAdmin) {
      return {
        allowed: true,
        locked: false,
        isAuthor,
        isAdmin: true,
        isAuthorOrAdmin: true,
        requiresPassword: false,
        lockType: PrivateLockType.NONE,
        isOneTime: false,
        effectivePasswordHash: null,
        accessGrant: null,
      };
    }

    const postLockType =
      post.privateLockType && post.privateLockType !== PrivateLockType.NONE
        ? post.privateLockType
        : post.secretPasswordHash
          ? PrivateLockType.PASSWORD
          : PrivateLockType.NONE;

    // Non-admin authors can access their own private blog directly ONLY if no PIN/password is set;
    // when PIN or password is configured, only Admin bypasses the PIN/password gate.
    if (isAuthor) {
      if (!post.secretPasswordHash) {
        return {
          allowed: true,
          locked: false,
          isAuthor: true,
          isAdmin: false,
          isAuthorOrAdmin: true,
          requiresPassword: false,
          lockType: PrivateLockType.NONE,
          isOneTime: false,
          effectivePasswordHash: null,
          accessGrant: null,
        };
      }

      const canReuseAuthorUnlockToken =
        postLockType !== PrivateLockType.PIN || Boolean(options?.allowPinUnlockToken);

      if (canReuseAuthorUnlockToken && viewer.unlockToken) {
        const expectedFp = this.getPasswordFingerprint(post.secretPasswordHash);
        if (this.verifyUnlockToken(viewer.unlockToken, post.id, viewer.userId || null, expectedFp)) {
          return {
            allowed: true,
            locked: false,
            isAuthor: true,
            isAdmin: false,
            isAuthorOrAdmin: true,
            requiresPassword: true,
            lockType: postLockType,
            isOneTime: false,
            effectivePasswordHash: post.secretPasswordHash,
            accessGrant: null,
          };
        }
      }

      return {
        allowed: true,
        locked: true,
        isAuthor: true,
        isAdmin: false,
        isAuthorOrAdmin: true,
        requiresPassword: true,
        lockType: postLockType,
        isOneTime: false,
        effectivePasswordHash: post.secretPasswordHash,
        accessGrant: null,
      };
    }

    if (post.status === PostStatus.ARCHIVED || post.status === PostStatus.REJECTED) {
      throw new NotFoundException({
        message: 'This private story is no longer available.',
        code: 'PRIVATE_POST_UNAVAILABLE',
      });
    }

    const accessGrant = viewer.userId
      ? await this.prisma.privatePostAccess.findUnique({
          where: { postId_userId: { postId: post.id, userId: viewer.userId } },
        })
      : null;

    if (accessGrant?.status === PrivateAccessStatus.REVOKED) {
      throw new ForbiddenException({
        message: 'Your access to this private story has been revoked by the author.',
        code: 'ACCESS_REVOKED',
      });
    }

    const isOneTimeExhausted = Boolean(
      accessGrant &&
        (accessGrant.status === PrivateAccessStatus.CONSUMED ||
          (accessGrant.oneTimeView && (accessGrant.hasViewed || accessGrant.viewCount >= 1))),
    );

    if (isOneTimeExhausted) {
      if (
        options?.allowConsumedViewSession &&
        viewer.unlockToken &&
        this.verifyUnlockToken(viewer.unlockToken, post.id, viewer.userId || null, null, {
          allowOneTimeSession: true,
        })
      ) {
        return {
          allowed: true,
          locked: false,
          isAuthor: false,
          isAdmin: false,
          isAuthorOrAdmin: false,
          requiresPassword: false,
          lockType: PrivateLockType.NONE,
          isOneTime: true,
          effectivePasswordHash: null,
          accessGrant,
        };
      }

      throw new ForbiddenException({
        message: 'Your one-time view for this private story has already been used.',
        code: 'ONE_TIME_VIEW_EXPIRED',
      });
    }

    const allowLinkPasswordAccess = post.allowLinkPasswordAccess ?? true;

    const hasActiveGrant = Boolean(accessGrant && accessGrant.status === PrivateAccessStatus.ACTIVE);
    const hasValidShareToken = Boolean(
      viewer.shareToken && post.shareToken && viewer.shareToken === post.shareToken,
    );
    const canUseLinkPassword = Boolean(
      hasValidShareToken && allowLinkPasswordAccess && post.secretPasswordHash,
    );

    if (!hasActiveGrant && !canUseLinkPassword) {
      if (!viewer.userId) {
        if (viewer.jwtAuthFailed) {
          throw new UnauthorizedException({
            message: 'Your session has expired. Please refresh your login to view this private story.',
            code: 'SESSION_EXPIRED',
            requiresAuth: true,
          });
        }
        if (hasValidShareToken) {
          throw new UnauthorizedException({
            message: 'Please sign in to access this private story.',
            code: 'LOGIN_REQUIRED',
            requiresAuth: true,
          });
        }
        throw new ForbiddenException({
          message: 'This story is private. A valid sharing link or permission is required.',
          code: 'PRIVATE_POST_FORBIDDEN',
        });
      }

      throw new ForbiddenException({
        message: 'You do not have permission to view this private story.',
        code: 'PRIVATE_POST_FORBIDDEN',
      });
    }

    if (post.requireFollowerToView) {
      if (!viewer.userId) {
        throw new UnauthorizedException({
          message: 'Please sign in and follow the author to view this private story.',
          code: 'LOGIN_REQUIRED',
          requiresAuth: true,
        });
      }
      const viewerRecord = await this.prisma.user.findUnique({
        where: { id: viewer.userId },
        select: { followingUserIds: true },
      });
      if (!(viewerRecord?.followingUserIds || []).includes(post.authorId)) {
        throw new ForbiddenException({
          message: 'You must follow the author before viewing this private story.',
          code: 'FOLLOW_AUTHOR_REQUIRED',
          requiresFollow: true,
          authorId: post.authorId,
        });
      }
    }

    let effectivePasswordHash: string | null = null;
    let lockType: PrivateLockType = PrivateLockType.NONE;

    if (hasActiveGrant && accessGrant) {
      if (accessGrant.passcodeHash) {
        effectivePasswordHash = accessGrant.passcodeHash;
        lockType =
          accessGrant.passcodeType !== PrivateLockType.NONE
            ? accessGrant.passcodeType
            : PrivateLockType.PASSWORD;
      } else {
        // When PIN is enabled on the blog, always enforce PIN even for granted users
        const mustUseBlogPassword =
          (postLockType === PrivateLockType.PIN && Boolean(post.secretPasswordHash)) ||
          accessGrant.requirePassword === true ||
          (accessGrant.requirePassword === null && Boolean(post.requirePasswordForGrantedUsers));
        if (mustUseBlogPassword && post.secretPasswordHash) {
          effectivePasswordHash = post.secretPasswordHash;
          lockType =
            postLockType !== PrivateLockType.NONE
              ? postLockType
              : PrivateLockType.PASSWORD;
        }
      }
    } else if (canUseLinkPassword) {
      effectivePasswordHash = post.secretPasswordHash;
      lockType =
        postLockType !== PrivateLockType.NONE
          ? postLockType
          : PrivateLockType.PASSWORD;
    }

    const requiresPassword = Boolean(effectivePasswordHash);
    const isOneTime = Boolean(accessGrant?.oneTimeView);

    if (!requiresPassword && !isOneTime) {
      return {
        allowed: true,
        locked: false,
        isAuthor: false,
        isAdmin: false,
        isAuthorOrAdmin: false,
        requiresPassword: false,
        lockType: PrivateLockType.NONE,
        isOneTime: false,
        effectivePasswordHash: null,
        accessGrant,
      };
    }

    // For PIN-locked blogs, NEVER auto-unlock on page loads/refreshes from a cached unlockToken.
    // Only allow unlockToken during an active unlocked page session (claps, comments, read tracking).
    const canReuseUnlockToken =
      !isOneTime && (lockType !== PrivateLockType.PIN || Boolean(options?.allowPinUnlockToken));

    if (canReuseUnlockToken && viewer.unlockToken) {
      const expectedFp = this.getPasswordFingerprint(effectivePasswordHash);
      if (this.verifyUnlockToken(viewer.unlockToken, post.id, viewer.userId || null, expectedFp)) {
        return {
          allowed: true,
          locked: false,
          isAuthor: false,
          isAdmin: false,
          isAuthorOrAdmin: false,
          requiresPassword,
          lockType,
          isOneTime: false,
          effectivePasswordHash,
          accessGrant,
        };
      }
    }

    return {
      allowed: true,
      locked: true,
      isAuthor: false,
      isAdmin: false,
      isAuthorOrAdmin: false,
      requiresPassword,
      lockType,
      isOneTime,
      effectivePasswordHash,
      accessGrant,
    };
  }

  async findPostForAuthCheck(identifier: string) {
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(identifier);
    const where: any = isObjectId
      ? { OR: [{ id: identifier }, { slug: identifier }] }
      : { OR: [{ slug: identifier }, { shareToken: identifier }] };

    return this.prisma.post.findFirst({
      where,
      include: {
        author: { select: { id: true, name: true, username: true, avatar: true, bio: true, role: true } },
        category: true,
        tags: true,
        privateAccesses: {
          select: { id: true, status: true },
        },
        comments: {
          include: {
            author: { select: { id: true, name: true, username: true, avatar: true, role: true } },
            replies: {
              include: { author: { select: { id: true, name: true, username: true, avatar: true, role: true } } },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
  }

  async assertUnlockedAccess(
    postIdOrSlug: string,
    viewer: ViewerContext,
    options?: { allowConsumedViewSession?: boolean; allowPinUnlockToken?: boolean },
  ) {
    const post = await this.findPostForAuthCheck(postIdOrSlug);
    if (!post) {
      throw new NotFoundException('Story not found.');
    }

    const evaluation = await this.evaluateAccess(post, viewer, {
      ...options,
      allowPinUnlockToken: options?.allowPinUnlockToken ?? true,
    });
    if (evaluation.locked) {
      throw new ForbiddenException({
        message: 'This private story is locked. Please unlock it first.',
        code: 'PRIVATE_POST_LOCKED',
        requiresPassword: evaluation.requiresPassword,
        lockType: evaluation.lockType,
        oneTimeView: evaluation.isOneTime,
      });
    }

    return { post, evaluation };
  }

  async unlockPost(
    identifier: string,
    viewer: ViewerContext,
    dto: VerifyPrivatePasswordDto,
    options?: { throwOnInvalidPassword?: boolean },
  ) {
    const post = await this.findPostForAuthCheck(identifier);
    if (!post) {
      throw new NotFoundException(`Story with identifier '${identifier}' not found.`);
    }

    const effectiveViewer: ViewerContext = {
      ...viewer,
      shareToken: dto.shareToken || viewer.shareToken,
    };

    const evaluation = await this.evaluateAccess(post, effectiveViewer);

    if (evaluation.isAdmin) {
      return {
        success: true,
        unlocked: true,
        unlockToken: null,
        oneTimeView: false,
        post: this.sanitizePost(post, {
          currentUserId: viewer.userId,
          currentUserRole: viewer.userRole,
          includeShareToken: true,
        }),
      };
    }

    if (evaluation.requiresPassword && evaluation.effectivePasswordHash) {
      const candidate = (dto.password ?? dto.pin ?? '').trim();
      const isMatch = candidate
        ? await bcrypt.compare(candidate, evaluation.effectivePasswordHash)
        : false;

      if (!isMatch) {
        if (options?.throwOnInvalidPassword) {
          throw new UnauthorizedException({
            message: 'Incorrect PIN or password.',
            code: 'INVALID_PRIVATE_PASSWORD',
          });
        }
        return {
          success: false,
          unlocked: false,
          message: 'Incorrect PIN or password.',
        };
      }
    }

    if (evaluation.isOneTime && evaluation.accessGrant) {
      const now = new Date();
      const consumed = await this.prisma.privatePostAccess.updateMany({
        where: {
          id: evaluation.accessGrant.id,
          status: PrivateAccessStatus.ACTIVE,
          hasViewed: false,
          viewCount: 0,
        },
        data: {
          hasViewed: true,
          viewCount: 1,
          firstViewedAt: now,
          lastViewedAt: now,
          status: PrivateAccessStatus.CONSUMED,
        },
      });

      if (consumed.count === 0) {
        throw new ForbiddenException({
          message: 'Your one-time view for this private story has already been used.',
          code: 'ONE_TIME_VIEW_EXPIRED',
        });
      }
    } else if (evaluation.accessGrant) {
      const now = new Date();
      await this.prisma.privatePostAccess.update({
        where: { id: evaluation.accessGrant.id },
        data: {
          hasViewed: true,
          viewCount: { increment: 1 },
          firstViewedAt: evaluation.accessGrant.firstViewedAt || now,
          lastViewedAt: now,
        },
      });
    }

    const unlockToken = this.signUnlockToken({
      postId: post.id,
      userId: viewer.userId || null,
      pwdFp: this.getPasswordFingerprint(evaluation.effectivePasswordHash),
      oneTimeSession: evaluation.isOneTime,
    });

    return {
      success: true,
      unlocked: true,
      unlockToken,
      oneTimeView: evaluation.isOneTime,
      post: this.sanitizePost(post, {
        currentUserId: viewer.userId,
        currentUserRole: viewer.userRole,
        includeShareToken: evaluation.isAuthorOrAdmin,
      }),
    };
  }

  private async assertManagePermission(postId: string, actorId: string, actorRole?: string) {
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post) throw new NotFoundException('Story not found.');
    const isAdmin = String(actorRole || '').toUpperCase() === Role.ADMIN;
    if (post.authorId !== actorId && !isAdmin) {
      throw new ForbiddenException('Only the post author or an Admin can manage this private blog.');
    }
    return post;
  }

  private formatAccessRecord(
    record: any,
    authorId: string,
    authorFollowingSet: Set<string>,
  ) {
    const userFollowingIds: string[] = record.user?.followingUserIds || [];
    const userSummary = record.user
      ? {
          id: record.user.id,
          name: record.user.name,
          username: record.user.username,
          avatar: record.user.avatar,
          bio: record.user.bio,
          role: record.user.role,
        }
      : null;

    return {
      id: record.id,
      postId: record.postId,
      userId: record.userId,
      user: userSummary,
      status: record.status,
      oneTimeView: record.oneTimeView,
      hasViewed: record.hasViewed,
      viewCount: record.viewCount,
      hasCustomPassword: Boolean(record.passcodeHash),
      lockType: record.passcodeType || PrivateLockType.NONE,
      requirePassword: record.requirePassword,
      isFollower: userFollowingIds.includes(authorId),
      isFollowing: authorFollowingSet.has(record.userId),
      firstViewedAt: record.firstViewedAt,
      lastViewedAt: record.lastViewedAt,
      revokedAt: record.revokedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  async getPrivateSettings(postId: string, actorId: string, actorRole?: string) {
    const post = await this.assertManagePermission(postId, actorId, actorRole);

    let shareToken = post.shareToken;
    if (post.visibility === PostVisibility.PRIVATE && !shareToken) {
      shareToken = this.generateShareToken();
      await this.prisma.post.update({
        where: { id: post.id },
        data: { shareToken },
      });
    }

    const [accessRecords, author, followers] = await Promise.all([
      this.prisma.privatePostAccess.findMany({
        where: { postId: post.id },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              username: true,
              avatar: true,
              bio: true,
              role: true,
              followingUserIds: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.findUnique({
        where: { id: post.authorId },
        select: { followingUserIds: true },
      }),
      this.prisma.user.findMany({
        where: {
          followingUserIds: { has: post.authorId },
        },
        select: {
          id: true,
          name: true,
          username: true,
          avatar: true,
          bio: true,
          role: true,
          followersCount: true,
          followingCount: true,
        },
        orderBy: { name: 'asc' },
      }),
    ]);

    const authorFollowingSet = new Set(author?.followingUserIds || []);
    const accessByUserId = new Map(accessRecords.map((r) => [r.userId, r]));

    return {
      post: {
        id: post.id,
        title: post.title,
        slug: post.slug,
        visibility: post.visibility,
        status: post.status,
        shareToken,
        hasPassword: Boolean(post.secretPasswordHash),
        lockType:
          post.privateLockType && post.privateLockType !== PrivateLockType.NONE
            ? post.privateLockType
            : post.secretPasswordHash
              ? PrivateLockType.PASSWORD
              : PrivateLockType.NONE,
        allowLinkPasswordAccess: post.allowLinkPasswordAccess ?? true,
        requirePasswordForGrantedUsers: post.requirePasswordForGrantedUsers ?? false,
        requireFollowerToView: post.requireFollowerToView ?? false,
      },
      sharedWith: accessRecords.map((r) =>
        this.formatAccessRecord(r, post.authorId, authorFollowingSet),
      ),
      followers: followers.map((f) => {
        const grant = accessByUserId.get(f.id);
        return {
          ...f,
          isFollower: true,
          isFollowing: authorFollowingSet.has(f.id),
          hasAccess: grant?.status === PrivateAccessStatus.ACTIVE,
          accessStatus: grant?.status || null,
          oneTimeView: grant?.oneTimeView || false,
          hasViewed: grant?.hasViewed || false,
        };
      }),
    };
  }

  async getFollowersForSharing(
    postId: string,
    actorId: string,
    actorRole?: string,
    search?: string,
  ) {
    const post = await this.assertManagePermission(postId, actorId, actorRole);
    const trimmed = (search || '').trim();

    const where: any = {
      followingUserIds: { has: post.authorId },
    };
    if (trimmed) {
      where.OR = [
        { name: { contains: trimmed, mode: 'insensitive' } },
        { username: { contains: trimmed, mode: 'insensitive' } },
      ];
    }

    const [followers, author, accessRecords] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          username: true,
          avatar: true,
          bio: true,
          role: true,
          followersCount: true,
          followingCount: true,
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.user.findUnique({
        where: { id: post.authorId },
        select: { followingUserIds: true },
      }),
      this.prisma.privatePostAccess.findMany({
        where: { postId: post.id },
      }),
    ]);

    const authorFollowingSet = new Set(author?.followingUserIds || []);
    const accessByUserId = new Map(accessRecords.map((r) => [r.userId, r]));

    return followers.map((f) => {
      const grant = accessByUserId.get(f.id);
      return {
        ...f,
        isFollower: true,
        isFollowing: authorFollowingSet.has(f.id),
        canGrantDirectly: true,
        needsFollowBeforeGrant: false,
        hasAccess: grant?.status === PrivateAccessStatus.ACTIVE,
        accessStatus: grant?.status || null,
        oneTimeView: grant?.oneTimeView || false,
        hasViewed: grant?.hasViewed || false,
        viewCount: grant?.viewCount || 0,
      };
    });
  }

  async searchUsersForSharing(
    postId: string,
    actorId: string,
    actorRole?: string,
    search?: string,
  ) {
    const post = await this.assertManagePermission(postId, actorId, actorRole);
    const trimmed = (search || '').trim();

    const where: any = {
      id: { not: post.authorId },
    };
    if (trimmed) {
      where.OR = [
        { name: { contains: trimmed, mode: 'insensitive' } },
        { username: { contains: trimmed, mode: 'insensitive' } },
        { email: { equals: trimmed, mode: 'insensitive' } },
      ];
    }

    const [users, author, accessRecords] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          username: true,
          avatar: true,
          bio: true,
          role: true,
          followersCount: true,
          followingCount: true,
          followingUserIds: true,
        },
        take: 25,
        orderBy: { name: 'asc' },
      }),
      this.prisma.user.findUnique({
        where: { id: post.authorId },
        select: { followingUserIds: true },
      }),
      this.prisma.privatePostAccess.findMany({
        where: { postId: post.id },
      }),
    ]);

    const authorFollowingSet = new Set(author?.followingUserIds || []);
    const accessByUserId = new Map(accessRecords.map((r) => [r.userId, r]));

    return users.map(({ followingUserIds, ...u }) => {
      const isFollower = (followingUserIds || []).includes(post.authorId);
      const isFollowing = authorFollowingSet.has(u.id);
      const grant = accessByUserId.get(u.id);
      return {
        ...u,
        isFollower,
        isFollowing,
        canGrantDirectly: isFollower || isFollowing,
        needsFollowBeforeGrant: !isFollower && !isFollowing,
        hasAccess: grant?.status === PrivateAccessStatus.ACTIVE,
        accessStatus: grant?.status || null,
        oneTimeView: grant?.oneTimeView || false,
        hasViewed: grant?.hasViewed || false,
      };
    });
  }

  async getSharedAccessList(
    postId: string,
    actorId: string,
    actorRole?: string,
    status?: string,
  ) {
    const post = await this.assertManagePermission(postId, actorId, actorRole);
    const normalizedStatus = status?.toUpperCase() as PrivateAccessStatus | undefined;

    const where: any = { postId: post.id };
    if (
      normalizedStatus &&
      Object.values(PrivateAccessStatus).includes(normalizedStatus)
    ) {
      where.status = normalizedStatus;
    }

    const [accessRecords, author] = await Promise.all([
      this.prisma.privatePostAccess.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              username: true,
              avatar: true,
              bio: true,
              role: true,
              followingUserIds: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.findUnique({
        where: { id: post.authorId },
        select: { followingUserIds: true },
      }),
    ]);

    const authorFollowingSet = new Set(author?.followingUserIds || []);
    return accessRecords.map((r) =>
      this.formatAccessRecord(r, post.authorId, authorFollowingSet),
    );
  }

  async updatePrivateSettings(
    postId: string,
    actorId: string,
    actorRole: string | undefined,
    dto: UpdatePrivateSettingsDto,
  ) {
    const post = await this.assertManagePermission(postId, actorId, actorRole);

    const data: any = {};
    const targetVisibility = dto.visibility || post.visibility;

    if (dto.visibility !== undefined) {
      if (dto.visibility !== PostVisibility.PRIVATE && actorRole === Role.READER) {
        throw new ForbiddenException('Only Writers or Admins can publish public stories.');
      }
      data.visibility = dto.visibility;
      if (dto.visibility === PostVisibility.PRIVATE) {
        data.isFeatured = false;
      }
    }

    const rawPassword = dto.password ?? dto.secretPassword;
    const explicitLockType = dto.lockType ?? dto.privateLockType;

    if (dto.removePassword) {
      data.secretPasswordHash = null;
      data.privateLockType = PrivateLockType.NONE;
    } else if (rawPassword !== undefined && rawPassword.trim() !== '') {
      const trimmed = rawPassword.trim();
      data.secretPasswordHash = await bcrypt.hash(trimmed, 10);
      data.privateLockType = this.detectLockType(trimmed, explicitLockType);
    } else if (explicitLockType !== undefined) {
      data.privateLockType = explicitLockType;
    }

    if (dto.allowLinkPasswordAccess !== undefined) {
      data.allowLinkPasswordAccess = dto.allowLinkPasswordAccess;
    }
    if (dto.requirePasswordForGrantedUsers !== undefined) {
      data.requirePasswordForGrantedUsers = dto.requirePasswordForGrantedUsers;
    }
    if (dto.requireFollowerToView !== undefined) {
      data.requireFollowerToView = dto.requireFollowerToView;
    }

    if (dto.regenerateShareToken || (targetVisibility === PostVisibility.PRIVATE && !post.shareToken)) {
      data.shareToken = this.generateShareToken();
    }

    const updated = await this.prisma.post.update({
      where: { id: post.id },
      data,
    });

    return {
      id: updated.id,
      visibility: updated.visibility,
      shareToken: updated.shareToken,
      hasPassword: Boolean(updated.secretPasswordHash),
      lockType: updated.privateLockType ?? PrivateLockType.NONE,
      allowLinkPasswordAccess: updated.allowLinkPasswordAccess ?? true,
      requirePasswordForGrantedUsers: updated.requirePasswordForGrantedUsers ?? false,
      requireFollowerToView: updated.requireFollowerToView ?? false,
    };
  }

  async grantPrivateAccess(
    postId: string,
    actorId: string,
    actorRole: string | undefined,
    dto: GrantPrivateAccessDto,
  ) {
    const post = await this.assertManagePermission(postId, actorId, actorRole);

    if (post.visibility !== PostVisibility.PRIVATE) {
      throw new BadRequestException('User access permissions are only available for private blogs.');
    }

    if (!dto.userId && !dto.usernameOrEmail) {
      throw new BadRequestException('Either userId or usernameOrEmail is required.');
    }

    let targetUser = null;
    if (dto.userId) {
      targetUser = await this.prisma.user.findUnique({ where: { id: dto.userId } });
    } else if (dto.usernameOrEmail) {
      const term = dto.usernameOrEmail.trim();
      targetUser = await this.prisma.user.findFirst({
        where: {
          OR: [
            { username: { equals: term, mode: 'insensitive' } },
            { email: { equals: term, mode: 'insensitive' } },
          ],
        },
      });
    }

    if (!targetUser) {
      throw new NotFoundException('Target reader account not found.');
    }

    if (targetUser.id === post.authorId) {
      throw new BadRequestException('You already own this private blog.');
    }

    const author = await this.prisma.user.findUnique({
      where: { id: post.authorId },
      select: { followingUserIds: true },
    });
    const authorFollowingIds = author?.followingUserIds || [];
    const authorFollowingSet = new Set(authorFollowingIds);

    const isFollower = (targetUser.followingUserIds || []).includes(post.authorId);
    const isAuthorFollowing = authorFollowingSet.has(targetUser.id);

    if (!isFollower && !isAuthorFollowing && actorRole !== Role.ADMIN) {
      throw new ForbiddenException({
        message:
          'This reader does not follow you yet. Follow this reader first before granting access.',
        code: 'FOLLOW_REQUIRED_BEFORE_GRANT',
        targetUser: {
          id: targetUser.id,
          name: targetUser.name,
          username: targetUser.username,
          avatar: targetUser.avatar,
        },
        isFollower: false,
        isFollowing: false,
      });
    }

    let passcodeHash: string | null = null;
    let passcodeType: PrivateLockType = PrivateLockType.NONE;
    if (dto.password && dto.password.trim() !== '') {
      const trimmed = dto.password.trim();
      passcodeHash = await bcrypt.hash(trimmed, 10);
      passcodeType = this.detectLockType(trimmed, dto.lockType);
    }

    const record = await this.prisma.privatePostAccess.upsert({
      where: { postId_userId: { postId: post.id, userId: targetUser.id } },
      create: {
        postId: post.id,
        userId: targetUser.id,
        grantedById: actorId,
        oneTimeView: Boolean(dto.oneTimeView),
        hasViewed: false,
        viewCount: 0,
        passcodeHash,
        passcodeType,
        requirePassword: dto.requirePassword ?? null,
        status: PrivateAccessStatus.ACTIVE,
      },
      update: {
        grantedById: actorId,
        oneTimeView: Boolean(dto.oneTimeView),
        hasViewed: false,
        viewCount: 0,
        firstViewedAt: null,
        lastViewedAt: null,
        passcodeHash,
        passcodeType,
        requirePassword: dto.requirePassword ?? null,
        status: PrivateAccessStatus.ACTIVE,
        revokedAt: null,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            username: true,
            avatar: true,
            bio: true,
            role: true,
            followingUserIds: true,
          },
        },
      },
    });

    await this.prisma.notification
      .create({
        data: {
          recipientId: targetUser.id,
          actorId: post.authorId,
          type: 'PRIVATE_SHARE',
          postId: post.id,
          read: false,
        },
      })
      .catch(() => null);

    return this.formatAccessRecord(record, post.authorId, authorFollowingSet);
  }

  async updatePrivateAccess(
    postId: string,
    targetUserId: string,
    actorId: string,
    actorRole: string | undefined,
    dto: UpdatePrivateAccessDto,
  ) {
    const post = await this.assertManagePermission(postId, actorId, actorRole);

    const existing = await this.prisma.privatePostAccess.findUnique({
      where: { postId_userId: { postId: post.id, userId: targetUserId } },
    });
    if (!existing) {
      throw new NotFoundException('Access record not found for this user.');
    }

    const data: any = {};
    if (dto.oneTimeView !== undefined) data.oneTimeView = dto.oneTimeView;
    if (dto.requirePassword !== undefined) data.requirePassword = dto.requirePassword;

    if (dto.removePassword) {
      data.passcodeHash = null;
      data.passcodeType = PrivateLockType.NONE;
    } else if (dto.password !== undefined && dto.password.trim() !== '') {
      const trimmed = dto.password.trim();
      data.passcodeHash = await bcrypt.hash(trimmed, 10);
      data.passcodeType = this.detectLockType(trimmed, dto.lockType);
    } else if (dto.lockType !== undefined) {
      data.passcodeType = dto.lockType;
    }

    if (dto.resetView) {
      data.hasViewed = false;
      data.viewCount = 0;
      data.firstViewedAt = null;
      data.lastViewedAt = null;
      data.status = PrivateAccessStatus.ACTIVE;
      data.revokedAt = null;
    }

    if (dto.status !== undefined) {
      data.status = dto.status;
      data.revokedAt = dto.status === PrivateAccessStatus.REVOKED ? new Date() : null;
    }

    const [updated, author] = await Promise.all([
      this.prisma.privatePostAccess.update({
        where: { id: existing.id },
        data,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              username: true,
              avatar: true,
              bio: true,
              role: true,
              followingUserIds: true,
            },
          },
        },
      }),
      this.prisma.user.findUnique({
        where: { id: post.authorId },
        select: { followingUserIds: true },
      }),
    ]);

    return this.formatAccessRecord(
      updated,
      post.authorId,
      new Set(author?.followingUserIds || []),
    );
  }

  async revokePrivateAccess(
    postId: string,
    targetUserId: string,
    actorId: string,
    actorRole?: string,
  ) {
    const post = await this.assertManagePermission(postId, actorId, actorRole);

    const existing = await this.prisma.privatePostAccess.findUnique({
      where: { postId_userId: { postId: post.id, userId: targetUserId } },
    });
    if (!existing) {
      throw new NotFoundException('Access record not found for this user.');
    }

    await this.prisma.privatePostAccess.update({
      where: { id: existing.id },
      data: {
        status: PrivateAccessStatus.REVOKED,
        revokedAt: new Date(),
      },
    });

    return {
      success: true,
      message: 'Access revoked successfully.',
      postId: post.id,
      userId: targetUserId,
      status: PrivateAccessStatus.REVOKED,
    };
  }

  async getMyPrivatePosts(authorId: string) {
    const posts = await this.prisma.post.findMany({
      where: {
        authorId,
        visibility: PostVisibility.PRIVATE,
      },
      include: {
        author: { select: { id: true, name: true, username: true, avatar: true, bio: true, role: true } },
        category: true,
        tags: true,
        privateAccesses: {
          select: { id: true, status: true, oneTimeView: true, hasViewed: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return posts.map((post) =>
      this.sanitizePost(post, {
        currentUserId: authorId,
        includeShareToken: true,
      }),
    );
  }

  async getSharedWithMePosts(userId: string) {
    const [grants, currentUser] = await Promise.all([
      this.prisma.privatePostAccess.findMany({
        where: {
          userId,
          status: { in: [PrivateAccessStatus.ACTIVE, PrivateAccessStatus.CONSUMED] },
        },
        include: {
          post: {
            include: {
              author: { select: { id: true, name: true, username: true, avatar: true, bio: true, role: true } },
              category: true,
              tags: true,
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { followingUserIds: true },
      }),
    ]);

    const followingSet = new Set(currentUser?.followingUserIds || []);

    return grants
      .filter(
        (g) =>
          g.post &&
          g.post.visibility === PostVisibility.PRIVATE &&
          g.post.status !== PostStatus.ARCHIVED &&
          g.post.status !== PostStatus.REJECTED,
      )
      .map((g) => {
        const post = g.post;
        const requiresBlogPassword =
          g.requirePassword === true ||
          (g.requirePassword === null && Boolean(post.requirePasswordForGrantedUsers));
        const requiresPassword = Boolean(
          g.passcodeHash || (requiresBlogPassword && post.secretPasswordHash),
        );
        const postLockType = post.privateLockType ?? PrivateLockType.NONE;
        const lockType = g.passcodeHash
          ? g.passcodeType
          : requiresPassword
            ? postLockType !== PrivateLockType.NONE
              ? postLockType
              : PrivateLockType.PASSWORD
            : PrivateLockType.NONE;

        return {
          accessId: g.id,
          accessStatus: g.status,
          oneTimeView: g.oneTimeView,
          hasViewed: g.hasViewed,
          viewCount: g.viewCount,
          requiresPassword,
          lockType,
          isFollowingAuthor: followingSet.has(post.authorId),
          requireFollowerToView: post.requireFollowerToView ?? false,
          sharedAt: g.createdAt,
          lastViewedAt: g.lastViewedAt,
          post: {
            id: post.id,
            title: post.title,
            slug: post.slug,
            visibility: post.visibility,
            isPrivate: true,
            readingTimeMinutes: post.readingTimeMinutes,
            authorId: post.authorId,
            author: post.author,
            category: post.category,
            tags: post.tags,
            createdAt: post.createdAt,
          },
        };
      });
  }

  async getAdminPrivatePosts() {
    const posts = await this.prisma.post.findMany({
      where: {
        visibility: PostVisibility.PRIVATE,
      },
      include: {
        author: { select: { id: true, name: true, username: true, avatar: true, bio: true, role: true } },
        category: true,
        tags: true,
        privateAccesses: {
          select: { id: true, status: true, oneTimeView: true, hasViewed: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return posts.map((post) =>
      this.sanitizePost(post, {
        currentUserRole: Role.ADMIN,
        includeShareToken: true,
      }),
    );
  }
}
