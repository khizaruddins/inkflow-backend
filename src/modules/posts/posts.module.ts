import { Module } from '@nestjs/common';
import { PostsService } from './posts.service';
import { PrivatePostsService } from './private-posts.service';
import { PostEncryptionService } from './post-encryption.service';
import { PostsController } from './posts.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [NotificationsModule, AuthModule],
  controllers: [PostsController],
  providers: [PostsService, PrivatePostsService, PostEncryptionService],
  exports: [PostsService, PrivatePostsService, PostEncryptionService],
})
export class PostsModule {}

