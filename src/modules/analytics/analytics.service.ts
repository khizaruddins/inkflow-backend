import { Injectable } from '@nestjs/common';
import { PostStatus, PostVisibility, Role } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  private computeMonthlyTrend(recent: number, total: number): number {
    if (total <= 0 || recent <= 0) return 0;
    const baseline = total - recent;
    if (baseline <= 0) return 100;
    return Math.min(999, Math.round((recent / baseline) * 100));
  }

  async getSummary(currentUser?: { id?: string; sub?: string; role?: string }) {
    const userId = currentUser?.id || currentUser?.sub || null;
    const isAdmin = String(currentUser?.role || '').toUpperCase() === Role.ADMIN;

    const scopeWhere: any = !isAdmin && userId ? { authorId: userId } : {};
    const publishedPublicWhere: any = {
      ...scopeWhere,
      status: PostStatus.PUBLISHED,
      visibility: { not: PostVisibility.PRIVATE },
    };

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [
      scopedPosts,
      recentPublishedCount,
      subscriberAgg,
      activeFollowerUsersCount,
      recentSubscribersCount,
      authorRecord,
      privateAccessViews,
      recentHistory,
    ] = await Promise.all([
      this.prisma.post.findMany({
        where: scopeWhere,
        select: {
          id: true,
          title: true,
          slug: true,
          status: true,
          visibility: true,
          viewsCount: true,
          clapsCount: true,
          commentsCount: true,
          readingTimeMinutes: true,
          publishedAt: true,
          createdAt: true,
        },
      }),
      this.prisma.post.count({
        where: {
          ...publishedPublicWhere,
          OR: [
            { publishedAt: { gte: thirtyDaysAgo } },
            { publishedAt: null, createdAt: { gte: thirtyDaysAgo } },
          ],
        },
      }),
      this.prisma.user.aggregate({
        _sum: { followersCount: true },
      }),
      this.prisma.user.count({
        where: {
          NOT: {
            followingUserIds: { isEmpty: true },
          },
        },
      }),
      this.prisma.user.count({
        where: {
          createdAt: { gte: thirtyDaysAgo },
          NOT: {
            followingUserIds: { isEmpty: true },
          },
        },
      }),
      !isAdmin && userId
        ? this.prisma.user.findUnique({
            where: { id: userId },
            select: { followersCount: true },
          })
        : Promise.resolve(null),
      this.prisma.privatePostAccess.aggregate({
        where: !isAdmin && userId ? { post: { authorId: userId } } : undefined,
        _sum: { viewCount: true },
      }),
      this.prisma.readingHistory.findMany({
        where: {
          viewedAt: { gte: thirtyDaysAgo },
          ...(!isAdmin && userId ? { post: { authorId: userId } } : {}),
        },
        select: { viewedAt: true, userId: true },
      }),
    ]);

    const publishedPosts = scopedPosts.filter(
      (p) => p.status === PostStatus.PUBLISHED && p.visibility !== PostVisibility.PRIVATE,
    );

    const totalPublished = publishedPosts.length;
    const totalViews = scopedPosts.reduce((acc, p) => acc + (p.viewsCount || 0), 0);
    const totalClaps = scopedPosts.reduce((acc, p) => acc + (p.clapsCount || 0), 0);

    const recentViews = scopedPosts
      .filter((p) => {
        const refDate = p.publishedAt || p.createdAt;
        return refDate >= thirtyDaysAgo;
      })
      .reduce((acc, p) => acc + (p.viewsCount || 0), 0);

    const recentClaps = scopedPosts
      .filter((p) => {
        const refDate = p.publishedAt || p.createdAt;
        return refDate >= thirtyDaysAgo;
      })
      .reduce((acc, p) => acc + (p.clapsCount || 0), 0);

    const totalSubscribers = !isAdmin && userId
      ? Math.max(0, authorRecord?.followersCount || 0)
      : Math.max(subscriberAgg._sum.followersCount || 0, activeFollowerUsersCount);

    const readingTimeMinutesTotal = scopedPosts.reduce(
      (acc, p) => acc + (p.viewsCount || 0) * Math.max(1, p.readingTimeMinutes || 3),
      0,
    );
    const readingTimeHours = Math.round((readingTimeMinutesTotal / 60) * 10) / 10;

    // Rank top 3 to 5 performing published articles by combined engagement (views, claps, comments)
    const topArticles = [...publishedPosts]
      .sort((a, b) => {
        const scoreA = (a.viewsCount || 0) * 2 + (a.clapsCount || 0) * 3 + (a.commentsCount || 0) * 2;
        const scoreB = (b.viewsCount || 0) * 2 + (b.clapsCount || 0) * 3 + (b.commentsCount || 0) * 2;
        if (scoreB !== scoreA) return scoreB - scoreA;
        if ((b.viewsCount || 0) !== (a.viewsCount || 0)) return (b.viewsCount || 0) - (a.viewsCount || 0);
        return (b.clapsCount || 0) - (a.clapsCount || 0);
      })
      .slice(0, 5)
      .map((p) => ({
        id: p.id,
        title: p.title,
        slug: p.slug,
        views: p.viewsCount || 0,
        readingTime: `${Math.max(1, p.readingTimeMinutes || 1)} min read`,
        claps: p.clapsCount || 0,
      }));

    // Build real acquisition/visibility breakdown from post views
    const publicViewsSum = scopedPosts
      .filter((p) => p.visibility !== PostVisibility.PRIVATE)
      .reduce((acc, p) => acc + (p.viewsCount || 0), 0);
    const privateViewsSum = scopedPosts
      .filter((p) => p.visibility === PostVisibility.PRIVATE)
      .reduce((acc, p) => acc + (p.viewsCount || 0), 0);
    const sharedInviteViews = privateAccessViews._sum.viewCount || 0;
    const totalTracked = Math.max(1, publicViewsSum + privateViewsSum + sharedInviteViews);

    const trafficSources =
      publicViewsSum + privateViewsSum + sharedInviteViews > 0
        ? [
            {
              name: 'Public Story Reads',
              value: Math.round((publicViewsSum / totalTracked) * 100),
              color: '#10b981',
            },
            {
              name: 'Private Share Links',
              value: Math.round((privateViewsSum / totalTracked) * 100),
              color: '#3b82f6',
            },
            {
              name: 'Invited Reader Access',
              value: Math.max(
                0,
                100 -
                  Math.round((publicViewsSum / totalTracked) * 100) -
                  Math.round((privateViewsSum / totalTracked) * 100),
              ),
              color: '#8b5cf6',
            },
          ].filter((s) => s.value > 0)
        : [];

    // Aggregate recent 7-day reading history counts
    const dailyMap = new Map<string, { views: number; visitors: Set<string> }>();
    for (const h of recentHistory) {
      const dateKey = new Date(h.viewedAt).toISOString().slice(0, 10);
      if (!dailyMap.has(dateKey)) {
        dailyMap.set(dateKey, { views: 0, visitors: new Set() });
      }
      const bucket = dailyMap.get(dateKey)!;
      bucket.views += 1;
      bucket.visitors.add(h.userId);
    }

    const dailyViews = Array.from(dailyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, info]) => ({
        date,
        views: info.views,
        uniqueVisitors: info.visitors.size,
      }));

    return {
      totalViews,
      viewsTrend: this.computeMonthlyTrend(recentViews, totalViews),
      totalPublished,
      publishedTrend: this.computeMonthlyTrend(recentPublishedCount, totalPublished),
      totalClaps,
      clapsTrend: this.computeMonthlyTrend(recentClaps, totalClaps),
      totalSubscribers,
      subscribersTrend: this.computeMonthlyTrend(recentSubscribersCount, totalSubscribers),
      readingTimeHours,
      trafficSources,
      countryStats: [],
      dailyViews,
      topArticles,
      totalPosts: scopedPosts.length,
      publishedPosts: totalPublished,
      totalComments: scopedPosts.reduce((acc, p) => acc + (p.commentsCount || 0), 0),
    };
  }
}
