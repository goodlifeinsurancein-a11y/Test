import { randomUUID } from 'node:crypto';

import { PlinkoEngine, DEFAULT_ROWS, DEFAULT_MULTIPLIERS } from './plinko.engine.js';
import {
  PlinkoBet,
  PlinkoPathResult,
  PlinkoRound,
  CompletedPlinkoRound,
} from './plinko.types.js';

/** In-memory Plinko lifecycle; no controller, wallet, or persistence dependency. */
export class PlinkoRoundEngine {
  readonly BETTING_MS = 15_000;
  readonly GENERATE_MS = 1_000;
  readonly RESULT_MS = 5_000;
  readonly SETTLEMENT_MS = 5_000;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private current: PlinkoRound | null = null;
  private last: CompletedPlinkoRound | null = null;
  private nextNumber = 1;

  constructor(
    private readonly engine = new PlinkoEngine(),
    private readonly config: { rows?: number; multipliers?: number[] } = {},
  ) {}

  start(): PlinkoRound {
    if (this.running) throw new Error('Plinko round engine is already running');
    this.running = true;
    return this.nextRound();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.current = null;
  }

  isRunning(): boolean {
    return this.running;
  }

  getState(): PlinkoRound | null {
    return this.current ? this.publicRound(this.current) : null;
  }

  getLastCompletedRound(): CompletedPlinkoRound | null {
    return this.last ? this.completed(this.last) : null;
  }

  placeBet(playerId: string, betInput: { betId: string; amount: number; rows?: number }): PlinkoBet {
    const round = this.requireBettingRound();
    this.engine.validateBet(betInput);
    if (round.bets.some((placedBet) => placedBet.betId === betInput.betId)) {
      throw new Error('Duplicate bet id');
    }
    const bet: PlinkoBet = {
      betId: betInput.betId,
      playerId,
      amount: betInput.amount,
      rows: betInput.rows ?? this.config.rows ?? DEFAULT_ROWS,
    };
    round.bets.push(bet);
    return { ...bet };
  }

  private requireBettingRound(): PlinkoRound {
    if (!this.current || this.current.status !== 'BETTING') {
      throw new Error('Betting is closed');
    }
    return this.current;
  }

  private nextRound(): PlinkoRound {
    const now = Date.now();
    this.current = {
      roundId: randomUUID(),
      roundNumber: this.nextNumber++,
      status: 'BETTING',
      startedAt: now,
      bettingEndsAt: now + this.BETTING_MS,
      lockedAt: null,
      generatedAt: null,
      resultAt: null,
      settledAt: null,
      completedAt: null,
      result: null,
      bets: [],
      settlements: [],
    };
    this.timer = setTimeout(() => this.lock(), this.BETTING_MS);
    return this.publicRound(this.current);
  }

  private lock(): void {
    if (!this.running || !this.current) return;
    this.current.status = 'LOCK';
    this.current.lockedAt = Date.now();
    this.timer = setTimeout(() => this.generate(), 0);
  }

  private generate(): void {
    if (!this.running || !this.current) return;
    this.current.status = 'GENERATE_RESULT';
    const rows = this.config.rows ?? DEFAULT_ROWS;
    this.current.result = this.engine.generatePath(rows, this.config.multipliers ?? DEFAULT_MULTIPLIERS);
    this.current.generatedAt = Date.now();
    this.timer = setTimeout(() => this.result(), this.GENERATE_MS);
  }

  private result(): void {
    if (!this.running || !this.current || !this.current.result) return;
    this.current.status = 'RESULT';
    this.current.resultAt = Date.now();
    this.timer = setTimeout(() => this.settle(), this.RESULT_MS);
  }

  private settle(): void {
    if (!this.running || !this.current || !this.current.result) return;
    this.current.status = 'SETTLEMENT';
    this.current.settledAt = Date.now();
    this.current.settlements = this.current.bets.map((bet) => {
      const item = this.engine.settleBet(bet, this.current!.result!, this.current!.settledAt!);
      return item;
    });
    this.timer = setTimeout(() => this.complete(), this.SETTLEMENT_MS);
  }

  private complete(): void {
    if (!this.running || !this.current || !this.current.result) return;
    this.current.status = 'COMPLETED';
    this.current.completedAt = Date.now();
    this.last = this.completed(this.current);
    this.timer = setTimeout(() => {
      if (this.running) this.nextRound();
    }, 0);
  }

  private publicRound(round: PlinkoRound): PlinkoRound {
    return { ...round };
  }

  private completed(round: PlinkoRound): CompletedPlinkoRound {
    return round as CompletedPlinkoRound;
  }
}
