import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Role, PostStatus, PostVisibility, PrivateLockType, CollabMode } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreatePostDto } from './dto/create-post.dto';
import { SaveDraftDto } from './dto/save-draft.dto';
import { RecordPostViewDto } from './dto/private-post.dto';
import { PrivatePostsService, ViewerContext } from './private-posts.service';

export interface RequestUser {
  id?: string;
  sub?: string;
  role?: Role | string;
  email?: string;
  name?: string;
  username?: string;
}

const DEFAULT_COVER_IMAGE =
  'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&q=80';

export function extractFirstImageFromContent(content?: string): string | null {
  if (!content) return null;
  const imgTagMatch = content.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (imgTagMatch && imgTagMatch[1]) {
    return imgTagMatch[1].replace(/&amp;/g, '&');
  }
  const mdImgMatch = content.match(/!\[[^\]]*\]\(([^)]+)\)/);
  if (mdImgMatch && mdImgMatch[1]) {
    return mdImgMatch[1].replace(/&amp;/g, '&');
  }
  return null;
}

export function isDefaultPlaceholderCover(url?: string): boolean {
  if (!url) return true;
  return url.includes('photo-1618005182384-a83a8bd57fbe');
}

@Injectable()
export class PostsService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    private privatePostsService: PrivatePostsService,
  ) {}

  async assertCanAccessPostById(
    postId: string,
    currentUser?: RequestUser | null,
    options?: {
      shareToken?: string;
      unlockToken?: string;
      allowConsumedViewSession?: boolean;
    },
  ) {
    const { post } = await this.privatePostsService.assertUnlockedAccess(
      postId,
      {
        userId: currentUser?.id || currentUser?.sub || null,
        userRole: currentUser?.role ? String(currentUser.role) : null,
        shareToken: options?.shareToken || null,
        unlockToken: options?.unlockToken || null,
      },
      {
        allowConsumedViewSession: options?.allowConsumedViewSession ?? true,
        allowPinUnlockToken: true,
      },
    );
    return post;
  }

  private async resolveCategoryId(requestedCategoryId?: string): Promise<string> {
    if (requestedCategoryId) return requestedCategoryId;
    let cat = await this.prisma.category.findFirst({ where: { slug: 'general' } });
    if (!cat) cat = await this.prisma.category.findFirst();
    if (!cat) {
      cat = await this.prisma.category.create({
        data: { name: 'General', slug: 'general' },
      });
    }
    return cat.id;
  }

  async findAll(query: {
    status?: string;
    visibility?: string;
    includePrivate?: boolean;
    categoryId?: string;
    authorId?: string;
    search?: string;
    feed?: string;
    isFeatured?: boolean;
    currentUserId?: string;
    currentUserRole?: string;
    jwtAuthFailed?: boolean;
  }) {
    const where: any = {};
    const isAdmin = query.currentUserRole === Role.ADMIN;
    const isOwnAuthorQuery = Boolean(query.currentUserId && query.authorId === query.currentUserId);
    const requestedVisibility = query.visibility?.toUpperCase();
    const isOwnPrivateQuery =
      requestedVisibility === PostVisibility.PRIVATE && Boolean(query.currentUserId);
    const requestedStatus = query.status?.toUpperCase();

    if (requestedVisibility === PostVisibility.PRIVATE && !query.currentUserId && query.jwtAuthFailed) {
      throw new UnauthorizedException({
        message: 'Your session has expired. Please refresh your login to view your private stories.',
        code: 'SESSION_EXPIRED',
      });
    }

    if (requestedStatus) {
      if (requestedStatus === 'ALL') {
        if (!isAdmin && !isOwnAuthorQuery && !isOwnPrivateQuery) {
          where.status = PostStatus.PUBLISHED;
        }
      } else if (
        requestedStatus !== PostStatus.PUBLISHED &&
        !isAdmin &&
        !isOwnAuthorQuery &&
        !isOwnPrivateQuery
      ) {
        where.status = PostStatus.PUBLISHED;
      } else {
        where.status = requestedStatus;
      }
    } else {
      where.status = PostStatus.PUBLISHED;
    }

    const isAuthorDashboardAll = requestedStatus === 'ALL' && (isOwnAuthorQuery || isAdmin);

    if (requestedVisibility === PostVisibility.PRIVATE) {
      if (!query.currentUserId) return [];
      where.visibility = PostVisibility.PRIVATE;
      if (!isAdmin) {
        where.authorId = query.currentUserId;
      }
    } else if (query.includePrivate && query.currentUserId) {
      if (requestedVisibility) {
        where.visibility = requestedVisibility;
      } else if (!isAdmin) {
        where.AND = [
          ...(where.AND || []),
          {
            OR: [
              { visibility: { not: PostVisibility.PRIVATE } },
              { visibility: PostVisibility.PRIVATE, authorId: query.currentUserId },
            ],
          },
        ];
      }
    } else if (isAuthorDashboardAll && !requestedVisibility) {
      // Author's own dashboard (status=ALL&authorId=me) or Admin dashboard (status=ALL)
      if (!isAdmin && query.currentUserId) {
        where.authorId = query.currentUserId;
      }
    } else {
      // Public feeds, home page, category filters, search, following feed, featured stories: NEVER list private blogs
      if (requestedVisibility && requestedVisibility !== PostVisibility.PRIVATE) {
        where.visibility = requestedVisibility;
      } else {
        where.visibility = { not: PostVisibility.PRIVATE };
      }
    }

    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.authorId && !where.authorId) where.authorId = query.authorId;
    if (query.isFeatured) where.isFeatured = true;

    if (query.feed === 'following' && query.currentUserId) {
      const currentUser = await this.prisma.user.findUnique({
        where: { id: query.currentUserId },
      });
      if (currentUser && currentUser.followingUserIds.length > 0) {
        where.authorId = { in: currentUser.followingUserIds };
      } else {
        where.authorId = { in: ['non_existent_id'] };
      }
    }

    if (query.search) {
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            { title: { contains: query.search, mode: 'insensitive' } },
            { excerpt: { contains: query.search, mode: 'insensitive' } },
          ],
        },
      ];
    }

    const posts = await this.prisma.post.findMany({
      where,
      include: {
        author: { select: { id: true, name: true, username: true, avatar: true, bio: true, role: true } },
        category: true,
        tags: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return posts.map((post) =>
      this.privatePostsService.sanitizePost(post, {
        currentUserId: query.currentUserId,
        currentUserRole: query.currentUserRole,
      }),
    );
  }

  async toggleFeature(id: string) {
    const post = await this.prisma.post.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('Post not found');
    if (post.visibility === PostVisibility.PRIVATE) {
      throw new BadRequestException('Private blogs cannot be featured publicly.');
    }

    const updated = await this.prisma.post.update({
      where: { id },
      data: {
        isFeatured: !post.isFeatured,
      },
    });
    return this.privatePostsService.sanitizePost(updated, { currentUserRole: Role.ADMIN });
  }

  async findBySlugOrId(identifier: string, viewer: ViewerContext = {}) {
    const post = await this.privatePostsService.findPostForAuthCheck(identifier);

    if (!post) {
      throw new NotFoundException(`Story with identifier '${identifier}' not found.`);
    }

    const evaluation = await this.privatePostsService.evaluateAccess(post, viewer);
    if (evaluation.locked) {
      return this.privatePostsService.buildLockedPreview(post, evaluation);
    }

    return this.privatePostsService.sanitizePost(post, {
      currentUserId: viewer.userId,
      currentUserRole: viewer.userRole,
    });
  }

  /**
   * Fetch full post payload for editing — allowed for the post author or an Admin.
   */
  async getPostForEdit(identifier: string, actorId: string, userRole?: string) {
    const post = await this.privatePostsService.findPostForAuthCheck(identifier);
    if (!post) {
      throw new NotFoundException(`Story with identifier '${identifier}' not found.`);
    }

    const isAdmin = String(userRole || '').toUpperCase() === Role.ADMIN;
    let isCollaborator = false;
    if (post.authorId !== actorId && !isAdmin) {
      const collab = await this.prisma.postCollaborator.findUnique({
        where: { postId_userId: { postId: post.id, userId: actorId } },
      });
      if (collab && collab.canEdit) {
        isCollaborator = true;
      }
    }
    if (post.authorId !== actorId && !isAdmin && !isCollaborator) {
      throw new ForbiddenException('Only the post author, an Admin, or an invited Collaborator can edit this story.');
    }

    let resolvedShareToken = post.shareToken;
    if (post.visibility === PostVisibility.PRIVATE && !resolvedShareToken) {
      resolvedShareToken = this.privatePostsService.generateShareToken();
      await this.prisma.post.update({
        where: { id: post.id },
        data: { shareToken: resolvedShareToken },
      });
    }

    const sanitized = this.privatePostsService.sanitizePost(
      { ...post, shareToken: resolvedShareToken },
      {
        currentUserId: actorId,
        currentUserRole: userRole,
        includeShareToken: true,
      },
    );

    return {
      ...sanitized,
      subtitle: post.subtitle ?? '',
      content: post.content ?? '',
      privateLockType: post.privateLockType ?? PrivateLockType.NONE,
      allowLinkPasswordAccess: post.allowLinkPasswordAccess ?? true,
      requirePasswordForGrantedUsers: post.requirePasswordForGrantedUsers ?? false,
      requireFollowerToView: post.requireFollowerToView ?? false,
      canEdit: true,
    };
  }

  async findByShareToken(shareToken: string, viewer: ViewerContext = {}) {
    if (!shareToken || !shareToken.trim()) {
      throw new NotFoundException('Private story link is invalid.');
    }

    const post = await this.prisma.post.findFirst({
      where: {
        shareToken: shareToken.trim(),
        visibility: PostVisibility.PRIVATE,
      },
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

    if (!post) {
      throw new NotFoundException('Private story link not found or expired.');
    }

    const effectiveViewer: ViewerContext = {
      ...viewer,
      shareToken: shareToken.trim(),
    };

    const evaluation = await this.privatePostsService.evaluateAccess(post, effectiveViewer);
    if (evaluation.locked) {
      return this.privatePostsService.buildLockedPreview(post, evaluation);
    }

    return this.privatePostsService.sanitizePost(post, {
      currentUserId: viewer.userId,
      currentUserRole: viewer.userRole,
    });
  }

  async create(authorId: string, dto: CreatePostDto, userRole?: string) {
    if (dto.id) {
      const existing = await this.prisma.post.findUnique({ where: { id: dto.id } });
      if (existing) {
        return this.updatePost(dto.id, authorId, dto, userRole);
      }
    }

    const visibility =
      dto.visibility ||
      (dto.isPrivate === true
        ? PostVisibility.PRIVATE
        : dto.isPrivate === false
          ? PostVisibility.PUBLIC
          : userRole === Role.READER
            ? PostVisibility.PRIVATE
            : PostVisibility.PUBLIC);

    if (visibility !== PostVisibility.PRIVATE && userRole === Role.READER) {
      throw new ForbiddenException('Only Writers or Admins can publish public stories.');
    }

    const isPrivate = visibility === PostVisibility.PRIVATE;
    let secretPasswordHash: string | undefined = undefined;
    let privateLockType: PrivateLockType = PrivateLockType.NONE;
    const rawPassword = dto.secretPassword ?? dto.password;
    const requestedLockType = dto.privateLockType ?? dto.lockType;

    if (rawPassword && rawPassword.trim() !== '') {
      const trimmed = rawPassword.trim();
      secretPasswordHash = await bcrypt.hash(trimmed, 10);
      privateLockType = this.privatePostsService.detectLockType(trimmed, requestedLockType);
    }

    const shareToken = isPrivate ? this.privatePostsService.generateShareToken() : null;
    const categoryId = await this.resolveCategoryId(dto.categoryId);

    const wordCount = dto.content.replace(/<[^>]*>/g, '').split(/\s+/).filter(Boolean).length;
    const readingTimeMinutes = Math.max(1, Math.ceil(wordCount / 200));

    const firstImage = extractFirstImageFromContent(dto.content);
    let coverImage = dto.coverImage?.trim();
    if (!coverImage || isDefaultPlaceholderCover(coverImage)) {
      coverImage = firstImage || coverImage || DEFAULT_COVER_IMAGE;
    }

    const slugBase = dto.slug || dto.title;
    let slug = slugBase
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (!slug) slug = `story-${Date.now().toString().slice(-6)}`;
    const slugCollision = await this.prisma.post.findFirst({ where: { slug } });
    if (slugCollision) {
      slug = `${slug}-${Date.now().toString().slice(-4)}`;
    }

    const status = dto.status || PostStatus.PUBLISHED;

    const created = await this.prisma.post.create({
      data: {
        title: dto.title,
        subtitle: dto.subtitle,
        slug,
        excerpt: dto.excerpt,
        content: dto.content,
        coverImage,
        authorId,
        categoryId,
        tagIds: dto.tagIds || [],
        status,
        visibility,
        secretPasswordHash,
        privateLockType,
        shareToken,
        allowLinkPasswordAccess: dto.allowLinkPasswordAccess ?? true,
        requirePasswordForGrantedUsers: dto.requirePasswordForGrantedUsers ?? false,
        requireFollowerToView: dto.requireFollowerToView ?? false,
        isFeatured: false,
        readingTimeMinutes,
        wordCount,
        publishedAt: !isPrivate && status === PostStatus.PUBLISHED ? new Date() : null,
      },
      include: {
        author: { select: { id: true, name: true, username: true, avatar: true, bio: true, role: true } },
        category: true,
        tags: true,
      },
    });

    return this.privatePostsService.sanitizePost(created, {
      currentUserId: authorId,
      currentUserRole: userRole,
      includeShareToken: true,
    });
  }

  async updatePost(id: string, actorId: string, dto: any, userRole?: string) {
    const existing = await this.prisma.post.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Post not found');
    const isAdmin = String(userRole || '').toUpperCase() === Role.ADMIN;
    let isCollaborator = false;
    if (existing.authorId !== actorId && !isAdmin) {
      const collab = await this.prisma.postCollaborator.findUnique({
        where: { postId_userId: { postId: existing.id, userId: actorId } },
      });
      if (collab && collab.canEdit) {
        isCollaborator = true;
      }
    }
    if (existing.authorId !== actorId && !isAdmin && !isCollaborator) {
      throw new ForbiddenException('Only the post author, an Admin, or an invited collaborator can update this post.');
    }
    if (isCollaborator && !isAdmin && existing.authorId !== actorId && existing.collabMode === CollabMode.APPROVAL_REQUIRED) {
      throw new ForbiddenException('This story requires author approval for collaborator changes. Please submit a revision suggestion.');
    }

    const categoryId = await this.resolveCategoryId(dto.categoryId || existing.categoryId);

    const content =
      dto.content !== undefined && dto.content !== '' ? dto.content : existing.content;
    const wordCount = content
      .replace(/<[^>]*>/g, '')
      .split(/\s+/)
      .filter(Boolean).length;
    const readingTimeMinutes = Math.max(1, Math.ceil(wordCount / 200));

    const status = dto.status
      ? (dto.status.toUpperCase() as any)
      : existing.status;
    const visibility = dto.visibility
      ? (dto.visibility.toUpperCase() as any)
      : dto.isPrivate === true
        ? PostVisibility.PRIVATE
        : dto.isPrivate === false
          ? PostVisibility.PUBLIC
          : existing.visibility;

    if (visibility !== PostVisibility.PRIVATE && userRole === Role.READER && !isAdmin) {
      throw new ForbiddenException('Only Writers or Admins can publish public stories.');
    }

    const isPrivate = visibility === PostVisibility.PRIVATE;
    const firstImage = extractFirstImageFromContent(content);

    let coverImage = existing.coverImage;
    if (dto.coverImage !== undefined) {
      const trimmed = (dto.coverImage || '').trim();
      if (trimmed && !isDefaultPlaceholderCover(trimmed)) {
        coverImage = trimmed;
      } else if (firstImage) {
        coverImage = firstImage;
      } else {
        coverImage =
          trimmed ||
          (isDefaultPlaceholderCover(existing.coverImage) ? DEFAULT_COVER_IMAGE : existing.coverImage);
      }
    } else if ((!coverImage || isDefaultPlaceholderCover(coverImage)) && firstImage) {
      coverImage = firstImage;
    }

    let slug = existing.slug;
    if (dto.slug && dto.slug !== existing.slug) {
      const slugCandidate = dto.slug
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      if (slugCandidate) {
        const slugCollision = await this.prisma.post.findFirst({
          where: { slug: slugCandidate, id: { not: id } },
        });
        slug = slugCollision ? `${slugCandidate}-${Date.now().toString().slice(-4)}` : slugCandidate;
      }
    }

    let secretPasswordHash = existing.secretPasswordHash;
    let privateLockType = existing.privateLockType ?? PrivateLockType.NONE;
    const rawPassword = dto.secretPassword ?? dto.password;
    const requestedLockType = dto.privateLockType ?? dto.lockType;
    if (dto.removePassword) {
      secretPasswordHash = null;
      privateLockType = PrivateLockType.NONE;
    } else if (rawPassword && String(rawPassword).trim() !== '') {
      const trimmed = String(rawPassword).trim();
      secretPasswordHash = await bcrypt.hash(trimmed, 10);
      privateLockType = this.privatePostsService.detectLockType(trimmed, requestedLockType);
    } else if (requestedLockType) {
      privateLockType = requestedLockType;
    }

    const shareToken = isPrivate
      ? dto.regenerateShareToken
        ? this.privatePostsService.generateShareToken()
        : existing.shareToken || this.privatePostsService.generateShareToken()
      : existing.shareToken;

    const updated = await this.prisma.post.update({
      where: { id },
      data: {
        title: dto.title !== undefined && String(dto.title).trim() !== '' ? dto.title : existing.title,
        subtitle: dto.subtitle !== undefined ? dto.subtitle : existing.subtitle,
        slug,
        excerpt:
          dto.excerpt !== undefined && String(dto.excerpt).trim() !== ''
            ? dto.excerpt
            : existing.excerpt,
        content,
        coverImage,
        categoryId,
        tagIds: dto.tagIds || existing.tagIds,
        status,
        visibility,
        secretPasswordHash,
        privateLockType,
        shareToken,
        allowLinkPasswordAccess:
          dto.allowLinkPasswordAccess ?? existing.allowLinkPasswordAccess ?? true,
        requirePasswordForGrantedUsers:
          dto.requirePasswordForGrantedUsers ??
          existing.requirePasswordForGrantedUsers ??
          false,
        requireFollowerToView:
          dto.requireFollowerToView ?? existing.requireFollowerToView ?? false,
        isFeatured: isPrivate ? false : existing.isFeatured,
        wordCount,
        readingTimeMinutes,
        publishedAt: isPrivate
          ? null
          : status === 'PUBLISHED'
            ? existing.publishedAt || new Date()
            : status === 'DRAFT'
              ? null
              : existing.publishedAt,
      },
      include: {
        author: { select: { id: true, name: true, username: true, avatar: true, bio: true, role: true } },
        category: true,
        tags: true,
        privateAccesses: { select: { id: true, status: true } },
      },
    });

    return this.privatePostsService.sanitizePost(updated, {
      currentUserId: actorId,
      currentUserRole: userRole,
      includeShareToken: true,
    });
  }

  async clap(id: string, actorId: string, count: number = 1, viewer: ViewerContext = {}) {
    const { post } = await this.privatePostsService.assertUnlockedAccess(
      id,
      {
        ...viewer,
        userId: actorId,
      },
      { allowConsumedViewSession: true, allowPinUnlockToken: true },
    );

    if (post.authorId === actorId) {
      throw new ForbiddenException('You cannot clap for your own story');
    }

    const addedClaps = Math.max(1, count);

    try {
      const existingClap = await (this.prisma as any).postClap.findFirst({
        where: { postId: post.id, userId: actorId },
      });

      if (existingClap) {
        await (this.prisma as any).postClap.update({
          where: { id: existingClap.id },
          data: { count: { increment: addedClaps } },
        });
      } else {
        await (this.prisma as any).postClap.create({
          data: {
            postId: post.id,
            userId: actorId,
            count: addedClaps,
          },
        });
      }
    } catch {
      // Fallback
    }

    const updated = await this.prisma.post.update({
      where: { id: post.id },
      data: { clapsCount: { increment: addedClaps } },
    });

    if (post.authorId !== actorId) {
      await this.notificationsService
        .createNotification({
          recipientId: post.authorId,
          actorId,
          type: 'CLAP',
          postId: post.id,
        })
        .catch(() => null);
    }

    return this.privatePostsService.sanitizePost(updated, {
      currentUserId: actorId,
      currentUserRole: viewer.userRole,
    });
  }

  async getClappers(postId: string, viewer: ViewerContext = {}) {
    if (!viewer.userId) {
      throw new ForbiddenException('Please sign in to view who clapped for this story.');
    }

    const { post } = await this.privatePostsService.assertUnlockedAccess(postId, viewer, {
      allowConsumedViewSession: true,
      allowPinUnlockToken: true,
    });

    try {
      const claps = await (this.prisma as any).postClap.findMany({
        where: { postId: post.id },
        include: {
          user: { select: { id: true, name: true, username: true, avatar: true, role: true } },
        },
        orderBy: { count: 'desc' },
      });
      return claps.map((c: any) => ({
        id: c.id,
        count: c.count,
        user: c.user,
      }));
    } catch {
      return [];
    }
  }

  async submitForReview(id: string, authorId: string) {
    const post = await this.prisma.post.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('Post not found');
    if (post.authorId !== authorId) throw new ForbiddenException('Only post author can submit for review');
    if (post.visibility === PostVisibility.PRIVATE) {
      throw new BadRequestException(
        'Private blogs are never posted online and cannot be submitted for public review.',
      );
    }

    return this.prisma.post.update({
      where: { id },
      data: {
        status: 'PENDING_REVIEW',
        reviewFeedback: null,
      },
    });
  }

  async reviewPost(
    id: string,
    status: 'PUBLISHED' | 'NEEDS_REVISION' | 'REJECTED' | 'DRAFT',
    feedback?: string,
    adminId?: string,
    action?: string,
  ) {
    const post = await this.prisma.post.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('Post not found');

    const isFlagImproper = action === 'FLAG_IMPROPER' || status === 'DRAFT';
    const targetStatus = isFlagImproper ? PostStatus.DRAFT : (status as PostStatus);

    if (post.visibility === PostVisibility.PRIVATE && targetStatus === PostStatus.PUBLISHED) {
      throw new BadRequestException('Private blogs cannot be published to the public feed.');
    }

    const updated = await this.prisma.post.update({
      where: { id },
      data: {
        status: targetStatus as any,
        reviewFeedback:
          feedback?.trim() ||
          (isFlagImproper
            ? 'Flagged during editorial review as improper. Converted back to draft for revision.'
            : null),
        isFeatured: targetStatus === PostStatus.PUBLISHED ? post.isFeatured : false,
        publishedAt:
          targetStatus === PostStatus.PUBLISHED
            ? post.publishedAt || new Date()
            : isFlagImproper
              ? null
              : post.publishedAt,
      },
      include: {
        author: { select: { id: true, name: true, username: true, avatar: true, bio: true, role: true } },
        category: true,
        tags: true,
        privateAccesses: { select: { id: true, status: true } },
      },
    });

    if (isFlagImproper && adminId && post.authorId) {
      const reasonText =
        feedback?.trim() ||
        'Your published article was flagged during editorial review and converted back to Draft so you can edit and republish it.';
      await this.notificationsService
        .createNotification({
          recipientId: post.authorId,
          actorId: adminId,
          type: 'EDITORIAL_FLAG',
          postId: post.id,
          message: reasonText,
          allowSelf: true,
        })
        .catch(() => null);
    }

    return this.privatePostsService.sanitizePost(updated, {
      currentUserId: adminId,
      currentUserRole: Role.ADMIN,
      includeShareToken: true,
    });
  }

  async recordView(id: string, viewer: ViewerContext = {}, dto: RecordPostViewDto) {
    const { post } = await this.privatePostsService.assertUnlockedAccess(id, viewer, {
      allowConsumedViewSession: true,
      allowPinUnlockToken: true,
    });

    const actualWordCount = Math.max(post.wordCount || 0, dto.wordCount || 0, 25);
    const required2xMs = Math.max(4000, Math.round((actualWordCount / 500) * 60 * 1000));
    const minAcceptedMs = Math.floor(required2xMs * 0.85);
    const readDurationMs = Number(dto.readDurationMs || 0);

    if (!dto.reachedBottom || readDurationMs < minAcceptedMs) {
      return {
        counted: false,
        viewsCount: post.viewsCount ?? 0,
        requiredReadMs: required2xMs,
      };
    }

    const updated = await this.prisma.post.update({
      where: { id: post.id },
      data: { viewsCount: { increment: 1 } },
      select: { id: true, viewsCount: true },
    });

    if (viewer.userId) {
      const existingHistory = await this.prisma.readingHistory.findFirst({
        where: { userId: viewer.userId, postId: post.id },
      });
      if (existingHistory) {
        await this.prisma.readingHistory
          .update({
            where: { id: existingHistory.id },
            data: { viewedAt: new Date() },
          })
          .catch(() => null);
      } else {
        await this.prisma.readingHistory
          .create({
            data: {
              userId: viewer.userId,
              postId: post.id,
              viewedAt: new Date(),
            },
          })
          .catch(() => null);
      }
    }

    return {
      counted: true,
      viewsCount: updated.viewsCount,
      requiredReadMs: required2xMs,
    };
  }

  async verifySecretPassword(id: string, password: string): Promise<boolean> {
    const post = await this.prisma.post.findUnique({ where: { id } });
    if (!post || !post.secretPasswordHash) return false;

    return bcrypt.compare(password, post.secretPasswordHash);
  }

  async saveDraft(authorId: string, dto: SaveDraftDto, userRole?: string) {
    const isAdmin = String(userRole || '').toUpperCase() === Role.ADMIN;
    const rawTitle = dto.title?.trim();
    const rawSubtitle = dto.subtitle?.trim();
    const requestedVisibility =
      dto.visibility ??
      (dto.isPrivate === true
        ? PostVisibility.PRIVATE
        : dto.isPrivate === false
          ? PostVisibility.PUBLIC
          : undefined);

    if (
      requestedVisibility &&
      requestedVisibility !== PostVisibility.PRIVATE &&
      userRole === Role.READER &&
      !isAdmin
    ) {
      throw new ForbiddenException('Only Writers or Admins can create public stories.');
    }

    const rawCover = dto.coverImage?.trim();
    const rawPassword = dto.secretPassword ?? dto.password;
    const requestedLockType = dto.privateLockType ?? dto.lockType;

    if (dto.id && dto.id.trim() !== '') {
      const postId = dto.id.trim();
      const existing = await this.prisma.post.findUnique({ where: { id: postId } });
      if (!existing) {
        throw new NotFoundException('Draft or story not found.');
      }
      let isCollaborator = false;
      if (existing.authorId !== authorId && !isAdmin) {
        const collab = await this.prisma.postCollaborator.findUnique({
          where: { postId_userId: { postId: existing.id, userId: authorId } },
        });
        if (collab && collab.canEdit) {
          isCollaborator = true;
        }
      }
      if (existing.authorId !== authorId && !isAdmin && !isCollaborator) {
        throw new ForbiddenException('Only the post author, an Admin, or an invited collaborator can edit this story.');
      }
      if (isCollaborator && !isAdmin && existing.authorId !== authorId && existing.collabMode === CollabMode.APPROVAL_REQUIRED) {
        throw new ForbiddenException('This story requires author approval for collaborator changes. Please submit a revision suggestion.');
      }

      const targetVisibility = requestedVisibility || existing.visibility;
      if (targetVisibility !== PostVisibility.PRIVATE && userRole === Role.READER && !isAdmin) {
        throw new ForbiddenException('Only Writers or Admins can create public stories.');
      }

      const resolvedTitle = rawTitle || existing.title || 'Untitled';
      const resolvedSubtitle =
        dto.subtitle !== undefined ? rawSubtitle ?? '' : existing.subtitle;
      const resolvedContent =
        dto.content !== undefined && dto.content !== '' ? dto.content : existing.content;
      const resolvedExcerpt =
        rawSubtitle ||
        existing.excerpt ||
        (resolvedTitle !== 'Untitled' ? resolvedTitle : 'Untitled Story Draft');

      const categoryId = await this.resolveCategoryId(dto.categoryId || existing.categoryId);
      const wordCount = resolvedContent
        .replace(/<[^>]*>/g, '')
        .split(/\s+/)
        .filter(Boolean).length;
      const readingTimeMinutes = Math.max(1, Math.ceil(wordCount / 200));
      const firstImage = extractFirstImageFromContent(resolvedContent);

      let finalCover = existing.coverImage;
      if (rawCover !== undefined && rawCover !== '') {
        if (!isDefaultPlaceholderCover(rawCover)) {
          finalCover = rawCover;
        } else if (firstImage) {
          finalCover = firstImage;
        } else {
          finalCover = rawCover;
        }
      } else if ((!finalCover || isDefaultPlaceholderCover(finalCover)) && firstImage) {
        finalCover = firstImage;
      }

      let secretPasswordHash = existing.secretPasswordHash;
      let privateLockType = existing.privateLockType ?? PrivateLockType.NONE;
      if (dto.removePassword) {
        secretPasswordHash = null;
        privateLockType = PrivateLockType.NONE;
      } else if (rawPassword && rawPassword.trim() !== '') {
        const trimmed = rawPassword.trim();
        secretPasswordHash = await bcrypt.hash(trimmed, 10);
        privateLockType = this.privatePostsService.detectLockType(trimmed, requestedLockType);
      } else if (requestedLockType) {
        privateLockType = requestedLockType;
      }

      const isPrivate = targetVisibility === PostVisibility.PRIVATE;
      const shareToken = isPrivate
        ? existing.shareToken || this.privatePostsService.generateShareToken()
        : existing.shareToken;

      const updatedDraft = await this.prisma.post.update({
        where: { id: postId },
        data: {
          title: resolvedTitle,
          subtitle: resolvedSubtitle,
          excerpt: resolvedExcerpt,
          content: resolvedContent,
          coverImage: finalCover,
          categoryId,
          tagIds: dto.tagIds || existing.tagIds,
          status: existing.status || 'DRAFT',
          visibility: targetVisibility,
          secretPasswordHash,
          privateLockType,
          shareToken,
          allowLinkPasswordAccess:
            dto.allowLinkPasswordAccess ?? existing.allowLinkPasswordAccess ?? true,
          requirePasswordForGrantedUsers:
            dto.requirePasswordForGrantedUsers ??
            existing.requirePasswordForGrantedUsers ??
            false,
          requireFollowerToView:
            dto.requireFollowerToView ?? existing.requireFollowerToView ?? false,
          isFeatured: isPrivate ? false : existing.isFeatured,
          wordCount,
          readingTimeMinutes,
        },
        include: {
          author: { select: { id: true, name: true, username: true, avatar: true, bio: true, role: true } },
          category: true,
          tags: true,
        },
      });

      return this.privatePostsService.sanitizePost(updatedDraft, {
        currentUserId: authorId,
        currentUserRole: userRole,
        includeShareToken: true,
      });
    }

    const title = rawTitle || 'Untitled';
    const subtitle = rawSubtitle || 'Untitled Subtitle';
    const content = dto.content || '<p></p>';
    const excerpt = rawSubtitle || (title !== 'Untitled' ? title : 'Untitled Story Draft');
    const categoryId = await this.resolveCategoryId(dto.categoryId);
    const wordCount = content.replace(/<[^>]*>/g, '').split(/\s+/).filter(Boolean).length;
    const readingTimeMinutes = Math.max(1, Math.ceil(wordCount / 200));
    const firstImage = extractFirstImageFromContent(content);

    const visibility =
      requestedVisibility || (userRole === Role.READER ? PostVisibility.PRIVATE : PostVisibility.PUBLIC);
    const isPrivate = visibility === PostVisibility.PRIVATE;

    let secretPasswordHash: string | undefined = undefined;
    let privateLockType: PrivateLockType = PrivateLockType.NONE;
    if (rawPassword && rawPassword.trim() !== '') {
      const trimmed = rawPassword.trim();
      secretPasswordHash = await bcrypt.hash(trimmed, 10);
      privateLockType = this.privatePostsService.detectLockType(trimmed, requestedLockType);
    }

    const slugBase =
      title !== 'Untitled' ? title.toLowerCase().replace(/[^a-z0-9]+/g, '-') : 'untitled-draft';
    const slug = `${slugBase}-${Date.now()}`;

    let newDraftCover = DEFAULT_COVER_IMAGE;
    if (rawCover && !isDefaultPlaceholderCover(rawCover)) {
      newDraftCover = rawCover;
    } else if (firstImage) {
      newDraftCover = firstImage;
    } else if (rawCover) {
      newDraftCover = rawCover;
    }

    const createdDraft = await this.prisma.post.create({
      data: {
        title,
        subtitle,
        slug,
        excerpt,
        content,
        coverImage: newDraftCover,
        authorId,
        categoryId,
        tagIds: dto.tagIds || [],
        status: PostStatus.DRAFT,
        visibility,
        secretPasswordHash,
        privateLockType,
        shareToken: isPrivate ? this.privatePostsService.generateShareToken() : null,
        allowLinkPasswordAccess: dto.allowLinkPasswordAccess ?? true,
        requirePasswordForGrantedUsers: dto.requirePasswordForGrantedUsers ?? false,
        requireFollowerToView: dto.requireFollowerToView ?? false,
        wordCount,
        readingTimeMinutes,
      },
      include: {
        author: { select: { id: true, name: true, username: true, avatar: true, bio: true, role: true } },
        category: true,
        tags: true,
      },
    });

    return this.privatePostsService.sanitizePost(createdDraft, {
      currentUserId: authorId,
      currentUserRole: userRole,
      includeShareToken: true,
    });
  }

  private async cleanupPostDependencies(postIds: string[]) {
    if (!postIds || postIds.length === 0) return;

    try {
      const comments = await this.prisma.comment.findMany({
        where: { postId: { in: postIds } },
        select: { id: true },
      });
      const commentIds = comments.map((c) => c.id);

      if (commentIds.length > 0) {
        await this.prisma.report.deleteMany({
          where: { commentId: { in: commentIds } },
        });
      }

      await this.prisma.comment.deleteMany({
        where: { postId: { in: postIds }, parentId: { not: null } },
      });

      await this.prisma.comment.deleteMany({
        where: { postId: { in: postIds } },
      });

      await Promise.allSettled([
        this.prisma.postVersion.deleteMany({ where: { postId: { in: postIds } } }),
        this.prisma.bookmark.deleteMany({ where: { postId: { in: postIds } } }),
        this.prisma.highlight.deleteMany({ where: { postId: { in: postIds } } }),
        this.prisma.readingHistory.deleteMany({ where: { postId: { in: postIds } } }),
        this.prisma.postClap.deleteMany({ where: { postId: { in: postIds } } }),
        this.prisma.notification.deleteMany({ where: { postId: { in: postIds } } }),
        this.prisma.privatePostAccess.deleteMany({ where: { postId: { in: postIds } } }),
      ]);
    } catch (err) {
      console.error('Error cleaning up post dependencies:', err);
    }
  }

  async bulkDelete(ids: string[], currentUserId?: string, userRole?: string) {
    if (!ids || ids.length === 0) return { count: 0 };
    const where: any = {
      id: { in: ids },
    };
    if (userRole !== Role.ADMIN && currentUserId) {
      where.authorId = currentUserId;
    }

    const postsToDelete = await this.prisma.post.findMany({
      where,
      select: { id: true },
    });
    const targetIds = postsToDelete.map((p) => p.id);
    if (targetIds.length === 0) return { count: 0 };

    await this.cleanupPostDependencies(targetIds);

    return this.prisma.post.deleteMany({
      where: { id: { in: targetIds } },
    });
  }

  async bulkPublish(ids: string[], currentUserId?: string, userRole?: string) {
    if (!ids || ids.length === 0) return { count: 0 };
    const where: any = {
      id: { in: ids },
      visibility: { not: PostVisibility.PRIVATE },
    };
    if (userRole !== Role.ADMIN && currentUserId) {
      where.authorId = currentUserId;
    }
    return this.prisma.post.updateMany({
      where,
      data: {
        status: PostStatus.PUBLISHED,
        publishedAt: new Date(),
      },
    });
  }

  async deletePost(id: string, authorId: string, userRole?: string) {
    const existing = await this.prisma.post.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Story not found.');
    }
    if (userRole !== Role.ADMIN && existing.authorId !== authorId) {
      throw new ForbiddenException('You do not have permission to delete this story.');
    }

    await this.cleanupPostDependencies([id]);

    await this.prisma.post.delete({
      where: { id },
    });
    return { success: true, message: 'Story deleted successfully.' };
  }
}
