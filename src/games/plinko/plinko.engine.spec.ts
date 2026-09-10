import { describe, expect, it } from 'vitest';
import { PlinkoEngine, DEFAULT_MULTIPLIERS } from './plinko.engine.js';

describe('PlinkoEngine', () => {
  const engine = new PlinkoEngine();

  describe('validateBet', () => {
    it('accepts valid bet', () => {
      expect(() => engine.validateBet({ betId: 'b1', amount: 100 })).not.toThrow();
    });

    it('rejects empty betId', () => {
      expect(() => engine.validateBet({ betId: '', amount: 100 })).toThrow();
    });

    it('rejects zero amount', () => {
      expect(() => engine.validateBet({ betId: 'b1', amount: 0 })).toThrow();
    });

    it('rejects negative amount', () => {
      expect(() => engine.validateBet({ betId: 'b1', amount: -10 })).toThrow();
    });

    it('rejects out-of-range rows', () => {
      expect(() => engine.validateBet({ betId: 'b1', amount: 100, rows: 2 })).toThrow();
      expect(() => engine.validateBet({ betId: 'b1', amount: 100, rows: 20 })).toThrow();
    });

    it('accepts valid rows', () => {
      expect(() => engine.validateBet({ betId: 'b1', amount: 100, rows: 8 })).not.toThrow();
    });
  });

  describe('generatePath', () => {
    it('returns correct number of path steps', () => {
      const result = engine.generatePath(8);
      expect(result.path).toHaveLength(8);
    });

    it('all path steps are 0 or 1', () => {
      for (let i = 0; i < 50; i++) {
        const result = engine.generatePath(8);
        for (const step of result.path) {
          expect(step === 0 || step === 1).toBe(true);
        }
      }
    });

    it('slotIndex is within multiplier range', () => {
      for (let i = 0; i < 100; i++) {
        const result = engine.generatePath(8);
        expect(result.slotIndex).toBeGreaterThanOrEqual(0);
        expect(result.slotIndex).toBeLessThan(DEFAULT_MULTIPLIERS.length);
      }
    });

    it('multiplier matches slot index', () => {
      const result = engine.generatePath(8);
      expect(result.multiplier).toBe(DEFAULT_MULTIPLIERS[result.slotIndex]);
    });

    it('rejects invalid rows', () => {
      expect(() => engine.generatePath(2)).toThrow();
      expect(() => engine.generatePath(20)).toThrow();
    });
  });

  describe('settleBet', () => {
    it('calculates win correctly', () => {
      const settlement = engine.settleBet(
        { betId: 'b1', playerId: 'p1', amount: 100, rows: 8 },
        { path: [1,1,1,1,0,0,0,0], slotIndex: 4, multiplier: 3.0 },
        Date.now(),
      );
      expect(settlement.status).toBe('WIN');
      expect(settlement.totalReturn).toBe(300);
      expect(settlement.profit).toBe(200);
    });

    it('calculates loss correctly', () => {
      const settlement = engine.settleBet(
        { betId: 'b1', playerId: 'p1', amount: 100, rows: 8 },
        { path: [0,0,0,0,0,0,0,0], slotIndex: 0, multiplier: 0.5 },
        Date.now(),
      );
      expect(settlement.status).toBe('LOSS');
      expect(settlement.totalReturn).toBe(50);
      expect(settlement.profit).toBe(-50);
    });

    it('handles edge multiplier', () => {
      const settlement = engine.settleBet(
        { betId: 'b1', playerId: 'p1', amount: 100, rows: 8 },
        { path: [1,1,1,1,1,1,1,1], slotIndex: 7, multiplier: 1.0 },
        Date.now(),
      );
      expect(settlement.totalReturn).toBe(100);
      expect(settlement.profit).toBe(0);
    });
  });
});
