export type CardSuit = 'SPADES' | 'HEARTS' | 'DIAMONDS' | 'CLUBS';
export type CardRank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';
export type AndarBaharSide = 'ANDAR' | 'BAHAR';
export type AndarBaharBetType = AndarBaharSide;
export type AndarBaharRoundStatus = 'BETTING' | 'LOCK' | 'INDICATOR' | 'DEAL' | 'MATCH' | 'RESULT' | 'COMPLETED';

export interface Card { suit: CardSuit; rank: CardRank; }
export interface DealtCard { side: AndarBaharSide; card: Card; position: number; }
export interface AndarBaharBetInput { betId: string; type: AndarBaharBetType; amount: number; }
export interface AndarBaharBet extends AndarBaharBetInput { playerId: string; status: 'PENDING' | 'WIN' | 'LOSS'; placedAt: number; }
export interface AndarBaharResult { winner: AndarBaharSide; matchingCard: DealtCard; indicatorCard: Card; }
export interface AndarBaharSettlement { betId: string; playerId: string; type: AndarBaharBetType; status: 'WIN' | 'LOSS'; amount: number; profit: number; totalReturn: number; settledAt: number; }
export interface AndarBaharRound {
  roundId: string; roundNumber: number; status: AndarBaharRoundStatus;
  startedAt: number; bettingEndsAt: number; lockedAt: number | null; indicatorAt: number | null;
  dealtAt: number | null; matchedAt: number | null; resultAt: number | null; completedAt: number | null;
  indicatorCard: Card | null; dealtCards: DealtCard[]; result: AndarBaharResult | null;
  bets: AndarBaharBet[]; settlements: AndarBaharSettlement[];
}
export interface CompletedAndarBaharRound extends AndarBaharRound { indicatorCard: Card; result: AndarBaharResult; completedAt: number; }
