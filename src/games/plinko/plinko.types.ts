export type PlinkoBetStatus = 'PENDING' | 'WIN' | 'LOSS';

export interface PlinkoBet {
  betId: string;
  playerId: string;
  amount: number;
  rows: number;
}

export interface PlinkoPathResult {
  path: number[];
  slotIndex: number;
  multiplier: number;
}

export interface PlinkoSettlement {
  betId: string;
  playerId: string;
  status: 'WIN' | 'LOSS';
  amount: number;
  multiplier: number;
  profit: number;
  totalReturn: number;
  settledAt: number;
}

export interface PlinkoRound {
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
  result: PlinkoPathResult | null;
  bets: PlinkoBet[];
  settlements: PlinkoSettlement[];
}

export interface CompletedPlinkoRound extends PlinkoRound {
  result: PlinkoPathResult;
  completedAt: number;
}
