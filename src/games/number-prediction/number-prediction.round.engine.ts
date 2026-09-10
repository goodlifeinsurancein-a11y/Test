import { randomUUID } from 'node:crypto';
import { NumberPredictionEngine } from './number-prediction.engine.js';
import {
  CompletedNumberPredictionRound,
  NumberPredictionBet,
  NumberPredictionBetInput,
  NumberPredictionRound,
} from './number-prediction.types.js';

export class NumberPredictionRoundEngine {
  readonly BETTING_MS = 15_000;
  readonly GENERATE_MS = 1_000;
  readonly RESULT_MS = 1_000;
  readonly SETTLEMENT_MS = 5_000;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private current: NumberPredictionRound | null = null;
  private last: CompletedNumberPredictionRound | null = null;
  private nextNumber = 1;

  constructor(private readonly engine = new NumberPredictionEngine()) {}

  start(): NumberPredictionRound {
    if (this.running) {
      throw new Error('Number Prediction round engine is already running');
    }
    this.running = true;
    return this.nextRound();
  }

  stop(): void {
    this.running = false;
    this.clearTimer();
    this.current = null;
  }

  isRunning(): boolean {
    return this.running;
  }

  getState(): NumberPredictionRound | null {
    return this.current ? this.publicRound(this.current) : null;
  }

  getLastCompletedRound(): CompletedNumberPredictionRound | null {
    return this.last ? this.completed(this.last) : null;
  }

  placeBet(playerId: string, bet: NumberPredictionBetInput): NumberPredictionBet {
    const round = this.betting();
    this.engine.validatePlayerId(playerId);
    this.engine.validateBet(bet);
    if (round.bets.some((item) => item.betId === bet.betId)) {
      throw new Error('Duplicate bet id');
    }

    const placed: NumberPredictionBet = {
      ...bet,
      playerId,
      status: 'PENDING',
      placedAt: Date.now(),
    };
    round.bets.push(placed);
    return { ...placed };
  }

  private nextRound(): NumberPredictionRound {
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
    this.schedule(() => this.lock(), this.BETTING_MS);
    return this.publicRound(this.current);
  }

  private lock(): void {
    if (!this.running || !this.current) return;
    this.current.status = 'LOCK';
    this.current.lockedAt = Date.now();
    this.schedule(() => this.generate(), 0);
  }

  private generate(): void {
    if (!this.running || !this.current) return;
    this.current.status = 'GENERATE_RESULT';
    this.current.result = this.engine.generateResult();
    this.current.generatedAt = this.current.result.generatedAt;
    this.schedule(() => this.result(), this.GENERATE_MS);
  }

  private result(): void {
    if (!this.running || !this.current) return;
    this.current.status = 'RESULT';
    this.current.resultAt = Date.now();
    this.schedule(() => this.settle(), this.RESULT_MS);
  }

  private settle(): void {
    if (!this.running || !this.current || !this.current.result) return;
    this.current.status = 'SETTLEMENT';
    this.current.settledAt = Date.now();
    this.current.settlements = this.current.bets.map((bet) => {
      const settlement = this.engine.settleBet(bet, bet.playerId, this.current!.result!, this.current!.settledAt!);
      bet.status = settlement.status;
      return settlement;
    });
    this.schedule(() => this.complete(), this.SETTLEMENT_MS);
  }

  private complete(): void {
    if (!this.running || !this.current || !this.current.result) return;
    this.current.status = 'COMPLETED';
    this.current.completedAt = Date.now();
    this.last = this.completed(this.current);
    this.schedule(() => {
      if (this.running) this.nextRound();
    }, 0);
  }

  private betting(): NumberPredictionRound {
    if (!this.current || this.current.status !== 'BETTING') {
      throw new Error('Number Prediction bets are accepted only during BETTING');
    }
    return this.current;
  }

  private schedule(callback: () => void, delay: number): void {
    this.clearTimer();
    this.timer = setTimeout(callback, delay);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private publicRound(round: NumberPredictionRound): NumberPredictionRound {
    const resultVisible = round.status === 'RESULT' || round.status === 'SETTLEMENT' || round.status === 'COMPLETED';
    const settlementsVisible = round.status === 'SETTLEMENT' || round.status === 'COMPLETED';
    return {
      ...round,
      result: resultVisible && round.result ? { ...round.result } : null,
      bets: round.bets.map((bet) => ({ ...bet, status: resultVisible ? bet.status : 'PENDING' })),
      settlements: settlementsVisible ? round.settlements.map((settlement) => ({ ...settlement })) : [],
    };
  }

  private completed(round: NumberPredictionRound): CompletedNumberPredictionRound {
    if (!round.result || round.completedAt === null) {
      throw new Error('Number Prediction round is not completed');
    }
    return {
      ...this.publicRound(round),
      result: { ...round.result },
      completedAt: round.completedAt,
      settlements: round.settlements.map((settlement) => ({ ...settlement })),
    };
  }
}
