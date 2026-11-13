import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { PostReportReason, PostReportStatus, NotificationType } from '@prisma/client';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(private prisma: PrismaService) {}

  // --------------------------------------------------------------------------
  // Comment Reports
  // --------------------------------------------------------------------------

  async findAll() {
    return this.prisma.report.findMany({
      include: {
        comment: {
          include: {
            author: { select: { id: true, name: true, username: true, avatar: true, role: true } },
          },
        },
        reporter: { select: { id: true, name: true, username: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async deleteReportedComment(reportId: string) {
    const report = await this.prisma.report.findUnique({ where: { id: reportId } });
    if (!report) throw new NotFoundException('Report not found');

    // Delete comment safely if exists
    try {
      await this.prisma.comment.delete({ where: { id: report.commentId } });
    } catch (e) {
      this.logger.warn(`Comment ${report.commentId} already deleted or not found.`);
    }

    // Update report status
    return this.prisma.report.update({
      where: { id: reportId },
      data: { status: 'DELETED' },
    });
  }

  async dismissReport(reportId: string) {
    return this.prisma.report.update({
      where: { id: reportId },
      data: { status: 'DISMISSED' },
    });
  }

  // --------------------------------------------------------------------------
  // Post (Blog Story) Reports
  // --------------------------------------------------------------------------

  async createPostReport(postId: string, reporterId: string, reason: string, customNote?: string) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, title: true, authorId: true },
    });
    if (!post) throw new NotFoundException('Post not found.');

    const validReasons: Record<string, PostReportReason> = {
      abusive: PostReportReason.ABUSIVE,
      inappropriate: PostReportReason.INAPPROPRIATE,
      false_claim: PostReportReason.FALSE_CLAIM,
      other: PostReportReason.OTHER,
      ABUSIVE: PostReportReason.ABUSIVE,
      INAPPROPRIATE: PostReportReason.INAPPROPRIATE,
      FALSE_CLAIM: PostReportReason.FALSE_CLAIM,
      OTHER: PostReportReason.OTHER,
    };

    const parsedReason = validReasons[reason] || PostReportReason.OTHER;

    const report = await this.prisma.postReport.create({
      data: {
        postId,
        reporterId,
        reason: parsedReason,
        customNote: customNote?.trim() || null,
        status: PostReportStatus.PENDING,
      },
      include: {
        post: { select: { id: true, title: true, slug: true } },
        reporter: { select: { id: true, name: true, username: true } },
      },
    });

    return {
      success: true,
      message: 'Report submitted successfully. InkFlow admin team will evaluate this story.',
      report,
    };
  }

  async findAllPostReports() {
    return this.prisma.postReport.findMany({
      include: {
        post: {
          select: {
            id: true,
            title: true,
            slug: true,
            excerpt: true,
            visibility: true,
            coverImage: true,
            author: { select: { id: true, name: true, username: true, avatar: true, email: true } },
          },
        },
        reporter: { select: { id: true, name: true, username: true, email: true, avatar: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async deleteReportedPost(reportId: string, adminId?: string) {
    const report = await this.prisma.postReport.findUnique({
      where: { id: reportId },
      include: { post: true },
    });
    if (!report) throw new NotFoundException('Report not found');

    const postId = report.postId;

    // Delete post & cascading dependencies
    await this.prisma.postSuggestion.deleteMany({ where: { postId } });
    await this.prisma.postCollaborator.deleteMany({ where: { postId } });
    await this.prisma.privatePostAccess.deleteMany({ where: { postId } });
    await this.prisma.postClap.deleteMany({ where: { postId } });
    await this.prisma.postVersion.deleteMany({ where: { postId } });
    await this.prisma.bookmark.deleteMany({ where: { postId } });
    await this.prisma.highlight.deleteMany({ where: { postId } });
    await this.prisma.readingHistory.deleteMany({ where: { postId } });
    await this.prisma.comment.deleteMany({ where: { postId } });

    // Mark report as resolved
    await this.prisma.postReport.update({
      where: { id: reportId },
      data: {
        status: PostReportStatus.RESOLVED,
        adminNote: 'Post taken down / deleted by administrator.',
      },
    });

    // Delete the post record itself
    await this.prisma.post.delete({ where: { id: postId } });

    return {
      success: true,
      message: `Story '${report.post?.title || postId}' has been removed from platform.`,
    };
  }

  async warnPostAuthor(reportId: string, adminComment: string, adminId: string) {
    if (!adminComment || adminComment.trim() === '') {
      throw new BadRequestException('Warning comment cannot be empty.');
    }

    const report = await this.prisma.postReport.findUnique({
      where: { id: reportId },
      include: { post: { select: { id: true, title: true, authorId: true } } },
    });
    if (!report) throw new NotFoundException('Report not found');

    const trimmedComment = adminComment.trim();

    // Update post reviewFeedback
    await this.prisma.post.update({
      where: { id: report.postId },
      data: {
        reviewFeedback: trimmedComment,
      },
    });

    // Send notification to author
    if (report.post?.authorId) {
      await this.prisma.notification.create({
        data: {
          recipientId: report.post.authorId,
          type: NotificationType.EDITORIAL_FLAG,
          actorId: adminId,
          postId: report.postId,
          message: `Admin Notice regarding "${report.post.title}": ${trimmedComment}`,
        },
      });
    }

    // Update report
    return this.prisma.postReport.update({
      where: { id: reportId },
      data: {
        status: PostReportStatus.RESOLVED,
        adminNote: `Warning sent to author: "${trimmedComment}"`,
      },
    });
  }

  async dismissPostReport(reportId: string) {
    return this.prisma.postReport.update({
      where: { id: reportId },
      data: {
        status: PostReportStatus.DISMISSED,
        adminNote: 'Dismissed by administrator after review.',
      },
    });
  }
}
