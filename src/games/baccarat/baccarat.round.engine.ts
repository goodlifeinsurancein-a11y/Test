import { randomUUID } from 'node:crypto';

import { BaccaratEngine } from './baccarat.engine.js';
import {
  Card,
  CompletedBaccaratRound,
  BaccaratBet,
  BaccaratBetInput,
  BaccaratRound,
} from './baccarat.types.js';

/** In-memory lifecycle coordinator with no transport or persistence dependencies. */
export class BaccaratRoundEngine {
  readonly BETTING_MS = 15_000;
  readonly DEAL_MS = 1_000;
  readonly COMPARE_MS = 1_000;
  readonly RESULT_MS = 5_000;
  readonly SETTLEMENT_MS = 1_000;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private currentRound: BaccaratRound | null = null;
  private lastCompletedRound: CompletedBaccaratRound | null = null;
  private nextRoundNumber = 1;

  constructor(private readonly engine = new BaccaratEngine()) {}

  start(): BaccaratRound {
    if (this.running) throw new Error('Baccarat round engine is already running');
    this.running = true;
    return this.startNextRound();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.currentRound = null;
  }

  isRunning(): boolean {
    return this.running;
  }

  getState(): BaccaratRound | null {
    return this.currentRound ? this.toPublicRound(this.currentRound) : null;
  }

  getLastCompletedRound(): CompletedBaccaratRound | null {
    return this.lastCompletedRound
      ? this.toCompletedRound(this.lastCompletedRound)
      : null;
  }

  placeBet(playerId: string, bet: BaccaratBetInput): BaccaratBet {
    const round = this.requireBettingRound();
    this.engine.validatePlayerId(playerId);
    this.engine.validateBet(bet);

    if (round.bets.some((placedBet) => placedBet.betId === bet.betId)) {
      throw new Error('Duplicate bet id');
    }

    const placedBet: BaccaratBet = {
      ...bet,
      playerId,
      status: 'PENDING',
      placedAt: Date.now(),
    };
    round.bets.push(placedBet);
    return { ...placedBet };
  }

  private startNextRound(): BaccaratRound {
    const startedAt = Date.now();
    this.currentRound = {
      roundId: randomUUID(),
      roundNumber: this.nextRoundNumber++,
      status: 'BETTING',
      startedAt,
      bettingEndsAt: startedAt + this.BETTING_MS,
      lockedAt: null,
      dealtAt: null,
      comparedAt: null,
      resultAt: null,
      settledAt: null,
      completedAt: null,
      playerHand: [],
      bankerHand: [],
      result: null,
      bets: [],
      settlements: [],
    };
    this.timer = setTimeout(() => this.lockBetting(), this.BETTING_MS);
    return this.toPublicRound(this.currentRound);
  }

  private lockBetting(): void {
    if (!this.running || !this.currentRound) return;
    this.currentRound.status = 'LOCK';
    this.currentRound.lockedAt = Date.now();
    this.timer = setTimeout(() => this.dealCards(), 0);
  }

  private dealCards(): void {
    if (!this.running || !this.currentRound) return;
    const shoe = this.engine.shuffleShoe(this.engine.createShoe());
    const { playerHand, bankerHand } = this.engine.dealRound(shoe);
    this.currentRound.status = 'DEAL';
    this.currentRound.dealtAt = Date.now();
    this.currentRound.playerHand = playerHand.map((c) => ({ ...c }));
    this.currentRound.bankerHand = bankerHand.map((c) => ({ ...c }));
    this.timer = setTimeout(() => this.compareCards(), this.DEAL_MS);
  }

  private compareCards(): void {
    if (!this.running || !this.currentRound) return;
    this.currentRound.status = 'COMPARE';
    this.currentRound.comparedAt = Date.now();
    this.currentRound.result = this.engine.determineResult(
      this.currentRound.playerHand,
      this.currentRound.bankerHand,
    );
    this.timer = setTimeout(() => this.showResult(), this.COMPARE_MS);
  }

  private showResult(): void {
    if (!this.running || !this.currentRound || !this.currentRound.result) return;
    this.currentRound.status = 'RESULT';
    this.currentRound.resultAt = Date.now();

    // Settle all bets.
    this.currentRound.settlements = this.currentRound.bets.map((bet) => {
      const settlement = this.engine.settleBet(
        bet,
        bet.playerId,
        this.currentRound!.result!,
        this.currentRound!.resultAt!,
      );
      bet.status = settlement.status;
      return settlement;
    });

    this.currentRound.status = 'SETTLEMENT';
    this.currentRound.settledAt = Date.now();

    this.timer = setTimeout(() => this.completeRound(), this.SETTLEMENT_MS);
  }

  private completeRound(): void {
    if (!this.running || !this.currentRound || !this.currentRound.result) return;
    this.currentRound.status = 'COMPLETED';
    this.currentRound.completedAt = Date.now();
    this.lastCompletedRound = this.toCompletedRound(this.currentRound);
    this.timer = setTimeout(() => {
      if (this.running) this.startNextRound();
    }, 0);
  }

  private requireBettingRound(): BaccaratRound {
    if (!this.currentRound || this.currentRound.status !== 'BETTING') {
      throw new Error('Baccarat bets are accepted only during BETTING');
    }
    return this.currentRound;
  }

  private toPublicRound(round: BaccaratRound): BaccaratRound {
    const revealCards = ['DEAL', 'COMPARE', 'RESULT', 'SETTLEMENT', 'COMPLETED'].includes(round.status);
    const revealResult = ['RESULT', 'SETTLEMENT', 'COMPLETED'].includes(round.status);
    return {
      ...round,
      playerHand: revealCards && round.playerHand.length ? round.playerHand.map((c) => ({ ...c })) : [],
      bankerHand: revealCards && round.bankerHand.length ? round.bankerHand.map((c) => ({ ...c })) : [],
      result: revealResult && round.result ? this.copyResult(round.result) : null,
      bets: round.bets.map((bet) => ({
        ...bet,
        status: revealResult ? bet.status : 'PENDING',
      })),
      settlements: revealResult ? round.settlements.map((s) => ({ ...s })) : [],
    };
  }

  private toCompletedRound(round: BaccaratRound): CompletedBaccaratRound {
    if (!round.result || round.completedAt === null) {
      throw new Error('Baccarat round is not completed');
    }
    return {
      ...this.toPublicRound(round),
      result: this.copyResult(round.result),
      completedAt: round.completedAt,
      settlements: round.settlements.map((s) => ({ ...s })),
    };
  }

  private copyResult(result: NonNullable<BaccaratRound['result']>) {
    return {
      ...result,
      playerHand: result.playerHand.map((c) => ({ ...c })),
      bankerHand: result.bankerHand.map((c) => ({ ...c })),
    };
  }
}
