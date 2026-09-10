import {
  BadRequestException,
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

    if (profileError) {
      throw new InternalServerErrorException(profileError.message);
    }

    if (!profile) {
      throw new NotFoundException('User profile not found');
    }

    if (profile.status !== 'ACTIVE') {
      throw new ForbiddenException('User account is not active');
    }

    const { data: wallet, error: walletError } = await client
      .from('wallets')
      .select(
        'id, wallet_id, user_id, balance, version, created_at, updated_at',
      )
      .eq('user_id', userId)
      .maybeSingle();

    if (walletError) {
      throw new InternalServerErrorException(walletError.message);
    }

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    if (wallet.user_id !== userId) {
      throw new ForbiddenException('Wallet access denied');
    }

    return {
      success: true,
      wallet,
    };
  }

  async getWalletById(userId: string, walletId: string) {
    const { data: wallet, error } = await this.supabase
      .getClient()
      .from('wallets')
      .select(
        'id, wallet_id, user_id, balance, version, created_at, updated_at',
      )
      .eq('wallet_id', walletId)
      .maybeSingle();


    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    if (wallet.user_id !== userId) {
      throw new ForbiddenException('You cannot access this wallet');
    }

    return {
      success: true,
      wallet,
    };
  }

  async debitAtomic(
    userId: string,
    walletId: string,
    amount: number,
  ) {
    this.validateAmount(amount);

    const client = this.supabase.getClient();

    const { data: wallet, error: walletError } = await client
      .from('wallets')
      .select('wallet_id, user_id')
      .eq('wallet_id', walletId)
      .maybeSingle();

    if (walletError) {
      throw new InternalServerErrorException(walletError.message);
    }

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    if (wallet.user_id !== userId) {
      throw new ForbiddenException('You cannot modify this wallet');
    }

    const { data, error } = await client.rpc('wallet_debit_atomic', {
      p_player_id: userId,
      p_amount: amount,
    });

    if (error) {
      if (error.message.toLowerCase().includes('insufficient')) {
        throw new BadRequestException('Insufficient wallet balance');
      }

      throw new InternalServerErrorException(error.message);
    }

    return {
      success: true,
      operation: 'DEBIT',
      wallet: data,
    };
  }

  async creditAtomic(
    userId: string,
    walletId: string,
    amount: number,
  ) {
    this.validateAmount(amount);

    const client = this.supabase.getClient();

    const { data: wallet, error: walletError } = await client
      .from('wallets')
      .select('wallet_id, user_id')
      .eq('wallet_id', walletId)
      .maybeSingle();

    if (walletError) {
      throw new InternalServerErrorException(walletError.message);
    }

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    if (wallet.user_id !== userId) {
      throw new ForbiddenException('You cannot modify this wallet');
    }

    const { data, error } = await client.rpc('wallet_credit_atomic', {
      p_player_id: userId,
      p_amount: amount,
    });

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    return {
      success: true,
      operation: 'CREDIT',
      wallet: data,
    };
  }

  private validateAmount(amount: number) {
    if (
      typeof amount !== 'number' ||
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      throw new BadRequestException(
        'Amount must be a finite number greater than 0',
      );
    }
  }
}
