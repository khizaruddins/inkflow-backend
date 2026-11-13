import { Injectable } from '@nestjs/common';
import { PostVisibility, PrivateAccessStatus } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';

export type NotificationTypeEnum =
  | 'CLAP'
  | 'RESPONSE'
  | 'REPLY'
  | 'FOLLOW'
  | 'PRIVATE_SHARE'
  | 'EDITORIAL_FLAG';

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  private formatTimeAgo(date: Date | string): string {
    const d = new Date(date);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffSecs = Math.max(0, Math.floor(diffMs / 1000));
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min${diffMins === 1 ? '' : 's'} ago`;
    if (diffHours < 24) return `${diffHours} hr${diffHours === 1 ? '' : 's'} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  async findForUser(userId: string) {
    const [rawNotifs, currentUser] = await Promise.all([
      this.prisma.notification.findMany({
        where: { recipientId: userId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { followingUserIds: true, role: true },
      }),
    ]);

    const followingIds = currentUser?.followingUserIds || [];
    const existingPostIds = new Set(rawNotifs.map((n) => n.postId).filter(Boolean));

    // Ensure publications from followed creators are persisted as real notifications (never private blogs!)
    if (followingIds.length > 0) {
      const followedPosts = await this.prisma.post.findMany({
        where: {
          authorId: { in: followingIds },
          status: 'PUBLISHED',
          visibility: { not: PostVisibility.PRIVATE },
        },
        orderBy: { publishedAt: 'desc' },
        take: 20,
      });

      for (const p of followedPosts) {
        if (!existingPostIds.has(p.id)) {
          try {
            const created = await this.prisma.notification.create({
              data: {
                recipientId: userId,
                actorId: p.authorId,
                postId: p.id,
                type: 'FOLLOW',
                read: false,
                createdAt: p.publishedAt || p.createdAt,
              },
            });
            existingPostIds.add(p.id);
            rawNotifs.push(created);
          } catch {}
        }
      }

      // Ensure follow records for followed users are persisted
      for (const fId of followingIds) {
        const hasFollowNotif = rawNotifs.some((n) => n.actorId === fId && !n.postId);
        if (!hasFollowNotif) {
          try {
            const created = await this.prisma.notification.create({
              data: {
                recipientId: userId,
                actorId: fId,
                type: 'FOLLOW',
                message: 'you started following',
                read: false,
              },
            });
            rawNotifs.push(created);
          } catch {}
        }
      }
    }

    const actorIds = Array.from(new Set(rawNotifs.map((n) => n.actorId).filter(Boolean)));
    const postIds = Array.from(new Set(rawNotifs.map((n) => n.postId).filter(Boolean))) as string[];

    const [actors, posts] = await Promise.all([
      actorIds.length > 0
        ? this.prisma.user.findMany({
            where: { id: { in: actorIds } },
            select: { id: true, name: true, avatar: true, username: true, role: true },
          })
        : [],
      postIds.length > 0
        ? this.prisma.post.findMany({
            where: { id: { in: postIds } },
            select: { id: true, title: true, slug: true, authorId: true, visibility: true, status: true },
          })
        : [],
    ]);

    const privatePostIds = posts
      .filter((p) => p.visibility === PostVisibility.PRIVATE && p.authorId !== userId)
      .map((p) => p.id);

    const activePrivateAccessIds = new Set<string>();
    if (privatePostIds.length > 0) {
      const accesses = await this.prisma.privatePostAccess.findMany({
        where: {
          userId,
          postId: { in: privatePostIds },
          status: PrivateAccessStatus.ACTIVE,
        },
        select: { postId: true, oneTimeView: true, hasViewed: true },
      });
      for (const a of accesses) {
        if (!(a.oneTimeView && a.hasViewed)) {
          activePrivateAccessIds.add(a.postId);
        }
      }
    }

    const actorMap = new Map<string, any>(actors.map((a) => [a.id, a] as [string, any]));
    const postMap = new Map<string, any>(posts.map((p) => [p.id, p] as [string, any]));

    const visibleNotifs = rawNotifs.filter((n) => {
      if (!n.postId) return true;
      if (currentUser?.role === 'ADMIN') return true;
      const post = postMap.get(n.postId);
      if (!post) return true;
      if (post.visibility !== PostVisibility.PRIVATE) return true;
      if (post.authorId === userId) return true;
      return activePrivateAccessIds.has(post.id);
    });

    const formattedNotifs = visibleNotifs.map((n) => {
      const actor = actorMap.get(n.actorId);
      const post = n.postId ? postMap.get(n.postId) : null;
      const typeLower = n.type.toLowerCase();

      let metaText = 'interacted with your profile';
      let title = post?.title;
      let slug = post?.slug;
      let displayActorName = actor?.name || 'A user';
      const isEditorialFlag = (n.type as string) === 'EDITORIAL_FLAG';

      if (isEditorialFlag) {
        const msg = n.message || '';
        if (msg.includes('Story Reported')) {
          metaText = 'reported a story for moderation:';
        } else if (msg.includes('Comment Reported')) {
          metaText = 'reported a comment:';
        } else if (msg.includes('Deletion Request')) {
          metaText = 'requested account termination:';
        } else if (msg.includes('Creator Application')) {
          metaText = 'submitted a creator application:';
        } else {
          displayActorName = actor?.name || 'Editorial Team';
          metaText = n.message
            ? `flagged your story as improper and moved it to Draft ("${n.message}"):`
            : 'flagged your story as improper and moved it to Draft so you can edit and republish:';
        }
      } else if (n.type === 'CLAP') {
        metaText = 'clapped for';
      } else if (n.type === 'RESPONSE') {
        metaText = 'responded to';
      } else if (n.type === 'REPLY') {
        metaText = 'replied to your comment on';
      } else if ((n.type as string) === 'PRIVATE_SHARE') {
        metaText = 'shared a private story with you:';
      } else if (n.type === 'FOLLOW') {
        const isOutgoing =
          n.message === 'you started following' ||
          (!n.message &&
            !n.postId &&
            currentUser?.followingUserIds?.some((id) => String(id) === String(n.actorId)));

        if (isOutgoing) {
          displayActorName = 'You';
          metaText = 'started following';
          title = actor?.name || 'Writer';
          slug = actor?.username || actor?.id;
        } else {
          displayActorName = actor?.name || 'A user';
          metaText = 'started following you';
          title = undefined;
          slug = actor?.username || actor?.id;
        }
      }

      if (
        post &&
        post.authorId === n.actorId &&
        (n.type as string) !== 'PRIVATE_SHARE' &&
        !isEditorialFlag
      ) {
        displayActorName = actor?.name || 'Writer';
        metaText = 'published';
      }

      return {
        id: n.id,
        type:
          post &&
          post.authorId === n.actorId &&
          (n.type as string) !== 'PRIVATE_SHARE' &&
          !isEditorialFlag
            ? 'publish'
            : typeLower,
        actorName: displayActorName,
        actorRole: actor?.role || undefined,
        actorAvatar:
          actor?.avatar ||
          `https://ui-avatars.com/api/?name=${encodeURIComponent(actor?.name || displayActorName)}&background=random`,
        targetId: post?.id || n.postId || (n.type === 'FOLLOW' ? actor?.id : undefined),
        targetTitle: title,
        targetSlug: slug,
        targetStatus: post?.status,
        message: n.message || undefined,
        isRead: Boolean(n.read),
        metaText,
        timestamp: this.formatTimeAgo(n.createdAt),
        createdAt: n.createdAt,
      };
    });

    formattedNotifs.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return formattedNotifs;
  }

  async markAsRead(id: string) {
    return this.prisma.notification
      .update({
        where: { id },
        data: { read: true },
      })
      .then(() => ({ success: true }))
      .catch(() => ({ success: true }));
  }

  async markAllAsRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { recipientId: userId, read: false },
      data: { read: true },
    });
    return { success: true };
  }

  async createNotification(data: {
    recipientId: string;
    actorId: string;
    type: NotificationTypeEnum;
    postId?: string;
    message?: string;
    allowSelf?: boolean;
  }) {
    if (!data.allowSelf && data.recipientId === data.actorId) return null;

    return this.prisma.notification.create({
      data: {
        recipientId: data.recipientId,
        actorId: data.actorId,
        type: data.type as any,
        postId: data.postId || null,
        message: data.message || null,
        read: false,
      },
    });
  }
}
