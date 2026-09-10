import { describe, expect, it } from 'vitest';

import { BaccaratEngine } from './baccarat.engine.js';
import { Card, BaccaratBetInput, BaccaratResult } from './baccarat.types.js';

const card = (rank: Card['rank'], suit: Card['suit'] = 'SPADES'): Card => ({ rank, suit });
const engine = new BaccaratEngine();

// ── Deck / shoe ───────────────────────────────────────────────────────────────────
describe('BaccaratEngine shoe', () => {
  it('creates an 8-deck shoe of 416 cards', () => {
    const shoe = engine.createShoe();
    expect(shoe).toHaveLength(8 * 52);
  });

  it('securely shuffles without changing card count', () => {
    const shoe = engine.createShoe();
    const shuffled = engine.shuffleShoe(shoe);
    expect(shuffled).toHaveLength(shoe.length);
    const key = (c: Card) => `${c.rank}-${c.suit}`;
    const countSorted = (arr: Card[]) => [...arr].map(key).sort().join(',');
    expect(countSorted(shuffled)).toBe(countSorted(shoe));
  });
});

// ── Card / hand values ────────────────────────────────────────────────────────────
describe('BaccaratEngine card values and hand totals', () => {
  it.each([
    ['A', 1],
    ['2', 2],
    ['9', 9],
    ['10', 0],
    ['J', 0],
    ['Q', 0],
    ['K', 0],
  ] as const)('values %s as %i', (rank, value) => {
    expect(engine.cardValue(card(rank as Card['rank']))).toBe(value);
  });

  it('computes hand total mod 10', () => {
    // A(1) + 10(0) + J(0) = 1 mod 10 => 1
    expect(engine.handTotal([card('A'), card('10'), card('J')])).toBe(1);
    // 9 + 7 = 16 mod 10 => 6
    expect(engine.handTotal([card('9'), card('7')])).toBe(6);
    // K(0) + Q(0) + 10(0) = 0
    expect(engine.handTotal([card('K'), card('Q'), card('10')])).toBe(0);
    // 5 + 3 = 8
    expect(engine.handTotal([card('5'), card('3')])).toBe(8);
  });

  it('handles natural hands', () => {
    // 9 + 9(0 for 10)=9, 9+9=18=>8 natural
    expect(engine.handTotal([card('9'), card('9')])).toBe(8);
  });
});

// ── Dealer / deal rules ───────────────────────────────────────────────────────────
describe('BaccaratEngine dealRound', () => {
  it('deals valid hands respecting shoe', () => {
    const { playerHand, bankerHand } = engine.dealRound(engine.shuffleShoe(engine.createShoe()));
    expect(playerHand.length).toBeGreaterThanOrEqual(2);
    expect(playerHand.length).toBeLessThanOrEqual(3);
    expect(bankerHand.length).toBeGreaterThanOrEqual(2);
    expect(bankerHand.length).toBeLessThanOrEqual(3);
  });

  it('throws if shoe too small', () => {
    expect(() => engine.dealRound(engine.createShoe().slice(0, 5))).toThrow(
      'Shoe too small',
    );
  });

  it('never draws third card on natural (≥8)', () => {
    // Force a natural: arrange shoe so first four cards yield ≥8.
    // Use raw shoe manipulation: 9+9(9) vs 9+9(9) — then third card shouldn't appear.
    const shoe = engine.createShoe();
    // Manually arrange: player 9,10, banker 4,5 then verify naturally >=8 prevents draw.
    // Just verify: any round where the initial totals are natural keeps 2-card hands.
    for (let attempt = 0; attempt < 200; attempt++) {
      const shuffled = engine.shuffleShoe(engine.createShoe());
      const remaining = [...shuffled];
      const p: Card[] = [remaining[0]!, remaining[1]!];
      const b: Card[] = [remaining[2]!, remaining[3]!];
      const pTotal = engine.handTotal(p);
      const bTotal = engine.handTotal(b);
      if (pTotal >= 8 || bTotal >= 8) {
        const { playerHand, bankerHand } = engine.dealRound(shuffled);
        expect(playerHand).toHaveLength(2);
        expect(bankerHand).toHaveLength(2);
        break;
      }
    }
  });

  it('banker draws correctly table (banker total 5 vs player third)', () => {
    // Unit-test the table directly via bankerDraws helper.
    // Banker 5 should draw regardless of player third -> true
    expect(engine.bankerDraws(5, 0)).toBe(true);
    expect(engine.bankerDraws(5, 9)).toBe(true);
    // Banker 6: only on player third 6 or 7
    expect(engine.bankerDraws(6, 6)).toBe(true);
    expect(engine.bankerDraws(6, 7)).toBe(true);
    expect(engine.bankerDraws(6, 5)).toBe(false);
    expect(engine.bankerDraws(6, 8)).toBe(false);
    // Banker 7: never draws
    expect(engine.bankerDraws(7, 7)).toBe(false);
    // Player stood (null): banker draws on ≤5
    expect(engine.bankerDraws(5, null)).toBe(true);
    expect(engine.bankerDraws(6, null)).toBe(false);
  });
});

// ── Winner determination ──────────────────────────────────────────────────────────
describe('BaccaratEngine determineResult', () => {
  it.each([
    // player wins
    [[[card('9'), card('5')], [card('2'), card('3')], 'PLAYER'] as const],
    // banker wins
    [[[card('A'), card('2')], [card('7'), card('5')], 'BANKER'] as const],
    // tie
    [[[card('A'), card('5')], [card('2'), card('4')], 'TIE'] as const],
  ])('%o', (playerHand, bankerHand, winner) => {
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
  const playerWin: BaccaratResult = {
    playerHand: [card('9'), card('5')],
    bankerHand: [card('2'), card('3')],
    playerTotal: 4,
    bankerTotal: 5,
    winner: 'PLAYER',
  } as unknown as BaccaratResult;
  const bankerWin: BaccaratResult = {
    playerHand: [card('A'), card('2')],
    bankerHand: [card('7'), card('3')],
    playerTotal: 3,
    bankerTotal: 0,
    winner: 'BANKER',
  } as unknown as BaccaratResult;
  const tieResult: BaccaratResult = {
    playerHand: [card('A'), card('5')],
    bankerHand: [card('2'), card('4')],
    playerTotal: 6,
    bankerTotal: 6,
    winner: 'TIE',
  } as unknown as BaccaratResult;
  // Correct finals: rebuild using engine instead of mock to avoid mistakes
  const resultPlayerWin = engine.determineResult([card('9'), card('5')], [card('2'), card('3')]);
  const resultBankerWin = engine.determineResult([card('A'), card('2')], [card('7'), card('3')]);
  const resultTie = engine.determineResult([card('A'), card('5')], [card('2'), card('4')]);

  it.each([
    ['PLAYER', 100],
    ['BANKER', 95],
    ['TIE', 800],
  ] as const)('uses %s payout ratio %i:1 in hundredths', (type, ratio) => {
    expect(engine.getPayoutRatio(type)).toBe(ratio);
  });

  it('settles player win at 1:1', () => {
    const s = engine.settleBet({ betId: 'bid', type: 'PLAYER', amount: 100 }, 'p1', resultPlayerWin, 1);
    expect(s).toMatchObject({ status: 'WIN', profit: 100, totalReturn: 200 });
  });

  it('settles banker win at 0.95:1 (integer arithmetic)', () => {
    const s = engine.settleBet({ betId: 'bid', type: 'BANKER', amount: 100 }, 'p1', resultBankerWin, 1);
    expect(s).toMatchObject({ status: 'WIN', profit: 95, totalReturn: 195 });
  });

  it('settles tie at 8:1', () => {
    const s = engine.settleBet({ betId: 'bid', type: 'TIE', amount: 10 }, 'p1', resultTie, 1);
    expect(s).toMatchObject({ status: 'WIN', profit: 80, totalReturn: 90 });
  });

  it('settles loss with negative profit and 0 totalReturn', () => {
    expect(
      engine.settleBet({ betId: 'loss', type: 'BANKER', amount: 50 }, 'p1', resultPlayerWin, 1),
    ).toMatchObject({ status: 'LOSS', profit: -50, totalReturn: 0 });
    expect(
      engine.settleBet({ betId: 'loss2', type: 'PLAYER', amount: 20 }, 'p1', resultTie, 1),
    ).toMatchObject({ status: 'LOSS', profit: -20, totalReturn: 0 });
  });

  it('handles fractional banker commission via floor(amount*95/100)', () => {
    // 1 unit: floor(1*95/100)=0 — banker commission on 1 coin is extreme.
    expect(
      engine.settleBet({ betId: 'tiny', type: 'BANKER', amount: 1 }, 'p1', resultBankerWin, 1).profit
    ).toBe(0);
    expect(
      engine.settleBet({ betId: '19', type: 'BANKER', amount: 19 }, 'p1', resultBankerWin, 1).profit
    ).toBe(18);
    expect(
      engine.settleBet({ betId: '20', type: 'BANKER', amount: 20 }, 'p1', resultBankerWin, 1).profit
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
    expect(engine.isWinningBet({ betId: 'win', type: 'PLAYER', amount: 1 }, resultPlayerWin)).toBe(true);
    expect(engine.isWinningBet({ betId: 'loss', type: 'BANKER', amount: 1 }, resultPlayerWin)).toBe(false);
  });
});
