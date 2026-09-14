import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { SupabaseService } from '../supabase/supabase.service.js';

export const TOKEN_SCALE = 10;

/** The sole Nest gateway for balance-changing, deci-token RPCs. */
@Injectable()
export class FinancialService {
  constructor(private readonly supabase: SupabaseService) {}

  wholeTokensToUnits(amount: number): number {
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new BadRequestException('Amount must be a positive whole number of tokens');
    const units = amount * TOKEN_SCALE;
    if (!Number.isSafeInteger(units)) throw new BadRequestException('Amount is too large');
    return units;
  }

  unitsToDisplay(units: number | string): string {
    const value = BigInt(units); const sign = value < 0n ? '-' : ''; const absolute = value < 0n ? -value : value;
    return `${sign}${absolute / 10n}${absolute % 10n === 0n ? '' : `.${absolute % 10n}`}`;
  }

  requestHash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

  newIdempotencyKey(provided?: string): string {
    if (provided !== undefined && !/^[A-Za-z0-9._:-]{8,128}$/.test(provided)) throw new BadRequestException('Invalid idempotency key');
    return provided ?? randomUUID();
  }

  idempotencyUuid(key: string): string {
    const hex = createHash('sha256').update(key).digest('hex');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-4' + hex.slice(13, 16) + '-8' + hex.slice(17, 20) + '-' + hex.slice(20, 32);
  }

  async openRound(input: { roundId: string; gameId: string; roundNumber: number; status: string; startedAt: Date; bettingEndsAt: Date | null; recoveryData?: Record<string, unknown> }) {
    return this.rpc('finance_open_round', {
      p_round_id: input.roundId,
      p_game_key: input.gameId,
      p_round_number: input.roundNumber,
      p_status: input.status,
      p_started_at: input.startedAt.toISOString(),
      p_betting_ends_at: input.bettingEndsAt?.toISOString() ?? null,
      p_recovery_data: input.recoveryData ?? {},
    });
  }

  async recordRoundResult(input: { roundId: string; status: string; resultData: any; resultAt: Date; completedAt?: Date }) {
    return this.rpc('finance_record_round_result', {
      p_round_id: input.roundId,
      p_status: input.status,
      p_result_data: input.resultData,
      p_result_at: input.resultAt.toISOString(),
      p_completed_at: input.completedAt?.toISOString() ?? null,
    });
  }

  async placeBet(input: { betId?: string; playerId: string; gameId: string; roundId: string; betType: string; betValue: Record<string, unknown>; amount: number; idempotencyKey?: string }) {
    const amountUnits = this.wholeTokensToUnits(input.amount);
    const idempotencyKey = this.newIdempotencyKey(input.idempotencyKey);
    const betId = input.betId ?? this.idempotencyUuid(idempotencyKey);
    const { data: wallet, error } = await this.supabase.getClient()
      .from('wallets')
      .select('id')
      .eq('user_id', input.playerId)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!wallet) throw new NotFoundException('Player wallet not found');

    return this.rpc('finance_place_bet_atomic', {
      p_bet_id: betId,
      p_player_id: input.playerId,
      p_game_key: input.gameId,
      p_round_id: input.roundId,
      p_bet_data: { ...input.betValue, bet_type: input.betType },
      p_amount: amountUnits,
      p_idempotency_key: idempotencyKey,
      p_request_hash: this.requestHash({ ...input, betId, amountUnits, idempotencyKey }),
      p_wallet_id: wallet.id,
    });
  }

  async placeCrashBet(input: { betId: string; playerId: string; roundId: string; amount: number; autoCashoutMultiplier?: number; idempotencyKey?: string }) {
    const amountUnits = this.wholeTokensToUnits(input.amount);
    const idempotencyKey = this.newIdempotencyKey(input.idempotencyKey);
    return this.rpc('finance_place_crash_bet_atomic', {
      p_bet_id: input.betId,
      p_player_id: input.playerId,
      p_round_id: input.roundId,
      p_amount: amountUnits,
      p_auto_cashout_multiplier: input.autoCashoutMultiplier ?? null,
      p_idempotency_key: idempotencyKey,
      p_request_hash: this.requestHash({ ...input, amountUnits, idempotencyKey }),
    });
  }

  async settleBet(input: { betId: string; outcome: 'WIN' | 'LOSS' | 'TIE' | 'CASHOUT' | 'VOID'; returnUnits: number; idempotencyKey?: string }) {
    if (!Number.isSafeInteger(input.returnUnits) || input.returnUnits < 0) throw new BadRequestException('Invalid settlement return');
    const idempotencyKey = this.newIdempotencyKey(input.idempotencyKey);
    return this.rpc('finance_settle_bet_atomic', {
      p_bet_id: input.betId,
      p_outcome: input.outcome,
      p_return_units: input.returnUnits,
      p_idempotency_key: idempotencyKey,
      p_request_hash: this.requestHash({ ...input, idempotencyKey }),
    });
  }

  async crashCashout(input: { betId: string; cashoutMultiplier: number; idempotencyKey?: string }) {
    const idempotencyKey = input.idempotencyKey ?? `crash-cashout:${input.betId}`;
    return this.rpc('finance_crash_cashout_atomic', {
      p_bet_id: input.betId,
      p_cashout_multiplier: input.cashoutMultiplier,
      p_idempotency_key: idempotencyKey,
      p_request_hash: this.requestHash({ ...input, idempotencyKey }),
    });
  }

  async createWallet(userId: string, walletId: string) {
    return this.rpc('finance_create_wallet', { p_user_id: userId, p_wallet_id: walletId });
  }

  async transfer(input: { fromUserId: string; toUserId: string; amount: number; operation?: string; idempotencyKey?: string; auditAction?: string }) {
    throw new BadRequestException('Direct wallet transfer is disabled; use the approved recharge flow');
  }

  async createRechargeRequest(requesterId: string, targetUserId: string, amount: number, idempotencyKey?: string) {
    return this.rpc('finance_create_recharge_request', {
      p_requester_id: requesterId,
      p_target_user_id: targetUserId,
      p_amount_units: this.wholeTokensToUnits(amount),
      p_idempotency_key: this.newIdempotencyKey(idempotencyKey),
    });
  }

  async approveRecharge(requestId: string, actorId: string, idempotencyKey?: string) {
    const key = this.newIdempotencyKey(idempotencyKey);
    return this.rpc('finance_approve_recharge_atomic', {
      p_request_id: requestId,
      p_actor_id: actorId,
      p_idempotency_key: key,
      p_request_hash: this.requestHash({ requestId, actorId, key }),
    });
  }

  async advanceCrashRound(input: { roundId: string; newStatus: string; currentMultiplier?: number; crashedAt?: Date; resultData?: any }) {
    return this.rpc('finance_advance_crash_round', {
      p_round_id: input.roundId,
      p_new_status: input.newStatus,
      p_current_multiplier: input.currentMultiplier ?? null,
      p_crashed_at: input.crashedAt?.toISOString() ?? null,
      p_result_data: input.resultData ?? null,
    });
  }

  async generateCrashPoint(roundId: string, gameKey: string) {
    return this.rpc('finance_generate_crash_point', { p_round_id: roundId, p_game_key: gameKey });
  }

  async recoverCrashRound(roundId: string) {
    return this.rpc('finance_recover_crash_round', { p_round_id: roundId });
  }

  async autoSettleCrashRound(roundId: string) {
    return this.rpc('finance_auto_settle_crash_round', { p_round_id: roundId });
  }

  private async rpc(name: string, params: Record<string, unknown>) {
    const { data, error } = await this.supabase.getClient().rpc(name, params);
    if (!error) return data;
    if (/insufficient|closed|invalid|idempotency|required|not pending|not eligible|disabled/i.test(error.message)) throw new BadRequestException(error.message);
    throw new InternalServerErrorException(`Financial operation failed: ${error.message}`);
  }
}
