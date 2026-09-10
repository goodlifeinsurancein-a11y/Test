export type WheelNumber = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type WheelColor = 'GREEN' | 'RED' | 'BLACK';
export type WheelBetType = 'NUMBER' | 'COLOR';
export type WheelBetStatus = 'PENDING' | 'WIN' | 'LOSS';
export type WheelRoundStatus = 'BETTING' | 'LOCK' | 'GENERATE_RESULT' | 'RESULT' | 'SETTLEMENT' | 'COMPLETED';

export interface WheelNumberBetInput {
  betId: string;
  type: 'NUMBER';
  number: WheelNumber;
  amount: number;
}

export interface WheelColorBetInput {
  betId: string;
  type: 'COLOR';
  color: WheelColor;
  amount: number;
}

export type WheelBetInput = WheelNumberBetInput | WheelColorBetInput;

export type WheelBet = WheelBetInput & {
  playerId: string;
  status: WheelBetStatus;
  placedAt: number;
};

export interface WheelResult {
  number: WheelNumber;
  color: WheelColor;
  generatedAt: number;
}

interface WheelSettlementBase {
  betId: string;
  playerId: string;
  status: Exclude<WheelBetStatus, 'PENDING'>;
  amount: number;
  profit: number;
  totalReturn: number;
  settledAt: number;
}

export type WheelSettlement =
  | (WheelSettlementBase & { type: 'NUMBER'; number: WheelNumber })
  | (WheelSettlementBase & { type: 'COLOR'; color: WheelColor });

export interface WheelRound {
  roundId: string;
  roundNumber: number;
  status: WheelRoundStatus;
  startedAt: number;
  bettingEndsAt: number;
  lockedAt: number | null;
  generatedAt: number | null;
  resultAt: number | null;
  settledAt: number | null;
  completedAt: number | null;
  result: WheelResult | null;
  bets: WheelBet[];
  settlements: WheelSettlement[];
}

export interface CompletedWheelRound extends WheelRound {
  result: WheelResult;
  completedAt: number;
}
