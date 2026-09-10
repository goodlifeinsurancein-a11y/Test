import { randomInt } from 'node:crypto';

import {
  Card,
  CardRank,
  CardSuit,
  DragonTigerBetInput,
  DragonTigerBetType,
  DragonTigerResult,
  DragonTigerSettlement,
  DragonTigerWinner,
} from './dragon-tiger.types.js';

const SUITS: CardSuit[] = ['SPADES', 'HEARTS', 'DIAMONDS', 'CLUBS'];
const RANKS: CardRank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

const RANK_VALUES: Record<CardRank, number> = {
  A: 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
  '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13,
};

/** Stateless deck, comparison, validation, and settlement logic. */
export class DragonTigerEngine {
  createDeck(): Card[] {
    return SUITS.flatMap((suit) => RANKS.map((rank) => ({ suit, rank })));
  }

  shuffleDeck(deck: Card[]): Card[] {
    const shuffled = [...deck];

    for (let index = shuffled.length - 1; index > 0; index--) {
      const swapIndex = randomInt(0, index + 1);
      [shuffled[index], shuffled[swapIndex]] = [
        shuffled[swapIndex],
        shuffled[index],
      ];
    }

    return shuffled;
  }

  dealRound(deck: Card[]): { dragonCard: Card; tigerCard: Card } {
    if (deck.length < 2) {
      throw new Error('At least two cards are required to deal Dragon Tiger');
    }

    const [dragonCard, tigerCard] = deck;

    if (!dragonCard || !tigerCard) {
      throw new Error('Unable to deal Dragon Tiger cards');
    }

    if (
      dragonCard.rank === tigerCard.rank &&
      dragonCard.suit === tigerCard.suit
    ) {
      throw new Error('Dragon and Tiger cards must be different');
    }

    return {
      dragonCard: { ...dragonCard },
      tigerCard: { ...tigerCard },
    };
  }

  compareCards(dragonCard: Card, tigerCard: Card): number {
    return RANK_VALUES[dragonCard.rank] - RANK_VALUES[tigerCard.rank];
  }

  determineResult(dragonCard: Card, tigerCard: Card): DragonTigerResult {
    const comparison = this.compareCards(dragonCard, tigerCard);
    const winner: DragonTigerWinner = comparison > 0
      ? 'DRAGON'
      : comparison < 0
        ? 'TIGER'
        : 'TIE';

    return {
      dragonCard: { ...dragonCard },
      tigerCard: { ...tigerCard },
      winner,
    };
  }

  validatePlayerId(playerId: string): void {
    if (typeof playerId !== 'string' || playerId.trim().length === 0) {
      throw new Error('Player id is required');
    }
  }

  validateBet(bet: DragonTigerBetInput): void {
    if (!bet || typeof bet !== 'object') {
      throw new Error('A valid Dragon Tiger bet is required');
    }

    if (typeof bet.betId !== 'string' || bet.betId.trim().length === 0) {
      throw new Error('Bet id is required');
    }

    if (!this.isBetType(bet.type)) {
      throw new Error('Invalid Dragon Tiger bet type');
    }

    if (!Number.isInteger(bet.amount) || bet.amount < 1) {
      throw new Error('Bet amount must be a positive whole number');
    }
  }

  getPayoutRatio(type: DragonTigerBetType): number {
    if (!this.isBetType(type)) {
      throw new Error('Invalid Dragon Tiger bet type');
    }

    return type === 'TIE' ? 8 : 1;
  }

  isWinningBet(bet: DragonTigerBetInput, result: DragonTigerResult): boolean {
    this.validateBet(bet);
    return bet.type === result.winner;
  }

  settleBet(
    bet: DragonTigerBetInput,
    playerId: string,
    result: DragonTigerResult,
    settledAt = Date.now(),
  ): DragonTigerSettlement {
    this.validateBet(bet);
    this.validatePlayerId(playerId);

    if (!this.isWinningBet(bet, result)) {
      return {
        betId: bet.betId,
        playerId,
        type: bet.type,
        status: 'LOSS',
        amount: bet.amount,
        profit: -bet.amount,
        totalReturn: 0,
        settledAt,
      };
    }

    const profit = bet.amount * this.getPayoutRatio(bet.type);

    return {
      betId: bet.betId,
      playerId,
      type: bet.type,
      status: 'WIN',
      amount: bet.amount,
      profit,
      totalReturn: bet.amount + profit,
      settledAt,
    };
  }

  private isBetType(type: unknown): type is DragonTigerBetType {
    return type === 'DRAGON' || type === 'TIGER' || type === 'TIE';
  }
}
