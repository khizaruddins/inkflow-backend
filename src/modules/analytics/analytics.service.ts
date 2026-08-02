import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  async getSummary() {
    const totalPosts = await this.prisma.post.count();
    const publishedPosts = await this.prisma.post.count({ where: { status: 'PUBLISHED' } });
    const totalUsers = await this.prisma.user.count();
    const writersCount = await this.prisma.user.count({ where: { role: { in: ['WRITER', 'ADMIN'] } } });
    const readersCount = await this.prisma.user.count({ where: { role: 'READER' } });
    
    const postStats = await this.prisma.post.aggregate({
      _sum: {
        viewsCount: true,
        clapsCount: true,
        commentsCount: true,
      },
    });

    return {
      success: true,
      data: {
        totalPosts,
        publishedPosts,
        totalUsers,
        writersCount,
        readersCount,
        totalViews: postStats._sum.viewsCount || 0,
        totalClaps: postStats._sum.clapsCount || 0,
        totalComments: postStats._sum.commentsCount || 0,
      },
    };
  }
}
