export type CrashRoundStatus =
  | 'BETTING'
  | 'LOCK'
  | 'RUNNING'
  | 'CRASH'
  | 'RESULT'
  | 'COMPLETED';

export type CrashBetStatus = 'ACTIVE' | 'CASHED_OUT' | 'LOST';
export type CrashSettlementStatus = 'WIN' | 'LOSS';

export interface CrashBetInput {
  betId: string;
  amount: number;
  autoCashoutMultiplier?: number;
}

export interface CrashBet extends CrashBetInput {
  playerId: string;
  status: CrashBetStatus;
  placedAt: number;
  cashedOutAt: number | null;
  cashoutMultiplier: number | null;
}

export interface CrashSettlement {
  betId: string;
  playerId: string;
  status: CrashSettlementStatus;
  amount: number;
  cashoutMultiplier: number | null;
  profit: number;
  totalReturn: number;
  settledAt: number;
}

export interface CrashResult {
  crashMultiplier: number;
  crashedAt: number;
}

export interface CrashRound {
  roundId: string;
  roundNumber: number;
  status: CrashRoundStatus;
  startedAt: number;
  bettingEndsAt: number;
  lockedAt: number | null;
  runningAt: number | null;
  crashedAt: number | null;
  resultAt: number | null;
  completedAt: number | null;
  currentMultiplier: number;
  crashResult: CrashResult | null;
  bets: CrashBet[];
  settlements: CrashSettlement[];
}

export interface CompletedCrashRound extends CrashRound {
  crashResult: CrashResult;
  completedAt: number;
}
