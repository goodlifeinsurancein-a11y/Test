import { describe, expect, it } from 'vitest';
import { BaccaratEngine } from './baccarat.engine.js';
import { Card, BaccaratBetInput, BaccaratResult } from './baccarat.types.js';

const engine = new BaccaratEngine();
const card = (rank: Card['rank'], suit: Card['suit'] = 'SPADES'): Card => ({ rank, suit });

// ── Winner determination ──────────────────────────────────────────────────────────
describe('BaccaratEngine determineResult', () => {
  it.each([
    // player wins: 9+5=4 vs A+2=3
    [[card('9'), card('5')], [card('A'), card('2')], 'PLAYER'],
    // banker wins: A+2=3 vs 9+5=4 is not a banker win; use banker 9+6=5
    [[card('A'), card('2')], [card('9'), card('6')], 'BANKER'],
    // tie: 1+5=6 vs 2+4=6
    [[card('A'), card('5')], [card('2'), card('4')], 'TIE'],
  ] as const)('%o', (playerHand, bankerHand, winner) => {
    expect(engine.determineResult(playerHand, bankerHand).winner).toBe(winner);
  });

  it('stores correct totals', () => {
    const result = engine.determineResult([card('5'), card('A')], [card('K'), card('A')]);
    expect(result.playerTotal).toBe(6);
    expect(result.bankerTotal).toBe(1);
    expect(result.winner).toBe('PLAYER');
  });
});

// ── Bet / payout / settlement ─────────────────────────────────────────────────────
describe('BaccaratEngine bets and settlement', () => {
  const playerWin: BaccaratResult = engine.determineResult([card('9'), card('5')], [card('A'), card('2')]);
  const bankerWin: BaccaratResult = engine.determineResult([card('A'), card('2')], [card('9'), card('6')]);
  const tieResult: BaccaratResult = engine.determineResult([card('A'), card('5')], [card('2'), card('4')]);

  it.each([
    ['PLAYER', 100],
    ['BANKER', 95],
    ['TIE', 800],
  ] as const)('uses %s payout ratio %i:1 in hundredths', (type, ratio) => {
    expect(engine.getPayoutRatio(type)).toBe(ratio);
  });

  it('settles player win at 1:1', () => {
    const s = engine.settleBet({ betId: 'bid', type: 'PLAYER', amount: 100 }, 'p1', playerWin, 1);
    expect(s).toMatchObject({ status: 'WIN', profit: 100, totalReturn: 200 });
  });

  it('settles banker win at 0.95:1 (integer arithmetic)', () => {
    const s = engine.settleBet({ betId: 'bid', type: 'BANKER', amount: 100 }, 'p1', bankerWin, 1);
    expect(s).toMatchObject({ status: 'WIN', profit: 95, totalReturn: 195 });
  });

  it('settles tie at 8:1', () => {
    const s = engine.settleBet({ betId: 'bid', type: 'TIE', amount: 10 }, 'p1', tieResult, 1);
    expect(s).toMatchObject({ status: 'WIN', profit: 80, totalReturn: 90 });
  });

  it('settles loss with negative profit and 0 totalReturn', () => {
    expect(
      engine.settleBet({ betId: 'loss', type: 'BANKER', amount: 50 }, 'p1', playerWin, 1),
    ).toMatchObject({ status: 'LOSS', profit: -50, totalReturn: 0 });
    expect(
      engine.settleBet({ betId: 'loss2', type: 'PLAYER', amount: 20 }, 'p1', tieResult, 1),
    ).toMatchObject({ status: 'LOSS', profit: -20, totalReturn: 0 });
  });

  it('handles fractional banker commission via floor(amount*95/100)', () => {
    expect(
      engine.settleBet({ betId: 'tiny', type: 'BANKER', amount: 1 }, 'p1', bankerWin, 1).profit,
    ).toBe(0);
    expect(
      engine.settleBet({ betId: '19', type: 'BANKER', amount: 19 }, 'p1', bankerWin, 1).profit,
    ).toBe(18);
    expect(
      engine.settleBet({ betId: '20', type: 'BANKER', amount: 20 }, 'p1', bankerWin, 1).profit,
    ).toBe(19);
  });

  it.each([
    { betId: '', type: 'PLAYER', amount: 1 },
    { betId: 'type', type: 'INVALID', amount: 10 },
    { betId: 'zero', type: 'PLAYER', amount: 0 },
    { betId: 'neg', type: 'PLAYER', amount: -1 },
    { betId: 'decimal', type: 'PLAYER', amount: 1.5 },
  ])('rejects invalid bet input: %o', (bet) => {
    expect(() => engine.validateBet(bet as BaccaratBetInput)).toThrow();
  });

  it('rejects empty/whitespace player IDs', () => {
    expect(() => engine.validatePlayerId('')).toThrow('Player id is required');
    expect(() => engine.validatePlayerId('   ')).toThrow('Player id is required');
  });

  it('identifies winning bet correctly', () => {
    expect(engine.isWinningBet({ betId: 'win', type: 'PLAYER', amount: 1 }, playerWin)).toBe(true);
    expect(engine.isWinningBet({ betId: 'loss', type: 'BANKER', amount: 1 }, playerWin)).toBe(false);
  });
});
