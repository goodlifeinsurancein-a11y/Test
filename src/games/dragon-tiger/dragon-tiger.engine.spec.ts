import { describe, expect, it } from 'vitest';

import { DragonTigerEngine } from './dragon-tiger.engine.js';
import { Card, DragonTigerBetInput } from './dragon-tiger.types.js';

const card = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });

describe('DragonTigerEngine deck and cards', () => {
  const engine = new DragonTigerEngine();

  it('creates a standard deck of 52 unique cards with all suits and ranks', () => {
    const deck = engine.createDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map((item) => `${item.rank}-${item.suit}`)).size).toBe(52);
    expect(new Set(deck.map((item) => item.suit))).toEqual(
      new Set(['SPADES', 'HEARTS', 'DIAMONDS', 'CLUBS']),
    );
    expect(new Set(deck.map((item) => item.rank))).toEqual(
      new Set(['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']),
    );
  });

  it('securely shuffles without changing cards and deals exactly two distinct cards', () => {
    const deck = engine.createDeck();
    const shuffled = engine.shuffleDeck(deck);
    const dealt = engine.dealRound(shuffled);

    expect(shuffled).toHaveLength(52);
    expect(new Set(shuffled.map((item) => `${item.rank}-${item.suit}`))).toEqual(
      new Set(deck.map((item) => `${item.rank}-${item.suit}`)),
    );
    expect(dealt.dragonCard).not.toEqual(dealt.tigerCard);
  });

  it('orders ranks from ace low through king high, regardless of suit', () => {
    expect(engine.compareCards(card('A', 'SPADES'), card('2', 'CLUBS'))).toBeLessThan(0);
    expect(engine.compareCards(card('10', 'HEARTS'), card('J', 'DIAMONDS'))).toBeLessThan(0);
    expect(engine.compareCards(card('K', 'SPADES'), card('Q', 'SPADES'))).toBeGreaterThan(0);
    expect(engine.compareCards(card('7', 'SPADES'), card('7', 'HEARTS'))).toBe(0);
  });

  it.each([
    [card('K', 'SPADES'), card('A', 'CLUBS'), 'DRAGON'],
    [card('2', 'SPADES'), card('Q', 'CLUBS'), 'TIGER'],
    [card('8', 'SPADES'), card('8', 'DIAMONDS'), 'TIE'],
  ] as const)('determines %s versus %s as %s', (dragonCard, tigerCard, winner) => {
    expect(engine.determineResult(dragonCard, tigerCard).winner).toBe(winner);
  });
});

describe('DragonTigerEngine bets and settlement', () => {
  const engine = new DragonTigerEngine();
  const dragonResult = engine.determineResult(card('K', 'SPADES'), card('A', 'CLUBS'));
  const tieResult = engine.determineResult(card('7', 'SPADES'), card('7', 'CLUBS'));

  it.each([
    ['DRAGON', 1], ['TIGER', 1], ['TIE', 8],
  ] as const)('uses %s payout ratio %i:1', (type, ratio) => {
    expect(engine.getPayoutRatio(type)).toBe(ratio);
  });

  it('settles main-bet, tie, and loss outcomes with locked ratios', () => {
    expect(engine.settleBet({ betId: 'dragon', type: 'DRAGON', amount: 5 }, 'p1', dragonResult, 1))
      .toMatchObject({ status: 'WIN', profit: 5, totalReturn: 10 });
    expect(engine.settleBet({ betId: 'tie', type: 'TIE', amount: 5 }, 'p1', tieResult, 1))
      .toMatchObject({ status: 'WIN', profit: 40, totalReturn: 45 });
    expect(engine.settleBet({ betId: 'loss', type: 'TIGER', amount: 5 }, 'p1', dragonResult, 1))
      .toMatchObject({ status: 'LOSS', profit: -5, totalReturn: 0 });
  });

  it.each([
    { betId: '', type: 'DRAGON', amount: 1 },
    { betId: 'type', type: 'INVALID', amount: 1 },
    { betId: 'zero', type: 'DRAGON', amount: 0 },
    { betId: 'negative', type: 'DRAGON', amount: -1 },
    { betId: 'decimal', type: 'DRAGON', amount: 1.5 },
  ])('rejects invalid bet input: %o', (bet) => {
    expect(() => engine.validateBet(bet as DragonTigerBetInput)).toThrow();
  });

  it('rejects invalid player IDs', () => {
    expect(() => engine.validatePlayerId('')).toThrow('Player id is required');
    expect(() => engine.validatePlayerId('   ')).toThrow('Player id is required');
  });
});
