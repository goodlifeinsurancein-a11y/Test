import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';

@Injectable()
export class RateLimitGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const rateLimitInfo = (request as any).rateLimit;

    if (rateLimitInfo && rateLimitInfo.remaining <= 0) {
      const resetTime = new Date(rateLimitInfo.resetTime).toISOString();
      throw new HttpException({
        message: 'Rate limit exceeded',
        retryAfter: resetTime,
        limit: rateLimitInfo.limit,
        remaining: rateLimitInfo.remaining,
      }, HttpStatus.TOO_MANY_REQUESTS);
    }

    return true;
  }
}
