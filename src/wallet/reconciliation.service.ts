import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service.js';
import { FinancialService } from './financial.service.js';

export interface ReconciliationResult {
  walletId: string;
  userId: string;
  walletBalanceUnits: number;
  ledgerBalanceUnits: number;
  difference: number;
  isConsistent: boolean;
  checkedAt: string;
}

export interface WalletReconciliationSummary {
  totalWallets: number;
  consistent: number;
  inconsistent: number;
  details: ReconciliationResult[];
  checkedAt: string;
}

@Injectable()
export class ReconciliationService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly financial: FinancialService,
  ) {}

  async reconcileWallet(walletId: string): Promise<ReconciliationResult> {
    const client = this.supabase.getClient();

    // Get wallet current balance
    const { data: wallet, error: walletError } = await client
      .from('wallets')
      .select('id, user_id, balance_units')
      .eq('id', walletId)
      .maybeSingle();

    if (walletError) {
      throw new InternalServerErrorException(walletError.message);
    }

    if (!wallet) {
      throw new InternalServerErrorException('Wallet not found');
    }

    // Calculate balance from ledger
    const { data: ledgerSum, error: ledgerError } = await client
      .from('wallet_transactions')
      .select('amount')
      .eq('wallet_id', walletId);

    if (ledgerError) {
      throw new InternalServerErrorException(ledgerError.message);
    }

    const ledgerBalanceUnits = (ledgerSum ?? []).reduce(
      (sum, tx) => sum + Number(tx.amount),
      0,
    );

    const walletBalanceUnits = Number(wallet.balance_units);
    const difference = walletBalanceUnits - ledgerBalanceUnits;

    return {
      walletId: wallet.id,
      userId: wallet.user_id,
      walletBalanceUnits,
      ledgerBalanceUnits,
      difference,
      isConsistent: difference === 0,
      checkedAt: new Date().toISOString(),
    };
  }

  async reconcileAllWallets(): Promise<WalletReconciliationSummary> {
    const client = this.supabase.getClient();

    const { data: wallets, error } = await client
      .from('wallets')
      .select('id, user_id, balance_units');

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    const details: ReconciliationResult[] = [];
    let consistent = 0;
    let inconsistent = 0;

    for (const wallet of wallets ?? []) {
      const result = await this.reconcileWallet(wallet.id);
      details.push(result);
      if (result.isConsistent) {
        consistent++;
      } else {
        inconsistent++;
      }
    }

    return {
      totalWallets: wallets?.length ?? 0,
      consistent,
      inconsistent,
      details,
      checkedAt: new Date().toISOString(),
    };
  }

  async reconcileGameWallet(gameKey: string): Promise<{
    gameWalletId: string;
    gameKey: string;
    poolBalanceUnits: number;
    ledgerBalanceUnits: number;
    difference: number;
    isConsistent: boolean;
    checkedAt: string;
  }> {
    const client = this.supabase.getClient();

    const { data: pool, error: poolError } = await client
      .from('game_wallets')
      .select('id, game_id, balance_units')
      .eq('game_id', gameKey)
      .maybeSingle();

    if (poolError) {
      throw new InternalServerErrorException(poolError.message);
    }

    if (!pool) {
      throw new InternalServerErrorException('Game wallet not found');
    }

    const { data: ledgerSum, error: ledgerError } = await client
      .from('wallet_transactions')
      .select('amount')
      .eq('game_wallet_id', pool.id);

    if (ledgerError) {
      throw new InternalServerErrorException(ledgerError.message);
    }

    const ledgerBalanceUnits = (ledgerSum ?? []).reduce(
      (sum, tx) => sum + Number(tx.amount),
      0,
    );

    const poolBalanceUnits = Number(pool.balance_units);
    const difference = poolBalanceUnits - ledgerBalanceUnits;

    return {
      gameWalletId: pool.id,
      gameKey: pool.game_id,
      poolBalanceUnits,
      ledgerBalanceUnits,
      difference,
      isConsistent: difference === 0,
      checkedAt: new Date().toISOString(),
    };
  }

  async reconcileAllGameWallets(): Promise<{
    total: number;
    consistent: number;
    inconsistent: number;
    details: Array<{
      gameWalletId: string;
      gameKey: string;
      poolBalanceUnits: number;
      ledgerBalanceUnits: number;
      difference: number;
      isConsistent: boolean;
      checkedAt: string;
    }>;
    checkedAt: string;
  }> {
    const client = this.supabase.getClient();

    const { data: pools, error } = await client
      .from('game_wallets')
      .select('id, game_id, balance_units');

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    const details = [];
    let consistent = 0;
    let inconsistent = 0;

    for (const pool of pools ?? []) {
      const result = await this.reconcileGameWallet(pool.game_id);
      details.push(result);
      if (result.isConsistent) {
        consistent++;
      } else {
        inconsistent++;
      }
    }

    return {
      total: pools?.length ?? 0,
      consistent,
      inconsistent,
      details,
      checkedAt: new Date().toISOString(),
    };
  }
}
