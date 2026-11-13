import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { Role, UserStatus, DeletionRequestStatus, NotificationType } from '@prisma/client';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * List all platform users with roles, status, article count, and metrics.
   */
  async findAll() {
    const users = await this.prisma.user.findMany({
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        avatar: true,
        bio: true,
        role: true,
        status: true,
        pausedAt: true,
        suspendedAt: true,
        suspendedUntil: true,
        suspensionReason: true,
        deletionRequestedAt: true,
        deletionScheduledAt: true,
        followersCount: true,
        followingCount: true,
        createdAt: true,
        _count: {
          select: {
            posts: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const now = new Date();
    return users.map((u) => {
      let daysToUnsuspend: number | null = null;
      if (u.status === UserStatus.SUSPENDED) {
        const suspendedDate = u.suspendedAt ? new Date(u.suspendedAt) : now;
        const unsuspendDate = (u as any).suspendedUntil
          ? new Date((u as any).suspendedUntil)
          : new Date(suspendedDate.getTime() + 14 * 24 * 60 * 60 * 1000);
        daysToUnsuspend = Math.max(1, Math.ceil((unsuspendDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
      }
      return {
        ...u,
        articlesCount: u._count.posts,
        daysToUnsuspend,
      };
    });
  }

  /**
   * Pause the authenticated user's account.
   */
  async pauseAccount(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');

    if (user.status === UserStatus.SUSPENDED) {
      throw new ForbiddenException('A suspended account cannot be paused or modified.');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        status: UserStatus.PAUSED,
        pausedAt: new Date(),
      },
    });

    const { masterPrivatePassword, ...userWithoutPassword } = updated;
    return {
      success: true,
      message: 'Account paused successfully. You cannot read or write stories until unpaused.',
      user: userWithoutPassword,
    };
  }

  /**
   * Unpause the authenticated user's account.
   */
  async unpauseAccount(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');

    if (user.status === UserStatus.SUSPENDED) {
      throw new ForbiddenException('A suspended account cannot be unpaused.');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        status: UserStatus.ACTIVE,
        pausedAt: null,
      },
    });

    const { masterPrivatePassword, ...userWithoutPassword } = updated;
    return {
      success: true,
      message: 'Account unpaused successfully. Full access has been restored.',
      user: userWithoutPassword,
    };
  }

  /**
   * User raises an account deletion request (30 days grace period).
   */
  async requestAccountDeletion(userId: string, email: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');

    if (user.email.toLowerCase().trim() !== email.toLowerCase().trim()) {
      throw new BadRequestException('Provided email does not match your account email.');
    }

    const now = new Date();
    const scheduledFor = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

    // Cancel any previous pending requests
    await this.prisma.accountDeletionRequest.updateMany({
      where: { userId, status: DeletionRequestStatus.PENDING },
      data: { status: DeletionRequestStatus.CANCELLED, cancelledAt: now },
    });

    // Create fresh deletion request
    const request = await this.prisma.accountDeletionRequest.create({
      data: {
        userId,
        userEmail: user.email,
        userName: user.name,
        status: DeletionRequestStatus.PENDING,
        requestedAt: now,
        scheduledFor,
      },
    });

    // Update user status
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        status: UserStatus.PENDING_DELETION,
        deletionRequestedAt: now,
        deletionScheduledAt: scheduledFor,
      },
    });

    // Notify all platform admins
    try {
      const admins = await this.prisma.user.findMany({
        where: { role: 'ADMIN' },
        select: { id: true },
      });
      if (admins.length > 0) {
        await this.prisma.notification.createMany({
          data: admins.map((admin) => ({
            recipientId: admin.id,
            actorId: userId,
            type: NotificationType.EDITORIAL_FLAG,
            message: `⚠️ Deletion Request: ${user.name} (@${user.username}) requested account termination (30-day grace period).`,
            read: false,
          })),
        });
      }
    } catch (err) {
      this.logger.error('Failed to notify admins of account deletion request', err);
    }

    const { masterPrivatePassword, ...userWithoutPassword } = updated;
    return {
      success: true,
      message: 'Account deletion requested. Your account is scheduled for termination in 30 days. You may cancel anytime before then.',
      scheduledFor,
      requestId: request.id,
      user: userWithoutPassword,
    };
  }

  /**
   * User cancels their pending account deletion request.
   */
  async cancelAccountDeletion(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');

    const now = new Date();

    // Mark pending requests as CANCELLED
    await this.prisma.accountDeletionRequest.updateMany({
      where: { userId, status: DeletionRequestStatus.PENDING },
      data: {
        status: DeletionRequestStatus.CANCELLED,
        cancelledAt: now,
      },
    });

    // Restore user to active
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        status: UserStatus.ACTIVE,
        deletionRequestedAt: null,
        deletionScheduledAt: null,
      },
    });

    const { masterPrivatePassword, ...userWithoutPassword } = updated;
    return {
      success: true,
      message: 'Account deletion request has been stopped. Your account remains active.',
      user: userWithoutPassword,
    };
  }

  /**
   * Admin lists all account deletion requests.
   */
  async getDeletionRequests() {
    const requests = await this.prisma.accountDeletionRequest.findMany({
      include: {
        user: {
          select: {
            id: true,
            name: true,
            username: true,
            email: true,
            avatar: true,
            role: true,
            status: true,
          },
        },
      },
      orderBy: { requestedAt: 'desc' },
    });

    const now = new Date();
    return requests.map((req) => ({
      ...req,
      isEligibleForTermination: req.status === DeletionRequestStatus.PENDING && now >= req.scheduledFor,
      daysRemaining: Math.max(0, Math.ceil((req.scheduledFor.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))),
      isOverdue: req.status === DeletionRequestStatus.PENDING && now > req.scheduledFor,
    }));
  }

  /**
   * Suspend a user account (Admin only).
   */
  async suspendUser(targetUserId: string, reason?: string, durationDays: number = 14) {
    const user = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!user) throw new NotFoundException('User not found.');

    if (user.role === Role.ADMIN) {
      throw new ForbiddenException('Administrators cannot be suspended.');
    }

    const now = new Date();
    const days = Number(durationDays) > 0 ? Number(durationDays) : 14;
    const suspendedUntil = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data: {
        status: UserStatus.SUSPENDED,
        suspendedAt: now,
        suspendedUntil,
        suspensionReason: reason || 'Violation of InkFlow Community Guidelines',
      },
    });

    const { masterPrivatePassword, ...userWithoutPassword } = updated;
    return {
      success: true,
      message: `User ${user.name} (@${user.username}) has been suspended for ${days} days.`,
      user: {
        ...userWithoutPassword,
        daysToUnsuspend: days,
      },
    };
  }

  /**
   * Unsuspend a user account (Admin only).
   */
  async unsuspendUser(targetUserId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!user) throw new NotFoundException('User not found.');

    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data: {
        status: UserStatus.ACTIVE,
        suspendedAt: null,
        suspendedUntil: null,
        suspensionReason: null,
      },
    });

    const { masterPrivatePassword, ...userWithoutPassword } = updated;
    return {
      success: true,
      message: `User ${user.name} (@${user.username}) has been restored to Active.`,
      user: userWithoutPassword,
    };
  }

  /**
   * Permanently hard-delete a user and all associated data from MongoDB (Admin only).
   */
  async hardDeleteUser(targetUserId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      include: { posts: { select: { id: true } } },
    });
    if (!user) throw new NotFoundException('User not found.');

    if (user.role === Role.ADMIN) {
      throw new ForbiddenException('Administrator accounts cannot be deleted through this endpoint.');
    }

    this.logger.warn(`Permanently wiping user ${targetUserId} (${user.email}) and all related data...`);

    const userPostIds = user.posts.map((p) => p.id);

    // 1. Delete suggestions on user's posts or created by user
    await this.prisma.postSuggestion.deleteMany({
      where: {
        OR: [{ userId: targetUserId }, { postId: { in: userPostIds } }],
      },
    });

    // 2. Delete collaborators on user's posts or where user is collaborator
    await this.prisma.postCollaborator.deleteMany({
      where: {
        OR: [{ userId: targetUserId }, { postId: { in: userPostIds } }],
      },
    });

    // 3. Delete private accesses granted to user or for user's posts
    await this.prisma.privatePostAccess.deleteMany({
      where: {
        OR: [
          { userId: targetUserId },
          { grantedById: targetUserId },
          { postId: { in: userPostIds } },
        ],
      },
    });

    // 4. Delete claps by user or on user's posts
    await this.prisma.postClap.deleteMany({
      where: {
        OR: [{ userId: targetUserId }, { postId: { in: userPostIds } }],
      },
    });

    // 5. Delete post versions
    if (userPostIds.length > 0) {
      await this.prisma.postVersion.deleteMany({
        where: { postId: { in: userPostIds } },
      });
    }

    // 6. Delete post reports on user's posts or submitted by user
    await this.prisma.postReport.deleteMany({
      where: {
        OR: [{ reporterId: targetUserId }, { postId: { in: userPostIds } }],
      },
    });

    // 7. Delete bookmarks, highlights, reading history, reading lists
    await this.prisma.bookmark.deleteMany({
      where: { OR: [{ userId: targetUserId }, { postId: { in: userPostIds } }] },
    });
    await this.prisma.highlight.deleteMany({
      where: { OR: [{ userId: targetUserId }, { postId: { in: userPostIds } }] },
    });
    await this.prisma.readingHistory.deleteMany({
      where: { OR: [{ userId: targetUserId }, { postId: { in: userPostIds } }] },
    });
    await this.prisma.readingList.deleteMany({
      where: { userId: targetUserId },
    });

    // 8. Delete comments authored by user or on user's posts
    await this.prisma.comment.deleteMany({
      where: {
        OR: [{ authorId: targetUserId }, { postId: { in: userPostIds } }],
      },
    });

    // 9. Delete comment reports submitted by user
    await this.prisma.report.deleteMany({
      where: { reporterId: targetUserId },
    });

    // 10. Delete notifications
    await this.prisma.notification.deleteMany({
      where: {
        OR: [{ recipientId: targetUserId }, { actorId: targetUserId }],
      },
    });

    // 11. Delete creator applications
    await this.prisma.creatorApplication.deleteMany({
      where: { userId: targetUserId },
    });

    // 12. Delete deletion requests
    await this.prisma.accountDeletionRequest.deleteMany({
      where: { userId: targetUserId },
    });

    // 13. Delete all posts
    await this.prisma.post.deleteMany({
      where: { authorId: targetUserId },
    });

    // 14. Delete user document
    await this.prisma.user.delete({
      where: { id: targetUserId },
    });

    return {
      success: true,
      message: `User ${user.name} (${user.email}) and all related MongoDB records have been permanently erased.`,
    };
  }
}
