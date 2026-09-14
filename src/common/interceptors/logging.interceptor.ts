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
    const suppliedRequestId = request.headers['x-request-id'];
    const requestId =
      typeof suppliedRequestId === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(suppliedRequestId)
        ? suppliedRequestId
        : crypto.randomUUID();
    const userId = (request as any).authUser?.id ?? (request as any).profile?.id ?? 'anonymous';
    const startTime = Date.now();

    (request as any).requestId = requestId;

    this.logger.log(`${request.method} ${request.routeOptions?.url ?? request.url.split('?')[0]}`, {
      requestId,
      userId,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - startTime;
          this.logger.log(
            `${request.method} ${request.routeOptions?.url ?? request.url.split('?')[0]} - ${duration}ms`,
            { requestId, userId, duration },
          );
        },
        error: (error: unknown) => {
          const duration = Date.now() - startTime;
          const errorName = error instanceof Error ? error.name : 'UnknownError';
          this.logger.error(
            `${request.method} ${request.routeOptions?.url ?? request.url.split('?')[0]} - ${duration}ms - ${errorName}`,
            { requestId, userId, duration, errorName },
          );
        },
      }),
    );
  }
}
