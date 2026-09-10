import { randomUUID } from 'node:crypto';
import { JackpotEngine } from './jackpot.engine.js';
import {
  JackpotBet,
  JackpotBetInput,
  JackpotRound,
  CompletedJackpotRound,
} from './jackpot.types.js';

export class JackpotRoundEngine {
  readonly BETTING_MS = 15_000;
  readonly GENERATE_MS = 1_000;
  readonly RESULT_MS = 1_000;
  readonly SETTLEMENT_MS = 5_000;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private current: JackpotRound | null = null;
  private last: CompletedJackpotRound | null = null;
  private nextNumber = 1;

  constructor(private readonly engine = new JackpotEngine()) {}

  // ── Public lifecycle ─────────────────────────────────────────────

  start(): JackpotRound {
    if (this.running) {
      throw new Error('Jackpot round engine is already running');
    }
    this.running = true;
    return this.nextRound();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.current = null;
  }

  isRunning(): boolean {
    return this.running;
  }

  getState(): JackpotRound | null {
    return this.current ? this.publicRound(this.current) : null;
  }

  getLastCompletedRound(): CompletedJackpotRound | null {
    return this.last ? this.completed(this.last) : null;
  }

  placeBet(playerId: string, bet: JackpotBetInput): JackpotBet {
    const round = this.betting();
    this.engine.validatePlayerId(playerId);
    this.engine.validateBet(bet);
    if (round.bets.some((item) => item.betId === bet.betId)) {
      throw new Error('Duplicate bet id');
    }
    const placed: JackpotBet = {
      ...bet,
      playerId,
      status: 'PENDING',
      placedAt: Date.now(),
    };
    round.bets.push(placed);
    return { ...placed };
  }

  // ── Internal state machine ───────────────────────────────────────

  private nextRound(): JackpotRound {
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
    this.current.result = this.engine.generateResult();
    this.current.generatedAt = this.current.result.generatedAt;
    this.timer = setTimeout(() => this.result(), this.GENERATE_MS);
  }

  private result(): void {
    if (!this.running || !this.current) return;
    this.current.status = 'RESULT';
    this.current.resultAt = Date.now();
    this.timer = setTimeout(() => this.settle(), this.RESULT_MS);
  }

  private settle(): void {
    if (!this.running || !this.current || !this.current.result) return;
    this.current.status = 'SETTLEMENT';
    this.current.settledAt = Date.now();
    this.current.settlements = this.current.bets.map((bet) => {
      const item = this.engine.settleBet(
        bet,
        bet.playerId,
        this.current!.result!,
        this.current!.settledAt!,
      );
      bet.status = item.status;
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

  // ── Accessors ────────────────────────────────────────────────────

  private betting(): JackpotRound {
    if (!this.current || this.current.status !== 'BETTING') {
      throw new Error('Jackpot bets are accepted only during BETTING');
    }
    return this.current;
  }

  /** Return a copy with hidden information redacted unless the round is visible. */
  private publicRound(round: JackpotRound): JackpotRound {
    const visible = ['RESULT', 'SETTLEMENT', 'COMPLETED'].includes(round.status);
    return {
      ...round,
      result:
        visible && round.result
          ? { ...round.result, winningNumbers: [...round.result.winningNumbers] }
          : null,
      bets: round.bets.map((bet) => ({
        ...bet,
        status: visible ? bet.status : 'PENDING',
      })),
      settlements:
        ['SETTLEMENT', 'COMPLETED'].includes(round.status)
          ? round.settlements.map((item) => ({ ...item }))
          : [],
    };
  }

  private completed(round: JackpotRound): CompletedJackpotRound {
    if (!round.result || round.completedAt === null) {
      throw new Error('Jackpot round is not completed');
    }
    return {
      ...this.publicRound(round),
      result: {
        ...round.result,
        winningNumbers: [...round.result.winningNumbers],
      },
      completedAt: round.completedAt,
      settlements: round.settlements.map((item) => ({ ...item })),
    };
  }
}
