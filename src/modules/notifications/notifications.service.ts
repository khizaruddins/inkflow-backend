import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';

export type NotificationTypeEnum = 'CLAP' | 'RESPONSE' | 'REPLY' | 'FOLLOW';

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  async findForUser(userId: string) {
    const rawNotifs = await this.prisma.notification.findMany({
      where: { recipientId: userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    if (rawNotifs.length === 0) {
      return [
        {
          id: 'notif_welcome',
          type: 'follow',
          actorName: 'InkFlow Team',
          actorAvatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&q=80',
          metaText: 'welcomed you to InkFlow! Discover stories from top creators or start writing your own.',
          isRead: false,
          timestamp: 'Just now',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'notif_editorial',
          type: 'subscribe',
          actorName: 'InkFlow Editorial',
          actorAvatar: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?auto=format&fit=crop&w=150&q=80',
          metaText: 'published a new guide for writers and creators.',
          isRead: true,
          timestamp: '1 day ago',
          createdAt: new Date(Date.now() - 86400000).toISOString(),
        },
      ];
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
            select: { id: true, title: true, slug: true },
          })
        : [],
    ]);

    const actorMap = new Map<string, any>(actors.map((a) => [a.id, a] as [string, any]));
    const postMap = new Map<string, any>(posts.map((p) => [p.id, p] as [string, any]));

    return rawNotifs.map((n) => {
      const actor = actorMap.get(n.actorId);
      const post = n.postId ? postMap.get(n.postId) : null;
      const typeLower = n.type.toLowerCase();

      let metaText = 'interacted with your profile';
      if (n.type === 'CLAP') metaText = 'clapped for';
      else if (n.type === 'RESPONSE') metaText = 'responded to';
      else if (n.type === 'REPLY') metaText = 'replied to your comment on';
      else if (n.type === 'FOLLOW') metaText = 'followed you';

      return {
        id: n.id,
        type: typeLower,
        actorName: actor?.name || 'A user',
        actorAvatar: actor?.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&q=80',
        targetTitle: post?.title,
        targetSlug: post?.slug,
        isRead: n.read,
        metaText,
        timestamp: new Date(n.createdAt).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }),
        createdAt: n.createdAt,
      };
    });
  }

  async markAsRead(id: string) {
    return this.prisma.notification
      .update({
        where: { id },
        data: { read: true },
      })
      .catch(() => ({ success: true }));
  }

  async markAllAsRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { recipientId: userId, read: false },
      data: { read: true },
    });
  }

  async createNotification(data: {
    recipientId: string;
    actorId: string;
    type: NotificationTypeEnum;
    postId?: string;
  }) {
    // Don't notify self
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
