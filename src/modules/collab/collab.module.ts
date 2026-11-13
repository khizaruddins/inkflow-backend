import { Module, forwardRef } from '@nestjs/common';
import { CollabService } from './collab.service';
import { CollabGateway } from './collab.gateway';
import { CollabController } from './collab.controller';
import { PusherService } from './pusher.service';
import { AuthModule } from '../auth/auth.module';
import { PostsModule } from '../posts/posts.module';

@Module({
  imports: [AuthModule, forwardRef(() => PostsModule)],
  controllers: [CollabController],
  providers: [CollabService, CollabGateway, PusherService],
  exports: [CollabService, CollabGateway, PusherService],
})
export class CollabModule {}
