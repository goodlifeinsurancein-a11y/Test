import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';

import { SupabaseService } from '../../supabase/supabase.service.js';
import { FinancialService } from '../../wallet/financial.service.js';
import { RouletteEngine } from './roulette.engine.js';
import { RouletteBetType } from './roulette.types.js';
import { EventBusService } from '../../events/event-bus.service.js';

@Injectable()
export class RouletteService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly rouletteEngine: RouletteEngine,
    private readonly financial: FinancialService,
    private readonly eventBus: EventBusService,
  ) {}

  getState() {
    return this.rouletteEngine.getRouletteState();
  }

  getLastResult() {
    return this.rouletteEngine.getLastResult();
  }

  async settleRoundPayouts() {
    if (this.rouletteEngine.isPayoutSettled()) {
      return {
        success: true,
        alreadySettled: true,
        outcomes: [],
      };
    }

    const round = this.rouletteEngine.getState();

    if (!round || round.status !== 'RESULT') {
      throw new InternalServerErrorException(
        'Roulette round is not in RESULT state',
      );
    }

    const outcomes = this.rouletteEngine.calculateBetOutcomes();

    const result = this.rouletteEngine.getRouletteState()?.result;

    if (!result) {
      throw new InternalServerErrorException(
        'Roulette result is not available for settlement',
      );
    }

    // Persist round result
    const { error: resultError } = await this.supabase
      .getClient()
      .rpc('finance_record_round_result', {
        p_round_id: round.roundId,
        p_status: 'RESULT',
        p_result_data: result,
        p_result_at: round.resultAt
          ? new Date(round.resultAt).toISOString()
          : new Date().toISOString(),
        p_completed_at: null,
      });

    if (resultError) {
      throw new InternalServerErrorException(
        `Failed to persist roulette result: ${resultError.message}`,
      );
    }

    // Settle each bet using unified financial RPC
    for (const outcome of outcomes) {
      const bet = outcome.bet;
      if (!bet.betId) {
        throw new InternalServerErrorException('Missing bet ID for settlement');
      }
      await this.financial.settleBet({
        betId: bet.betId,
        outcome: outcome.status === 'WIN' ? 'WIN' : 'LOSS',
        returnUnits: this.financial.wholeTokensToUnits(outcome.totalReturn),
        idempotencyKey: `roulette:${round.roundId}:${bet.betId}:settlement`,
      });
    }

    this.rouletteEngine.markPayoutsSettled();

    return {
      success: true,
      alreadySettled: false,
      outcomes,
    };
  }

  async placeBet(
    playerId: string,
    roundId: string,
    betType: string,
    betValue: string,
    amount: number,
  ) {
    this.validateAmount(amount);

    const state = this.rouletteEngine.getRouletteState();

    if (!state) {
      throw new NotFoundException('Roulette round not found');
    }

    if (state.roundId !== roundId) {
      throw new BadRequestException('Invalid roulette round');
    }

    if (state.status !== 'BETTING') {
      throw new BadRequestException(
        'Bets are accepted only during BETTING',
      );
    }

    const bet = {
      betId: '',
      playerId,
      betType: betType as RouletteBetType,
      betValue,
      amount,
    };

    try {
      this.rouletteEngine.validateBetForService(bet);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : 'Invalid roulette bet',
      );
    }

    // Use unified financial RPC for atomic bet placement
    const amountUnits = this.financial.wholeTokensToUnits(amount);
    const idempotencyKey = this.financial.newIdempotencyKey();
    const betId = this.financial.idempotencyUuid(idempotencyKey);

    const saved = await this.financial.placeBet({
      betId,
      playerId,
      gameId: 'roulette',
      roundId,
      betType: bet.betType,
      betValue: { value: bet.betValue },
      amount: amountUnits,
      idempotencyKey,
    });

    if ((saved as { idempotent?: boolean })?.idempotent) {
      return { success: true, bet: { ...bet, betId }, idempotent: true };
    }

    try {
      this.rouletteEngine.addBet({ ...bet, betId });
    } catch (error) {
      // Refund via void settlement
      await this.financial.settleBet({
        betId,
        outcome: 'VOID',
        returnUnits: amountUnits,
        idempotencyKey: `${idempotencyKey}:void`,
      });
      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : 'Failed to place roulette bet',
      );
    }

    this.eventBus.publish({
      eventName: 'BET_PLACED',
      game: 'ROULETTE',
      roundId,
      roundNumber: state.roundNumber,
      userId: playerId,
      timestamp: new Date().toISOString(),
      data: {
        betType: bet.betType,
        betValue: bet.betValue,
        amount: bet.amount,
      },
    });

    return {
      success: true,
      bet: { ...bet, betId },
      idempotent: false,
    };
  }

  private validateAmount(amount: number) {
    if (
      typeof amount !== 'number' ||
      !Number.isInteger(amount) ||
      amount <= 0
    ) {
      throw new BadRequestException(
        'Bet amount must be a positive whole number',
      );
    }
  }
}
