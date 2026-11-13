import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './common/database/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { PostsModule } from './modules/posts/posts.module';
import { CommentsModule } from './modules/comments/comments.module';
import { ReportsModule } from './modules/reports/reports.module';
import { LibraryModule } from './modules/library/library.module';
import { HealthModule } from './modules/health/health.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { UnsplashModule } from './modules/unsplash/unsplash.module';
import { CollabModule } from './modules/collab/collab.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    PostsModule,
    CommentsModule,
    ReportsModule,
    LibraryModule,
    HealthModule,
    AnalyticsModule,
    ApplicationsModule,
    NotificationsModule,
    CategoriesModule,
    UnsplashModule,
    CollabModule,
  ],
})
export class AppModule {}
