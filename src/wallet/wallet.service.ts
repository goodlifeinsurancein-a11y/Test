import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service.js';

@Injectable()
export class WalletService {
  constructor(private readonly supabase: SupabaseService) {}

  async getMyWallet(userId: string) {
    const client = this.supabase.getClient();
    const { data: profile, error: profileError } = await client
      .from('users')
      .select('id, role, status')
      .eq('id', userId)
      .maybeSingle();

    if (profileError) throw new InternalServerErrorException(profileError.message);
    if (!profile) throw new NotFoundException('User profile not found');
    if (profile.status !== 'ACTIVE') throw new ForbiddenException('User account is not active');

    const { data: wallet, error: walletError } = await client
      .from('wallets')
      .select('id, wallet_id, user_id, balance_units, version, created_at, updated_at')
      .eq('user_id', userId)
      .maybeSingle();

    if (walletError) throw new InternalServerErrorException(walletError.message);
    if (!wallet) throw new NotFoundException('Wallet not found');
    if (wallet.user_id !== userId) throw new ForbiddenException('Wallet access denied');

    return {
      success: true,
      wallet: {
        ...wallet,
        balance_units: String(wallet.balance_units),
        balance: this.unitsToDisplay(wallet.balance_units),
      },
    };
  }

  async getWalletById(userId: string, walletId: string) {
    const { data: wallet, error } = await this.supabase
      .getClient()
      .from('wallets')
      .select('id, wallet_id, user_id, balance_units, version, created_at, updated_at')
      .eq('wallet_id', walletId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException(error.message);
    if (!wallet) throw new NotFoundException('Wallet not found');
    if (wallet.user_id !== userId) throw new ForbiddenException('You cannot access this wallet');

    return {
      success: true,
      wallet: {
        ...wallet,
        balance_units: String(wallet.balance_units),
        balance: this.unitsToDisplay(wallet.balance_units),
      },
    };
  }

  /**
   * Direct wallet debit/credit endpoints were legacy mutation paths.
   * Financial mutations must go through game/recharge atomic RPCs so the
   * wallet ledger and idempotency records are always written together.
   */
  async debitAtomic(): Promise<never> {
    throw new ForbiddenException('Direct wallet debit is disabled; use an atomic financial operation');
  }

  async creditAtomic(): Promise<never> {
    throw new ForbiddenException('Direct wallet credit is disabled; use an atomic financial operation');
  }

  private unitsToDisplay(units: number | string): string {
    const value = BigInt(units);
    return `${value / 10n}${value % 10n === 0n ? '' : `.${value % 10n}`}`;
  }
}
