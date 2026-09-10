import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service.js';
import { FinancialService } from '../../wallet/financial.service.js';
import { CrashEngine } from './crash.engine.js';
import {
  CrashBetInput,
  CrashBetStatus,
  CrashRound,
  CrashRoundStatus,
  CrashSettlement,
  CrashResult,
  CompletedCrashRound,
} from './crash.types.js';

/**
 * Persistent Crash game coordinator.
 * All authoritative state lives in PostgreSQL.
 * In-memory state is a cache only.
 */
@Injectable()
export class CrashPersistentEngine {
  readonly BETTING_MS = 15_000;
  readonly TICK_MS = 100;
  readonly MULTIPLIER_INCREMENT = 0.01;
  readonly CRASH_MS = 1_000;
  readonly RESULT_MS = 5_000;

  private multiplierTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private currentRoundId: string | null = null;
  private cachedRound: CrashRound | null = null;

  private readonly instanceId = crypto.randomUUID();

  constructor(
    private readonly supabase: SupabaseService,
    private readonly financial: FinancialService,
    private readonly crashEngine = new CrashEngine(),
  ) {}

  /**
   * Start the engine - recovers any interrupted round or starts a new one
   */
  async start(): Promise<CrashRound> {
    if (this.running) {
      throw new Error('Crash persistent engine is already running');
    }

    this.running = true;

    // Try to recover interrupted round
    const recovered = await this.recoverInterruptedRound();
    if (recovered) {
      this.currentRoundId = recovered.roundId;
      this.cachedRound = recovered;
      this.startRoundTimers(recovered);
      return recovered;
    }

    // No interrupted round - start new round
    return this.startNewRound();
  }

  /**
   * Stop the engine gracefully
   */
  async stop(): Promise<void> {
    this.running = false;
    this.clearTimers();
    this.currentRoundId = null;
    this.cachedRound = null;
    // Release engine lease
    try {
      await this.supabase.getClient().rpc('finance_release_engine_lease', {
        p_instance_id: this.instanceId,
      });
    } catch {}
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get current round state (from cache or DB)
   */
  async getState(): Promise<CrashRound | null> {
    if (!this.currentRoundId) return null;

    if (this.cachedRound) {
      return this.toPublicRound(this.cachedRound);
    }

    // Fallback to DB
    return this.loadRoundFromDB(this.currentRoundId);
  }

  /**
   * Get last completed round
   */
  async getLastCompletedRound(): Promise<CompletedCrashRound | null> {
    const { data, error } = await this.supabase.getClient()
      .from('game_rounds')
      .select('*')
      .eq('game_key', 'crash')
      .eq('status', 'COMPLETED')
      .order('round_number', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new InternalServerErrorException(error.message);
    if (!data) return null;

    const settlements = await this.loadSettlements(data.id);
    return this.toCompletedRound(data, settlements);
  }

  /**
   * Place a bet - authoritative via DB RPC
   */
  async placeBet(playerId: string, bet: CrashBetInput): Promise<CrashBetInput & { playerId: string; status: CrashBetStatus; placedAt: number }> {
    if (!this.running || !this.currentRoundId) {
      throw new Error('Engine not running or no current round');
    }

    const round = await this.getCurrentRoundWithLock();
    if (!round || round.status !== 'BETTING') {
      throw new Error('Betting is closed');
    }

    // Validate bet
    if (!playerId || typeof playerId !== 'string' || playerId.trim().length === 0) {
      throw new Error('Player id is required');
    }
    this.crashEngine.validateBet(bet);

    // Use DB RPC for atomic bet placement with idempotency
    const amountUnits = this.financial.wholeTokensToUnits(bet.amount);
    const idempotencyKey = this.financial.newIdempotencyKey();
    const betId = bet.betId;

    const result = await this.supabase.getClient().rpc('finance_place_crash_bet_atomic', {
      p_bet_id: betId,
      p_player_id: playerId,
      p_round_id: this.currentRoundId,
      p_amount: amountUnits,
      p_auto_cashout_multiplier: bet.autoCashoutMultiplier ?? null,
      p_idempotency_key: idempotencyKey,
      p_request_hash: this.financial.requestHash({ betId, playerId, amount: bet.amount, autoCashoutMultiplier: bet.autoCashoutMultiplier, idempotencyKey }),
    });

    if (!result) {
      throw new InternalServerErrorException('Failed to place bet');
    }

    // Update cache
    if (this.cachedRound) {
      const placedBet = {
        ...bet,
        playerId,
        status: 'ACTIVE' as CrashBetStatus,
        placedAt: Date.now(),
        cashedOutAt: null,
        cashoutMultiplier: null,
      };
      this.cachedRound.bets.push(placedBet);
    }

    return { ...bet, playerId, status: 'ACTIVE', placedAt: Date.now() };
  }

  /**
   * Cash out - authoritative via DB RPC with exactly-once guarantee
   */
  async cashOut(betId: string, cashoutMultiplier: number): Promise<CrashSettlement> {
    if (!this.running || !this.currentRoundId) {
      throw new Error('Engine not running or no current round');
    }

    const round = await this.getCurrentRoundWithLock();
    if (!round || round.status !== 'RUNNING') {
      throw new Error('Cashout is only allowed during RUNNING');
    }

    this.crashEngine.validateManualCashoutMultiplier(cashoutMultiplier);

    if (cashoutMultiplier > round.currentMultiplier) {
      throw new Error('Cashout multiplier cannot exceed the current multiplier');
    }

    // Use deterministic idempotency key for cashout
    const idempotencyKey = `crash-cashout:${this.currentRoundId}:${betId}`;
    const requestHash = this.financial.requestHash({ betId, cashoutMultiplier, roundId: this.currentRoundId });

    const { data: result, error } = await this.supabase.getClient().rpc('finance_crash_cashout_atomic', {
      p_bet_id: betId,
      p_cashout_multiplier: cashoutMultiplier,
      p_idempotency_key: idempotencyKey,
      p_request_hash: requestHash,
    });

    if (error) {
      throw new InternalServerErrorException(`Cashout failed: ${error.message}`);
    }

    if (!result) {
      throw new InternalServerErrorException('Cashout failed: no result returned');
    }

    // Update cache
    if (this.cachedRound) {
      const bet = this.cachedRound.bets.find(b => b.betId === betId);
      if (bet) {
        bet.status = 'CASHED_OUT';
        bet.cashoutMultiplier = cashoutMultiplier;
        bet.cashedOutAt = Date.now();
      }
      const settlement = this.crashEngine.settleCashout(
        { ...bet!, betId, amount: bet!.amount, autoCashoutMultiplier: bet!.autoCashoutMultiplier },
        bet!.playerId,
        cashoutMultiplier,
        Date.now(),
      );
      this.cachedRound.settlements.push(settlement);
    }

    const betInfo = round.bets.find(b => b.betId === betId);
    const returnUnits = result?.return_units ? Number(result.return_units) : 0;

    return {
      betId,
      playerId: betInfo?.playerId ?? '',
      status: 'WIN',
      amount: betInfo?.amount ?? 0,
      cashoutMultiplier,
      profit: returnUnits - (betInfo?.amount ?? 0),
      totalReturn: returnUnits / 10, // convert back to display
      settledAt: Date.now(),
    };
  }

  /**
   * Start a new round
   */
  private async startNewRound(): Promise<CrashRound> {
    const startedAt = new Date();
    const roundId = crypto.randomUUID();

    // Get next round number
    const { data: lastRound } = await this.supabase.getClient()
      .from('game_rounds')
      .select('round_number')
      .eq('game_key', 'crash')
      .order('round_number', { ascending: false })
      .limit(1)
      .maybeSingle();

    const roundNumber = (lastRound?.round_number ?? 0) + 1;

    // Create round in DB
    await this.supabase.getClient().rpc('finance_open_round', {
      p_round_id: roundId,
      p_game_key: 'crash',
      p_round_number: roundNumber,
      p_status: 'BETTING',
      p_started_at: startedAt.toISOString(),
      p_betting_ends_at: new Date(startedAt.getTime() + this.BETTING_MS).toISOString(),
      p_recovery_data: { lifecycle: 'crash' },
    });

    // Acquire engine lease for single-writer safety
    const leaseAcquired = await this.supabase.getClient().rpc('finance_acquire_engine_lease', {
      p_instance_id: this.instanceId,
      p_ttl_seconds: 30,
    });

    if (!leaseAcquired) {
      console.warn('Could not acquire engine lease; another instance may be processing');
    }

    this.currentRoundId = roundId;
    this.cachedRound = {
      roundId,
      roundNumber,
      status: 'BETTING',
      startedAt: startedAt.getTime(),
      bettingEndsAt: startedAt.getTime() + this.BETTING_MS,
      lockedAt: null,
      runningAt: null,
      crashedAt: null,
      resultAt: null,
      completedAt: null,
      currentMultiplier: 1,
      crashResult: null,
      bets: [],
      settlements: [],
    };

    this.startRoundTimers(this.cachedRound);
    return this.toPublicRound(this.cachedRound);
  }

  /**
   * Recover interrupted round from DB
   */
  private async recoverInterruptedRound(): Promise<CrashRound | null> {
    const { data, error } = await this.supabase.getClient()
      .from('game_rounds')
      .select('*')
      .eq('game_key', 'crash')
      .in('status', ['BETTING', 'LOCK', 'RUNNING', 'CRASH', 'RESULT'])
      .is('result_data', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new InternalServerErrorException(error.message);
    if (!data) return null;

    // Load bets and settlements
    const bets = await this.loadBets(data.id);
    const settlements = await this.loadSettlements(data.id);

    const round: CrashRound = {
      roundId: data.id,
      roundNumber: data.round_number,
      status: data.status as CrashRoundStatus,
      startedAt: new Date(data.started_at).getTime(),
      bettingEndsAt: data.betting_ends_at ? new Date(data.betting_ends_at).getTime() : 0,
      lockedAt: data.locked_at ? new Date(data.locked_at).getTime() : 0,
      runningAt: data.running_at ? new Date(data.running_at).getTime() : 0,
      crashedAt: data.crashed_at ? new Date(data.crashed_at).getTime() : 0,
      resultAt: data.result_at ? new Date(data.result_at).getTime() : 0,
      completedAt: data.completed_at ? new Date(data.completed_at).getTime() : 0,
      currentMultiplier: Number(data.current_multiplier ?? 1),
      crashResult: data.crash_point ? { crashMultiplier: Number(data.crash_point), crashedAt: data.crashed_at ? new Date(data.crashed_at).getTime() : 0 } : null,
      bets,
      settlements,
    };

    this.currentRoundId = data.id;

    // If round was in RUNNING, CRASH, or RESULT - need to handle recovery
    if (['RUNNING', 'CRASH', 'RESULT'].includes(data.status)) {
      // Crash point should already be persisted
      if (data.crash_point) {
        round.crashResult = { crashMultiplier: Number(data.crash_point), crashedAt: data.crashed_at ? new Date(data.crashed_at).getTime() : 0 };
      }
    }

    return round;
  }

  /**
   * Get current round with advisory lock
   */
  private async getCurrentRoundWithLock(): Promise<CrashRound | null> {
    if (!this.currentRoundId) return null;

    // Try to acquire advisory lock for this operation
    const { data: locked } = await this.supabase.getClient().rpc('finance_acquire_round_lock', {
      p_round_id: this.currentRoundId,
      p_game_key: 'crash',
      p_action: 'read',
    });

    if (!locked) {
      // Another instance has the lock - reload from DB
      return this.loadRoundFromDB(this.currentRoundId);
    }

    return this.cachedRound ?? this.loadRoundFromDB(this.currentRoundId);
  }

  /**
   * Load round from database
   */
  private async loadRoundFromDB(roundId: string): Promise<CrashRound | null> {
    const { data, error } = await this.supabase.getClient()
      .from('game_rounds')
      .select('*')
      .eq('id', roundId)
      .eq('game_key', 'crash')
      .maybeSingle();

    if (error) throw new InternalServerErrorException(error.message);
    if (!data) return null;

    const bets = await this.loadBets(roundId);
    const settlements = await this.loadSettlements(roundId);

    return {
      roundId: data.id,
      roundNumber: data.round_number,
      status: data.status as CrashRoundStatus,
      startedAt: new Date(data.started_at).getTime(),
      bettingEndsAt: data.betting_ends_at ? new Date(data.betting_ends_at).getTime() : 0,
      lockedAt: data.locked_at ? new Date(data.locked_at).getTime() : 0,
      runningAt: data.running_at ? new Date(data.running_at).getTime() : 0,
      crashedAt: data.crashed_at ? new Date(data.crashed_at).getTime() : 0,
      resultAt: data.result_at ? new Date(data.result_at).getTime() : 0,
      completedAt: data.completed_at ? new Date(data.completed_at).getTime() : 0,
      currentMultiplier: Number(data.current_multiplier ?? 1),
      crashResult: data.crash_point ? { crashMultiplier: Number(data.crash_point), crashedAt: data.crashed_at ? new Date(data.crashed_at).getTime() : 0 } : null,
      bets,
      settlements,
    };
  }

  /**
   * Load bets for a round
   */
  private async loadBets(roundId: string) {
    const { data, error } = await this.supabase.getClient()
      .from('game_bets')
      .select('*')
      .eq('round_id', roundId)
      .eq('game_key', 'crash')
      .order('created_at', { ascending: true });

    if (error) throw new InternalServerErrorException(error.message);

    return (data ?? []).map(bet => ({
      betId: bet.id,
      playerId: bet.player_id,
      amount: Number(bet.amount) / 10, // convert to display
      autoCashoutMultiplier: bet.bet_data?.autoCashoutMultiplier ? Number(bet.bet_data.autoCashoutMultiplier) : undefined,
      status: bet.status as CrashBetStatus,
      placedAt: new Date(bet.created_at).getTime(),
      cashedOutAt: bet.status === 'CASHED_OUT' ? new Date(bet.updated_at).getTime() : null,
      cashoutMultiplier: bet.status === 'CASHED_OUT' ? (Number(bet.payout) / 10) / (Number(bet.amount) / 10) : null,
    }));
  }

  /**
   * Load settlements for a round
   */
  private async loadSettlements(roundId: string): Promise<CrashSettlement[]> {
    const { data, error } = await this.supabase.getClient()
      .from('game_settlements')
      .select('*')
      .eq('round_id', roundId)
      .eq('game_key', 'crash')
      .order('settled_at', { ascending: true });

    if (error) throw new InternalServerErrorException(error.message);

    return (data ?? []).map(s => ({
      betId: s.bet_id,
      playerId: s.player_id,
      status: s.outcome === 'CASHED_OUT' ? 'WIN' as CrashSettlement['status'] : s.outcome === 'WON' ? 'WIN' as CrashSettlement['status'] : 'LOSS' as CrashSettlement['status'],
      amount: Number(s.stake) / 10,
      cashoutMultiplier: s.outcome === 'CASHED_OUT' ? Number(s.payout) / Number(s.stake) : null,
      profit: Number(s.profit) / 10,
      totalReturn: Number(s.payout) / 10,
      settledAt: new Date(s.settled_at).getTime(),
    }));
  }

  /**
   * Start round timers based on current state
   */
  private startRoundTimers(round: CrashRound): void {
    this.clearTimers();

    if (!this.running) return;

    const now = Date.now();

    switch (round.status) {
      case 'BETTING': {
        const timeLeft = round.bettingEndsAt - now;
        if (timeLeft > 0) {
          this.multiplierTimer = setTimeout(() => this.lockBetting(), timeLeft);
        } else {
          this.lockBetting();
        }
        break;
      }
      case 'LOCK':
        this.multiplierTimer = setTimeout(() => this.startRunning(), 0);
        break;
      case 'RUNNING':
        this.startMultiplierTimer();
        break;
      case 'CRASH':
        this.multiplierTimer = setTimeout(() => this.showResult(), this.CRASH_MS);
        break;
      case 'RESULT':
        this.multiplierTimer = setTimeout(() => this.completeRound(), this.RESULT_MS);
        break;
    }
  }

  /**
   * Lock betting phase
   */
  private async lockBetting(): Promise<void> {
    if (!this.running || !this.currentRoundId) return;

    try {
      await this.supabase.getClient().rpc('finance_advance_crash_round', {
        p_round_id: this.currentRoundId,
        p_new_status: 'LOCK',
      });

      if (this.cachedRound) {
        this.cachedRound.status = 'LOCK';
        this.cachedRound.lockedAt = Date.now();
      }

      // Immediately transition to RUNNING
      await this.startRunning();
    } catch (error) {
      console.error('Failed to lock betting:', error);
    }
  }

  /**
   * Start running phase
   */
  private async startRunning(): Promise<void> {
    if (!this.running || !this.currentRoundId) return;

    try {
      // Generate crash point and transition to RUNNING
      const result = await this.supabase.getClient().rpc('finance_advance_crash_round', {
        p_round_id: this.currentRoundId,
        p_new_status: 'RUNNING',
      });

      if (this.cachedRound) {
        this.cachedRound.status = 'RUNNING';
        this.cachedRound.runningAt = Date.now();
        this.cachedRound.currentMultiplier = 1;

        // Load the generated crash point from RPC response
        if (result.data?.crash_point) {
          this.cachedRound.crashResult = {
            crashMultiplier: Number(result.data.crash_point),
            crashedAt: 0,
          };
        } else {
          // Fallback: reload from DB to get crash_point
          const { data } = await this.supabase.getClient()
            .from('game_rounds')
            .select('crash_point')
            .eq('id', this.currentRoundId)
            .maybeSingle();
          if (data?.crash_point) {
            this.cachedRound.crashResult = {
              crashMultiplier: Number(data.crash_point),
              crashedAt: 0,
            };
          }
        }
      }

      this.startMultiplierTimer();
    } catch (error) {
      console.error('Failed to start running:', error);
    }
  }

  /**
   * Start multiplier timer
   */
  private startMultiplierTimer(): void {
    if (this.multiplierTimer) return;

    this.multiplierTimer = setInterval(async () => {
      await this.advanceMultiplier();
    }, this.TICK_MS);
  }

  /**
   * Advance multiplier - called every TICK_MS
   */
  private async advanceMultiplier(): Promise<void> {
    if (!this.running || !this.currentRoundId || !this.cachedRound) return;
    if (this.cachedRound.status !== 'RUNNING') return;

    try {
      const nextMultiplier = this.crashEngine.advanceMultiplier(
        this.cachedRound.currentMultiplier,
        this.MULTIPLIER_INCREMENT,
      );

      // Check if crashed
      if (this.cachedRound.crashResult?.crashMultiplier &&
          this.crashEngine.hasCrashed(nextMultiplier, this.cachedRound.crashResult.crashMultiplier)) {
        this.cachedRound.currentMultiplier = this.cachedRound.crashResult.crashMultiplier;
        await this.crashRound();
        return;
      }

      this.cachedRound.currentMultiplier = nextMultiplier;

      // Update DB with new multiplier (best effort, not blocking)
      try {
        await this.supabase.getClient().rpc('finance_advance_crash_round', {
          p_round_id: this.currentRoundId,
          p_new_status: 'RUNNING',
          p_current_multiplier: nextMultiplier,
        });
      } catch {
        // Non-blocking - ignore errors
      }

      this.processAutoCashouts();
    } catch (error) {
      console.error('Error advancing multiplier:', error);
    }
  }

  /**
   * Process auto-cashouts
   */
  private async processAutoCashouts(): Promise<void> {
    if (!this.cachedRound) return;

    for (const bet of this.cachedRound.bets) {
      if (
        bet.status === 'ACTIVE' &&
        bet.autoCashoutMultiplier !== undefined &&
        this.cachedRound.currentMultiplier >= bet.autoCashoutMultiplier
      ) {
        try {
          await this.cashOut(bet.betId, this.cachedRound.currentMultiplier);
        } catch (error) {
          // Auto-cashout failed, bet will be settled as loss on crash
          console.error('Auto-cashout failed:', error);
        }
      }
    }
  }

  /**
   * Crash the round
   */
  private async crashRound(): Promise<void> {
    if (!this.running || !this.currentRoundId || !this.cachedRound) return;

    if (this.multiplierTimer) {
      clearInterval(this.multiplierTimer);
      this.multiplierTimer = null;
    }

    const crashedAt = Date.now();

    try {
      await this.supabase.getClient().rpc('finance_advance_crash_round', {
        p_round_id: this.currentRoundId,
        p_new_status: 'CRASH',
        p_crashed_at: new Date(crashedAt).toISOString(),
        p_result_data: { crashMultiplier: this.cachedRound.crashResult?.crashMultiplier },
      });

      this.cachedRound.status = 'CRASH';
      this.cachedRound.crashedAt = crashedAt;
      this.cachedRound.currentMultiplier = this.cachedRound.crashResult?.crashMultiplier ?? 0;

      // Auto-settle remaining bets
      await this.supabase.getClient().rpc('finance_auto_settle_crash_round', {
        p_round_id: this.currentRoundId,
      });

      this.multiplierTimer = setTimeout(() => this.showResult(), this.CRASH_MS);
    } catch (error) {
      console.error('Failed to crash round:', error);
    }
  }

  /**
   * Show result
   */
  private async showResult(): Promise<void> {
    if (!this.running || !this.currentRoundId || !this.cachedRound) return;

    try {
      await this.supabase.getClient().rpc('finance_advance_crash_round', {
        p_round_id: this.currentRoundId,
        p_new_status: 'RESULT',
      });

      this.cachedRound.status = 'RESULT';
      this.cachedRound.resultAt = Date.now();

      this.multiplierTimer = setTimeout(() => this.completeRound(), this.RESULT_MS);
    } catch (error) {
      console.error('Failed to show result:', error);
    }
  }

  /**
   * Complete round
   */
  private async completeRound(): Promise<void> {
    if (!this.running || !this.currentRoundId || !this.cachedRound) return;

    try {
      await this.supabase.getClient().rpc('finance_advance_crash_round', {
        p_round_id: this.currentRoundId,
        p_new_status: 'COMPLETED',
      });

      this.cachedRound.status = 'COMPLETED';
      this.cachedRound.completedAt = Date.now();

      // Start next round after brief pause
      this.multiplierTimer = setTimeout(async () => {
        if (this.running) {
          await this.startNewRound();
        }
      }, 100);
    } catch (error) {
      console.error('Failed to complete round:', error);
    }
  }

  /**
   * Convert to public round (hide crash point before crash)
   */
  private toPublicRound(round: CrashRound): CrashRound {
    const revealCrash =
      round.status === 'CRASH' ||
      round.status === 'RESULT' ||
      round.status === 'COMPLETED';

    return {
      ...round,
      crashResult: revealCrash && round.crashResult
        ? { ...round.crashResult }
        : null,
      bets: round.bets.map((bet) => ({ ...bet })),
      settlements: revealCrash
        ? round.settlements.map((settlement) => ({ ...settlement }))
        : [],
    };
  }

  /**
   * Convert to completed round
   */
  private toCompletedRound(data: any, settlements: CrashSettlement[]): CompletedCrashRound {
    return {
      roundId: data.id,
      roundNumber: data.round_number,
      status: 'COMPLETED',
      startedAt: new Date(data.started_at).getTime(),
      bettingEndsAt: data.betting_ends_at ? new Date(data.betting_ends_at).getTime() : 0,
      lockedAt: data.locked_at ? new Date(data.locked_at).getTime() : 0,
      runningAt: data.running_at ? new Date(data.running_at).getTime() : 0,
      crashedAt: data.crashed_at ? new Date(data.crashed_at).getTime() : 0,
      resultAt: data.result_at ? new Date(data.result_at).getTime() : 0,
      completedAt: data.completed_at ? new Date(data.completed_at).getTime() : 0,
      currentMultiplier: Number(data.current_multiplier ?? 1),
      crashResult: data.crash_point ? { crashMultiplier: Number(data.crash_point), crashedAt: data.crashed_at ? new Date(data.crashed_at).getTime() : 0 } : { crashMultiplier: 0, crashedAt: 0 },
      bets: [],
      settlements,
    };
  }

  private clearTimers(): void {
    if (this.multiplierTimer) {
      clearInterval(this.multiplierTimer);
      this.multiplierTimer = null;
    }
  }
}
