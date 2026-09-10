import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';

import { CrashEngine } from './crash.engine.js';
import {
  CompletedCrashRound,
  CrashBet,
  CrashBetInput,
  CrashResult,
  CrashRound,
  CrashSettlement,
} from './crash.types.js';

/**
 * An in-memory Crash game coordinator. It has no transport, persistence,
 * wallet, authentication, or external-service dependencies.
 */
export class CrashRoundEngine {
  readonly BETTING_MS = 15_000;
  readonly TICK_MS = 100;
  readonly MULTIPLIER_INCREMENT = 0.01;
  readonly CRASH_MS = 1_000;
  readonly RESULT_MS = 5_000;

  private transitionTimer: ReturnType<typeof setTimeout> | null = null;
  private multiplierTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private currentRound: CrashRound | null = null;
  private lastCompletedRound: CompletedCrashRound | null = null;
  private nextRoundNumber = 1;
  private hiddenCrashPoint: number | null = null;

  constructor(private readonly crashEngine = new CrashEngine()) {
    // Use deterministic generation with roundId
    this.currentCrashPoint = null;
  }

  private currentCrashPoint: number | null = null;

  start(): CrashRound {
    if (this.running) {
      throw new Error('Crash round engine is already running');
    }

    this.running = true;
    return this.startNextRound();
  }

  stop(): void {
    this.running = false;
    this.clearTimers();
    this.currentRound = null;
    this.hiddenCrashPoint = null;
  }

  isRunning(): boolean {
    return this.running;
  }

  getState(): CrashRound | null {
    return this.currentRound ? this.toPublicRound(this.currentRound) : null;
  }

  getLastCompletedRound(): CompletedCrashRound | null {
    return this.lastCompletedRound
      ? this.toCompletedRound(this.lastCompletedRound)
      : null;
  }

  placeBet(playerId: string, bet: CrashBetInput): CrashBet {
    const round = this.requireRoundStatus('BETTING', 'Crash bets are accepted only during BETTING');

    if (typeof playerId !== 'string' || playerId.trim().length === 0) {
      throw new Error('Player id is required');
    }

    this.crashEngine.validateBet(bet);

    if (round.bets.some((placedBet) => placedBet.betId === bet.betId)) {
      throw new Error('Duplicate bet id');
    }

    const placedBet: CrashBet = {
      ...bet,
      playerId,
      status: 'ACTIVE',
      placedAt: Date.now(),
      cashedOutAt: null,
      cashoutMultiplier: null,
    };

    round.bets.push(placedBet);
    return { ...placedBet };
  }

  cashOut(betId: string, cashoutMultiplier: number): CrashSettlement {
    const round = this.requireRoundStatus('RUNNING', 'Cashout is allowed only during RUNNING');

    if (typeof betId !== 'string' || betId.trim().length === 0) {
      throw new Error('Bet id is required');
    }

    this.crashEngine.validateManualCashoutMultiplier(cashoutMultiplier);

    if (cashoutMultiplier > round.currentMultiplier) {
      throw new Error('Cashout multiplier cannot exceed the current multiplier');
    }

    const bet = round.bets.find((placedBet) => placedBet.betId === betId);

    if (!bet) {
      throw new Error('Crash bet not found');
    }

    if (bet.status !== 'ACTIVE') {
      throw new Error('Crash bet has already been settled');
    }

    return this.cashOutBet(round, bet, cashoutMultiplier);
  }

  private startNextRound(): CrashRound {
    const startedAt = Date.now();

    this.currentRound = {
      roundId: randomUUID(),
      roundNumber: this.nextRoundNumber++,
      status: 'BETTING',
      startedAt,
      bettingEndsAt: startedAt + this.BETTING_MS,
      lockedAt: null,
      runningAt: null,
      crashedAt: null,
      resultAt: null,
      completedAt: null,
      currentMultiplier: 1,
      crashResult: null,
      bets: [],
      settlements: [],
    };

    this.transitionTimer = setTimeout(() => this.lockBetting(), this.BETTING_MS);
    return this.toPublicRound(this.currentRound);
  }

  private lockBetting(): void {
    if (!this.running || !this.currentRound) return;

    this.currentRound.status = 'LOCK';
    this.currentRound.lockedAt = Date.now();
    this.transitionTimer = setTimeout(() => this.startRunning(), 0);
  }

  private startRunning(): void {
    if (!this.running || !this.currentRound) return;

    this.currentRound.status = 'RUNNING';
    this.currentRound.runningAt = Date.now();
    this.hiddenCrashPoint = this.crashEngine.generateCrashPoint(this.currentRound.roundId);
    this.multiplierTimer = setInterval(() => this.advanceRunningRound(), this.TICK_MS);
  }

  private advanceRunningRound(): void {
    if (
      !this.running ||
      !this.currentRound ||
      this.currentRound.status !== 'RUNNING' ||
      this.hiddenCrashPoint === null
    ) {
      return;
    }

    const nextMultiplier = this.crashEngine.advanceMultiplier(
      this.currentRound.currentMultiplier,
      this.MULTIPLIER_INCREMENT,
    );

    if (this.crashEngine.hasCrashed(nextMultiplier, this.hiddenCrashPoint)) {
      this.currentRound.currentMultiplier = this.hiddenCrashPoint;
      this.crashRound();
      return;
    }

    this.currentRound.currentMultiplier = nextMultiplier;
    this.processAutoCashouts();
  }

  private processAutoCashouts(): void {
    if (!this.currentRound) return;

    for (const bet of this.currentRound.bets) {
      if (
        bet.status === 'ACTIVE' &&
        bet.autoCashoutMultiplier !== undefined &&
        this.currentRound.currentMultiplier >= bet.autoCashoutMultiplier
      ) {
        this.cashOutBet(this.currentRound, bet, this.currentRound.currentMultiplier);
      }
    }
  }

  private crashRound(): void {
    if (!this.currentRound || this.hiddenCrashPoint === null) return;

    if (this.multiplierTimer) {
      clearInterval(this.multiplierTimer);
      this.multiplierTimer = null;
    }

    const crashedAt = Date.now();
    this.currentRound.status = 'CRASH';
    this.currentRound.crashedAt = crashedAt;
    this.currentRound.crashResult = {
      crashMultiplier: this.hiddenCrashPoint,
      crashedAt,
    };

    for (const bet of this.currentRound.bets) {
      if (bet.status !== 'ACTIVE') continue;

      bet.status = 'LOST';
      this.currentRound.settlements.push(
        this.crashEngine.settleLoss(bet, bet.playerId, crashedAt),
      );
    }

    this.transitionTimer = setTimeout(() => this.showResult(), this.CRASH_MS);
  }

  private showResult(): void {
    if (!this.running || !this.currentRound) return;

    this.currentRound.status = 'RESULT';
    this.currentRound.resultAt = Date.now();
    this.transitionTimer = setTimeout(() => this.completeRound(), this.RESULT_MS);
  }

  private completeRound(): void {
    if (!this.running || !this.currentRound || !this.currentRound.crashResult) return;

    this.currentRound.status = 'COMPLETED';
    this.currentRound.completedAt = Date.now();
    this.lastCompletedRound = this.toCompletedRound(this.currentRound);
    this.transitionTimer = setTimeout(() => {
      if (this.running) this.startNextRound();
    }, 0);
  }

  private cashOutBet(
    round: CrashRound,
    bet: CrashBet,
    cashoutMultiplier: number,
  ): CrashSettlement {
    const settledAt = Date.now();
    const settlement = this.crashEngine.settleCashout(
      bet,
      bet.playerId,
      cashoutMultiplier,
      settledAt,
    );

    bet.status = 'CASHED_OUT';
    bet.cashoutMultiplier = cashoutMultiplier;
    bet.cashedOutAt = settledAt;
    round.settlements.push(settlement);
    return { ...settlement };
  }

  private requireRoundStatus(
    status: CrashRound['status'],
    message: string,
  ): CrashRound {
    if (!this.currentRound || this.currentRound.status !== status) {
      throw new Error(message);
    }

    return this.currentRound;
  }

  private clearTimers(): void {
    if (this.transitionTimer) {
      clearTimeout(this.transitionTimer);
      this.transitionTimer = null;
    }

    if (this.multiplierTimer) {
      clearInterval(this.multiplierTimer);
      this.multiplierTimer = null;
    }
  }

  private toPublicRound(round: CrashRound): CrashRound {
    const revealCrash =
      round.status === 'CRASH' ||
      round.status === 'RESULT' ||
      round.status === 'COMPLETED';

    return {
      ...round,
      crashResult: revealCrash && round.crashResult
        ? { ...round.crashResult }
        : null,
      bets: round.bets.map((bet) => ({ ...bet })),
      settlements: revealCrash
        ? round.settlements.map((settlement) => ({ ...settlement }))
        : [],
    };
  }

  private toCompletedRound(round: CrashRound): CompletedCrashRound {
    if (!round.crashResult || round.completedAt === null) {
      throw new Error('Crash round is not completed');
    }

    return {
      ...this.toPublicRound(round),
      crashResult: { ...round.crashResult },
      completedAt: round.completedAt,
      settlements: round.settlements.map((settlement) => ({ ...settlement })),
    };
  }
}
