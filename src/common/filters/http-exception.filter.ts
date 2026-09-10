import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    const requestId = (request.headers['x-request-id'] as string) ?? crypto.randomUUID();
    const userId = (request as any).authUser?.id ?? (request as any).profile?.id ?? 'anonymous';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errorCode = 'INTERNAL_ERROR';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      message = typeof res === 'string' ? res : (res as any).message ?? exception.message;
      errorCode = (res as any).errorCode ?? exception.name;
    } else if (exception instanceof Error) {
      message = exception.message;
      this.logger.error(
        `Unhandled error: ${message}`,
        exception.stack,
        `${request.method} ${request.url}`,
      );
    } else {
      this.logger.error(
        `Unknown exception: ${JSON.stringify(exception)}`,
        undefined,
        `${request.method} ${request.url}`,
      );
    }

    // Don't leak internal details in production
    const isDev = process.env.NODE_ENV !== 'production';
    const errorResponse = {
      success: false,
      statusCode: status,
      error: errorCode,
      message: isDev ? message : (status >= 500 ? 'Internal server error' : message),
      timestamp: new Date().toISOString(),
      path: request.url,
      requestId,
      ...(isDev && exception instanceof Error ? { stack: exception.stack } : {}),
    };

    this.logger.warn(
      `${request.method} ${request.url} - ${status} - ${message}`,
      { requestId, userId, status, errorCode },
    );

    response.status(status).send(errorResponse);
  }
}
