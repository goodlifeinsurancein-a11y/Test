import { randomInt } from 'node:crypto';
import {
  NumberPredictionBetInput,
  NumberPredictionNumber,
  NumberPredictionResult,
  NumberPredictionSettlement,
} from './number-prediction.types.js';

const RESULT_COUNT = 10;

export class NumberPredictionEngine {
  generateResult(generatedAt = Date.now()): NumberPredictionResult {
    return {
      number: randomInt(0, RESULT_COUNT) as NumberPredictionNumber,
      generatedAt,
    };
  }

  validatePlayerId(playerId: unknown): void {
    if (typeof playerId !== 'string' || playerId.trim().length === 0) {
      throw new Error('Player id is required');
    }
  }

  validateBet(bet: unknown): void {
    if (!bet || typeof bet !== 'object') {
      throw new Error('A valid number prediction bet is required');
    }

    const input = bet as Record<string, unknown>;
    if (typeof input.betId !== 'string' || input.betId.trim().length === 0) {
      throw new Error('Bet id is required');
    }
    if (!this.isNumber(input.number)) {
      throw new Error('Invalid number prediction number');
    }
    if (typeof input.amount !== 'number' || !Number.isFinite(input.amount) || !Number.isInteger(input.amount) || input.amount < 1) {
      throw new Error('Bet amount must be a positive whole number');
    }
  }

  validateResult(result: unknown): asserts result is NumberPredictionResult {
    if (!result || typeof result !== 'object') {
      throw new Error('A valid number prediction result is required');
    }
    const value = result as Record<string, unknown>;
    if (!this.isNumber(value.number) || typeof value.generatedAt !== 'number' || !Number.isFinite(value.generatedAt)) {
      throw new Error('Invalid number prediction result');
    }
  }

  settleBet(
    bet: NumberPredictionBetInput,
    playerId: string,
    result: NumberPredictionResult,
    settledAt = Date.now(),
  ): NumberPredictionSettlement {
    this.validateBet(bet);
    this.validatePlayerId(playerId);
    this.validateResult(result);

    if (bet.number !== result.number) {
      return {
        betId: bet.betId,
        playerId,
        number: bet.number,
        status: 'LOSS',
        amount: bet.amount,
        profit: -bet.amount,
        totalReturn: 0,
        settledAt,
      };
    }

    const profit = bet.amount * 9;
    return {
      betId: bet.betId,
      playerId,
      number: bet.number,
      status: 'WIN',
      amount: bet.amount,
      profit,
      totalReturn: bet.amount + profit,
      settledAt,
    };
  }

  private isNumber(value: unknown): value is NumberPredictionNumber {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 9;
  }
}
