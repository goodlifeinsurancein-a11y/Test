import { describe, expect, it } from 'vitest';
import { ColorPredictionEngine } from './color-prediction.engine.js';
import { ColorPredictionBetInput } from './color-prediction.types.js';
describe('ColorPredictionEngine', () => {
  const engine = new ColorPredictionEngine();
  it('generates only valid secure server-side colors', () => { for (let i = 0; i < 100; i++) expect(['RED', 'GREEN', 'VIOLET']).toContain(engine.generateResult().color); });
  it.each([['RED', 1], ['GREEN', 1], ['VIOLET', 4]] as const)('uses %s payout %i:1', (color, ratio) => expect(engine.getPayoutRatio(color)).toBe(ratio));
  it('settles all winning colors and losses', () => {
    expect(engine.settleBet({ betId: 'red', type: 'RED', amount: 10 }, 'p', { color: 'RED', generatedAt: 1 }, 2)).toMatchObject({ status: 'WIN', profit: 10, totalReturn: 20 });
    expect(engine.settleBet({ betId: 'green', type: 'GREEN', amount: 10 }, 'p', { color: 'GREEN', generatedAt: 1 }, 2)).toMatchObject({ status: 'WIN', profit: 10, totalReturn: 20 });
    expect(engine.settleBet({ betId: 'violet', type: 'VIOLET', amount: 10 }, 'p', { color: 'VIOLET', generatedAt: 1 }, 2)).toMatchObject({ status: 'WIN', profit: 40, totalReturn: 50 });
    expect(engine.settleBet({ betId: 'loss', type: 'RED', amount: 10 }, 'p', { color: 'GREEN', generatedAt: 1 }, 2)).toMatchObject({ status: 'LOSS', profit: -10, totalReturn: 0 });
  });
  it('returns deterministic two-decimal token settlement values', () => {
    const settlement = engine.settleBet({ betId: 'precision', type: 'VIOLET', amount: 999 }, 'p', { color: 'VIOLET', generatedAt: 1 }, 2);
    expect(settlement.profit).toBe(3996);
    expect(settlement.totalReturn).toBe(4995);
    expect(Number.isInteger(settlement.profit * 100)).toBe(true);
    expect(Number.isInteger(settlement.totalReturn * 100)).toBe(true);
  });
  it.each([{ betId: '', type: 'RED', amount: 1 }, { betId: 'type', type: 'BLUE', amount: 1 }, { betId: 'zero', type: 'RED', amount: 0 }, { betId: 'negative', type: 'RED', amount: -1 }, { betId: 'decimal', type: 'RED', amount: 1.5 }, { betId: 'nan', type: 'RED', amount: Number.NaN }, { betId: 'infinity', type: 'RED', amount: Infinity }])('rejects invalid bets: %o', (bet) => expect(() => engine.validateBet(bet as ColorPredictionBetInput)).toThrow());
  it('rejects invalid player IDs', () => { expect(() => engine.validatePlayerId('')).toThrow(); expect(() => engine.validatePlayerId(' ')).toThrow(); });
  it('rejects malformed non-object bet input', () => { expect(() => engine.validateBet(null as unknown as ColorPredictionBetInput)).toThrow(); });
});
