import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';

export type NotificationTypeEnum = 'CLAP' | 'RESPONSE' | 'REPLY' | 'FOLLOW';

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
        select: { followingUserIds: true },
      }),
    ]);

    const followingIds = currentUser?.followingUserIds || [];
    const existingPostIds = new Set(rawNotifs.map((n) => n.postId).filter(Boolean));

    // Ensure publications from followed creators are persisted as real notifications
    if (followingIds.length > 0) {
      const followedPosts = await this.prisma.post.findMany({
        where: {
          authorId: { in: followingIds },
          status: 'PUBLISHED',
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
            select: { id: true, name: true, avatar: true, username: true },
          })
        : [],
      postIds.length > 0
        ? this.prisma.post.findMany({
            where: { id: { in: postIds } },
            select: { id: true, title: true, slug: true, authorId: true },
          })
        : [],
    ]);

    const actorMap = new Map<string, any>(actors.map((a) => [a.id, a] as [string, any]));
    const postMap = new Map<string, any>(posts.map((p) => [p.id, p] as [string, any]));

    const formattedNotifs = rawNotifs.map((n) => {
      const actor = actorMap.get(n.actorId);
      const post = n.postId ? postMap.get(n.postId) : null;
      const typeLower = n.type.toLowerCase();

      let metaText = 'interacted with your profile';
      let title = post?.title;
      let slug = post?.slug;
      let displayActorName = actor?.name || 'A user';

      if (n.type === 'CLAP') {
        metaText = 'clapped for';
      } else if (n.type === 'RESPONSE') {
        metaText = 'responded to';
      } else if (n.type === 'REPLY') {
        metaText = 'replied to your comment on';
      } else if (n.type === 'FOLLOW') {
        if (!n.postId && currentUser?.followingUserIds?.includes(n.actorId)) {
          displayActorName = `You started following ${actor?.name || 'writer'}`;
          metaText = '';
        } else {
          metaText = 'started following you';
        }
      }

      if (post && post.authorId === n.actorId) {
        displayActorName = actor?.name || 'Writer';
        metaText = 'published';
      }

      return {
        id: n.id,
        type: post && post.authorId === n.actorId ? 'publish' : typeLower,
        actorName: displayActorName,
        actorAvatar:
          actor?.avatar ||
          `https://ui-avatars.com/api/?name=${encodeURIComponent(displayActorName)}&background=random`,
        targetTitle: title,
        targetSlug: slug,
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
  }) {
    if (data.recipientId === data.actorId) return null;

    return this.prisma.notification.create({
      data: {
        recipientId: data.recipientId,
        actorId: data.actorId,
        type: data.type as any,
        postId: data.postId || null,
        read: false,
      },
    });
  }
}
