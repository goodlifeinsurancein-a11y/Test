export type HiLoChoice = 'HIGHER' | 'LOWER' | 'EQUAL';
export type HiLoBetStatus = 'PENDING' | 'WIN' | 'LOSS';

export interface HiLoBetInput {
  betId: string;
  choice: HiLoChoice;
  amount: number;
}

export interface HiLoBet extends HiLoBetInput {
  playerId: string;
  status: HiLoBetStatus;
  placedAt: number;
}

export type CardSuit = 'CLUBS' | 'DIAMONDS' | 'HEARTS' | 'SPADES';
export type CardRank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  suit: CardSuit;
  rank: CardRank;
  value: number; // 2-14 (Ace=14)
}

export interface HiLoResult {
  currentCard: Card;
  nextCard: Card;
  outcome: 'HIGHER' | 'LOWER' | 'EQUAL';
}

export interface HiLoSettlement {
  betId: string;
  playerId: string;
  status: 'WIN' | 'LOSS';
  amount: number;
  multiplier: number;
  profit: number;
  totalReturn: number;
  settledAt: number;
}

export interface HiLoRound {
  roundId: string;
  roundNumber: number;
  status: 'BETTING' | 'LOCK' | 'GENERATE_RESULT' | 'RESULT' | 'SETTLEMENT' | 'COMPLETED';
  startedAt: number;
  bettingEndsAt: number;
  lockedAt: number | null;
  generatedAt: number | null;
  resultAt: number | null;
  settledAt: number | null;
  completedAt: number | null;
  result: HiLoResult | null;
  bets: HiLoBet[];
  settlements: HiLoSettlement[];
}

export interface CompletedHiLoRound extends HiLoRound {
  result: HiLoResult;
  completedAt: number;
}
