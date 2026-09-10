import { describe, expect, it } from 'vitest';

import { CrashEngine } from './crash.engine.js';
import { CrashBetInput } from './crash.types.js';

describe('CrashEngine', () => {
  const engine = new CrashEngine();

  it('generates two-decimal server-side crash points in the supported range', () => {
    for (let index = 0; index < 100; index++) {
      const point = engine.generateCrashPoint();

      expect(point).toBeGreaterThanOrEqual(1.01);
      expect(point).toBeLessThanOrEqual(100);
      expect(point.toFixed(2)).toMatch(/^\d+\.\d{2}$/);
    }
  });

  it('validates a valid bet and optional auto cashout', () => {
    expect(() => engine.validateBet({
      betId: 'bet-1', amount: 1, autoCashoutMultiplier: 1.01,
    })).not.toThrow();
  });

  it.each([
    { betId: '', amount: 1 },
    { betId: 'zero', amount: 0 },
    { betId: 'negative', amount: -1 },
    { betId: 'decimal', amount: 1.5 },
    { betId: 'auto-low', amount: 1, autoCashoutMultiplier: 1 },
    { betId: 'auto-invalid', amount: 1, autoCashoutMultiplier: Number.NaN },
  ])('rejects malformed bet input: %o', (bet) => {
    expect(() => engine.validateBet(bet as CrashBetInput)).toThrow();
  });

  it('advances multipliers and detects a crash', () => {
    expect(engine.advanceMultiplier(1)).toBe(1.01);
    expect(engine.advanceMultiplier(1.09)).toBe(1.1);
    expect(engine.hasCrashed(2, 2)).toBe(true);
    expect(engine.hasCrashed(1.99, 2)).toBe(false);
  });

  it('calculates cashout and losing settlements', () => {
    const bet = { betId: 'bet-1', amount: 10 };

    expect(engine.settleCashout(bet, 'player-1', 1.5, 100)).toMatchObject({
      status: 'WIN', profit: 5, totalReturn: 15, settledAt: 100,
    });
    expect(engine.settleLoss(bet, 'player-1', 200)).toMatchObject({
      status: 'LOSS', profit: -10, totalReturn: 0, settledAt: 200,
    });
  });
});
