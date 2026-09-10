import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { FinancialService } from '../wallet/financial.service.js';
import { SupabaseService } from '../supabase/supabase.service.js';

@Injectable()
export class FinancialCoinService {
  constructor(private readonly financial: FinancialService, private readonly supabase: SupabaseService) {}

  async getMyBalance(userId: string) {
    const { data, error } = await this.supabase.getClient().from('wallets').select('id,wallet_id,user_id,balance_units,version,created_at,updated_at').eq('user_id', userId).maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException('Wallet not found');
    return { success: true, account: { ...data, balance: this.financial.unitsToDisplay(data.balance_units), balance_units: String(data.balance_units) } };
  }

  async createRechargeRequest(requesterId: string, targetUserId: string, amount: number, idempotencyKey?: string) {
    if (requesterId === targetUserId) {
      throw new BadRequestException('Requester and target cannot be the same user');
    }
    return { success: true, request: await this.financial.createRechargeRequest(requesterId, targetUserId, amount, idempotencyKey) };
  }

  async approveRechargeRequest(actorId: string, requestId: string, idempotencyKey?: string) {
    return { success: true, request: await this.financial.approveRecharge(requestId, actorId, idempotencyKey) };
  }

  async getRechargeRequests(userId: string) {
    const { data, error } = await this.supabase.getClient().from('coin_recharge_requests').select('id,requester_id,target_user_id,amount_units,status,approved_by,rejection_reason,created_at,decided_at').or(`requester_id.eq.${userId},target_user_id.eq.${userId}`).order('created_at', { ascending: false });
    if (error) throw new InternalServerErrorException(error.message);
    return { success: true, requests: (data ?? []).map((request) => ({ ...request, amount: this.financial.unitsToDisplay(request.amount_units), amount_units: String(request.amount_units) })) };
  }
}
