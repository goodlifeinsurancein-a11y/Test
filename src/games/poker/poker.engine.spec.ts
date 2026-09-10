import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PokerEngine } from './poker.engine.js';
import { PokerRoundEngine } from './poker.round.engine.js';
import { PokerCard, PokerHand, PokerHandType } from './poker.types.js';

const card = (rank: PokerCard['rank'], suit: PokerCard['suit']): PokerCard => ({ rank, suit });

describe('PokerEngine', () => {
  const engine = new PokerEngine();

  describe('deck operations', () => {
    it('creates a standard 52-card deck with unique cards', () => {
      const deck = engine.createDeck();
      expect(deck).toHaveLength(52);
      expect(new Set(deck.map((item) => `${item.rank}-${item.suit}`))).toHaveLength(52);
    });

    it('uses cryptographic randomness for shuffling', () => {
      const source = readFileSync(new URL('./poker.engine.ts', import.meta.url), 'utf8');
      expect(source).toContain('randomInt(');
      expect(source).not.toContain('Math.random');
    });

    it('shuffle preserves all cards without duplicates', () => {
      const deck = engine.createDeck();
      const shuffled = engine.shuffleDeck(deck);
      expect(new Set(shuffled.map((item) => `${item.rank}-${item.suit}`))).toEqual(
        new Set(deck.map((item) => `${item.rank}-${item.suit}`)),
      );
    });

    it('deals cards from the top and returns remaining deck', () => {
      const deck = engine.createDeck();
      const { hand, remainingDeck } = engine.dealCards(deck, 5);
      expect(hand).toHaveLength(5);
      expect(remainingDeck).toHaveLength(47);
      const allKeys = [...hand, ...remainingDeck].map((c) => `${c.rank}-${c.suit}`);
      expect(new Set(allKeys)).toHaveLength(52);
    });

    it('throws when dealing more cards than available', () => {
      const deck = engine.createDeck().slice(0, 3);
      expect(() => engine.dealCards(deck, 5)).toThrow();
    });

    it('deals return deep copies, not references', () => {
      const deck = engine.createDeck();
      const { hand } = engine.dealCards(deck, 1);
      hand[0]!.rank = 'X' as never;
      expect(deck[0]!.rank).toBe('2');
    });
  });

  describe('hand evaluation', () => {
    it('evaluates ROYAL_FLUSH correctly', () => {
      const hand = engine.evaluateHand([
        card('A', 'SPADES'),
        card('K', 'SPADES'),
        card('Q', 'SPADES'),
        card('J', 'SPADES'),
        card('10', 'SPADES'),
      ]);
      expect(hand.type).toBe('ROYAL_FLUSH');
      expect(hand.rank).toBe(10);
    });

    it('evaluates STRAIGHT_FLUSH correctly', () => {
      const hand = engine.evaluateHand([
        card('9', 'HEARTS'),
        card('8', 'HEARTS'),
        card('7', 'HEARTS'),
        card('6', 'HEARTS'),
        card('5', 'HEARTS'),
      ]);
      expect(hand.type).toBe('STRAIGHT_FLUSH');
      expect(hand.rank).toBe(9);
    });

    it('evaluates ace-low straight flush (A-2-3-4-5) as STRAIGHT_FLUSH', () => {
      const hand = engine.evaluateHand([
        card('A', 'DIAMONDS'),
        card('5', 'DIAMONDS'),
        card('4', 'DIAMONDS'),
        card('3', 'DIAMONDS'),
        card('2', 'DIAMONDS'),
      ]);
      expect(hand.type).toBe('STRAIGHT_FLUSH');
    });

    it('evaluates FOUR_OF_A_KIND correctly', () => {
      const hand = engine.evaluateHand([
        card('K', 'SPADES'),
        card('K', 'HEARTS'),
        card('K', 'DIAMONDS'),
        card('K', 'CLUBS'),
        card('3', 'SPADES'),
      ]);
      expect(hand.type).toBe('FOUR_OF_A_KIND');
      expect(hand.rank).toBe(8);
    });

    it('evaluates FULL_HOUSE correctly', () => {
      const hand = engine.evaluateHand([
        card('J', 'SPADES'),
        card('J', 'HEARTS'),
        card('J', 'DIAMONDS'),
        card('9', 'CLUBS'),
        card('9', 'SPADES'),
      ]);
      expect(hand.type).toBe('FULL_HOUSE');
      expect(hand.rank).toBe(7);
    });

    it('evaluates FLUSH correctly', () => {
      const hand = engine.evaluateHand([
        card('A', 'CLUBS'),
        card('J', 'CLUBS'),
        card('9', 'CLUBS'),
        card('7', 'CLUBS'),
        card('2', 'CLUBS'),
      ]);
      expect(hand.type).toBe('FLUSH');
      expect(hand.rank).toBe(6);
    });

    it('evaluates STRAIGHT correctly', () => {
      const hand = engine.evaluateHand([
        card('9', 'SPADES'),
        card('8', 'HEARTS'),
        card('7', 'DIAMONDS'),
        card('6', 'CLUBS'),
        card('5', 'SPADES'),
      ]);
      expect(hand.type).toBe('STRAIGHT');
      expect(hand.rank).toBe(5);
    });

    it('evaluates ace-low straight (A-2-3-4-5) as STRAIGHT', () => {
      const hand = engine.evaluateHand([
        card('A', 'SPADES'),
        card('5', 'HEARTS'),
        card('4', 'DIAMONDS'),
        card('3', 'CLUBS'),
        card('2', 'HEARTS'),
      ]);
      expect(hand.type).toBe('STRAIGHT');
    });

    it('does not treat K-A-2-3-4 as a straight', () => {
      const hand = engine.evaluateHand([
        card('K', 'SPADES'),
        card('A', 'HEARTS'),
        card('2', 'DIAMONDS'),
        card('3', 'CLUBS'),
        card('4', 'HEARTS'),
      ]);
      expect(hand.type).not.toBe('STRAIGHT');
    });

    it('evaluates THREE_OF_A_KIND correctly', () => {
      const hand = engine.evaluateHand([
        card('Q', 'SPADES'),
        card('Q', 'HEARTS'),
        card('Q', 'DIAMONDS'),
        card('7', 'CLUBS'),
        card('2', 'SPADES'),
      ]);
      expect(hand.type).toBe('THREE_OF_A_KIND');
      expect(hand.rank).toBe(4);
    });

    it('evaluates TWO_PAIR correctly', () => {
      const hand = engine.evaluateHand([
        card('10', 'SPADES'),
        card('10', 'HEARTS'),
        card('6', 'DIAMONDS'),
        card('6', 'CLUBS'),
        card('K', 'SPADES'),
      ]);
      expect(hand.type).toBe('TWO_PAIR');
      expect(hand.rank).toBe(3);
    });

    it('evaluates JACKS_OR_BETTER for a pair of jacks', () => {
      const hand = engine.evaluateHand([
        card('J', 'SPADES'),
        card('J', 'HEARTS'),
        card('7', 'DIAMONDS'),
        card('3', 'CLUBS'),
        card('2', 'SPADES'),
      ]);
      expect(hand.type).toBe('JACKS_OR_BETTER');
      expect(hand.rank).toBe(2);
    });

    it('evaluates JACKS_OR_BETTER for a pair of queens', () => {
      const hand = engine.evaluateHand([
        card('Q', 'SPADES'),
        card('Q', 'HEARTS'),
        card('5', 'DIAMONDS'),
        card('4', 'CLUBS'),
        card('3', 'SPADES'),
      ]);
      expect(hand.type).toBe('JACKS_OR_BETTER');
    });

    it('evaluates JACKS_OR_BETTER for a pair of aces', () => {
      const hand = engine.evaluateHand([
        card('A', 'SPADES'),
        card('A', 'HEARTS'),
        card('9', 'DIAMONDS'),
        card('5', 'CLUBS'),
        card('2', 'SPADES'),
      ]);
      expect(hand.type).toBe('JACKS_OR_BETTER');
    });

    it('evaluates HIGH_CARD for a pair of tens (below jacks)', () => {
      const hand = engine.evaluateHand([
        card('10', 'SPADES'),
        card('10', 'HEARTS'),
        card('7', 'DIAMONDS'),
        card('3', 'CLUBS'),
        card('2', 'SPADES'),
      ]);
      expect(hand.type).toBe('HIGH_CARD');
    });

    it('evaluates HIGH_CARD for a pair of twos', () => {
      const hand = engine.evaluateHand([
        card('2', 'SPADES'),
        card('2', 'HEARTS'),
        card('7', 'DIAMONDS'),
        card('5', 'CLUBS'),
        card('3', 'SPADES'),
      ]);
      expect(hand.type).toBe('HIGH_CARD');
    });

    it('evaluates HIGH_CARD for an unpaired hand', () => {
      const hand = engine.evaluateHand([
        card('A', 'SPADES'),
        card('K', 'HEARTS'),
        card('9', 'DIAMONDS'),
        card('7', 'CLUBS'),
        card('2', 'SPADES'),
      ]);
      expect(hand.type).toBe('HIGH_CARD');
      expect(hand.rank).toBe(1);
    });

    it('throws on duplicate cards in hand', () => {
      expect(() =>
        engine.evaluateHand([
          card('A', 'SPADES'),
          card('A', 'SPADES'),
          card('K', 'HEARTS'),
          card('Q', 'DIAMONDS'),
          card('J', 'CLUBS'),
        ]),
      ).toThrow('duplicate');
    });

    it('throws on invalid card in hand', () => {
      expect(() =>
        engine.evaluateHand([
          { rank: 'A', suit: 'SPADES' },
          { rank: 'X', suit: 'HEARTS' },
          { rank: 'K', suit: 'DIAMONDS' },
          { rank: 'Q', suit: 'CLUBS' },
          { rank: 'J', suit: 'SPADES' },
        ]),
      ).toThrow('Invalid poker card');
    });
  });

  describe('hand comparison', () => {
    it('royal flush beats straight flush', () => {
      const royal = engine.evaluateHand([
        card('A', 'SPADES'),
        card('K', 'SPADES'),
        card('Q', 'SPADES'),
        card('J', 'SPADES'),
        card('10', 'SPADES'),
      ]);
      const sf = engine.evaluateHand([
        card('9', 'HEARTS'),
        card('8', 'HEARTS'),
        card('7', 'HEARTS'),
        card('6', 'HEARTS'),
        card('5', 'HEARTS'),
      ]);
      expect(engine.compareHands(royal, sf)).toBe(royal);
    });

    it('higher straight flush beats lower straight flush', () => {
      const higher = engine.evaluateHand([
        card('9', 'HEARTS'),
        card('8', 'HEARTS'),
        card('7', 'HEARTS'),
        card('6', 'HEARTS'),
        card('5', 'HEARTS'),
      ]);
      const lower = engine.evaluateHand([
        card('8', 'CLUBS'),
        card('7', 'CLUBS'),
        card('6', 'CLUBS'),
        card('5', 'CLUBS'),
        card('4', 'CLUBS'),
      ]);
      expect(engine.compareHands(higher, lower)).toBe(higher);
    });

    it('four of a kind compares by quad rank', () => {
      const quadK = engine.evaluateHand([
        card('K', 'SPADES'),
        card('K', 'HEARTS'),
        card('K', 'DIAMONDS'),
        card('K', 'CLUBS'),
        card('2', 'SPADES'),
      ]);
      const quadQ = engine.evaluateHand([
        card('Q', 'SPADES'),
        card('Q', 'HEARTS'),
        card('Q', 'DIAMONDS'),
        card('Q', 'CLUBS'),
        card('A', 'SPADES'),
      ]);
      expect(engine.compareHands(quadK, quadQ)).toBe(quadK);
    });

    it('full house compares by trips rank, then pair rank', () => {
      const fullJ9 = engine.evaluateHand([
        card('J', 'SPADES'),
        card('J', 'HEARTS'),
        card('J', 'DIAMONDS'),
        card('9', 'CLUBS'),
        card('9', 'SPADES'),
      ]);
      const fullJ8 = engine.evaluateHand([
        card('J', 'SPADES'),
        card('J', 'HEARTS'),
        card('J', 'DIAMONDS'),
        card('8', 'CLUBS'),
        card('8', 'SPADES'),
      ]);
      expect(engine.compareHands(fullJ9, fullJ8)).toBe(fullJ9);
    });

    it('flush compares by high card descending', () => {
      const flushA = engine.evaluateHand([
        card('A', 'CLUBS'),
        card('J', 'CLUBS'),
        card('9', 'CLUBS'),
        card('7', 'CLUBS'),
        card('2', 'CLUBS'),
      ]);
      const flushK = engine.evaluateHand([
        card('K', 'CLUBS'),
        card('J', 'CLUBS'),
        card('9', 'CLUBS'),
        card('7', 'CLUBS'),
        card('2', 'CLUBS'),
      ]);
      expect(engine.compareHands(flushA, flushK)).toBe(flushA);
    });

    it('straight compares by high card', () => {
      const high = engine.evaluateHand([
        card('9', 'SPADES'),
        card('8', 'HEARTS'),
        card('7', 'DIAMONDS'),
        card('6', 'CLUBS'),
        card('5', 'SPADES'),
      ]);
      const low = engine.evaluateHand([
        card('8', 'SPADES'),
        card('7', 'HEARTS'),
        card('6', 'DIAMONDS'),
        card('5', 'CLUBS'),
        card('4', 'SPADES'),
      ]);
      expect(engine.compareHands(high, low)).toBe(high);
    });

    it('ace-low straight (5-high) is the lowest straight', () => {
      const fiveHigh = engine.evaluateHand([
        card('A', 'SPADES'),
        card('5', 'HEARTS'),
        card('4', 'DIAMONDS'),
        card('3', 'CLUBS'),
        card('2', 'HEARTS'),
      ]);
      const sixHigh = engine.evaluateHand([
        card('6', 'SPADES'),
        card('5', 'HEARTS'),
        card('4', 'DIAMONDS'),
        card('3', 'CLUBS'),
        card('2', 'HEARTS'),
      ]);
      expect(engine.compareHands(sixHigh, fiveHigh)).toBe(sixHigh);
    });

    it('three of a kind compares by trips rank', () => {
      const tripK = engine.evaluateHand([
        card('K', 'SPADES'),
        card('K', 'HEARTS'),
        card('K', 'DIAMONDS'),
        card('7', 'CLUBS'),
        card('2', 'SPADES'),
      ]);
      const tripQ = engine.evaluateHand([
        card('Q', 'SPADES'),
        card('Q', 'HEARTS'),
        card('Q', 'DIAMONDS'),
        card('7', 'CLUBS'),
        card('2', 'SPADES'),
      ]);
      expect(engine.compareHands(tripK, tripQ)).toBe(tripK);
    });

    it('three of a kind compares by kicker when trips are equal', () => {
      const tripHighKicker = engine.evaluateHand([
        card('Q', 'SPADES'),
        card('Q', 'HEARTS'),
        card('Q', 'DIAMONDS'),
        card('K', 'CLUBS'),
        card('7', 'SPADES'),
      ]);
      const tripLowKicker = engine.evaluateHand([
        card('Q', 'SPADES'),
        card('Q', 'HEARTS'),
        card('Q', 'DIAMONDS'),
        card('9', 'CLUBS'),
        card('7', 'SPADES'),
      ]);
      expect(engine.compareHands(tripHighKicker, tripLowKicker)).toBe(tripHighKicker);
    });

    it('two pair compares higher pair first, then lower pair, then kicker', () => {
      const highPair = engine.evaluateHand([
        card('K', 'SPADES'),
        card('K', 'HEARTS'),
        card('Q', 'DIAMONDS'),
        card('Q', 'CLUBS'),
        card('2', 'SPADES'),
      ]);
      const lowPair = engine.evaluateHand([
        card('K', 'SPADES'),
        card('K', 'HEARTS'),
        card('J', 'DIAMONDS'),
        card('J', 'CLUBS'),
        card('2', 'SPADES'),
      ]);
      expect(engine.compareHands(highPair, lowPair)).toBe(highPair);
    });

    it('jacks or better compares by pair rank, then kickers', () => {
      const pairK = engine.evaluateHand([
        card('K', 'SPADES'),
        card('K', 'HEARTS'),
        card('7', 'DIAMONDS'),
        card('3', 'CLUBS'),
        card('2', 'SPADES'),
      ]);
      const pairJ = engine.evaluateHand([
        card('J', 'SPADES'),
        card('J', 'HEARTS'),
        card('7', 'DIAMONDS'),
        card('3', 'CLUBS'),
        card('2', 'SPADES'),
      ]);
      expect(engine.compareHands(pairK, pairJ)).toBe(pairK);
    });

    it('high card compares card by card from highest to lowest', () => {
      const aceHigh = engine.evaluateHand([
        card('A', 'SPADES'),
        card('K', 'HEARTS'),
        card('9', 'DIAMONDS'),
        card('7', 'CLUBS'),
        card('2', 'SPADES'),
      ]);
      const kingHigh = engine.evaluateHand([
        card('K', 'SPADES'),
        card('Q', 'HEARTS'),
        card('9', 'DIAMONDS'),
        card('7', 'CLUBS'),
        card('2', 'SPADES'),
      ]);
      expect(engine.compareHands(aceHigh, kingHigh)).toBe(aceHigh);
    });

    it('returns first hand when hands are identical', () => {
      const a = engine.evaluateHand([
        card('A', 'SPADES'),
        card('K', 'HEARTS'),
        card('9', 'DIAMONDS'),
        card('7', 'CLUBS'),
        card('2', 'SPADES'),
      ]);
      const b = engine.evaluateHand([
        card('A', 'SPADES'),
        card('K', 'HEARTS'),
        card('9', 'DIAMONDS'),
        card('7', 'CLUBS'),
        card('2', 'SPADES'),
      ]);
      expect(engine.compareHands(a, b)).toBe(a);
    });
  });

  describe('draw mechanics', () => {
    it('replaces only non-held cards', () => {
      const deck = engine.createDeck();
      const { hand, remainingDeck } = engine.dealCards(deck, 5);
      const { finalHand } = engine.draw(hand, [0, 1, 2, 3, 4], remainingDeck);
      expect(finalHand).toEqual(hand);
    });

    it('replaces all cards when nothing is held', () => {
      const deck = engine.createDeck();
      const { hand, remainingDeck } = engine.dealCards(deck, 5);
      const { finalHand } = engine.draw(hand, [], remainingDeck);
      expect(finalHand).toHaveLength(5);
      expect(new Set(finalHand.map((c) => `${c.rank}-${c.suit}`)).size).toBe(5);
      expect(finalHand.every((c) => !hand.some((h) => h.rank === c.rank && h.suit === c.suit))).toBe(true);
    });

    it('returns deep copies, not references', () => {
      const deck = engine.createDeck();
      const { hand, remainingDeck } = engine.dealCards(deck, 5);
      const { finalHand } = engine.draw(hand, [], remainingDeck);
      finalHand[0]!.rank = 'X' as never;
      expect(hand[0]!.rank).not.toBe('X');
    });

    it('throws when initial hand does not have 5 cards', () => {
      const deck = engine.createDeck();
      const { remainingDeck } = engine.dealCards(deck, 3);
      expect(() => engine.draw([card('A', 'SPADES'), card('K', 'HEARTS')], [], remainingDeck)).toThrow();
    });

    it('throws on invalid hold indices', () => {
      const deck = engine.createDeck();
      const { hand, remainingDeck } = engine.dealCards(deck, 5);
      expect(() => engine.draw(hand, [5], remainingDeck)).toThrow();
      expect(() => engine.draw(hand, [-1], remainingDeck)).toThrow();
      expect(() => engine.draw(hand, [0, 0], remainingDeck)).toThrow();
    });

    it('throws when deck has insufficient cards for draw', () => {
      const deck = engine.createDeck();
      const { hand, remainingDeck } = engine.dealCards(deck, 5);
      const smallDeck = remainingDeck.slice(0, 2);
      expect(() => engine.draw(hand, [], smallDeck)).toThrow('Not enough cards');
    });
  });

  describe('validation', () => {
    it('rejects empty or whitespace player IDs', () => {
      expect(() => engine.validatePlayerId('')).toThrow('Player id is required');
      expect(() => engine.validatePlayerId('  ')).toThrow('Player id is required');
    });

    it('accepts valid player IDs', () => {
      expect(() => engine.validatePlayerId('player-1')).not.toThrow();
    });

    it('rejects invalid bets', () => {
      expect(() => engine.validateBet(null)).toThrow();
      expect(() => engine.validateBet({})).toThrow();
      expect(() => engine.validateBet({ playerId: '' })).toThrow();
      expect(() => engine.validateBet({ playerId: 'p', amount: 0 })).toThrow();
      expect(() => engine.validateBet({ playerId: 'p', amount: -1 })).toThrow();
      expect(() => engine.validateBet({ playerId: 'p', amount: 1.5 })).toThrow();
      expect(() => engine.validateBet({ playerId: 'p', amount: Number.NaN })).toThrow();
      expect(() => engine.validateBet({ playerId: 'p', amount: Infinity })).toThrow();
    });

    it('rejects invalid hold arrays in bet', () => {
      expect(() => engine.validateBet({ playerId: 'p', amount: 10, hold: 'bad' })).toThrow();
      expect(() => engine.validateBet({ playerId: 'p', amount: 10, hold: [5] })).toThrow();
    });

    it('accepts valid bets', () => {
      expect(() => engine.validateBet({ playerId: 'p', amount: 10 })).not.toThrow();
      expect(() => engine.validateBet({ playerId: 'p', amount: 10, hold: [] })).not.toThrow();
      expect(() => engine.validateBet({ playerId: 'p', amount: 10, hold: [0, 1, 2] })).not.toThrow();
    });
  });

  describe('settlement', () => {
    it.each([
      ['ROYAL_FLUSH', 250],
      ['STRAIGHT_FLUSH', 50],
      ['FOUR_OF_A_KIND', 25],
      ['FULL_HOUSE', 9],
      ['FLUSH', 6],
      ['STRAIGHT', 4],
      ['THREE_OF_A_KIND', 3],
      ['TWO_PAIR', 2],
      ['JACKS_OR_BETTER', 1],
    ] as const)('pays %s at %ix', (handType, multiplier) => {
      const hand: PokerHand = {
        cards: [card('A', 'SPADES')],
        type: handType,
        rank: 0,
        comparison: [],
      };
      const settlement = engine.settleBet({ playerId: 'p1', amount: 10 }, hand, 1000);
      expect(settlement).toMatchObject({
        playerId: 'p1',
        amount: 10,
        handType,
        result: 'WIN',
        profit: 10 * multiplier,
        totalReturn: 10 + 10 * multiplier,
        settledAt: 1000,
      });
    });

    it('HIGH_CARD results in a loss', () => {
      const hand: PokerHand = {
        cards: [card('A', 'SPADES')],
        type: 'HIGH_CARD',
        rank: 0,
        comparison: [],
      };
      const settlement = engine.settleBet({ playerId: 'p1', amount: 10 }, hand, 1000);
      expect(settlement).toMatchObject({
        result: 'LOSS',
        profit: -10,
        totalReturn: 0,
      });
    });

    it('settlements use integer arithmetic for all financials', () => {
      const hand: PokerHand = {
        cards: [],
        type: 'FULL_HOUSE',
        rank: 0,
        comparison: [],
      };
      const settlement = engine.settleBet({ playerId: 'p1', amount: 7 }, hand);
      expect(Number.isInteger(settlement.profit)).toBe(true);
      expect(Number.isInteger(settlement.totalReturn)).toBe(true);
      expect(settlement.profit).toBe(63);
      expect(settlement.totalReturn).toBe(70);
    });
  });

  describe('payout multipliers', () => {
    it('returns correct multiplier for every hand type', () => {
      expect(engine.getPayoutMultiplier('ROYAL_FLUSH')).toBe(250);
      expect(engine.getPayoutMultiplier('STRAIGHT_FLUSH')).toBe(50);
      expect(engine.getPayoutMultiplier('FOUR_OF_A_KIND')).toBe(25);
      expect(engine.getPayoutMultiplier('FULL_HOUSE')).toBe(9);
      expect(engine.getPayoutMultiplier('FLUSH')).toBe(6);
      expect(engine.getPayoutMultiplier('STRAIGHT')).toBe(4);
      expect(engine.getPayoutMultiplier('THREE_OF_A_KIND')).toBe(3);
      expect(engine.getPayoutMultiplier('TWO_PAIR')).toBe(2);
      expect(engine.getPayoutMultiplier('JACKS_OR_BETTER')).toBe(1);
      expect(engine.getPayoutMultiplier('HIGH_CARD')).toBe(0);
    });
  });
});

describe('PokerRoundEngine', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('starts in BETTING status with empty players', () => {
    vi.useFakeTimers();
    const round = new PokerRoundEngine();
    const state = round.start();
    expect(state.status).toBe('BETTING');
    expect(state.players).toHaveLength(0);
    expect(state.roundNumber).toBe(1);
    round.stop();
  });

  it('rejects duplicate starts', () => {
    vi.useFakeTimers();
    const round = new PokerRoundEngine();
    round.start();
    expect(() => round.start()).toThrow('already running');
    round.stop();
  });

  it('accepts bets during BETTING phase', () => {
    vi.useFakeTimers();
    const round = new PokerRoundEngine();
    round.start();
    round.placeBet('p1', 100);
    round.placeBet('p2', 200);
    const state = round.getState();
    expect(state?.players).toHaveLength(2);
    expect(state?.players[0]?.bet.amount).toBe(100);
    expect(state?.players[1]?.bet.amount).toBe(200);
    round.stop();
  });

  it('rejects duplicate player bets', () => {
    vi.useFakeTimers();
    const round = new PokerRoundEngine();
    round.start();
    round.placeBet('p1', 100);
    expect(() => round.placeBet('p1', 200)).toThrow('already placed');
    round.stop();
  });

  it('rejects bets after lock', () => {
    vi.useFakeTimers();
    const round = new PokerRoundEngine();
    round.start();
    vi.advanceTimersByTime(15_000);
    expect(round.getState()?.status).toBe('LOCK');
    expect(() => round.placeBet('p1', 100)).toThrow('BETTING');
    round.stop();
  });

  it('rejects bets with invalid amounts', () => {
    vi.useFakeTimers();
    const round = new PokerRoundEngine();
    round.start();
    expect(() => round.placeBet('p1', 0)).toThrow();
    expect(() => round.placeBet('p1', -1)).toThrow();
    expect(() => round.placeBet('p1', 1.5)).toThrow();
    round.stop();
  });

  it('reveals cards and hands after DEAL phase', () => {
    vi.useFakeTimers();
    const round = new PokerRoundEngine();
    round.start();
    round.placeBet('p1', 100);
    vi.advanceTimersByTime(15_000); // LOCK
    vi.advanceTimersByTime(0); // DEAL

    const state = round.getState();
    expect(state?.status).toBe('DEAL');
    expect(state?.players[0]?.cards).toHaveLength(5);
    expect(state?.players[0]?.hand).not.toBeNull();
    expect(state?.players[0]?.hand?.cards).toHaveLength(5);
    round.stop();
  });

  it('completes full round lifecycle and produces settlement', () => {
    vi.useFakeTimers();
    const round = new PokerRoundEngine();
    const first = round.start();
    round.placeBet('p1', 100);

    vi.advanceTimersByTime(15_000); // LOCK → DEAL
    vi.advanceTimersByTime(0); // DEAL → COMPARE
    vi.advanceTimersByTime(1_000); // COMPARE → SETTLEMENT
    vi.advanceTimersByTime(1_000); // SETTLEMENT → RESULT
    vi.advanceTimersByTime(5_000); // RESULT → COMPLETED

    const result = round.getLastResult();
    expect(result).not.toBeNull();
    expect(result?.roundId).toBe(first.roundId);
    expect(result?.settlements).toHaveLength(1);
    expect(result?.settlements[0]?.playerId).toBe('p1');

    const settlement = result?.settlements[0];
    expect(Number.isInteger(settlement?.profit)).toBe(true);
    expect(Number.isInteger(settlement?.totalReturn)).toBe(true);
    round.stop();
  });

  it('cycles to next round after completion', () => {
    vi.useFakeTimers();
    const round = new PokerRoundEngine();
    const first = round.start();
    round.placeBet('p1', 100);

    vi.advanceTimersByTime(15_000);
    vi.advanceTimersByTime(0);
    vi.advanceTimersByTime(1_000);
    vi.advanceTimersByTime(1_000);
    vi.advanceTimersByTime(5_000);
    vi.advanceTimersByTime(0); // next round

    const state = round.getState();
    expect(state?.status).toBe('BETTING');
    expect(state?.roundNumber).toBe(first.roundNumber + 1);
    expect(state?.players).toHaveLength(0);
    round.stop();
  });

  it('stops cleanly and clears timers', () => {
    vi.useFakeTimers();
    const round = new PokerRoundEngine();
    round.start();
    round.stop();
    expect(round.isRunning()).toBe(false);
    expect(round.getState()).toBeNull();
    vi.advanceTimersByTime(60_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not reveal cards or hands during BETTING', () => {
    vi.useFakeTimers();
    const round = new PokerRoundEngine();
    round.start();
    round.placeBet('p1', 100);
    const state = round.getState();
    expect(state?.players[0]?.cards).toHaveLength(0);
    expect(state?.players[0]?.hand).toBeNull();
    round.stop();
  });

  it('handles draw with hold selection correctly', () => {
    vi.useFakeTimers();
    const round = new PokerRoundEngine();
    round.start();
    round.placeBet('p1', 100);

    vi.advanceTimersByTime(15_000); // LOCK
    round.submitHold('p1', [0, 1, 2, 3, 4]);
    vi.advanceTimersByTime(0); // DEAL

    const state = round.getState();
    expect(state?.players[0]?.bet.hold).toEqual([0, 1, 2, 3, 4]);
    round.stop();
  });

  it('rejects hold submission outside LOCK phase', () => {
    vi.useFakeTimers();
    const round = new PokerRoundEngine();
    round.start();
    round.placeBet('p1', 100);
    expect(() => round.submitHold('p1', [0, 1])).toThrow('LOCK');
    round.stop();
  });

  it('rejects hold submission for unknown player', () => {
    vi.useFakeTimers();
    const round = new PokerRoundEngine();
    round.start();
    vi.advanceTimersByTime(15_000);
    expect(() => round.submitHold('unknown', [0, 1])).toThrow('not placed a bet');
    round.stop();
  });

  it('rejects invalid hold indices', () => {
    vi.useFakeTimers();
    const round = new PokerRoundEngine();
    round.start();
    round.placeBet('p1', 100);
    vi.advanceTimersByTime(15_000);
    expect(() => round.submitHold('p1', [5])).toThrow('between 0 and 4');
    expect(() => round.submitHold('p1', [-1])).toThrow('between 0 and 4');
    expect(() => round.submitHold('p1', [0, 0])).toThrow('unique');
    round.stop();
  });

  it('enforces max players limit', () => {
    vi.useFakeTimers();
    const round = new PokerRoundEngine();
    round.start();
    for (let i = 0; i < 8; i++) {
      round.placeBet(`p${i}`, 10);
    }
    expect(() => round.placeBet('p8', 10)).toThrow('Maximum');
    round.stop();
  });

  it('auto-holds nothing when player does not submit hold', () => {
    vi.useFakeTimers();
    vi.spyOn(PokerEngine.prototype, 'shuffleDeck').mockReturnValue(
      Array.from({ length: 52 }, (_, i) => card('2', 'SPADES')).map((_, i) => {
        const suits = ['SPADES', 'HEARTS', 'DIAMONDS', 'CLUBS'] as const;
        const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;
        return card(ranks[i % 13], suits[Math.floor(i / 13)]);
      }),
    );
    const round = new PokerRoundEngine();
    round.start();
    round.placeBet('p1', 100);
    vi.advanceTimersByTime(15_000); // LOCK
    vi.advanceTimersByTime(0); // DEAL

    const state = round.getState();
    expect(state?.players[0]?.bet.hold).toEqual([]);
    round.stop();
  });
});
