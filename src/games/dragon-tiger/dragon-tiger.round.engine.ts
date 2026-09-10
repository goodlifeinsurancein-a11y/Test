import { randomUUID } from 'node:crypto';

import { DragonTigerEngine } from './dragon-tiger.engine.js';
import {
  Card,
  CompletedDragonTigerRound,
  DragonTigerBet,
  DragonTigerBetInput,
  DragonTigerRound,
} from './dragon-tiger.types.js';

/** In-memory lifecycle coordinator with no transport or persistence dependencies. */
export class DragonTigerRoundEngine {
  readonly BETTING_MS = 15_000;
  readonly DEAL_MS = 1_000;
  readonly COMPARE_MS = 1_000;
  readonly RESULT_MS = 5_000;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private currentRound: DragonTigerRound | null = null;
  private lastCompletedRound: CompletedDragonTigerRound | null = null;
  private nextRoundNumber = 1;

  constructor(private readonly engine = new DragonTigerEngine()) {}

  start(): DragonTigerRound {
    if (this.running) throw new Error('Dragon Tiger round engine is already running');
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

  getState(): DragonTigerRound | null {
    return this.currentRound ? this.toPublicRound(this.currentRound) : null;
  }

  getLastCompletedRound(): CompletedDragonTigerRound | null {
    return this.lastCompletedRound
      ? this.toCompletedRound(this.lastCompletedRound)
      : null;
  }

  placeBet(playerId: string, bet: DragonTigerBetInput): DragonTigerBet {
    const round = this.requireBettingRound();
    this.engine.validatePlayerId(playerId);
    this.engine.validateBet(bet);

    if (round.bets.some((placedBet) => placedBet.betId === bet.betId)) {
      throw new Error('Duplicate bet id');
    }

    const placedBet: DragonTigerBet = {
      ...bet,
      playerId,
      status: 'PENDING',
      placedAt: Date.now(),
    };
    round.bets.push(placedBet);
    return { ...placedBet };
  }

  private startNextRound(): DragonTigerRound {
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
      completedAt: null,
      dragonCard: null,
      tigerCard: null,
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
    const deck = this.engine.shuffleDeck(this.engine.createDeck());
    const { dragonCard, tigerCard } = this.engine.dealRound(deck);
    this.currentRound.status = 'DEAL';
    this.currentRound.dealtAt = Date.now();
    this.currentRound.dragonCard = dragonCard;
    this.currentRound.tigerCard = tigerCard;
    this.timer = setTimeout(() => this.compareCards(), this.DEAL_MS);
  }

  private compareCards(): void {
    if (!this.running || !this.currentRound || !this.currentRound.dragonCard || !this.currentRound.tigerCard) return;
    this.currentRound.status = 'COMPARE';
    this.currentRound.comparedAt = Date.now();
    this.currentRound.result = this.engine.determineResult(
      this.currentRound.dragonCard,
      this.currentRound.tigerCard,
    );
    this.currentRound.settlements = this.currentRound.bets.map((bet) => {
      const settlement = this.engine.settleBet(
        bet,
        bet.playerId,
        this.currentRound!.result!,
        this.currentRound!.comparedAt!,
      );
      bet.status = settlement.status;
      return settlement;
    });
    this.timer = setTimeout(() => this.showResult(), this.COMPARE_MS);
  }

  private showResult(): void {
    if (!this.running || !this.currentRound) return;
    this.currentRound.status = 'RESULT';
    this.currentRound.resultAt = Date.now();
    this.timer = setTimeout(() => this.completeRound(), this.RESULT_MS);
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

  private requireBettingRound(): DragonTigerRound {
    if (!this.currentRound || this.currentRound.status !== 'BETTING') {
      throw new Error('Dragon Tiger bets are accepted only during BETTING');
    }
    return this.currentRound;
  }

  private toPublicRound(round: DragonTigerRound): DragonTigerRound {
    const revealCards = ['DEAL', 'COMPARE', 'RESULT', 'COMPLETED'].includes(round.status);
    const revealResult = ['RESULT', 'COMPLETED'].includes(round.status);
    return {
      ...round,
      dragonCard: revealCards && round.dragonCard ? { ...round.dragonCard } : null,
      tigerCard: revealCards && round.tigerCard ? { ...round.tigerCard } : null,
      result: revealResult && round.result ? this.copyResult(round.result) : null,
      bets: round.bets.map((bet) => ({
        ...bet,
        status: revealResult ? bet.status : 'PENDING',
      })),
      settlements: revealResult ? round.settlements.map((settlement) => ({ ...settlement })) : [],
    };
  }

  private toCompletedRound(round: DragonTigerRound): CompletedDragonTigerRound {
    if (!round.dragonCard || !round.tigerCard || !round.result || round.completedAt === null) {
      throw new Error('Dragon Tiger round is not completed');
    }
    return {
      ...this.toPublicRound(round),
      dragonCard: { ...round.dragonCard },
      tigerCard: { ...round.tigerCard },
      result: this.copyResult(round.result),
      completedAt: round.completedAt,
      settlements: round.settlements.map((settlement) => ({ ...settlement })),
    };
  }

  private copyResult(result: NonNullable<DragonTigerRound['result']>) {
    return {
      ...result,
      dragonCard: { ...result.dragonCard },
      tigerCard: { ...result.tigerCard },
    };
  }
}
