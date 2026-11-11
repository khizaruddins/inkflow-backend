import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Populates req.user when a valid JWT is present while allowing unauthenticated requests through.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  private hasAttemptedJwt(req: any): boolean {
    const authHeader = req?.headers?.authorization;
    const hasBearer =
      typeof authHeader === 'string' &&
      authHeader.startsWith('Bearer ') &&
      !['Bearer', 'Bearer null', 'Bearer undefined'].includes(authHeader.trim());
    const cookieToken = req?.cookies?.accessToken;
    const hasCookie =
      Boolean(cookieToken) && cookieToken !== 'null' && cookieToken !== 'undefined';
    return hasBearer || hasCookie;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    try {
      await super.canActivate(context);
    } catch {
      if (this.hasAttemptedJwt(req)) {
        req.jwtAuthFailed = true;
      }
    }
    return true;
  }

  handleRequest(_err: any, user: any, _info: any, context?: ExecutionContext) {
    if (!user && context) {
      const req = context.switchToHttp().getRequest();
      if (this.hasAttemptedJwt(req)) {
        req.jwtAuthFailed = true;
      }
    }
    return user || null;
  }
}
