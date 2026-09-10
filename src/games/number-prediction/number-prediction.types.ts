export type NumberPredictionNumber = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type NumberPredictionRoundStatus =
  | 'BETTING'
  | 'LOCK'
  | 'GENERATE_RESULT'
  | 'RESULT'
  | 'SETTLEMENT'
  | 'COMPLETED';

export interface NumberPredictionBetInput {
  betId: string;
  number: NumberPredictionNumber;
  amount: number;
}

export interface NumberPredictionBet extends NumberPredictionBetInput {
  playerId: string;
  status: 'PENDING' | 'WIN' | 'LOSS';
  placedAt: number;
}

export interface NumberPredictionResult {
  number: NumberPredictionNumber;
  generatedAt: number;
}

export interface NumberPredictionSettlement {
  betId: string;
  playerId: string;
  number: NumberPredictionNumber;
  status: 'WIN' | 'LOSS';
  amount: number;
  profit: number;
  totalReturn: number;
  settledAt: number;
}

export interface NumberPredictionRound {
  roundId: string;
  roundNumber: number;
  status: NumberPredictionRoundStatus;
  startedAt: number;
  bettingEndsAt: number;
  lockedAt: number | null;
  generatedAt: number | null;
  resultAt: number | null;
  settledAt: number | null;
  completedAt: number | null;
  result: NumberPredictionResult | null;
  bets: NumberPredictionBet[];
  settlements: NumberPredictionSettlement[];
}

export interface CompletedNumberPredictionRound extends NumberPredictionRound {
  result: NumberPredictionResult;
  completedAt: number;
}
