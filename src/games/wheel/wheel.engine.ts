import { randomInt } from 'node:crypto';
import {
  WheelBetInput,
  WheelColor,
  WheelColorBetInput,
  WheelNumber,
  WheelNumberBetInput,
  WheelResult,
  WheelSettlement,
} from './wheel.types.js';

const SEGMENTS: readonly WheelColor[] = ['GREEN', 'RED', 'BLACK', 'RED', 'BLACK', 'RED', 'BLACK', 'RED', 'BLACK', 'RED'];

export class WheelEngine {
  generateResult(generatedAt = Date.now()): WheelResult {
    const number = randomInt(0, SEGMENTS.length) as WheelNumber;
    return { number, color: SEGMENTS[number]!, generatedAt };
  }

  getColorForNumber(number: unknown): WheelColor {
    if (!this.isWheelNumber(number)) {
      throw new Error('Invalid wheel number');
    }
    return SEGMENTS[number]!;
  }

  validatePlayerId(playerId: unknown): void {
    if (typeof playerId !== 'string' || playerId.trim().length === 0) {
      throw new Error('Player id is required');
    }
  }

  validateBet(bet: unknown): asserts bet is WheelBetInput {
    if (!bet || typeof bet !== 'object') {
      throw new Error('A valid wheel bet is required');
    }

    const input = bet as Record<string, unknown>;
    if (typeof input.betId !== 'string' || input.betId.trim().length === 0) {
      throw new Error('Bet id is required');
    }
    if (!this.isValidAmount(input.amount)) {
      throw new Error('Bet amount must be a positive whole number');
    }
    if (input.type === 'NUMBER' && this.isWheelNumber(input.number)) {
      return;
    }
    if (input.type === 'COLOR' && this.isWheelColor(input.color)) {
      return;
    }
    throw new Error('Invalid wheel bet type or selection');
  }

  validateResult(result: unknown): asserts result is WheelResult {
    if (!result || typeof result !== 'object') {
      throw new Error('A valid wheel result is required');
    }

    const value = result as Record<string, unknown>;
    if (
      !this.isWheelNumber(value.number) ||
      !this.isWheelColor(value.color) ||
      value.color !== SEGMENTS[value.number] ||
      typeof value.generatedAt !== 'number' ||
      !Number.isFinite(value.generatedAt)
    ) {
      throw new Error('Invalid wheel result');
    }
  }

  isWinningBet(bet: WheelBetInput, result: WheelResult): boolean {
    this.validateBet(bet);
    this.validateResult(result);
    return bet.type === 'NUMBER' ? bet.number === result.number : bet.color === result.color;
  }

  settleBet(bet: WheelBetInput, playerId: string, result: WheelResult, settledAt = Date.now()): WheelSettlement {
    this.validateBet(bet);
    this.validatePlayerId(playerId);
    this.validateResult(result);

    const won = this.isWinningBet(bet, result);
    const profit = won ? bet.amount * this.profitMultiplier(bet) : -bet.amount;
    const base = {
      betId: bet.betId,
      playerId,
      status: won ? 'WIN' as const : 'LOSS' as const,
      amount: bet.amount,
      profit,
      totalReturn: won ? bet.amount + profit : 0,
      settledAt,
    };

    return bet.type === 'NUMBER'
      ? { ...base, type: 'NUMBER', number: bet.number }
      : { ...base, type: 'COLOR', color: bet.color };
  }

  private profitMultiplier(bet: WheelBetInput): number {
    if (bet.type === 'NUMBER' || bet.color === 'GREEN') {
      return 9;
    }
    return 1;
  }

  private isWheelNumber(value: unknown): value is WheelNumber {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 9;
  }

  private isWheelColor(value: unknown): value is WheelColor {
    return value === 'GREEN' || value === 'RED' || value === 'BLACK';
  }

  private isValidAmount(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 1;
  }
}
