import { describe, expect, it } from 'vitest';
import { FinancialService } from './financial.service.js';

describe('FinancialService token units', () => {
  const service = new FinancialService({} as never);
  it('preserves the locked 0.9 Andar Bahar profit exactly in deci-token units', () => {
    expect(service.wholeTokensToUnits(1)).toBe(10);
    expect(service.unitsToDisplay(19)).toBe('1.9');
  });
  it('uses a stable UUID for an idempotency key', () => {
    expect(service.idempotencyUuid('request-key-123')).toBe(service.idempotencyUuid('request-key-123'));
  });
});
