import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { ReportCommentDto } from './dto/report-comment.dto';

@Injectable()
export class CommentsService {
  constructor(private prisma: PrismaService) {}

  async findByPostId(postId: string) {
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(postId);
    if (!isObjectId) return [];

    return this.prisma.comment.findMany({
      where: { postId, parentId: null },
      include: {
        author: { select: { id: true, name: true, username: true, avatar: true } },
        replies: {
          include: {
            author: { select: { id: true, name: true, username: true, avatar: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(authorId: string, dto: CreateCommentDto) {
    const comment = await this.prisma.comment.create({
      data: {
        postId: dto.postId,
        authorId,
        content: dto.content,
        parentId: dto.parentId || null,
      },
      include: {
        author: { select: { id: true, name: true, username: true, avatar: true } },
        replies: true,
      },
    });

    // Update comment count on post
    await this.prisma.post.update({
      where: { id: dto.postId },
      data: { commentsCount: { increment: 1 } },
    });

    return comment;
  }

  async report(commentId: string, reporterId: string, dto: ReportCommentDto) {
    const comment = await this.prisma.comment.findUnique({ where: { id: commentId } });
    if (!comment) throw new NotFoundException('Comment not found');

    const report = await this.prisma.report.create({
      data: {
        commentId,
        reporterId,
        reasons: dto.reasons,
        blockedAuthor: dto.blockAuthor || false,
        status: 'UNDER_EVALUATION',
      },
    });

    if (dto.blockAuthor) {
      const reporter = await this.prisma.user.findUnique({ where: { id: reporterId } });
      if (reporter) {
        await this.prisma.user.update({
          where: { id: reporterId },
          data: {
            followingUserIds: reporter.followingUserIds.filter((id) => id !== comment.authorId),
          },
        });
      }
    }

    return report;
  }
}
