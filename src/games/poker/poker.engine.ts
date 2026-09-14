import { randomInt } from 'node:crypto';
import {
  PokerBet,
  PokerCard,
  PokerHand,
  PokerHandType,
  PokerPlayerResult,
  PokerRank,
  PokerSettlement,
  PokerSuit,
} from './poker.types.js';

const SUITS: readonly PokerSuit[] = ['SPADES', 'HEARTS', 'DIAMONDS', 'CLUBS'];
const RANKS: readonly PokerRank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RANK_VALUES: Record<PokerRank, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
  '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14,
};

export class PokerEngine {
  createDeck(): PokerCard[] {
    return SUITS.flatMap((suit) => RANKS.map((rank) => ({ suit, rank })));
  }

  shuffleDeck(deck: readonly PokerCard[]): PokerCard[] {
    const shuffled = deck.map((card) => ({ ...card }));
    for (let i = shuffled.length - 1; i > 0; i--) {
      const swap = randomInt(0, i + 1);
      [shuffled[i], shuffled[swap]] = [shuffled[swap]!, shuffled[i]!];
    }
    return shuffled;
  }

  dealCards(deck: readonly PokerCard[], count = 5): { hand: PokerCard[]; remainingDeck: PokerCard[] } {
    if (!Number.isInteger(count) || count < 1 || count > deck.length) {
      throw new Error('Invalid card count');
    }
    return {
      hand: deck.slice(0, count).map((card) => ({ ...card })),
      remainingDeck: deck.slice(count).map((card) => ({ ...card })),
    };
  }

  draw(
    initialCards: readonly PokerCard[],
    heldIndices: number[],
    remainingDeck: readonly PokerCard[],
  ): { finalHand: PokerCard[]; remainingDeck: PokerCard[] } {
    if (initialCards.length !== 5) {
      throw new Error('Initial hand must contain exactly 5 cards');
    }
    this.validateHoldIndices(heldIndices);

    const heldSet = new Set(heldIndices);
    const drawCount = 5 - heldSet.size;

    if (drawCount > remainingDeck.length) {
      throw new Error('Not enough cards remaining in the deck');
    }

    const finalHand: PokerCard[] = [];
    let drawIndex = 0;

    for (let i = 0; i < 5; i++) {
      if (heldSet.has(i)) {
        finalHand.push({ ...initialCards[i]! });
      } else {
        finalHand.push({ ...remainingDeck[drawIndex]! });
        drawIndex++;
      }
    }

    return {
      finalHand,
      remainingDeck: remainingDeck.slice(drawCount).map((card) => ({ ...card })),
    };
  }

  validatePlayerId(playerId: unknown): void {
    if (typeof playerId !== 'string' || playerId.trim().length === 0) {
      throw new Error('Player id is required');
    }
  }

  validateBet(bet: unknown): asserts bet is PokerBet {
    if (!bet || typeof bet !== 'object') {
      throw new Error('A valid poker bet is required');
    }
    const value = bet as Record<string, unknown>;
    this.validatePlayerId(value.playerId);
    if (typeof value.amount !== 'number' || !Number.isFinite(value.amount) || !Number.isInteger(value.amount) || value.amount < 1) {
      throw new Error('Bet amount must be a positive whole number');
    }
    if (value.hold !== undefined) {
      if (!Array.isArray(value.hold)) {
        throw new Error('Hold must be an array of card indices');
      }
      this.validateHoldIndices(value.hold);
    }
  }

  evaluateHand(cards: readonly PokerCard[]): PokerHand {
    if (cards.length !== 5) {
      throw new Error('Poker hand must contain exactly 5 cards');
    }
    this.validateHandCards(cards);

    const values = cards.map((card) => RANK_VALUES[card.rank]).sort((a, b) => b - a);
    const suits = cards.map((card) => card.suit);
    const aceLow = this.isAceLowStraight(values);
    const straightComparison = aceLow ? [5, 4, 3, 2, 1] : values;

    if (this.isFlush(suits)) {
      if (this.isStraight(values)) {
        if (values[0] === 14 && values[1] === 13 && values[2] === 12 && values[3] === 11 && values[4] === 10) {
          return this.makeHand(cards, 'ROYAL_FLUSH', 10, values);
        }
        return this.makeHand(cards, 'STRAIGHT_FLUSH', 9, straightComparison);
      }
      return this.makeHand(cards, 'FLUSH', 6, values);
    }

    if (this.isStraight(values)) {
      return this.makeHand(cards, 'STRAIGHT', 5, straightComparison);
    }

    const freq = this.frequencies(values);
    const sortedFreq = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    const counts = sortedFreq.map(([, c]) => c);

    if (counts[0] === 4) {
      const quad = sortedFreq[0]![0];
      const kicker = sortedFreq[1]![0];
      return this.makeHand(cards, 'FOUR_OF_A_KIND', 8, [quad, kicker]);
    }
    if (counts[0] === 3 && counts[1] === 2) {
      const trips = sortedFreq[0]![0];
      const pair = sortedFreq[1]![0];
      return this.makeHand(cards, 'FULL_HOUSE', 7, [trips, pair]);
    }
    if (counts[0] === 3) {
      const trips = sortedFreq[0]![0];
      const kickers = sortedFreq.slice(1).map(([v]) => v);
      return this.makeHand(cards, 'THREE_OF_A_KIND', 4, [trips, ...kickers]);
    }
    if (counts[0] === 2 && counts[1] === 2) {
      const pairs = sortedFreq.slice(0, 2).map(([v]) => v).sort((a, b) => b - a);
      const kicker = sortedFreq[2]![0];
      return this.makeHand(cards, 'TWO_PAIR', 3, [...pairs, kicker]);
    }
    if (counts[0] === 2) {
      const pair = sortedFreq[0]![0];
      if (pair >= 11) {
        const kickers = sortedFreq.slice(1).map(([v]) => v);
        return this.makeHand(cards, 'JACKS_OR_BETTER', 2, [pair, ...kickers]);
      }
    }

    return this.makeHand(cards, 'HIGH_CARD', 1, values);
  }

  compareHands(a: PokerHand, b: PokerHand): PokerHand {
    if (a.rank !== b.rank) return a.rank > b.rank ? a : b;
    for (let i = 0; i < Math.min(a.comparison.length, b.comparison.length); i++) {
      if (a.comparison[i] !== b.comparison[i]) {
        return a.comparison[i]! > b.comparison[i]! ? a : b;
      }
    }
    return a;
  }

  getPayoutMultiplier(handType: PokerHandType): number {
    switch (handType) {
      case 'ROYAL_FLUSH': return 250;
      case 'STRAIGHT_FLUSH': return 50;
      case 'FOUR_OF_A_KIND': return 25;
      case 'FULL_HOUSE': return 9;
      case 'FLUSH': return 6;
      case 'STRAIGHT': return 4;
      case 'THREE_OF_A_KIND': return 3;
      case 'TWO_PAIR': return 2;
      case 'JACKS_OR_BETTER': return 1;
      case 'HIGH_CARD': return 0;
    }
  }

  settleBet(bet: PokerBet, hand: PokerHand, settledAt = Date.now()): PokerSettlement {
    this.validateBet(bet);
    const multiplier = this.getPayoutMultiplier(hand.type);
    const result: PokerPlayerResult = multiplier > 0 ? 'WIN' : 'LOSS';
    const profit = result === 'WIN' ? bet.amount * multiplier : -bet.amount;
    return {
      playerId: bet.playerId,
      amount: bet.amount,
      handType: hand.type,
      result,
      profit,
      totalReturn: result === 'WIN' ? bet.amount + profit : 0,
      settledAt,
    };
  }

  private makeHand(cards: readonly PokerCard[], type: PokerHandType, rank: number, comparison: number[]): PokerHand {
    return {
      cards: cards.map((card) => ({ ...card })),
      type,
      rank,
      comparison,
    };
  }

  private validateHandCards(cards: readonly PokerCard[]): void {
    const unique = new Set<string>();
    for (const card of cards) {
      if (!card || !SUITS.includes(card.suit) || !RANKS.includes(card.rank)) {
        throw new Error('Invalid poker card');
      }
      const key = `${card.rank}-${card.suit}`;
      if (unique.has(key)) {
        throw new Error('Poker hand contains duplicate cards');
      }
      unique.add(key);
    }
  }

  private validateHoldIndices(indices: unknown): void {
    if (!Array.isArray(indices)) {
      throw new Error('Hold must be an array');
    }
    for (const idx of indices) {
      if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx > 4) {
        throw new Error('Hold indices must be integers between 0 and 4');
      }
    }
    if (new Set(indices).size !== indices.length) {
      throw new Error('Hold indices must be unique');
    }
  }

  private isFlush(suits: readonly PokerSuit[]): boolean {
    return suits.every((suit) => suit === suits[0]);
  }

  private isAceLowStraight(sortedValues: readonly number[]): boolean {
    return sortedValues[0] === 14 && sortedValues[1] === 5 && sortedValues[2] === 4 && sortedValues[3] === 3 && sortedValues[4] === 2;
  }

  private isStraight(sortedValues: readonly number[]): boolean {
    const set = new Set(sortedValues);
    if (set.size !== 5) return false;
    if (sortedValues[0] - sortedValues[4] === 4) return true;
    return this.isAceLowStraight(sortedValues);
  }

  private frequencies(values: readonly number[]): Map<number, number> {
    const freq = new Map<number, number>();
    for (const v of values) {
      freq.set(v, (freq.get(v) ?? 0) + 1);
    }
    return freq;
  }
}
