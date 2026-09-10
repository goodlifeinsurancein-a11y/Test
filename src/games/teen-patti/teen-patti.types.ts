export type TeenPattiSuit = 'SPADES' | 'HEARTS' | 'DIAMONDS' | 'CLUBS';

export type TeenPattiRank =
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | '10'
  | 'J'
  | 'Q'
  | 'K'
  | 'A';

export interface TeenPattiCard {
  suit: TeenPattiSuit;
  rank: TeenPattiRank;
}

export type TeenPattiHandType = 'TRAIL' | 'PURE_SEQUENCE' | 'SEQUENCE' | 'COLOR' | 'PAIR' | 'HIGH_CARD';
export type TeenPattiPlayerResult = 'WIN' | 'LOSS' | 'TIE';
export type TeenPattiRoundStatus = 'BETTING' | 'LOCK' | 'DEAL' | 'COMPARE' | 'SETTLEMENT' | 'RESULT' | 'COMPLETED';

export interface TeenPattiHand {
  cards: TeenPattiCard[];
  type: TeenPattiHandType;
  rank: number;
}

export interface TeenPattiBet {
  playerId: string;
  amount: number;
}

export interface TeenPattiSettlement {
  playerId: string;
  amount: number;
  handType: TeenPattiHandType;
  result: TeenPattiPlayerResult;
  profit: number;
  totalReturn: number;
  settledAt: number;
}

export interface TeenPattiPlayerRound {
  playerId: string;
  cards: TeenPattiCard[];
  hand: TeenPattiHand | null;
  bet: TeenPattiBet;
  result: TeenPattiPlayerResult | null;
  profit: number;
  totalReturn: number;
}

export interface TeenPattiRoundState {
  roundId: string;
  roundNumber: number;
  status: TeenPattiRoundStatus;
  startedAt: number;
  bettingEndsAt: number;
  lockedAt: number | null;
  dealtAt: number | null;
  comparedAt: number | null;
  settledAt: number | null;
  resultAt: number | null;
  completedAt: number | null;
  dealerCards: TeenPattiCard[];
  dealerHand: TeenPattiHand | null;
  players: TeenPattiPlayerRound[];
  settlements: TeenPattiSettlement[];
}

export interface TeenPattiRoundResult {
  roundId: string;
  roundNumber: number;
  dealerCards: TeenPattiCard[];
  dealerHand: TeenPattiHand;
  players: TeenPattiPlayerRound[];
  settlements: TeenPattiSettlement[];
  completedAt: number;
}
