export type PokerSuit = 'SPADES' | 'HEARTS' | 'DIAMONDS' | 'CLUBS';

export type PokerRank =
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

export interface PokerCard {
  suit: PokerSuit;
  rank: PokerRank;
}

export type PokerHandType =
  | 'ROYAL_FLUSH'
  | 'STRAIGHT_FLUSH'
  | 'FOUR_OF_A_KIND'
  | 'FULL_HOUSE'
  | 'FLUSH'
  | 'STRAIGHT'
  | 'THREE_OF_A_KIND'
  | 'TWO_PAIR'
  | 'JACKS_OR_BETTER'
  | 'HIGH_CARD';

export type PokerPlayerResult = 'WIN' | 'LOSS';

export type PokerRoundStatus =
  | 'BETTING'
  | 'LOCK'
  | 'DEAL'
  | 'COMPARE'
  | 'RESULT'
  | 'SETTLEMENT'
  | 'COMPLETED';

export interface PokerHand {
  cards: PokerCard[];
  type: PokerHandType;
  rank: number;
  comparison: number[];
}

export interface PokerBet {
  playerId: string;
  amount: number;
  hold?: number[];
}

export interface PokerSettlement {
  playerId: string;
  amount: number;
  handType: PokerHandType;
  result: PokerPlayerResult;
  profit: number;
  totalReturn: number;
  settledAt: number;
}

export interface PokerPlayerRound {
  playerId: string;
  cards: PokerCard[];
  hand: PokerHand | null;
  bet: PokerBet;
  result: PokerPlayerResult | null;
  profit: number;
  totalReturn: number;
}

export interface PokerRoundState {
  roundId: string;
  roundNumber: number;
  status: PokerRoundStatus;
  startedAt: number;
  bettingEndsAt: number;
  lockedAt: number | null;
  dealtAt: number | null;
  comparedAt: number | null;
  settledAt: number | null;
  resultAt: number | null;
  completedAt: number | null;
  players: PokerPlayerRound[];
  settlements: PokerSettlement[];
}

export interface PokerRoundResult {
  roundId: string;
  roundNumber: number;
  players: PokerPlayerRound[];
  settlements: PokerSettlement[];
  completedAt: number;
}
