import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';

@Injectable()
export class LibraryService {
  constructor(private prisma: PrismaService) {}

  // READING LISTS
  async getReadingLists(userId: string) {
    return this.prisma.readingList.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async createReadingList(userId: string, name: string, description?: string, isPrivate = true) {
    return this.prisma.readingList.create({
      data: {
        userId,
        name,
        description,
        isPrivate,
        postIds: [],
      },
    });
  }

  // BOOKMARKS
  async getBookmarks(userId: string) {
    return this.prisma.bookmark.findMany({
      where: { userId },
      include: {
        post: {
          include: {
            author: { select: { id: true, name: true, username: true, avatar: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async toggleBookmark(userId: string, postId: string) {
    const existing = await this.prisma.bookmark.findUnique({
      where: { userId_postId: { userId, postId } },
    });

    if (existing) {
      await this.prisma.bookmark.delete({ where: { id: existing.id } });
      return { bookmarked: false };
    } else {
      await this.prisma.bookmark.create({
        data: { userId, postId },
      });
      return { bookmarked: true };
    }
  }

  // HIGHLIGHTS
  async getHighlights(userId: string) {
    return this.prisma.highlight.findMany({
      where: { userId },
      include: {
        post: { select: { id: true, title: true, slug: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createHighlight(userId: string, postId: string, text: string) {
    return this.prisma.highlight.create({
      data: { userId, postId, text },
    });
  }

  async deleteHighlight(id: string) {
    return this.prisma.highlight.delete({ where: { id } });
  }

  // READING HISTORY
  async getHistory(userId: string) {
    return this.prisma.readingHistory.findMany({
      where: { userId },
      include: {
        post: {
          include: {
            author: { select: { id: true, name: true, avatar: true } },
          },
        },
      },
      orderBy: { viewedAt: 'desc' },
    });
  }

  async recordHistory(userId: string, postId: string) {
    if (!userId || !postId) return null;

    try {
      await this.prisma.post.update({
        where: { id: postId },
        data: { viewsCount: { increment: 1 } },
      });
    } catch (e) {
      // Ignore error if post ID doesn't match objectid
    }

    const existing = await this.prisma.readingHistory.findFirst({
      where: { userId, postId },
    });

    if (existing) {
      return this.prisma.readingHistory.update({
        where: { id: existing.id },
        data: { viewedAt: new Date() },
      });
    }

    return this.prisma.readingHistory.create({
      data: {
        userId,
        postId,
        viewedAt: new Date(),
      },
    });
  }
}
