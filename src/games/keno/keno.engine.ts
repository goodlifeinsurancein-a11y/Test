import { randomInt } from 'node:crypto';
import { KenoBet, KenoResult, KenoSettlement, KENO_PAYOUT_TABLE, KENO_BOARD_SIZE, KENO_DRAW_SIZE, MIN_PICKS, MAX_PICKS } from './keno.types.js';

// Re-export the public draw constants used by consumers/tests of the engine.
export { KENO_BOARD_SIZE, KENO_DRAW_SIZE } from './keno.types.js';

export class KenoEngine {
  validateBet(bet: { betId: string; picks: number[]; amount: number }): void {
    if (!bet.betId || typeof bet.betId !== 'string' || bet.betId.trim().length === 0) throw new Error('Invalid betId');
    if (!Number.isInteger(bet.amount) || bet.amount <= 0) throw new Error('Amount must be a positive integer');
    if (!Array.isArray(bet.picks) || bet.picks.length < MIN_PICKS || bet.picks.length > MAX_PICKS) throw new Error(`Picks must be 1-10 numbers`);
    const seen = new Set<number>();
    for (const n of bet.picks) {
      if (!Number.isInteger(n) || n < 1 || n > KENO_BOARD_SIZE) throw new Error(`Pick ${n} out of range (1-${KENO_BOARD_SIZE})`);
      if (seen.has(n)) throw new Error(`Duplicate pick: ${n}`);
      seen.add(n);
    }
  }

  draw(): number[] {
    const board = Array.from({ length: KENO_BOARD_SIZE }, (_, i) => i + 1);
    for (let i = KENO_BOARD_SIZE - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [board[i], board[j]] = [board[j], board[i]];
    }
    return board.slice(0, KENO_DRAW_SIZE).sort((a, b) => a - b);
  }

  getMultiplier(pickCount: number, matches: number): number {
    const table = KENO_PAYOUT_TABLE[pickCount];
    if (table && table[matches] !== undefined) return table[matches];
    if (matches === pickCount) return Math.pow(2, pickCount) * 2;
    return 0;
  }

  settleBet(bet: KenoBet, result: KenoResult, settledAt: number): KenoSettlement {
    let matches = 0;
    const drawnSet = new Set(result.drawnNumbers);
    for (const n of bet.picks) if (drawnSet.has(n)) matches++;
    const multiplier = this.getMultiplier(bet.picks.length, matches);
    const isWin = multiplier > 0;
    const totalReturn = isWin ? bet.amount * multiplier : 0;
    return {
      betId: bet.betId,
      playerId: bet.playerId,
      status: isWin ? 'WIN' : 'LOSS',
      amount: bet.amount,
      matches,
      multiplier,
      profit: totalReturn - bet.amount,
      totalReturn,
      settledAt,
    };
  }
}
