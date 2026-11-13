import { Injectable, Logger } from '@nestjs/common';
import Pusher from 'pusher';

@Injectable()
export class PusherService {
  private readonly logger = new Logger(PusherService.name);
  private pusher: Pusher | null = null;

  constructor() {
    this.initPusher();
  }

  private initPusher() {
    const appId = process.env.PUSHER_APP_ID || '2211792';
    const key = process.env.PUSHER_KEY || '0dd4e536aa5157a6a3e3';
    const secret = process.env.PUSHER_SECRET;
    const cluster = process.env.PUSHER_CLUSTER || 'ap2';

    if (appId && key && secret && cluster) {
      try {
        this.pusher = new Pusher({
          appId,
          key,
          secret,
          cluster,
          useTLS: true,
        });
        this.logger.log(`✅ Pusher initialized on cluster '${cluster}' with App ID '${appId}'`);
      } catch (err) {
        this.logger.error('Failed to create Pusher instance:', err);
      }
    } else {
      this.logger.warn(
        `⚠️ Pusher not initialized: missing ${
          !secret ? 'PUSHER_SECRET ' : ''
        }${!appId ? 'PUSHER_APP_ID ' : ''}${!key ? 'PUSHER_KEY' : ''}`,
      );
    }
  }

  isConfigured(): boolean {
    return this.pusher !== null;
  }

  async trigger(channel: string, event: string, data: any): Promise<boolean> {
    if (!this.pusher) {
      this.initPusher();
    }

    if (!this.pusher) {
      return false;
    }

    try {
      await this.pusher.trigger(channel, event, data);
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to trigger Pusher event '${event}' on channel '${channel}':`,
        error,
      );
      return false;
    }
  }
}
