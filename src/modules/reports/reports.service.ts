import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.report.findMany({
      include: {
        comment: {
          include: {
            author: { select: { id: true, name: true, username: true, avatar: true } },
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

    // Delete comment
    await this.prisma.comment.delete({ where: { id: report.commentId } });

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
}
