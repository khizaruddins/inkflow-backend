import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { Express } from 'express';
import { bootstrap } from '../src/main';

let handler: Express | null = null;

export default async function vercelHandler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  try {
    if (!handler) {
      const app = await bootstrap();
      handler = app.getHttpAdapter().getInstance() as Express;
    }

    handler(req, res);
  } catch (error: unknown) {
    console.error('❌ Vercel Serverless Initialization Error:', error);

    res.status(500).json({
      success: false,
      error: 'Vercel Serverless Initialization Error',
      message:
        error instanceof Error
          ? error.message
          : 'Unknown serverless initialization error',
    });
  }
}
