import { randomInt } from 'node:crypto';

import {
  PlinkoBet,
  PlinkoPathResult,
  PlinkoSettlement,
} from './plinko.types.js';

export const DEFAULT_ROWS = 8;
export const DEFAULT_SLOTS = 8;
export const MIN_ROWS = 4;
export const MAX_ROWS = 16;

export const DEFAULT_MULTIPLIERS: number[] = [0.5, 1.0, 1.5, 2.0, 3.0, 2.0, 1.5, 1.0];

export class PlinkoEngine {
  validateBet(bet: { betId: string; amount: number; rows?: number }): void {
    if (!bet.betId || typeof bet.betId !== 'string' || bet.betId.trim().length === 0) {
      throw new Error('Invalid betId');
    }
    if (!Number.isInteger(bet.amount) || bet.amount <= 0) {
      throw new Error('Amount must be a positive integer');
    }
    if (bet.rows !== undefined) {
      if (!Number.isInteger(bet.rows) || bet.rows < MIN_ROWS || bet.rows > MAX_ROWS) {
        throw new Error(`Rows must be between ${MIN_ROWS} and ${MAX_ROWS}`);
      }
    }
  }

  generatePath(rows: number, multipliers: number[] = DEFAULT_MULTIPLIERS): PlinkoPathResult {
    if (!Number.isInteger(rows) || rows < MIN_ROWS || rows > MAX_ROWS) {
      throw new Error(`Rows must be between ${MIN_ROWS} and ${MAX_ROWS}`);
    }
    const path: number[] = [];
    let slot = 0;
    for (let i = 0; i < rows; i++) {
      const direction = randomInt(2);
      path.push(direction);
      slot = (slot * 2 + direction) % multipliers.length;
      // Simple left/right accumulation for standard board
      if (direction === 1 && slot === 0) {
        // edge wrap handled implicitly
      }
    }
    // For n rows: accumulated lefts = count(0), rights = count(1), slot = rights
    let rights = 0;
    for (const d of path) if (d === 1) rights++;
    const slotIndex = Math.min(rights, multipliers.length - 1);
    return {
      path,
      slotIndex,
      multiplier: multipliers[slotIndex],
    };
  }

  settleBet(bet: PlinkoBet, result: PlinkoPathResult, settledAt: number): PlinkoSettlement {
    const totalReturn = Math.round(bet.amount * result.multiplier);
    const profit = totalReturn - bet.amount;
    const isWin = totalReturn > bet.amount;
    return {
      betId: bet.betId,
      playerId: bet.playerId,
      status: isWin ? 'WIN' : 'LOSS',
      amount: bet.amount,
      multiplier: result.multiplier,
      profit,
      totalReturn,
      settledAt,
    };
  }
}
