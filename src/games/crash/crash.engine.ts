import { randomInt, randomBytes, createHash } from 'node:crypto';

import {
  CrashBetInput,
  CrashSettlement,
} from './crash.types.js';

/** Stateless game calculations for an individual Crash round. */
export class CrashEngine {
  readonly MIN_CRASH_MULTIPLIER = 1.01;
  readonly MAX_CRASH_MULTIPLIER = 100;

  generateCrashPoint(roundId?: string): number {
    // Default to legacy randomInt if no roundId (used by in-memory CrashRoundEngine)
    if (!roundId) {
      const minCents = Math.round(this.MIN_CRASH_MULTIPLIER * 100);
      const maxCents = Math.round(this.MAX_CRASH_MULTIPLIER * 100);
      return randomInt(minCents, maxCents + 1) / 100;
    }

    // Server-authoritative deterministic generation using SHA-256
    // This matches the finance_generate_crash_point RPC logic
    const secret = process.env.CRASH_SERVER_SECRET ?? 'dev-secret-do-not-use-in-production';
    const seed = `${secret}:${roundId}:crash-point-v2`;
    const hash = createHash('sha256').update(seed).digest();
    // First 8 bytes as big-endian 63-bit integer
    let val = 0n;
    for (let i = 0; i < 8; i++) {
      val = (val << 8n) | BigInt(hash[i]);
    }
    // 1.01 .. 99.99 (990000 possible values in 0.01 steps)
    const cents = 101 + Number(val % 990000n);
    return cents / 100;
  }

  validateBet(bet: CrashBetInput): void {
    if (!bet || typeof bet !== 'object') {
      throw new Error('A valid crash bet is required');
    }

    if (typeof bet.betId !== 'string' || bet.betId.trim().length === 0) {
      throw new Error('Bet id is required');
    }

    if (!Number.isInteger(bet.amount) || bet.amount < 1) {
      throw new Error('Bet amount must be a positive whole number');
    }

    if (bet.autoCashoutMultiplier !== undefined) {
      if (
        !Number.isFinite(bet.autoCashoutMultiplier) ||
        bet.autoCashoutMultiplier < this.MIN_CRASH_MULTIPLIER
      ) {
        throw new Error('Auto cashout multiplier must be at least 1.01x');
      }
    }
  }

  validateManualCashoutMultiplier(multiplier: number): void {
    if (!Number.isFinite(multiplier) || multiplier < 1) {
      throw new Error('Cashout multiplier must be at least 1.00x');
    }
  }

  advanceMultiplier(currentMultiplier: number, increment = 0.01): number {
    if (!Number.isFinite(currentMultiplier) || currentMultiplier < 1) {
      throw new Error('Current multiplier must be at least 1.00x');
    }

    if (!Number.isFinite(increment) || increment <= 0) {
      throw new Error('Multiplier increment must be greater than zero');
    }

    return Math.round((currentMultiplier + increment) * 100) / 100;
  }

  hasCrashed(currentMultiplier: number, crashPoint: number): boolean {
    return currentMultiplier >= crashPoint;
  }

  settleCashout(
    bet: CrashBetInput,
    playerId: string,
    cashoutMultiplier: number,
    settledAt = Date.now(),
  ): CrashSettlement {
    this.validateBet(bet);
    this.validateManualCashoutMultiplier(cashoutMultiplier);

    const totalReturn = this.roundTokenValue(
      bet.amount * cashoutMultiplier,
    );

    return {
      betId: bet.betId,
      playerId,
      status: 'WIN',
      amount: bet.amount,
      cashoutMultiplier,
      profit: this.roundTokenValue(totalReturn - bet.amount),
      totalReturn,
      settledAt,
    };
  }

  settleLoss(
    bet: CrashBetInput,
    playerId: string,
    settledAt = Date.now(),
  ): CrashSettlement {
    this.validateBet(bet);

    return {
      betId: bet.betId,
      playerId,
      status: 'LOSS',
      amount: bet.amount,
      cashoutMultiplier: null,
      profit: -bet.amount,
      totalReturn: 0,
      settledAt,
    };
  }

  private roundTokenValue(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
}
