import { Module } from '@nestjs/common';
import { CollabService } from './collab.service';
import { CollabGateway } from './collab.gateway';
import { CollabController } from './collab.controller';
import { PusherService } from './pusher.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [CollabController],
  providers: [CollabService, CollabGateway, PusherService],
  exports: [CollabService, CollabGateway, PusherService],
})
export class CollabModule {}
