import { randomInt } from 'node:crypto';
import {
  JackpotBetInput,
  JackpotPick,
  JackpotResult,
  JackpotSettlement,
} from './jackpot.types.js';

const MIN_PICK = 1;
const MAX_PICK = 36;
const DRAW_SIZE = 6;

/**
 * Core Jackpot game engine.
 *
 * - Picks: 1-36, up to 6 unique numbers per bet.
 * - Draw: 6 unique numbers from 1-36.
 * - Payout tiers: match 6 → 1000x, 5 → 100x, 4 → 25x, 3 → 5x, <3 → 0x.
 * - All amounts are integer deci-token units (10 units = 1 displayed token).
 * - Cryptographically secure randomness via node:crypto.randomInt.
 */
export class JackpotEngine {
  /** Matches → payout multiplier (0 means loss). */
  private readonly payoutTable: Record<number, number> = {
    6: 1000,
    5: 100,
    4: 25,
    3: 5,
  };

  // ── Validation ───────────────────────────────────────────────────

  /** Throw if the bet payload is invalid. */
  validateBet(bet: JackpotBetInput): void {
    if (!bet || typeof bet !== 'object') {
      throw new Error('A valid jackpot bet is required');
    }

    if (typeof bet.betId !== 'string' || bet.betId.trim().length === 0) {
      throw new Error('Bet id is required');
    }

    if (!Array.isArray(bet.numbers)) {
      throw new Error('Bet numbers must be an array');
    }

    if (bet.numbers.length < 1 || bet.numbers.length > DRAW_SIZE) {
      throw new Error(`Bet must contain between 1 and ${DRAW_SIZE} numbers`);
    }

    const seen = new Set<number>();
    for (const n of bet.numbers) {
      if (!Number.isInteger(n) || n < MIN_PICK || n > MAX_PICK) {
        throw new Error(`Each number must be an integer between ${MIN_PICK} and ${MAX_PICK}`);
      }
      if (seen.has(n)) {
        throw new Error('Bet numbers must be unique');
      }
      seen.add(n);
    }

    if (!Number.isInteger(bet.amount) || bet.amount < 1) {
      throw new Error('Bet amount must be a positive whole number');
    }
  }

  /** Throw if the player id is invalid. */
  validatePlayerId(playerId: string): void {
    if (typeof playerId !== 'string' || playerId.trim().length === 0) {
      throw new Error('Player id is required');
    }
  }

  // ── Result generation ────────────────────────────────────────────

  /**
   * Draw `DRAW_SIZE` unique winning numbers from MIN_PICK..MAX_PICK.
   * Uses Fisher-Yates with crypto.randomInt for uniform distribution.
   */
  generateResult(generatedAt = Date.now()): JackpotResult {
    const pool: number[] = [];
    for (let i = MIN_PICK; i <= MAX_PICK; i++) {
      pool.push(i);
    }

    const winningNumbers: JackpotPick[] = [];
    for (let i = 0; i < DRAW_SIZE; i++) {
      const idx = randomInt(0, pool.length);
      winningNumbers.push(pool[idx]!);
      pool[idx] = pool[pool.length - 1]!;
      pool.pop();
    }

    return { winningNumbers: winningNumbers.sort((a, b) => a - b), generatedAt };
  }

  // ── Settlement helpers ───────────────────────────────────────────

  /** Count how many of the player's numbers appear in the winning set. */
  countMatches(playerNumbers: JackpotPick[], winningNumbers: JackpotPick[]): number {
    const winSet = new Set(winningNumbers);
    return playerNumbers.filter((n) => winSet.has(n)).length;
  }

  /** Return the payout multiplier for a given match count (0 = loss). */
  getPayoutMultiplier(matchCount: number): number {
    return this.payoutTable[matchCount] ?? 0;
  }

  /** Settle a single bet against a draw result. All arithmetic is integer. */
  settleBet(
    bet: JackpotBetInput,
    playerId: string,
    result: JackpotResult,
    settledAt = Date.now(),
  ): JackpotSettlement {
    this.validateBet(bet);
    this.validatePlayerId(playerId);

    const matchCount = this.countMatches(bet.numbers, result.winningNumbers);
    const multiplier = this.getPayoutMultiplier(matchCount);

    if (multiplier === 0) {
      return {
        betId: bet.betId,
        playerId,
        matchCount,
        status: 'LOSS',
        amount: bet.amount,
        profit: -bet.amount,
        totalReturn: 0,
        settledAt,
      };
    }

    const profit = bet.amount * multiplier;
    const totalReturn = bet.amount + profit;

    return {
      betId: bet.betId,
      playerId,
      matchCount,
      status: 'WIN',
      amount: bet.amount,
      profit,
      totalReturn,
      settledAt,
    };
  }
}
