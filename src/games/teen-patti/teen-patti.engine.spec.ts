import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TeenPattiEngine } from './teen-patti.engine.js';
import { TeenPattiCard, TeenPattiHand, TeenPattiHandType } from './teen-patti.types.js';

describe('TeenPattiEngine', () => {
  const engine = new TeenPattiEngine();
  const card = (rank: TeenPattiCard['rank'], suit: TeenPattiCard['suit']): TeenPattiCard => ({ rank, suit });
  const hand = (cards: TeenPattiCard[]): TeenPattiHand => engine.evaluateHand(cards);

  it('creates a standard deck containing exactly 52 unique physical cards', () => {
    const deck = engine.createDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map((item) => `${item.rank}-${item.suit}`))).toHaveLength(52);
  });

  it('uses cryptographic randomness to shuffle without changing deck membership', () => {
    const source = readFileSync(new URL('./teen-patti.engine.ts', import.meta.url), 'utf8');
    const deck = engine.createDeck();
    const shuffled = engine.shuffleDeck(deck);
    expect(source).toContain('randomInt(');
    expect(source).not.toContain('Math.random');
    expect(new Set(shuffled.map((item) => `${item.rank}-${item.suit}`))).toEqual(new Set(deck.map((item) => `${item.rank}-${item.suit}`)));
  });

  it('deals cards from the supplied deck and returns the remaining physical cards', () => {
    const deck = engine.createDeck();
    const first = engine.dealCards(deck, 3);
    const second = engine.dealCards(first.remainingDeck, 3);
    expect(first.hand).toHaveLength(3);
    expect(second.hand).toHaveLength(3);
    expect(first.remainingDeck).toHaveLength(49);
    expect(new Set([...first.hand, ...second.hand].map((item) => `${item.rank}-${item.suit}`))).toHaveLength(6);
  });

  it.each([
    ['TRAIL', [card('A', 'SPADES'), card('A', 'HEARTS'), card('A', 'DIAMONDS')]],
    ['PURE_SEQUENCE', [card('A', 'SPADES'), card('K', 'SPADES'), card('Q', 'SPADES')]],
    ['SEQUENCE', [card('9', 'SPADES'), card('8', 'HEARTS'), card('7', 'DIAMONDS')]],
    ['COLOR', [card('A', 'SPADES'), card('J', 'SPADES'), card('5', 'SPADES')]],
    ['PAIR', [card('A', 'SPADES'), card('A', 'HEARTS'), card('7', 'CLUBS')]],
    ['HIGH_CARD', [card('A', 'SPADES'), card('J', 'HEARTS'), card('5', 'CLUBS')]],
  ] as const)('evaluates %s correctly', (type, cards) => {
    expect(hand([...cards]).type).toBe(type);
  });

  it('recognizes A-2-3 as both a sequence and a pure sequence', () => {
    expect(hand([card('A', 'SPADES'), card('2', 'HEARTS'), card('3', 'DIAMONDS')]).type).toBe('SEQUENCE');
    expect(hand([card('A', 'SPADES'), card('2', 'SPADES'), card('3', 'SPADES')]).type).toBe('PURE_SEQUENCE');
  });

  it('treats A-2-3 as lower than K-Q-J and A-K-Q', () => {
    const aceLow = hand([card('A', 'SPADES'), card('2', 'HEARTS'), card('3', 'DIAMONDS')]);
    expect(engine.compareHands(aceLow, hand([card('K', 'SPADES'), card('Q', 'HEARTS'), card('J', 'DIAMONDS')]))).toBe(-1);
    expect(engine.compareHands(aceLow, hand([card('A', 'HEARTS'), card('K', 'CLUBS'), card('Q', 'DIAMONDS')]))).toBe(-1);
  });

  it('orders normal sequences by their high card', () => {
    expect(engine.compareHands(hand([card('8', 'SPADES'), card('7', 'HEARTS'), card('6', 'DIAMONDS')]), hand([card('7', 'SPADES'), card('6', 'HEARTS'), card('5', 'DIAMONDS')]))).toBe(1);
  });

  it('compares pairs by pair rank and then kicker', () => {
    expect(engine.compareHands(hand([card('K', 'SPADES'), card('K', 'HEARTS'), card('2', 'CLUBS')]), hand([card('Q', 'SPADES'), card('Q', 'HEARTS'), card('A', 'CLUBS')]))).toBe(1);
    expect(engine.compareHands(hand([card('Q', 'SPADES'), card('Q', 'HEARTS'), card('A', 'CLUBS')]), hand([card('Q', 'DIAMONDS'), card('Q', 'CLUBS'), card('K', 'SPADES')]))).toBe(1);
  });

  it('compares color hands by first, second, and third highest card', () => {
    expect(engine.compareHands(hand([card('A', 'SPADES'), card('J', 'SPADES'), card('7', 'SPADES')]), hand([card('K', 'HEARTS'), card('Q', 'HEARTS'), card('9', 'HEARTS')]))).toBe(1);
    expect(engine.compareHands(hand([card('A', 'SPADES'), card('J', 'SPADES'), card('7', 'SPADES')]), hand([card('A', 'HEARTS'), card('10', 'HEARTS'), card('8', 'HEARTS')]))).toBe(1);
    expect(engine.compareHands(hand([card('A', 'SPADES'), card('J', 'SPADES'), card('7', 'SPADES')]), hand([card('A', 'HEARTS'), card('J', 'HEARTS'), card('6', 'HEARTS')]))).toBe(1);
  });

  it.each([
    ['TRAIL', [card('A', 'SPADES'), card('A', 'HEARTS'), card('A', 'DIAMONDS')], 5],
    ['PURE_SEQUENCE', [card('A', 'SPADES'), card('K', 'SPADES'), card('Q', 'SPADES')], 4],
    ['SEQUENCE', [card('9', 'SPADES'), card('8', 'HEARTS'), card('7', 'DIAMONDS')], 3],
    ['COLOR', [card('A', 'SPADES'), card('J', 'SPADES'), card('5', 'SPADES')], 2],
    ['PAIR', [card('A', 'SPADES'), card('A', 'HEARTS'), card('7', 'CLUBS')], 1],
    ['HIGH_CARD', [card('A', 'SPADES'), card('J', 'HEARTS'), card('5', 'CLUBS')], 1],
  ] as const)('pays %s wins at %i:1 profit', (_type, cards, multiplier) => {
    const player = hand([...cards]);
    const dealer = hand([card('2', 'SPADES'), card('4', 'HEARTS'), card('6', 'DIAMONDS')]);
    const settlement = engine.settleBet({ playerId: 'player', amount: 100 }, player, dealer, 1);
    expect(settlement).toMatchObject({ result: 'WIN', profit: 100 * multiplier, totalReturn: 100 * (multiplier + 1) });
  });

  it('returns a negative profit for a loss and the full stake for a tie', () => {
    const loss = engine.settleBet({ playerId: 'loss', amount: 100 }, hand([card('2', 'SPADES'), card('4', 'HEARTS'), card('6', 'DIAMONDS')]), hand([card('A', 'HEARTS'), card('J', 'CLUBS'), card('5', 'DIAMONDS')]), 1);
    const tie = engine.settleBet({ playerId: 'tie', amount: 100 }, hand([card('A', 'SPADES'), card('K', 'HEARTS'), card('Q', 'DIAMONDS')]), hand([card('A', 'HEARTS'), card('K', 'CLUBS'), card('Q', 'SPADES')]), 1);
    expect(loss).toMatchObject({ result: 'LOSS', profit: -100, totalReturn: 0 });
    expect(tie).toMatchObject({ result: 'TIE', profit: 0, totalReturn: 100 });
  });

  it.each([0, -1, 1.5, Number.NaN, Infinity, '1', null])('rejects invalid bet amounts: %o', (amount) => {
    expect(() => engine.validateBet({ playerId: 'player', amount })).toThrow();
  });

  it('rejects invalid player ids, malformed bets, invalid cards, and duplicate physical cards', () => {
    expect(() => engine.validatePlayerId('')).toThrow();
    expect(() => engine.validatePlayerId('   ')).toThrow();
    expect(() => engine.validateBet(null)).toThrow();
    expect(() => engine.evaluateHand([card('A', 'SPADES'), card('A', 'SPADES'), card('A', 'HEARTS')])).toThrow('duplicate');
    expect(() => engine.evaluateHand([{ rank: 'X', suit: 'SPADES' } as never, card('2', 'HEARTS'), card('3', 'CLUBS')])).toThrow('Invalid');
  });
});
