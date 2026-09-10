import { describe, expect, it } from 'vitest';

import { DiceBet, DiceEngine, DiceResult } from './dice.engine.js';

const result = (dice1: number, dice2: number): DiceResult => ({
  dice1,
  dice2,
  total: dice1 + dice2,
  isDouble: dice1 === dice2,
});

describe('DiceEngine', () => {
  const engine = new DiceEngine();

  it('rolls two standard dice and calculates their total', () => {
    for (let index = 0; index < 100; index++) {
      const roll = engine.roll();

      expect(roll.dice1).toBeGreaterThanOrEqual(1);
      expect(roll.dice1).toBeLessThanOrEqual(6);
      expect(roll.dice2).toBeGreaterThanOrEqual(1);
      expect(roll.dice2).toBeLessThanOrEqual(6);
      expect(roll.total).toBe(roll.dice1 + roll.dice2);
      expect(roll.isDouble).toBe(roll.dice1 === roll.dice2);
    }
  });

  it.each([
    [2, 35], [3, 17], [4, 11], [5, 8], [6, 6], [7, 5],
    [8, 6], [9, 8], [10, 11], [11, 17], [12, 35],
  ])('uses the locked %i exact-total payout', (total, payout) => {
    expect(engine.getPayoutRatio({
      type: 'EXACT_TOTAL', value: total, amount: 1,
    })).toBe(payout);
  });

  it('evaluates odd, even, low, high, and double bets', () => {
    expect(engine.isWinningBet({ type: 'ODD', amount: 2 }, result(2, 3))).toBe(true);
    expect(engine.isWinningBet({ type: 'EVEN', amount: 2 }, result(2, 4))).toBe(true);
    expect(engine.isWinningBet({ type: 'LOW', amount: 2 }, result(2, 4))).toBe(true);
    expect(engine.isWinningBet({ type: 'HIGH', amount: 2 }, result(5, 6))).toBe(true);
    expect(engine.isWinningBet({ type: 'DOUBLE', amount: 2 }, result(4, 4))).toBe(true);
    expect(engine.isWinningBet({ type: 'DOUBLE', amount: 2 }, result(4, 5))).toBe(false);
  });

  it('settles wins and losses using profit and total return', () => {
    const winner = engine.settleBet(
      { type: 'EXACT_TOTAL', value: 7, amount: 3 }, result(3, 4),
    );
    const loser = engine.settleBet(
      { type: 'HIGH', amount: 3 }, result(1, 4),
    );

    expect(winner).toMatchObject({ won: true, profit: 15, totalReturn: 18 });
    expect(loser).toMatchObject({ won: false, profit: -3, totalReturn: 0 });
  });

  it.each([
    { type: 'EXACT_TOTAL', amount: 1 },
    { type: 'EXACT_TOTAL', value: 1, amount: 1 },
    { type: 'EXACT_TOTAL', value: 13, amount: 1 },
    { type: 'EXACT_TOTAL', value: 4.5, amount: 1 },
    { type: 'ODD', amount: 0 },
    { type: 'EVEN', amount: -1 },
    { type: 'LOW', amount: 1.5 },
    { type: 'INVALID', amount: 1 },
  ])('rejects invalid bets: %o', (bet) => {
    expect(() => engine.validateBet(bet as DiceBet)).toThrow();
  });
});
