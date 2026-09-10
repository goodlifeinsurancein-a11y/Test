import { randomInt } from 'node:crypto';
import {
  TeenPattiBet,
  TeenPattiCard,
  TeenPattiHand,
  TeenPattiHandType,
  TeenPattiPlayerResult,
  TeenPattiRank,
  TeenPattiSettlement,
  TeenPattiSuit,
} from './teen-patti.types.js';

const SUITS: readonly TeenPattiSuit[] = ['SPADES', 'HEARTS', 'DIAMONDS', 'CLUBS'];
const RANKS: readonly TeenPattiRank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RANK_VALUES: Record<TeenPattiRank, number> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  '10': 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

export class TeenPattiEngine {
  createDeck(): TeenPattiCard[] {
    return SUITS.flatMap((suit) => RANKS.map((rank) => ({ suit, rank })));
  }

  shuffleDeck(deck: readonly TeenPattiCard[]): TeenPattiCard[] {
    const shuffled = deck.map((card) => ({ ...card }));
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = randomInt(0, index + 1);
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
    }
    return shuffled;
  }

  dealCards(deck: readonly TeenPattiCard[], count = 3): { hand: TeenPattiCard[]; remainingDeck: TeenPattiCard[] } {
    if (!Number.isInteger(count) || count < 1 || count > deck.length) {
      throw new Error('Invalid card count');
    }
    return {
      hand: deck.slice(0, count).map((card) => ({ ...card })),
      remainingDeck: deck.slice(count).map((card) => ({ ...card })),
    };
  }

  validatePlayerId(playerId: unknown): void {
    if (typeof playerId !== 'string' || playerId.trim().length === 0) {
      throw new Error('Player id is required');
    }
  }

  validateBet(bet: unknown): asserts bet is TeenPattiBet {
    if (!bet || typeof bet !== 'object') {
      throw new Error('A valid Teen Patti bet is required');
    }
    const value = bet as Record<string, unknown>;
    this.validatePlayerId(value.playerId);
    if (typeof value.amount !== 'number' || !Number.isFinite(value.amount) || !Number.isInteger(value.amount) || value.amount < 1) {
      throw new Error('Bet amount must be a positive whole number');
    }
  }

  evaluateHand(cards: readonly TeenPattiCard[]): TeenPattiHand {
    if (cards.length !== 3) {
      throw new Error('Teen Patti hand must contain exactly 3 cards');
    }
    this.validateHandCards(cards);

    const values = cards.map((card) => RANK_VALUES[card.rank]).sort((left, right) => right - left);
    const sameSuit = cards.every((card) => card.suit === cards[0]!.suit);
    const frequencies = new Map<number, number>();
    for (const value of values) frequencies.set(value, (frequencies.get(value) ?? 0) + 1);

    const highestFrequency = Math.max(...frequencies.values());
    const sequenceHigh = this.sequenceHighValue(values);
    let type: TeenPattiHandType;
    if (highestFrequency === 3) type = 'TRAIL';
    else if (sequenceHigh !== null && sameSuit) type = 'PURE_SEQUENCE';
    else if (sequenceHigh !== null) type = 'SEQUENCE';
    else if (sameSuit) type = 'COLOR';
    else if (highestFrequency === 2) type = 'PAIR';
    else type = 'HIGH_CARD';

    return { cards: cards.map((card) => ({ ...card })), type, rank: this.getHandRank(type) };
  }

  compareHands(player: TeenPattiHand, dealer: TeenPattiHand): number {
    if (player.rank !== dealer.rank) return player.rank > dealer.rank ? 1 : -1;

    const playerValues = this.comparisonValues(player);
    const dealerValues = this.comparisonValues(dealer);
    for (let index = 0; index < playerValues.length; index += 1) {
      if (playerValues[index] !== dealerValues[index]) {
        return playerValues[index]! > dealerValues[index]! ? 1 : -1;
      }
    }
    return 0;
  }

  getPayoutMultiplier(handType: TeenPattiHandType): number {
    switch (handType) {
      case 'TRAIL': return 5;
      case 'PURE_SEQUENCE': return 4;
      case 'SEQUENCE': return 3;
      case 'COLOR': return 2;
      case 'PAIR':
      case 'HIGH_CARD': return 1;
    }
  }

  settleBet(bet: TeenPattiBet, playerHand: TeenPattiHand, dealerHand: TeenPattiHand, settledAt = Date.now()): TeenPattiSettlement {
    this.validateBet(bet);
    const comparison = this.compareHands(playerHand, dealerHand);
    const result: TeenPattiPlayerResult = comparison > 0 ? 'WIN' : comparison < 0 ? 'LOSS' : 'TIE';
    const profit = result === 'WIN' ? bet.amount * this.getPayoutMultiplier(playerHand.type) : result === 'LOSS' ? -bet.amount : 0;
    return {
      playerId: bet.playerId,
      amount: bet.amount,
      handType: playerHand.type,
      result,
      profit,
      totalReturn: result === 'WIN' ? bet.amount + profit : result === 'TIE' ? bet.amount : 0,
      settledAt,
    };
  }

  private validateHandCards(cards: readonly TeenPattiCard[]): void {
    const uniqueCards = new Set<string>();
    for (const card of cards) {
      if (!card || !SUITS.includes(card.suit) || !RANKS.includes(card.rank)) {
        throw new Error('Invalid Teen Patti card');
      }
      const key = `${card.rank}-${card.suit}`;
      if (uniqueCards.has(key)) throw new Error('Teen Patti hand contains duplicate cards');
      uniqueCards.add(key);
    }
  }

  private getHandRank(type: TeenPattiHandType): number {
    switch (type) {
      case 'TRAIL': return 6;
      case 'PURE_SEQUENCE': return 5;
      case 'SEQUENCE': return 4;
      case 'COLOR': return 3;
      case 'PAIR': return 2;
      case 'HIGH_CARD': return 1;
    }
  }

  private comparisonValues(hand: TeenPattiHand): number[] {
    const values = hand.cards.map((card) => RANK_VALUES[card.rank]).sort((left, right) => right - left);
    if (hand.type === 'TRAIL') return [values[0]!];
    if (hand.type === 'PURE_SEQUENCE' || hand.type === 'SEQUENCE') return [this.sequenceHighValue(values)!];
    if (hand.type === 'PAIR') {
      const frequencies = new Map<number, number>();
      for (const value of values) frequencies.set(value, (frequencies.get(value) ?? 0) + 1);
      const pair = [...frequencies.entries()].find(([, count]) => count === 2)?.[0];
      const kicker = [...frequencies.entries()].find(([, count]) => count === 1)?.[0];
      return [pair ?? 0, kicker ?? 0];
    }
    return values;
  }

  private sequenceHighValue(values: readonly number[]): number | null {
    const ascending = [...new Set(values)].sort((left, right) => left - right);
    if (ascending.length !== 3) return null;
    if (ascending[0] === 2 && ascending[1] === 3 && ascending[2] === 14) return 3;
    return ascending[1] === ascending[0]! + 1 && ascending[2] === ascending[1]! + 1 ? ascending[2]! : null;
  }
}
