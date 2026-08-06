import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../common/database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreatePostDto } from './dto/create-post.dto';
import { SaveDraftDto } from './dto/save-draft.dto';

@Injectable()
export class PostsService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) {}

  async findAll(query: {
    status?: string;
    categoryId?: string;
    authorId?: string;
    search?: string;
    feed?: string;
    isFeatured?: boolean;
    currentUserId?: string;
  }) {
    const where: any = {};

    if (query.status) {
      where.status = query.status.toUpperCase();
    } else {
      where.status = 'PUBLISHED';
    }

    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.authorId) where.authorId = query.authorId;
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
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { excerpt: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.post.findMany({
      where,
      include: {
        author: { select: { id: true, name: true, username: true, avatar: true, bio: true } },
        category: true,
        tags: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async toggleFeature(id: string) {
    const post = await this.prisma.post.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('Post not found');

    return this.prisma.post.update({
      where: { id },
      data: {
        isFeatured: !post.isFeatured,
      },
    });
  }

  async findBySlugOrId(identifier: string) {
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(identifier);
    const where: any = isObjectId
      ? { OR: [{ slug: identifier }, { id: identifier }] }
      : { slug: identifier };

    const post = await this.prisma.post.findFirst({
      where,
      include: {
        author: { select: { id: true, name: true, username: true, avatar: true, bio: true } },
        category: true,
        tags: true,
        comments: {
          include: {
            author: { select: { id: true, name: true, username: true, avatar: true } },
            replies: {
              include: { author: { select: { id: true, name: true, username: true, avatar: true } } },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!post) {
      throw new NotFoundException(`Story with identifier '${identifier}' not found.`);
    }

    return post;
  }

  async create(authorId: string, dto: CreatePostDto) {
    let secretPasswordHash: string | undefined = undefined;
    if (dto.secretPassword) {
      secretPasswordHash = await bcrypt.hash(dto.secretPassword, 10);
    }

    // Resolve categoryId if empty or omitted
    let categoryId = dto.categoryId;
    if (!categoryId) {
      let cat = await this.prisma.category.findFirst({ where: { slug: 'general' } });
      if (!cat) cat = await this.prisma.category.findFirst();
      if (!cat) {
        cat = await this.prisma.category.create({
          data: { name: 'General', slug: 'general' },
        });
      }
      categoryId = cat.id;
    }

    // Calculate reading time & metrics
    const wordCount = dto.content.replace(/<[^>]*>/g, '').split(/\s+/).length;
    const readingTimeMinutes = Math.max(1, Math.ceil(wordCount / 200));

    return this.prisma.post.create({
      data: {
        title: dto.title,
        subtitle: dto.subtitle,
        slug: dto.slug,
        excerpt: dto.excerpt,
        content: dto.content,
        coverImage: dto.coverImage,
        authorId,
        categoryId,
        tagIds: dto.tagIds || [],
        status: dto.status || 'PUBLISHED',
        visibility: dto.visibility || 'PUBLIC',
        secretPasswordHash,
        readingTimeMinutes,
        wordCount,
        publishedAt: dto.status === 'PUBLISHED' ? new Date() : null,
      },
    });
  }

  async updatePost(id: string, authorId: string, dto: any) {
    const existing = await this.prisma.post.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Post not found');
    if (existing.authorId !== authorId) {
      throw new ForbiddenException('Only post author can update this post');
    }

    let categoryId = dto.categoryId || existing.categoryId;
    if (!categoryId) {
      let cat = await this.prisma.category.findFirst({ where: { slug: 'general' } });
      if (!cat) cat = await this.prisma.category.findFirst();
      if (!cat) {
        cat = await this.prisma.category.create({
          data: { name: 'General', slug: 'general' },
        });
      }
      categoryId = cat.id;
    }

    const wordCount = (dto.content || existing.content)
      .replace(/<[^>]*>/g, '')
      .split(/\s+/)
      .filter(Boolean).length;
    const readingTimeMinutes = Math.max(1, Math.ceil(wordCount / 200));

    const status = dto.status
      ? (dto.status.toUpperCase() as any)
      : existing.status;
    const visibility = dto.visibility
      ? (dto.visibility.toUpperCase() as any)
      : existing.visibility;

    return this.prisma.post.update({
      where: { id },
      data: {
        title: dto.title || existing.title,
        subtitle: dto.subtitle ?? existing.subtitle,
        slug: dto.slug || existing.slug,
        excerpt: dto.excerpt || existing.excerpt,
        content: dto.content || existing.content,
        coverImage: dto.coverImage || existing.coverImage,
        categoryId,
        tagIds: dto.tagIds || existing.tagIds,
        status,
        visibility,
        wordCount,
        readingTimeMinutes,
        publishedAt: status === 'PUBLISHED' && !existing.publishedAt ? new Date() : existing.publishedAt,
      },
    });
  }

  async clap(id: string, actorId: string, count: number = 1) {
    const post = await this.prisma.post.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('Post not found');

    if (post.authorId === actorId) {
      throw new ForbiddenException('You cannot clap for your own story');
    }

    const addedClaps = Math.max(1, count);

    try {
      const existingClap = await (this.prisma as any).postClap.findFirst({
        where: { postId: id, userId: actorId },
      });

      if (existingClap) {
        await (this.prisma as any).postClap.update({
          where: { id: existingClap.id },
          data: { count: { increment: addedClaps } },
        });
      } else {
        await (this.prisma as any).postClap.create({
          data: {
            postId: id,
            userId: actorId,
            count: addedClaps,
          },
        });
      }
    } catch (e) {
      // Fallback
    }

    const updated = await this.prisma.post.update({
      where: { id },
      data: { clapsCount: { increment: addedClaps } },
    });

    if (post.authorId !== actorId) {
      await this.notificationsService
        .createNotification({
          recipientId: post.authorId,
          actorId,
          type: 'CLAP',
          postId: id,
        })
        .catch(() => null);
    }

    return updated;
  }

  async getClappers(postId: string) {
    try {
      const claps = await (this.prisma as any).postClap.findMany({
        where: { postId },
        include: {
          user: { select: { id: true, name: true, username: true, avatar: true } },
        },
        orderBy: { count: 'desc' },
      });
      return claps.map((c: any) => ({
        id: c.id,
        count: c.count,
        user: c.user,
      }));
    } catch (e) {
      return [];
    }
  }

  async submitForReview(id: string, authorId: string) {
    const post = await this.prisma.post.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('Post not found');
    if (post.authorId !== authorId) throw new ForbiddenException('Only post author can submit for review');

    return this.prisma.post.update({
      where: { id },
      data: {
        status: 'PENDING_REVIEW',
        reviewFeedback: null,
      },
    });
  }

  async reviewPost(id: string, status: 'PUBLISHED' | 'NEEDS_REVISION' | 'REJECTED', feedback?: string) {
    const post = await this.prisma.post.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('Post not found');

    return this.prisma.post.update({
      where: { id },
      data: {
        status: status as any,
        reviewFeedback: feedback || null,
        publishedAt: status === 'PUBLISHED' ? new Date() : post.publishedAt,
      },
    });
  }

  async verifySecretPassword(id: string, password: string): Promise<boolean> {
    const post = await this.prisma.post.findUnique({ where: { id } });
    if (!post || !post.secretPasswordHash) return false;

    return bcrypt.compare(password, post.secretPasswordHash);
  }

  async saveDraft(authorId: string, dto: SaveDraftDto) {
    const rawTitle = dto.title?.trim();
    const rawSubtitle = dto.subtitle?.trim();

    const title = rawTitle || 'Untitled';
    const subtitle = rawSubtitle || 'Untitled Subtitle';
    const content = dto.content || '<p></p>';
    const excerpt = rawSubtitle || (title !== 'Untitled' ? title : 'Untitled Story Draft');

    let categoryId = dto.categoryId;
    if (!categoryId) {
      let cat = await this.prisma.category.findFirst({ where: { slug: 'general' } });
      if (!cat) cat = await this.prisma.category.findFirst();
      if (!cat) {
        cat = await this.prisma.category.create({
          data: { name: 'General', slug: 'general' },
        });
      }
      categoryId = cat.id;
    }

    const wordCount = content.replace(/<[^>]*>/g, '').split(/\s+/).filter(Boolean).length;
    const readingTimeMinutes = Math.max(1, Math.ceil(wordCount / 200));

    // If id is provided, update existing draft
    if (dto.id) {
      const existing = await this.prisma.post.findUnique({ where: { id: dto.id } });
      if (existing && existing.authorId === authorId) {
        return this.prisma.post.update({
          where: { id: dto.id },
          data: {
            title,
            subtitle,
            excerpt,
            content,
            coverImage: dto.coverImage || existing.coverImage,
            categoryId,
            tagIds: dto.tagIds || existing.tagIds,
            status: 'DRAFT',
            wordCount,
            readingTimeMinutes,
          },
        });
      }
    }

    // Create new draft
    const slugBase = title !== 'Untitled'
      ? title.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      : 'untitled-draft';
    const slug = `${slugBase}-${Date.now()}`;

    return this.prisma.post.create({
      data: {
        title,
        subtitle,
        slug,
        excerpt,
        content,
        coverImage:
          dto.coverImage ||
          'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&q=80',
        authorId,
        categoryId,
        tagIds: dto.tagIds || [],
        status: 'DRAFT',
        visibility: 'PUBLIC',
        wordCount,
        readingTimeMinutes,
      },
    });
  }
}
