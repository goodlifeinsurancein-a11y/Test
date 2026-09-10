import { randomInt } from 'node:crypto';
import { Card, CardRank, CardSuit, HiLoBet, HiLoChoice, HiLoResult, HiLoSettlement } from './hi-lo.types.js';

const SUITS: CardSuit[] = ['CLUBS', 'DIAMONDS', 'HEARTS', 'SPADES'];
const RANKS: CardRank[] = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const RANK_VALUES: Record<CardRank, number> = {
  '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14,
};

export function cardValue(rank: CardRank): number { return RANK_VALUES[rank]; }

export function buildDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) for (const rank of RANKS) {
    deck.push({ suit, rank, value: RANK_VALUES[rank] });
  }
  return deck;
}

export function shuffle(deck: Card[]): Card[] {
  const a = [...deck];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const EQUAL_PAYOUT = 5;  // 5x for EQUAL
const SIDE_PAYOUT = 1.95; // 1.95x for HIGHER/LOWER

export class HiLoEngine {
  validateBet(bet: { betId: string; choice: HiLoChoice; amount: number }): void {
    if (!bet.betId || typeof bet.betId !== 'string' || bet.betId.trim().length === 0) throw new Error('Invalid betId');
    if (!['HIGHER', 'LOWER', 'EQUAL'].includes(bet.choice)) throw new Error('Invalid choice: must be HIGHER, LOWER, or EQUAL');
    if (!Number.isInteger(bet.amount) || bet.amount <= 0) throw new Error('Amount must be a positive integer');
  }

  generateResult(deck: Card[]): HiLoResult {
    if (deck.length < 2) throw new Error('Deck must have at least 2 cards');
    const current = deck[0];
    const next = deck[1];
    let outcome: HiLoResult['outcome'];
    if (next.value > current.value) outcome = 'HIGHER';
    else if (next.value < current.value) outcome = 'LOWER';
    else outcome = 'EQUAL';
    return { currentCard: current, nextCard: next, outcome };
  }

  settleBet(bet: HiLoBet, result: HiLoResult, settledAt: number): HiLoSettlement {
    const isWin = bet.choice === result.outcome;
    const multiplier = isWin
      ? (bet.choice === 'EQUAL' ? EQUAL_PAYOUT : Math.round(SIDE_PAYOUT * 100) / 100)
      : 0;
    const totalReturn = isWin ? Math.round(bet.amount * multiplier) : 0;
    const profit = totalReturn - bet.amount;
    return {
      betId: bet.betId,
      playerId: bet.playerId,
      status: isWin ? 'WIN' : 'LOSS',
      amount: bet.amount,
      multiplier,
      profit,
      totalReturn,
      settledAt,
    };
  }
}
