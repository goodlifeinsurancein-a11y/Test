export type CardSuit = 'SPADES' | 'HEARTS' | 'DIAMONDS' | 'CLUBS';
export type CardRank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

export interface Card {
  suit: CardSuit;
  rank: CardRank;
}

export type BaccaratHand = 'PLAYER' | 'BANKER' | 'TIE';
export type BaccaratBetType = BaccaratHand;
export type BaccaratBetStatus = 'PENDING' | 'WIN' | 'LOSS';
export type BaccaratRoundStatus =
  | 'BETTING'
  | 'LOCK'
  | 'DEAL'
  | 'COMPARE'
  | 'RESULT'
  | 'SETTLEMENT'
  | 'COMPLETED';

export interface BaccaratResult {
  playerHand: Card[];
  bankerHand: Card[];
  playerTotal: number;
  bankerTotal: number;
  winner: BaccaratHand;
}

export interface BaccaratBetInput {
  betId: string;
  type: BaccaratBetType;
  amount: number;
}

export interface BaccaratBet extends BaccaratBetInput {
  playerId: string;
  status: BaccaratBetStatus;
  placedAt: number;
}

export interface BaccaratSettlement {
  betId: string;
  playerId: string;
  type: BaccaratBetType;
  status: 'WIN' | 'LOSS';
  amount: number;
  profit: number;
  totalReturn: number;
  settledAt: number;
}

export interface BaccaratRound {
  roundId: string;
  roundNumber: number;
  status: BaccaratRoundStatus;
  startedAt: number;
  bettingEndsAt: number;
  lockedAt: number | null;
  dealtAt: number | null;
  comparedAt: number | null;
  resultAt: number | null;
  settledAt: number | null;
  completedAt: number | null;
  playerHand: Card[];
  bankerHand: Card[];
  result: BaccaratResult | null;
  bets: BaccaratBet[];
  settlements: BaccaratSettlement[];
}

export interface CompletedBaccaratRound extends BaccaratRound {
  result: BaccaratResult;
  completedAt: number;
}
