import { randomInt } from 'node:crypto';

import {
  Card,
  CardRank,
  CardSuit,
  BaccaratBetInput,
  BaccaratBetType,
  BaccaratHand,
  BaccaratResult,
  BaccaratSettlement,
} from './baccarat.types.js';

const SUITS: CardSuit[] = ['SPADES', 'HEARTS', 'DIAMONDS', 'CLUBS'];
const RANKS: CardRank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

const RANK_VALUES: Record<CardRank, number> = {
  A: 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
  '8': 8, '9': 9, '10': 0, J: 0, Q: 0, K: 0,
};

/** Number of decks in a shoe. */
const SHOE_DECKS = 8;

/** Stateless baccarat game logic. */
export class BaccaratEngine {
  createShoe(): Card[] {
    const single: Card[] = SUITS.flatMap((suit) =>
      RANKS.map((rank) => ({ suit, rank })),
    );
    const shoe: Card[] = [];
    for (let d = 0; d < SHOE_DECKS; d++) {
      shoe.push(...single);
    }
    return shoe;
  }

  shuffleShoe(shoe: Card[]): Card[] {
    const shuffled = [...shoe];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = randomInt(0, i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  /** Card value for baccarat (0–9). */
  cardValue(card: Card): number {
    return RANK_VALUES[card.rank];
  }

  /** Hand total = sum of card values mod 10. */
  handTotal(cards: Card[]): number {
    let sum = 0;
    for (const card of cards) {
      sum += RANK_VALUES[card.rank];
    }
    return sum % 10;
  }

  /**
   * Does the banker draw a third card?
   *
   * Rules:
   * - Player total 8 or 9: natural — no third card for either side.
   * - Player draws third if total ≤ 5; stands on 6–7.
   * - Banker draws based on banker total AND the player's third card value.
   */
  bankerDraws(bankerTotal: number, playerThirdCardValue: number | null): boolean {
    // If player didn't draw (stood on 6 or 7), banker draws on 0–5 only.
    if (playerThirdCardValue === null) {
      return bankerTotal <= 5;
    }

    if (bankerTotal >= 8) return false;

    if (bankerTotal <= 5) return true;

    // Banker total 6: draws only if player third card is 6 or 7.
    if (bankerTotal === 6) {
      return playerThirdCardValue === 6 || playerThirdCardValue === 7;
    }

    // Banker total 7: never draws.
    return false;
  }

  dealRound(shoe: Card[]): { playerHand: Card[]; bankerHand: Card[]; remainingShoe: Card[] } {
    if (shoe.length < 6) {
      throw new Error('Shoe too small to deal a baccarat round');
    }

    const remaining = [...shoe];
    const playerHand: Card[] = [remaining.shift()!, remaining.shift()!];
    const bankerHand: Card[] = [remaining.shift()!, remaining.shift()!];

    // Natural: no third card.
    const playerTotal = this.handTotal(playerHand);
    const bankerTotal = this.handTotal(bankerHand);

    if (playerTotal >= 8 || bankerTotal >= 8) {
      return { playerHand, bankerHand, remainingShoe: remaining };
    }

    // Player third card.
    let playerThirdCardValue: number | null = null;
    if (playerTotal <= 5) {
      const third = remaining.shift()!;
      playerThirdCardValue = this.cardValue(third);
      playerHand.push(third);
    }

    // Banker third card.
    if (this.bankerDraws(this.handTotal(bankerHand), playerThirdCardValue)) {
      bankerHand.push(remaining.shift()!);
    }

    return { playerHand, bankerHand, remainingShoe: remaining };
  }

  determineResult(playerHand: Card[], bankerHand: Card[]): BaccaratResult {
    const playerTotal = this.handTotal(playerHand);
    const bankerTotal = this.handTotal(bankerHand);

    let winner: BaccaratHand;
    if (playerTotal > bankerTotal) {
      winner = 'PLAYER';
    } else if (bankerTotal > playerTotal) {
      winner = 'BANKER';
    } else {
      winner = 'TIE';
    }

    return {
      playerHand: playerHand.map((c) => ({ ...c })),
      bankerHand: bankerHand.map((c) => ({ ...c })),
      playerTotal,
      bankerTotal,
      winner,
    };
  }

  validatePlayerId(playerId: string): void {
    if (typeof playerId !== 'string' || playerId.trim().length === 0) {
      throw new Error('Player id is required');
    }
  }

  validateBet(bet: BaccaratBetInput): void {
    if (!bet || typeof bet !== 'object') {
      throw new Error('A valid Baccarat bet is required');
    }
    if (typeof bet.betId !== 'string' || bet.betId.trim().length === 0) {
      throw new Error('Bet id is required');
    }
    if (!this.isBetType(bet.type)) {
      throw new Error('Invalid Baccarat bet type');
    }
    if (!Number.isInteger(bet.amount) || bet.amount < 1) {
      throw new Error('Bet amount must be a positive whole number');
    }
  }

  getPayoutRatio(type: BaccaratBetType): number {
    switch (type) {
      case 'PLAYER': return 100;
      case 'BANKER': return 95;
      case 'TIE':   return 800;
      default: throw new Error('Invalid bet type');
    }
  }

  /** Profit per 100 units wagered (integer arithmetic). */
  getProfitPerHundred(type: BaccaratBetType): number {
    return this.getPayoutRatio(type);
  }

  isWinningBet(bet: BaccaratBetInput, result: BaccaratResult): boolean {
    this.validateBet(bet);
    return bet.type === result.winner;
  }

  /**
   * Settle a single bet using integer arithmetic.
   *
   * profit = floor(amount * payoutRatio / 100)
   *   PLAYER: 1:1   →  profit = amount
   *   BANKER: 0.95:1 → profit = floor(amount * 95 / 100)
   *   TIE:    8:1   →  profit = amount * 8
   */
  settleBet(
    bet: BaccaratBetInput,
    playerId: string,
    result: BaccaratResult,
    settledAt = Date.now(),
  ): BaccaratSettlement {
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

    const profit = Math.floor((bet.amount * this.getPayoutRatio(bet.type)) / 100);

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

  private isBetType(type: unknown): type is BaccaratBetType {
    return type === 'PLAYER' || type === 'BANKER' || type === 'TIE';
  }
}
