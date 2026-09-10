export type CardSuit = 'SPADES' | 'HEARTS' | 'DIAMONDS' | 'CLUBS';
export type CardRank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

export interface Card {
  suit: CardSuit;
  rank: CardRank;
}

export type DragonTigerWinner = 'DRAGON' | 'TIGER' | 'TIE';
export type DragonTigerBetType = DragonTigerWinner;
export type DragonTigerBetStatus = 'PENDING' | 'WIN' | 'LOSS';
export type DragonTigerRoundStatus =
  | 'BETTING'
  | 'LOCK'
  | 'DEAL'
  | 'COMPARE'
  | 'RESULT'
  | 'COMPLETED';

export interface DragonTigerResult {
  dragonCard: Card;
  tigerCard: Card;
  winner: DragonTigerWinner;
}

export interface DragonTigerBetInput {
  betId: string;
  type: DragonTigerBetType;
  amount: number;
}

export interface DragonTigerBet extends DragonTigerBetInput {
  playerId: string;
  status: DragonTigerBetStatus;
  placedAt: number;
}

export interface DragonTigerSettlement {
  betId: string;
  playerId: string;
  type: DragonTigerBetType;
  status: 'WIN' | 'LOSS';
  amount: number;
  profit: number;
  totalReturn: number;
  settledAt: number;
}

export interface DragonTigerRound {
  roundId: string;
  roundNumber: number;
  status: DragonTigerRoundStatus;
  startedAt: number;
  bettingEndsAt: number;
  lockedAt: number | null;
  dealtAt: number | null;
  comparedAt: number | null;
  resultAt: number | null;
  completedAt: number | null;
  dragonCard: Card | null;
  tigerCard: Card | null;
  result: DragonTigerResult | null;
  bets: DragonTigerBet[];
  settlements: DragonTigerSettlement[];
}

export interface CompletedDragonTigerRound extends DragonTigerRound {
  dragonCard: Card;
  tigerCard: Card;
  result: DragonTigerResult;
  completedAt: number;
}
