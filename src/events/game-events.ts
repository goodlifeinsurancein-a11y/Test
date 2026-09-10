export type GameEventName =
  | 'ROUND_STARTED'
  | 'BET_PLACED'
  | 'CASHOUT'
  | 'SETTLEMENT_COMPLETED'
  | 'GAME_STARTED'
  | 'RESULT_GENERATED'
  | 'ROUND_LOCKED'
  | 'ROUND_RESULT'
  | 'BET_WON'
  | 'BET_LOST'
  | 'ROUND_COMPLETED';

export interface GameEvent {
  eventName: GameEventName;
  game: string;
  roundId: string;
  roundNumber: number;
  userId?: string;
  timestamp: string;
  data?: Record<string, unknown>;
}
