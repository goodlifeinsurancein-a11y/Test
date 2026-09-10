import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FinancialService } from '../../wallet/financial.service.js';
import { SupabaseService } from '../../supabase/supabase.service.js';
import { TeenPattiRoundEngine } from './teen-patti.round.engine.js';
import { EventBusService } from '../../events/event-bus.service.js';

@Injectable()
export class TeenPattiService {
  constructor(
    private readonly financial: FinancialService,
    private readonly supabase: SupabaseService,
    private readonly engine: TeenPattiRoundEngine,
    private readonly events: EventBusService,
  ) {}

  async placeBet(
    playerId: string,
    walletId: string,
    amount: number,
  ) {
    if (!playerId) {
      throw new BadRequestException(
        'Player id is required',
      );
    }

    if (!walletId) {
      throw new BadRequestException(
        'Wallet id is required',
      );
    }

    if (
      !Number.isFinite(amount) ||
      amount < 1
    ) {
      throw new BadRequestException(
        'Bet amount must be at least 1',
      );
    }

    const state = this.engine.getTeenPattiState();

    if (!state || state.status !== 'BETTING') {
      throw new BadRequestException(
        'Teen Patti betting is closed',
      );
    }

    // Use unified financial RPC for atomic bet placement
    const amountUnits = this.financial.wholeTokensToUnits(amount);
    const idempotencyKey = this.financial.newIdempotencyKey();
    const betId = this.financial.idempotencyUuid(idempotencyKey);

    const saved = await this.financial.placeBet({
      betId,
      playerId,
      gameId: 'teen-patti',
      roundId: state.roundId,
      betType: 'ANTE',
      betValue: {},
      amount: amountUnits,
      idempotencyKey,
    });

    if ((saved as { idempotent?: boolean })?.idempotent) {
      return { success: true, message: 'Teen Patti bet placed', playerId, amount, roundId: state.roundId, roundNumber: state.roundNumber, idempotent: true };
    }

    try {
      this.engine.placeBet(
        playerId,
        amount,
      );
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
          : 'Failed to place Teen Patti bet',
      );
    }

    this.events.publish({
      eventName: 'BET_PLACED',
      game: 'TEEN_PATTI',
      roundId: state.roundId,
      roundNumber: state.roundNumber,
      userId: playerId,
      timestamp: new Date().toISOString(),
      data: {
        amount,
      },
    });

    return {
      success: true,
      message: 'Teen Patti bet placed',
      playerId,
      amount,
      roundId: state.roundId,
      roundNumber: state.roundNumber,
      idempotent: false,
    };
  }

  getState() {
    return this.engine.getTeenPattiState();
  }

  getLastResult() {
    const result =
      this.engine.getLastResult();

    if (!result) {
      throw new NotFoundException(
        'No completed Teen Patti round',
      );
    }

    return result;
  }
}
