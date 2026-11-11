import { Module } from '@nestjs/common';
import { PostsService } from './posts.service';
import { PrivatePostsService } from './private-posts.service';
import { PostsController } from './posts.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [NotificationsModule, AuthModule],
  controllers: [PostsController],
  providers: [PostsService, PrivatePostsService],
  exports: [PostsService, PrivatePostsService],
})
export class PostsModule {}
