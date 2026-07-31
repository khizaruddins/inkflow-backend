import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ResponseEnvelope<T> {
  success: boolean;
  message: string;
  data: T;
  meta: any;
  errors: any;
}

@Injectable()
export class ResponseTransformInterceptor<T> implements NestInterceptor<T, ResponseEnvelope<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<ResponseEnvelope<T>> {
    return next.handle().pipe(
      map((res) => {
        // Handle paginated responses or custom meta envelopes
        const isPaginated = res && typeof res === 'object' && 'data' in res && 'meta' in res;
        const data = isPaginated ? res.data : res;
        const meta = isPaginated ? res.meta : null;
        const message = res && typeof res === 'object' && res.message ? res.message : 'Operation successful';

        return {
          success: true,
          message,
          data,
          meta,
          errors: null,
        };
      }),
    );
  }
}
