import { Module } from '@nestjs/common';
import { CollabService } from './collab.service';
import { CollabGateway } from './collab.gateway';
import { CollabController } from './collab.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [CollabController],
  providers: [CollabService, CollabGateway],
  exports: [CollabService, CollabGateway],
})
export class CollabModule {}
