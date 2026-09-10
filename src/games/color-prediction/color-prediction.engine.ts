import { randomInt } from 'node:crypto';
import { ColorPredictionBetInput, ColorPredictionBetType, ColorPredictionColor, ColorPredictionResult, ColorPredictionSettlement } from './color-prediction.types.js';

const COLORS: ColorPredictionColor[] = ['RED', 'GREEN', 'VIOLET'];
export class ColorPredictionEngine {
  generateResult(generatedAt = Date.now()): ColorPredictionResult { return { color: COLORS[randomInt(0, COLORS.length)]!, generatedAt }; }
  validatePlayerId(playerId: string): void { if (typeof playerId !== 'string' || playerId.trim().length === 0) throw new Error('Player id is required'); }
  validateBet(bet: ColorPredictionBetInput): void { if (!bet || typeof bet !== 'object') throw new Error('A valid color prediction bet is required'); if (typeof bet.betId !== 'string' || bet.betId.trim().length === 0) throw new Error('Bet id is required'); if (!this.isColor(bet.type)) throw new Error('Invalid color prediction bet type'); if (!Number.isInteger(bet.amount) || bet.amount < 1) throw new Error('Bet amount must be a positive whole number'); }
  getPayoutRatio(type: ColorPredictionBetType): number { if (!this.isColor(type)) throw new Error('Invalid color prediction bet type'); return type === 'VIOLET' ? 4 : 1; }
  settleBet(bet: ColorPredictionBetInput, playerId: string, result: ColorPredictionResult, settledAt = Date.now()): ColorPredictionSettlement { this.validateBet(bet); this.validatePlayerId(playerId); if (bet.type !== result.color) return { betId: bet.betId, playerId, type: bet.type, status: 'LOSS', amount: bet.amount, profit: -bet.amount, totalReturn: 0, settledAt }; const profit = this.roundTokenValue(bet.amount * this.getPayoutRatio(bet.type)); return { betId: bet.betId, playerId, type: bet.type, status: 'WIN', amount: bet.amount, profit, totalReturn: this.roundTokenValue(bet.amount + profit), settledAt }; }
  private isColor(value: unknown): value is ColorPredictionColor { return value === 'RED' || value === 'GREEN' || value === 'VIOLET'; }
  private roundTokenValue(value: number): number { return Math.round((value + Number.EPSILON) * 100) / 100; }
}
