export type RouletteColor = 'RED' | 'BLACK' | 'GREEN';

export type RouletteBetType =
  | 'NUMBER'
  | 'COLOR'
  | 'ODD_EVEN'
  | 'LOW_HIGH'
  | 'DOZEN';

export type RouletteBetStatus = 'PENDING' | 'WIN' | 'LOSS';

export interface RouletteBet {
  betId: string;
  playerId: string;
  betType: RouletteBetType;
  betValue: string;
  amount: number;
}

export interface RouletteResult {
  number: number;
  color: RouletteColor;
}

export interface RouletteBetOutcome {
  bet: RouletteBet;
  status: 'WIN' | 'LOSS';
  profit: number;
  totalReturn: number;
}

export interface RouletteRoundState {
  roundId: string;
  roundNumber: number;
  status: 'BETTING' | 'LOCK' | 'PROCESSING' | 'RESULT' | 'COMPLETED';
  result: RouletteResult | null;
  bets: RouletteBet[];
}
