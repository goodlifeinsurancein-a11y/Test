import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { EventBusService } from '../../events/event-bus.service.js';
import { FinancialService } from '../../wallet/financial.service.js';
import { SupabaseService } from '../../supabase/supabase.service.js';
import { RouletteEngine } from './roulette.engine.js';
import { RouletteBet, RouletteBetType } from './roulette.types.js';

type PersistedRouletteBet = RouletteBet & { betId: string };

@Injectable()
export class FinancialRouletteService {
  constructor(private readonly engine: RouletteEngine, private readonly financial: FinancialService, private readonly supabase: SupabaseService, private readonly events: EventBusService) {}

  async initialise(): Promise<void> {
    this.engine.setPayoutHandler(() => this.settleRound());
    this.events.subscribe('ROUND_STARTED', (event) => {
      if (event.game !== 'ROULETTE') return;
      void this.financial.openRound({ roundId: event.roundId, gameId: 'roulette', roundNumber: event.roundNumber, status: 'BETTING', startedAt: new Date(String((event.data ?? {}).startedAt)), bettingEndsAt: new Date(String((event.data ?? {}).bettingEndsAt)), recoveryData: { lifecycle: 'ROULETTE' } }).catch((error: Error) => console.error('Failed to persist roulette round', error.message));
    });
  }

  getState() {
    const state = this.engine.getRouletteState();
    if (!state) return null;
    return { roundId: state.roundId, roundNumber: state.roundNumber, status: state.status, result: state.status === 'RESULT' || state.status === 'COMPLETED' ? state.result : null };
  }

  getLastResult() {
    const result = this.engine.getLastResult();
    if (!result) throw new NotFoundException('No completed roulette round');
    return { roundId: result.roundId, roundNumber: result.roundNumber, result: result.result, completedAt: result.completedAt };
  }

  async history() {
    const { data, error } = await this.supabase.getClient().from('game_rounds').select('id,round_number,status,result_data,started_at,result_at,completed_at').eq('game_key', 'roulette').not('result_data', 'is', null).order('round_number', { ascending: false }).limit(50);
    if (error) throw new InternalServerErrorException(error.message);
    return { success: true, rounds: data ?? [] };
  }

  async placeBet(playerId: string, roundId: string, betType: string, betValue: string, amount: number, idempotencyKey?: string) {
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new BadRequestException('Bet amount must be a positive whole number');
    const state = this.engine.getRouletteState();
    if (!state || state.roundId !== roundId || state.status !== 'BETTING') throw new BadRequestException('Roulette betting is closed');
    const resolvedKey = this.financial.newIdempotencyKey(idempotencyKey);
    const bet: PersistedRouletteBet = { betId: this.financial.idempotencyUuid(resolvedKey), playerId, betType: betType as RouletteBetType, betValue, amount };
    try { this.engine.validateBetForService(bet); } catch (error) { throw new BadRequestException(error instanceof Error ? error.message : 'Invalid roulette bet'); }
    const saved = await this.financial.placeBet({ betId: bet.betId, playerId, gameId: 'roulette', roundId, betType: bet.betType, betValue: { value: betValue }, amount, idempotencyKey: resolvedKey });
    if ((saved as { idempotent?: boolean })?.idempotent) return { success: true, bet: { id: bet.betId, roundId, betType: bet.betType, betValue, amount }, idempotent: true };
    try { this.engine.addBet(bet); } catch (error) {
      await this.financial.settleBet({ betId: bet.betId, outcome: 'VOID', returnUnits: amount * 10, idempotencyKey: `${this.financial.newIdempotencyKey(idempotencyKey)}:void` });
      throw new BadRequestException(error instanceof Error ? error.message : 'Roulette betting is closed');
    }
    return { success: true, bet: { id: bet.betId, roundId, betType: bet.betType, betValue, amount }, idempotent: Boolean((saved as { idempotent?: boolean })?.idempotent) };
  }

  private async settleRound() {
    const state = this.engine.getRouletteState(); const result = state?.result;
    if (!state || state.status !== 'RESULT' || !result) throw new InternalServerErrorException('Roulette result is not available');
    const { error } = await this.supabase.getClient().rpc('finance_record_round_result', { p_round_id: state.roundId, p_status: 'RESULT', p_result_data: result, p_result_at: new Date().toISOString(), p_completed_at: null });
    if (error) throw new InternalServerErrorException(`Failed to persist roulette result: ${error.message}`);
    for (const outcome of this.engine.calculateBetOutcomes()) {
      const bet = outcome.bet as PersistedRouletteBet;
      await this.financial.settleBet({ betId: bet.betId, outcome: outcome.status, returnUnits: outcome.totalReturn * 10, idempotencyKey: `roulette:${state.roundId}:${bet.betId}:settlement` });
    }
    this.engine.markPayoutsSettled();
  }
}
