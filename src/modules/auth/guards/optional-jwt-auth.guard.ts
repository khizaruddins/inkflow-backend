import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Populates req.user when a valid JWT is present while allowing unauthenticated requests through.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      await super.canActivate(context);
    } catch {
      // Allow anonymous access when JWT is missing, expired, or invalid
    }
    return true;
  }

  handleRequest(_err: any, user: any) {
    return user || null;
  }
}
