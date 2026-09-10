/** All legal number picks range from 1..36 inclusive. */
export type JackpotPick = number;

/** Round lifecycle status – mirrors ColorPrediction. */
export type JackpotRoundStatus =
  | 'BETTING'
  | 'LOCK'
  | 'GENERATE_RESULT'
  | 'RESULT'
  | 'SETTLEMENT'
  | 'COMPLETED';

/** Client-supplied bet payload. */
export interface JackpotBetInput {
  /** Caller-generated unique bet id (must be non-empty string). */
  betId: string;
  /** Player-chosen numbers; each in 1..36, all unique, 1-6 items. */
  numbers: JackpotPick[];
  /** Bet amount in deci-token units (positive integer). */
  amount: number;
}

/** Canonical bet record stored in the round. */
export interface JackpotBet extends JackpotBetInput {
  playerId: string;
  status: 'PENDING' | 'WIN' | 'LOSS';
  placedAt: number;
}

/** Server-generated draw result. */
export interface JackpotResult {
  /** Exactly 6 unique numbers drawn from 1..36. */
  winningNumbers: JackpotPick[];
  generatedAt: number;
}

/** Per-bet settlement entry. */
export interface JackpotSettlement {
  betId: string;
  playerId: string;
  matchCount: number;
  status: 'WIN' | 'LOSS';
  amount: number;
  profit: number;
  totalReturn: number;
  settledAt: number;
}

/** Live round state. */
export interface JackpotRound {
  roundId: string;
  roundNumber: number;
  status: JackpotRoundStatus;
  startedAt: number;
  bettingEndsAt: number;
  lockedAt: number | null;
  generatedAt: number | null;
  resultAt: number | null;
  settledAt: number | null;
  completedAt: number | null;
  result: JackpotResult | null;
  bets: JackpotBet[];
  settlements: JackpotSettlement[];
}

/** Fully completed round snapshot. */
export interface CompletedJackpotRound extends JackpotRound {
  result: JackpotResult;
  completedAt: number;
}
