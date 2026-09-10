import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rateLimit';
export const RateLimit = (options: { max: number; timeWindow: string }) =>
  SetMetadata(RATE_LIMIT_KEY, options);
