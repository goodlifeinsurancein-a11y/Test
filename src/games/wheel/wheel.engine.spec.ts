import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WheelEngine } from './wheel.engine.js';
import { WheelBetInput, WheelResult } from './wheel.types.js';

describe('WheelEngine', () => {
  const engine = new WheelEngine();
  const result = (number: WheelResult['number']): WheelResult => ({
    number,
    color: engine.getColorForNumber(number),
    generatedAt: 1,
  });

  it.each([
    [0, 'GREEN'], [1, 'RED'], [2, 'BLACK'], [3, 'RED'], [4, 'BLACK'],
    [5, 'RED'], [6, 'BLACK'], [7, 'RED'], [8, 'BLACK'], [9, 'RED'],
  ] as const)('maps segment %i to %s', (number, color) => {
    expect(engine.getColorForNumber(number)).toBe(color);
  });

  it.each([-1, 10, 1.5, Number.NaN, Infinity, '1', null])('rejects invalid number %o', (number) => {
    expect(() => engine.getColorForNumber(number)).toThrow('Invalid wheel number');
  });

  it.each(['BLUE', '', 'RED ', 1, null])('rejects invalid color %o', (color) => {
    expect(() => engine.validateBet({ betId: 'invalid-color', type: 'COLOR', color, amount: 1 })).toThrow();
  });

  it('uses secure server-side randomness and derives a matching color', () => {
    const source = readFileSync(new URL('./wheel.engine.ts', import.meta.url), 'utf8');
    expect(source).toContain('randomInt(');
    expect(source).not.toContain('Math.random');

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const generated = engine.generateResult();
      expect(generated.number).toBeGreaterThanOrEqual(0);
      expect(generated.number).toBeLessThanOrEqual(9);
      expect(generated.color).toBe(engine.getColorForNumber(generated.number));
    }
  });

  it('does not accept a result number from callers when generating a result', () => {
    const generated = engine.generateResult(123);
    expect(generated.generatedAt).toBe(123);
    expect(generated.color).toBe(engine.getColorForNumber(generated.number));
  });

  it.each([0, -1, 1.5, Number.NaN, Infinity, '10', null])('rejects invalid amount %o', (amount) => {
    expect(() => engine.validateBet({ betId: 'invalid-amount', type: 'NUMBER', number: 1, amount })).toThrow();
  });

  it('accepts the minimum one-token exact-number and color bets', () => {
    expect(() => engine.validateBet({ betId: 'number-min', type: 'NUMBER', number: 0, amount: 1 })).not.toThrow();
    expect(() => engine.validateBet({ betId: 'color-min', type: 'COLOR', color: 'GREEN', amount: 1 })).not.toThrow();
  });

  it('rejects malformed bets, player ids, bet ids, and invalid types', () => {
    expect(() => engine.validateBet(null)).toThrow();
    expect(() => engine.validateBet({ betId: '', type: 'NUMBER', number: 1, amount: 1 })).toThrow();
    expect(() => engine.validateBet({ betId: 'bad-type', type: 'SIDE', amount: 1 })).toThrow();
    expect(() => engine.validateBet({ betId: 'bad-number', type: 'NUMBER', number: 10, amount: 1 })).toThrow();
    expect(() => engine.validatePlayerId('')).toThrow();
    expect(() => engine.validatePlayerId('   ')).toThrow();
    expect(() => engine.validatePlayerId(null)).toThrow();
  });

  it('settles exact-number and GREEN wins at nine-to-one profit', () => {
    expect(engine.settleBet({ betId: 'number', type: 'NUMBER', number: 0, amount: 100 }, 'p1', result(0), 2)).toMatchObject({
      status: 'WIN', profit: 900, totalReturn: 1000,
    });
    expect(engine.settleBet({ betId: 'green', type: 'COLOR', color: 'GREEN', amount: 100 }, 'p2', result(0), 2)).toMatchObject({
      status: 'WIN', profit: 900, totalReturn: 1000,
    });
  });

  it('settles RED and BLACK wins at one-to-one profit', () => {
    expect(engine.settleBet({ betId: 'red', type: 'COLOR', color: 'RED', amount: 100 }, 'p1', result(1), 2)).toMatchObject({
      status: 'WIN', profit: 100, totalReturn: 200,
    });
    expect(engine.settleBet({ betId: 'black', type: 'COLOR', color: 'BLACK', amount: 100 }, 'p2', result(2), 2)).toMatchObject({
      status: 'WIN', profit: 100, totalReturn: 200,
    });
  });

  it('settles losses with negative profit and no return', () => {
    const bet: WheelBetInput = { betId: 'loss', type: 'COLOR', color: 'BLACK', amount: 100 };
    expect(engine.settleBet(bet, 'p1', result(1), 2)).toMatchObject({ status: 'LOSS', profit: -100, totalReturn: 0 });
  });
});
