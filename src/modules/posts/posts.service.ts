import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../common/database/prisma.service';
import { CreatePostDto } from './dto/create-post.dto';

@Injectable()
export class PostsService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: { status?: string; categoryId?: string; authorId?: string; search?: string }) {
    const where: any = {};

    if (query.status) where.status = query.status;
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.authorId) where.authorId = query.authorId;

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
        categoryId: dto.categoryId,
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

  async clap(id: string) {
    const post = await this.prisma.post.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('Post not found');

    return this.prisma.post.update({
      where: { id },
      data: { clapsCount: { increment: 1 } },
    });
  }

  async verifySecretPassword(id: string, password: string): Promise<boolean> {
    const post = await this.prisma.post.findUnique({ where: { id } });
    if (!post || !post.secretPasswordHash) return false;

    return bcrypt.compare(password, post.secretPasswordHash);
  }
}
