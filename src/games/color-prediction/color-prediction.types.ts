export type ColorPredictionColor = 'RED' | 'GREEN' | 'VIOLET';
export type ColorPredictionBetType = ColorPredictionColor;
export type ColorPredictionRoundStatus = 'BETTING' | 'LOCK' | 'GENERATE_RESULT' | 'RESULT' | 'SETTLEMENT' | 'COMPLETED';
export interface ColorPredictionBetInput { betId: string; type: ColorPredictionBetType; amount: number; }
export interface ColorPredictionBet extends ColorPredictionBetInput { playerId: string; status: 'PENDING' | 'WIN' | 'LOSS'; placedAt: number; }
export interface ColorPredictionResult { color: ColorPredictionColor; generatedAt: number; }
export interface ColorPredictionSettlement { betId: string; playerId: string; type: ColorPredictionBetType; status: 'WIN' | 'LOSS'; amount: number; profit: number; totalReturn: number; settledAt: number; }
export interface ColorPredictionRound { roundId: string; roundNumber: number; status: ColorPredictionRoundStatus; startedAt: number; bettingEndsAt: number; lockedAt: number | null; generatedAt: number | null; resultAt: number | null; settledAt: number | null; completedAt: number | null; result: ColorPredictionResult | null; bets: ColorPredictionBet[]; settlements: ColorPredictionSettlement[]; }
export interface CompletedColorPredictionRound extends ColorPredictionRound { result: ColorPredictionResult; completedAt: number; }
