import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest<FastifyRequest>();
    const requestId = (request.headers['x-request-id'] as string) ?? crypto.randomUUID();
    const userId = (request as any).authUser?.id ?? (request as any).profile?.id ?? 'anonymous';
    const startTime = Date.now();

    (request as any).requestId = requestId;

    this.logger.log(
      `${request.method} ${request.url}`,
      {
        requestId,
        userId,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      },
    );

    return next.handle().pipe(
      tap({
        next: (data) => {
          const duration = Date.now() - startTime;
          this.logger.log(
            `${request.method} ${request.url} - ${duration}ms`,
            { requestId, userId, duration },
          );
        },
        error: (error) => {
          const duration = Date.now() - startTime;
          this.logger.error(
            `${request.method} ${request.url} - ${duration}ms - ERROR: ${error.message}`,
            { requestId, userId, duration, error: error.message },
          );
        },
      }),
    );
  }
}
