export type KenoBetStatus = 'PENDING' | 'WIN' | 'LOSS';

export interface KenoBetInput {
  betId: string;
  picks: number[];
  amount: number;
}

export interface KenoBet extends KenoBetInput {
  playerId: string;
  status: KenoBetStatus;
  placedAt: number;
}

export interface KenoResult {
  drawnNumbers: number[];
}

export interface KenoSettlement {
  betId: string;
  playerId: string;
  status: 'WIN' | 'LOSS';
  amount: number;
  matches: number;
  multiplier: number;
  profit: number;
  totalReturn: number;
  settledAt: number;
}

export interface KenoRound {
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
  result: KenoResult | null;
  bets: KenoBet[];
  settlements: KenoSettlement[];
}

export interface CompletedKenoRound extends KenoRound {
  result: KenoResult;
  completedAt: number;
}

export const KENO_BOARD_SIZE = 40;
export const KENO_DRAW_SIZE = 10;
export const MIN_PICKS = 1;
export const MAX_PICKS = 10;

export const KENO_PAYOUT_TABLE: Record<number, Record<number, number>> = {
  10: { 10: 5000, 9: 500, 8: 100, 7: 25, 6: 5, 5: 2 },
  8:  { 8: 2500, 7: 250, 6: 50, 5: 10, 4: 2 },
  6:  { 6: 1000, 5: 100, 4: 15, 3: 3 },
};
export const DEFAULT_KENO_PICKS = 6;
