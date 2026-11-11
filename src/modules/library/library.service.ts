import { Injectable } from '@nestjs/common';
import { PostVisibility, PrivateAccessStatus, Role } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import { PostsService, RequestUser } from '../posts/posts.service';

@Injectable()
export class LibraryService {
  constructor(
    private prisma: PrismaService,
    private postsService: PostsService,
  ) {}

  private async filterAuthorizedPrivateItems<T extends { post?: any }>(
    items: T[],
    userId: string,
    userRole?: string,
  ): Promise<T[]> {
    const privatePostIds = Array.from(
      new Set(
        items
          .filter((item) => item.post && item.post.visibility === PostVisibility.PRIVATE)
          .map((item) => item.post.id),
      ),
    );

    const activeAccessPostIds = new Set<string>();
    if (privatePostIds.length > 0 && userRole !== Role.ADMIN) {
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
          activeAccessPostIds.add(a.postId);
        }
      }
    }

    return items
      .filter((item) => {
        if (!item.post) return false;
        if (item.post.visibility !== PostVisibility.PRIVATE) return true;
        if (userRole === Role.ADMIN || item.post.authorId === userId) return true;
        return activeAccessPostIds.has(item.post.id);
      })
      .map((item) => {
        if (!item.post) return item;
        const { secretPasswordHash, shareToken, ...restPost } = item.post;
        return {
          ...item,
          post: restPost,
        };
      });
  }

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
  async getBookmarks(userId: string, userRole?: string) {
    const bookmarks = await this.prisma.bookmark.findMany({
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

    return this.filterAuthorizedPrivateItems(bookmarks, userId, userRole);
  }

  async toggleBookmark(
    userId: string,
    postId: string,
    currentUser?: RequestUser | null,
    unlockToken?: string,
  ) {
    const existing = await this.prisma.bookmark.findUnique({
      where: { userId_postId: { userId, postId } },
    });

    if (existing) {
      await this.prisma.bookmark.delete({ where: { id: existing.id } });
      return { bookmarked: false };
    }

    await this.postsService.assertCanAccessPostById(
      postId,
      currentUser || { id: userId, role: Role.READER },
      { unlockToken, allowConsumedViewSession: true },
    );

    await this.prisma.bookmark.create({
      data: { userId, postId },
    });
    return { bookmarked: true };
  }

  // HIGHLIGHTS
  async getHighlights(userId: string, userRole?: string) {
    const highlights = await this.prisma.highlight.findMany({
      where: { userId },
      include: {
        post: {
          select: {
            id: true,
            title: true,
            slug: true,
            coverImage: true,
            visibility: true,
            authorId: true,
            author: { select: { id: true, name: true, avatar: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return this.filterAuthorizedPrivateItems(highlights, userId, userRole);
  }

  async createHighlight(
    userId: string,
    postId: string,
    text: string,
    title?: string,
    note?: string,
    currentUser?: RequestUser | null,
    unlockToken?: string,
  ) {
    await this.postsService.assertCanAccessPostById(
      postId,
      currentUser || { id: userId, role: Role.READER },
      { unlockToken, allowConsumedViewSession: true },
    );

    return this.prisma.highlight.create({
      data: { userId, postId, text, title, note },
      include: {
        post: {
          select: {
            id: true,
            title: true,
            slug: true,
          },
        },
      },
    });
  }

  async deleteHighlight(id: string) {
    return this.prisma.highlight.delete({ where: { id } });
  }

  // READING HISTORY
  async getHistory(userId: string, userRole?: string) {
    const history = await this.prisma.readingHistory.findMany({
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

    return this.filterAuthorizedPrivateItems(history, userId, userRole);
  }

  async recordHistory(
    userId: string,
    postId: string,
    role?: string,
    currentUser?: RequestUser | null,
    unlockToken?: string,
  ) {
    if (!userId || !postId) return null;

    await this.postsService
      .assertCanAccessPostById(
        postId,
        currentUser || { id: userId, role: role || Role.READER },
        { unlockToken, allowConsumedViewSession: true },
      );

    // Super admin views should not be counted as reads
    const isSuperAdmin = role?.toUpperCase() === 'ADMIN';
    if (!isSuperAdmin) {
      try {
        await this.prisma.post.update({
          where: { id: postId },
          data: { viewsCount: { increment: 1 } },
        });
      } catch (e) {
        // Ignore error if post ID doesn't match objectid
      }
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
