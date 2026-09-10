import { randomUUID } from 'node:crypto';

import {
  DiceBet,
  DiceBetResult,
  DiceEngine,
  DiceResult,
} from './dice.engine.js';

export type DiceRoundStatus =
  | 'BETTING'
  | 'LOCK'
  | 'ROLL'
  | 'RESULT'
  | 'COMPLETED';

export interface DicePlacedBet extends DiceBet {
  betId: string;
  playerId: string;
}

export interface DiceBetOutcome extends DiceBetResult {
  bet: DicePlacedBet;
}

export interface DiceRoundState {
  roundId: string;
  roundNumber: number;
  status: DiceRoundStatus;
  startedAt: number;
  bettingEndsAt: number;
  lockedAt: number | null;
  rolledAt: number | null;
  resultAt: number | null;
  completedAt: number | null;
  diceResult: DiceResult | null;
  bets: DicePlacedBet[];
  outcomes: DiceBetOutcome[];
}

export interface DiceCompletedRound extends DiceRoundState {
  diceResult: DiceResult;
  completedAt: number;
}

/**
 * In-memory Dice round coordinator. It deliberately has no HTTP, wallet,
 * persistence, or authentication dependencies.
 */
export class DiceRoundEngine {
  readonly BETTING_MS = 15_000;
  readonly ROLL_MS = 3_000;
  readonly RESULT_MS = 5_000;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private currentRound: DiceRoundState | null = null;
  private lastCompletedRound: DiceCompletedRound | null = null;
  private nextRoundNumber = 1;

  constructor(private readonly diceEngine = new DiceEngine()) {}

  start(): DiceRoundState {
    if (this.running) {
      throw new Error('Dice round engine is already running');
    }

    this.running = true;
    return this.startNextRound();
  }

  stop(): void {
    this.running = false;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.currentRound = null;
  }

  isRunning(): boolean {
    return this.running;
  }

  getState(): DiceRoundState | null {
    return this.currentRound
      ? this.toPublicState(this.currentRound)
      : null;
  }

  getLastCompletedRound(): DiceCompletedRound | null {
    return this.lastCompletedRound
      ? this.toCompletedRound(this.lastCompletedRound)
      : null;
  }

  placeBet(playerId: string, bet: DiceBet): DicePlacedBet {
    const round = this.requireBettingRound();

    if (typeof playerId !== 'string' || playerId.trim().length === 0) {
      throw new Error('Player id is required');
    }

    this.diceEngine.validateBet(bet);

    const placedBet: DicePlacedBet = {
      betId: randomUUID(),
      playerId,
      type: bet.type,
      ...(bet.value === undefined ? {} : { value: bet.value }),
      amount: bet.amount,
    };

    round.bets.push(placedBet);
    return { ...placedBet };
  }

  private startNextRound(): DiceRoundState {
    const startedAt = Date.now();

    this.currentRound = {
      roundId: randomUUID(),
      roundNumber: this.nextRoundNumber++,
      status: 'BETTING',
      startedAt,
      bettingEndsAt: startedAt + this.BETTING_MS,
      lockedAt: null,
      rolledAt: null,
      resultAt: null,
      completedAt: null,
      diceResult: null,
      bets: [],
      outcomes: [],
    };

    this.timer = setTimeout(() => this.lockBetting(), this.BETTING_MS);
    return this.toPublicState(this.currentRound);
  }

  private lockBetting(): void {
    if (!this.running || !this.currentRound) {
      return;
    }

    this.currentRound.status = 'LOCK';
    this.currentRound.lockedAt = Date.now();
    this.timer = setTimeout(() => this.rollDice(), 0);
  }

  private rollDice(): void {
    if (!this.running || !this.currentRound) {
      return;
    }

    this.currentRound.status = 'ROLL';
    this.currentRound.rolledAt = Date.now();
    this.currentRound.diceResult = this.diceEngine.roll();
    this.currentRound.outcomes = this.currentRound.bets.map((bet) => ({
      ...this.diceEngine.settleBet(bet, this.currentRound!.diceResult!),
      bet: { ...bet },
    }));

    this.timer = setTimeout(() => this.showResult(), this.ROLL_MS);
  }

  private showResult(): void {
    if (!this.running || !this.currentRound) {
      return;
    }

    this.currentRound.status = 'RESULT';
    this.currentRound.resultAt = Date.now();
    this.timer = setTimeout(() => this.completeRound(), this.RESULT_MS);
  }

  private completeRound(): void {
    if (!this.running || !this.currentRound || !this.currentRound.diceResult) {
      return;
    }

    this.currentRound.status = 'COMPLETED';
    this.currentRound.completedAt = Date.now();
    this.lastCompletedRound = this.toCompletedRound(this.currentRound);
    this.timer = setTimeout(() => {
      if (this.running) {
        this.startNextRound();
      }
    }, 0);
  }

  private requireBettingRound(): DiceRoundState {
    if (!this.currentRound || this.currentRound.status !== 'BETTING') {
      throw new Error('Dice bets are accepted only during BETTING');
    }

    return this.currentRound;
  }

  private toPublicState(round: DiceRoundState): DiceRoundState {
    const revealResult =
      round.status === 'RESULT' || round.status === 'COMPLETED';

    return {
      ...round,
      diceResult: revealResult && round.diceResult
        ? { ...round.diceResult }
        : null,
      bets: round.bets.map((bet) => ({ ...bet })),
      outcomes: revealResult
        ? round.outcomes.map((outcome) => ({
            ...outcome,
            bet: { ...outcome.bet },
          }))
        : [],
    };
  }

  private toCompletedRound(round: DiceRoundState): DiceCompletedRound {
    if (!round.diceResult || round.completedAt === null) {
      throw new Error('Dice round is not completed');
    }

    return {
      ...this.toPublicState(round),
      diceResult: { ...round.diceResult },
      completedAt: round.completedAt,
      outcomes: round.outcomes.map((outcome) => ({
        ...outcome,
        bet: { ...outcome.bet },
      })),
    };
  }
}
