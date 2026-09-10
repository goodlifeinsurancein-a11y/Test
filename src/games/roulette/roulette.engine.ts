import { Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { GameEngine } from '../game.engine.js';
import { EventBusService } from '../../events/event-bus.service.js';
import { RoundState } from '../round.manager.js';
import {
  RouletteBet,
  RouletteBetOutcome,
  RouletteBetType,
  RouletteColor,
  RouletteResult,
  RouletteRoundState,
} from './roulette.types.js';

const RED_NUMBERS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18,
  19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

export interface RouletteLastResult {
  roundId: string;
  roundNumber: number;
  result: RouletteResult;
  bets: RouletteBet[];
  outcomes: RouletteBetOutcome[];
  completedAt: number | null;
}

@Injectable()
export class RouletteEngine extends GameEngine {
  constructor(
    private readonly eventBus: EventBusService,
  ) {
    super();
  }

  private bets: RouletteBet[] = [];
  private result: RouletteResult | null = null;
  private payoutsSettled = false;

  private currentOutcomes: RouletteBetOutcome[] = [];

  private lastResult: RouletteLastResult | null = null;

  private payoutHandler: (() => Promise<void>) | null = null;

  protected override onBettingStart(round: RoundState): void {
    this.clearBets();

    this.eventBus.publish({
      eventName: 'ROUND_STARTED',
      game: 'ROULETTE',
      roundId: round.roundId,
      roundNumber: round.roundNumber,
      timestamp: new Date().toISOString(),
      data: {
        status: round.status,
        startedAt: new Date(round.startedAt).toISOString(),
        bettingEndsAt: new Date(round.bettingEndsAt).toISOString(),
      },
    });
  }

  protected override onBettingEnd(round: RoundState): void {
    this.eventBus.publish({
      eventName: 'ROUND_LOCKED',
      game: 'ROULETTE',
      roundId: round.roundId,
      roundNumber: round.roundNumber,
      timestamp: new Date().toISOString(),
      data: {
        status: round.status,
      },
    });
  }

  protected override onProcessing(): void {
    this.spin();
  }

  setPayoutHandler(handler: () => Promise<unknown>): void {
    this.payoutHandler = async () => {
      await handler();
    };
  }

  protected override async onResult(
    round: RoundState,
  ): Promise<void> {
    this.currentOutcomes = this.calculateBetOutcomes();

    if (!this.result) {
      throw new Error('Roulette result is not available');
    }

    this.eventBus.publish({
      eventName: 'ROUND_RESULT',
      game: 'ROULETTE',
      roundId: round.roundId,
      roundNumber: round.roundNumber,
      timestamp: new Date().toISOString(),
      data: {
        number: this.result.number,
        color: this.result.color,
      },
    });

    for (const outcome of this.currentOutcomes) {
      this.eventBus.publish({
        eventName:
          outcome.status === 'WIN'
            ? 'BET_WON'
            : 'BET_LOST',
        game: 'ROULETTE',
      roundId: round.roundId,
      roundNumber: round.roundNumber,
      userId: outcome.bet.playerId,
      timestamp: new Date().toISOString(),
      data: {
        betType: outcome.bet.betType,
        betValue: outcome.bet.betValue,
        amount: outcome.bet.amount,
        profit: outcome.profit,
        totalReturn: outcome.totalReturn,
      },
      });
    }

    if (this.payoutHandler) {
      await this.payoutHandler();
    }
  }

  protected override onRoundCompleted(
    round: RoundState,
  ): void {
    if (!this.result) {
      return;
    }

    const outcomes = this.currentOutcomes;

    this.lastResult = {
      roundId: round.roundId,
      roundNumber: round.roundNumber,
      result: { ...this.result },
      bets: this.bets.map((bet) => ({ ...bet })),
      outcomes: outcomes.map((outcome) => ({
        ...outcome,
        bet: { ...outcome.bet },
      })),
      completedAt: round.completedAt,
    };

    this.eventBus.publish({
      eventName: 'ROUND_COMPLETED',
      game: 'ROULETTE',
      roundId: round.roundId,
      roundNumber: round.roundNumber,
      timestamp: new Date().toISOString(),
      data: {
        status: round.status,
        result: {
          number: this.result.number,
          color: this.result.color,
        },
        betCount: this.bets.length,
        completedAt: round.completedAt
          ? new Date(round.completedAt).toISOString()
          : null,
      },
    });
  }

  spin(): RouletteResult {
    const round = super.getState();

    if (!round || round.status !== 'PROCESSING') {
      throw new Error(
        'Roulette spin is allowed only during PROCESSING',
      );
    }

    const number = randomInt(0, 37);

    const color: RouletteColor =
      number === 0
        ? 'GREEN'
        : RED_NUMBERS.has(number)
          ? 'RED'
          : 'BLACK';

    this.result = {
      number,
      color,
    };

    return this.result;
  }

  addBet(bet: RouletteBet): void {
    const round = super.getState();

    if (!round || round.status !== 'BETTING') {
      throw new Error(
        'Bets are accepted only during BETTING',
      );
    }

    this.validateBetForService(bet);
    this.bets.push({ ...bet });
  }

  calculateBetOutcomes(): RouletteBetOutcome[] {
    const round = super.getState();

    if (!round || round.status !== 'RESULT') {
      throw new Error(
        'Bet outcomes are available only during RESULT',
      );
    }

    if (!this.result) {
      throw new Error(
        'Roulette result is not available',
      );
    }

    return this.bets.map((bet) => {
      const won = this.isWinningBet(
        bet,
        this.result!,
      );

      if (!won) {
        return {
          bet: { ...bet },
          status: 'LOSS',
          profit: 0,
          totalReturn: 0,
        };
      }

      const profit =
        bet.amount *
        this.getPayoutMultiplier(bet.betType);

      return {
        bet: { ...bet },
        status: 'WIN',
        profit,
        totalReturn: bet.amount + profit,
      };
    });
  }

  getRouletteState(): RouletteRoundState | null {
    const round = super.getState();

    if (!round) {
      return null;
    }

    return {
      roundId: round.roundId,
      roundNumber: round.roundNumber,
      status: round.status,
      result: this.result,
      bets: [...this.bets],
    };
  }

  getLastResult(): RouletteLastResult | null {
    if (!this.lastResult) {
      return null;
    }

    return {
      roundId: this.lastResult.roundId,
      roundNumber: this.lastResult.roundNumber,
      result: { ...this.lastResult.result },
      bets: this.lastResult.bets.map((bet) => ({
        ...bet,
      })),
      outcomes: this.lastResult.outcomes.map((outcome) => ({
        ...outcome,
        bet: { ...outcome.bet },
      })),
      completedAt: this.lastResult.completedAt,
    };
  }

  isPayoutSettled(): boolean {
    return this.payoutsSettled;
  }

  markPayoutsSettled(): void {
    this.payoutsSettled = true;
  }

  clearBets(): void {
    this.bets = [];
    this.result = null;
    this.payoutsSettled = false;
  }

  private isWinningBet(
    bet: RouletteBet,
    result: RouletteResult,
  ): boolean {
    const number = result.number;

    switch (bet.betType) {
      case 'NUMBER':
        return Number(bet.betValue) === number;

      case 'COLOR':
        if (number === 0) {
          return false;
        }

        return bet.betValue === result.color;

      case 'ODD_EVEN':
        if (number === 0) {
          return false;
        }

        return bet.betValue ===
          (number % 2 === 0 ? 'EVEN' : 'ODD');

      case 'LOW_HIGH':
        if (number === 0) {
          return false;
        }

        return bet.betValue ===
          (number <= 18 ? 'LOW' : 'HIGH');

      case 'DOZEN':
        if (number === 0) {
          return false;
        }

        if (number >= 1 && number <= 12) {
          return bet.betValue === '1-12';
        }

        if (number >= 13 && number <= 24) {
          return bet.betValue === '13-24';
        }

        return bet.betValue === '25-36';
    }
  }

  private getPayoutMultiplier(
    betType: RouletteBetType,
  ): number {
    switch (betType) {
      case 'NUMBER':
        return 35;

      case 'COLOR':
      case 'ODD_EVEN':
      case 'LOW_HIGH':
        return 1;

      case 'DOZEN':
        return 2;
    }
  }

  validateBetForService(
    bet: RouletteBet,
  ): void {
    if (!bet.playerId) {
      throw new Error(
        'Player ID is required',
      );
    }

    if (
      !Number.isInteger(bet.amount) ||
      bet.amount <= 0
    ) {
      throw new Error(
        'Bet amount must be a positive whole number',
      );
    }

    const validTypes: RouletteBetType[] = [
      'NUMBER',
      'COLOR',
      'ODD_EVEN',
      'LOW_HIGH',
      'DOZEN',
    ];

    if (!validTypes.includes(bet.betType)) {
      throw new Error(
        'Invalid roulette bet type',
      );
    }

    switch (bet.betType) {
      case 'NUMBER': {
        const number = Number(bet.betValue);

        if (
          !Number.isInteger(number) ||
          number < 0 ||
          number > 36
        ) {
          throw new Error(
            'Number bet must be between 0 and 36',
          );
        }

        break;
      }

      case 'COLOR':
        if (
          !['RED', 'BLACK'].includes(
            bet.betValue,
          )
        ) {
          throw new Error(
            'Color must be RED or BLACK',
          );
        }

        break;

      case 'ODD_EVEN':
        if (
          !['ODD', 'EVEN'].includes(
            bet.betValue,
          )
        ) {
          throw new Error(
            'ODD_EVEN must be ODD or EVEN',
          );
        }

        break;

      case 'LOW_HIGH':
        if (
          !['LOW', 'HIGH'].includes(
            bet.betValue,
          )
        ) {
          throw new Error(
            'LOW_HIGH must be LOW or HIGH',
          );
        }

        break;

      case 'DOZEN':
        if (
          !['1-12', '13-24', '25-36'].includes(
            bet.betValue,
          )
        ) {
          throw new Error(
            'Invalid dozen',
          );
        }

        break;
    }
  }
}
