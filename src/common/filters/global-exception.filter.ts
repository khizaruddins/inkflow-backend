import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    this.logger.error(`Exception on ${request.method} ${request.url}`, exception instanceof Error ? exception.stack : String(exception));

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse: any =
      exception instanceof HttpException ? exception.getResponse() : null;

    let message = 'Internal server error';
    let errors: any = null;
    let code: string | undefined;
    let meta: any = null;

    if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
      message = exceptionResponse.message || exceptionResponse.error || message;
      errors = exceptionResponse.message || null;
      code = exceptionResponse.code;
      const { message: _m, error: _e, statusCode: _s, code: _c, ...extra } = exceptionResponse;
      if (Object.keys(extra).length > 0) {
        meta = extra;
      }
    } else if (typeof exceptionResponse === 'string') {
      message = exceptionResponse;
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    response.status(status).json({
      success: false,
      message,
      ...(code ? { code } : {}),
      data: null,
      meta,
      errors: Array.isArray(errors) ? errors : [message],
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
