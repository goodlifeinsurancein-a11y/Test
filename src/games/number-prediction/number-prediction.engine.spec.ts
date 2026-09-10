import { describe, expect, it } from 'vitest';
import { NumberPredictionEngine } from './number-prediction.engine.js';

describe('NumberPredictionEngine', () => {
  const engine = new NumberPredictionEngine();
  const result = (number: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9) => ({ number, generatedAt: 1 });

  it('generates only one of the ten valid numbers', () => {
    for (let i = 0; i < 100; i += 1) {
      const generated = engine.generateResult();
      expect(Number.isInteger(generated.number)).toBe(true);
      expect(generated.number).toBeGreaterThanOrEqual(0);
      expect(generated.number).toBeLessThanOrEqual(9);
    }
  });

  it.each(Array.from({ length: 10 }, (_, number) => number as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9))('accepts valid number %i', (number) => {
    expect(() => engine.validateBet({ betId: String(number), number, amount: 1 })).not.toThrow();
  });

  it.each([-1, 10, 1.5, Number.NaN, Infinity, '1', null])('rejects invalid number %o', (number) => {
    expect(() => engine.validateBet({ betId: 'invalid-number', number: number as never, amount: 1 })).toThrow();
  });

  it.each([0, -1, 1.5, Number.NaN, Infinity, '10', null])('rejects invalid amount %o', (amount) => {
    expect(() => engine.validateBet({ betId: 'invalid-amount', number: 1, amount: amount as never })).toThrow();
  });

  it('requires a valid player and bet id', () => {
    expect(() => engine.validatePlayerId('')).toThrow();
    expect(() => engine.validatePlayerId('   ')).toThrow();
    expect(() => engine.validatePlayerId(null)).toThrow();
    expect(() => engine.validateBet(null)).toThrow();
    expect(() => engine.validateBet({ betId: '', number: 1, amount: 1 })).toThrow();
  });

  it('pays nine times profit and ten times total return on a win', () => {
    expect(engine.settleBet({ betId: 'win', number: 4, amount: 100 }, 'player', result(4), 2)).toMatchObject({
      status: 'WIN',
      profit: 900,
      totalReturn: 1000,
    });
  });

  it('returns zero and records negative profit on a loss', () => {
    expect(engine.settleBet({ betId: 'loss', number: 4, amount: 100 }, 'player', result(5), 2)).toMatchObject({
      status: 'LOSS',
      profit: -100,
      totalReturn: 0,
    });
  });
});
