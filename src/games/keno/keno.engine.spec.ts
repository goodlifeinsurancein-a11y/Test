import { describe, expect, it } from 'vitest';
import { KenoEngine, KENO_BOARD_SIZE, KENO_DRAW_SIZE } from './keno.engine.js';

describe('KenoEngine', () => {
  const engine = new KenoEngine();

  describe('validateBet', () => {
    it('accepts valid bet', () => expect(() => engine.validateBet({ betId: 'b1', picks: [1,5,10], amount: 100 })).not.toThrow());
    it('rejects empty picks', () => expect(() => engine.validateBet({ betId: 'b1', picks: [], amount: 100 })).toThrow());
    it('rejects too many picks', () => expect(() => engine.validateBet({ betId: 'b1', picks: [1,2,3,4,5,6,7,8,9,10,11], amount: 100 })).toThrow());
    it('rejects out of range picks', () => expect(() => engine.validateBet({ betId: 'b1', picks: [0], amount: 100 })).toThrow());
    it('rejects duplicate picks', () => expect(() => engine.validateBet({ betId: 'b1', picks: [5,5,6], amount: 100 })).toThrow());
    it('rejects zero amount', () => expect(() => engine.validateBet({ betId: 'b1', picks: [1], amount: 0 })).toThrow());
  });

  describe('draw', () => {
    it('returns exactly 10 unique numbers', () => {
      const drawn = engine.draw();
      expect(drawn).toHaveLength(KENO_DRAW_SIZE);
      expect(new Set(drawn).size).toBe(KENO_DRAW_SIZE);
    });

    it('all numbers in range 1-40', () => {
      for (let i = 0; i < 100; i++) {
        const drawn = engine.draw();
        for (const n of drawn) {
          expect(n).toBeGreaterThanOrEqual(1);
          expect(n).toBeLessThanOrEqual(KENO_BOARD_SIZE);
        }
      }
    });

    it('results are sorted', () => {
      const drawn = engine.draw();
      for (let i = 1; i < drawn.length; i++) {
        expect(drawn[i]).toBeGreaterThan(drawn[i-1]);
      }
    });
  });

  describe('getMultiplier', () => {
    it('returns correct table values', () => {
      expect(engine.getMultiplier(10, 10)).toBe(5000);
      expect(engine.getMultiplier(10, 9)).toBe(500);
      expect(engine.getMultiplier(10, 8)).toBe(100);
      expect(engine.getMultiplier(8, 8)).toBe(2500);
      expect(engine.getMultiplier(6, 6)).toBe(1000);
    });

    it('returns 0 for non-winning matches', () => {
      expect(engine.getMultiplier(6, 2)).toBe(0);
      expect(engine.getMultiplier(10, 4)).toBe(0);
    });
  });

  describe('settleBet', () => {
    it('pays correctly for match all', () => {
      const settlement = engine.settleBet(
        { betId: 'b1', playerId: 'p1', picks: [1,2,3,4,5,6], amount: 100, status: 'PENDING', placedAt: Date.now() },
        { drawnNumbers: [1,2,3,4,5,6,7,8,9,10] },
        Date.now(),
      );
      expect(settlement.status).toBe('WIN');
      expect(settlement.matches).toBe(6);
      expect(settlement.multiplier).toBe(1000);
      expect(settlement.totalReturn).toBe(100000);
    });

    it('loses when no matches', () => {
      const settlement = engine.settleBet(
        { betId: 'b2', playerId: 'p1', picks: [30,31,32,33,34,35], amount: 100, status: 'PENDING', placedAt: Date.now() },
        { drawnNumbers: [1,2,3,4,5,6,7,8,9,10] },
        Date.now(),
      );
      expect(settlement.status).toBe('LOSS');
      expect(settlement.totalReturn).toBe(0);
    });
  });
});
