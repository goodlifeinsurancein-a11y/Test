import { BadRequestException, Injectable, InternalServerErrorException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { FinancialService } from '../wallet/financial.service.js';
import { SupabaseService } from '../supabase/supabase.service.js';
import { EventBusService } from '../events/event-bus.service.js';
import { CrashPersistentEngine } from './crash/crash.persistent.engine.js';
import { TeenPattiRoundEngine } from './teen-patti/teen-patti.round.engine.js';
import { DiceRoundEngine } from './dice/dice.round.engine.js';
import { DragonTigerRoundEngine } from './dragon-tiger/dragon-tiger.round.engine.js';
import { AndarBaharRoundEngine } from './andar-bahar/andar-bahar.round.engine.js';
import { ColorPredictionRoundEngine } from './color-prediction/color-prediction.round.engine.js';
import { NumberPredictionRoundEngine } from './number-prediction/number-prediction.round.engine.js';
import { WheelRoundEngine } from './wheel/wheel.round.engine.js';
import { JackpotRoundEngine } from './jackpot/jackpot.round.engine.js';
import { PlinkoRoundEngine } from './plinko/plinko.round.engine.js';
import { PokerRoundEngine } from './poker/poker.round.engine.js';
import { BaccaratRoundEngine } from './baccarat/baccarat.round.engine.js';
import { HiLoRoundEngine } from './hi-lo/hi-lo.round.engine.js';
import { KenoRoundEngine } from './keno/keno.round.engine.js';

type GameId =
  | 'TEEN_PATTI'
  | 'CRASH'
  | 'DICE'
  | 'DRAGON_TIGER'
  | 'ANDAR_BAHAR'
  | 'COLOR_PREDICTION'
  | 'NUMBER_PREDICTION'
  | 'WHEEL'
  | 'JACKPOT'
  | 'PLINKO'
  | 'POKER'
  | 'BACCARAT'
  | 'HI_LO'
  | 'KENO';

type Engine = {
  start(): Promise<unknown>;
  stop(): void;
  getState(): Promise<any>;
  getLastCompletedRound?: () => Promise<any>;
  placeBet(playerId: string, bet: any): Promise<any>;
  cashOut?: (betId: string, multiplier: number) => Promise<any>;
};

const GAME_NAMES: Record<string, GameId> = {
  'teen-patti': 'TEEN_PATTI',
  crash: 'CRASH',
  dice: 'DICE',
  'dragon-tiger': 'DRAGON_TIGER',
  'andar-bahar': 'ANDAR_BAHAR',
  'color-prediction': 'COLOR_PREDICTION',
  'number-prediction': 'NUMBER_PREDICTION',
  wheel: 'WHEEL',
  jackpot: 'JACKPOT',
  plinko: 'PLINKO',
  poker: 'POKER',
  baccarat: 'BACCARAT',
  'hi-lo': 'HI_LO',
  keno: 'KENO',
};

/**
 * Transport/persistence adapter around the game engines.
 * Financial correctness is guaranteed by PostgreSQL RPCs.
 * In-memory engines are caches only.
 */
@Injectable()
export class IntegratedGamesService implements OnModuleInit, OnModuleDestroy {
  private readonly engines: Record<GameId, Engine>;
  private syncTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly financial: FinancialService,
    private readonly supabase: SupabaseService,
    private readonly events: EventBusService,
  ) {
    this.engines = {
      TEEN_PATTI: new TeenPattiRoundEngine() as unknown as Engine,
      CRASH: new CrashPersistentEngine(this.supabase, this.financial) as unknown as Engine,
      DICE: new DiceRoundEngine() as unknown as Engine,
      DRAGON_TIGER: new DragonTigerRoundEngine() as unknown as Engine,
      ANDAR_BAHAR: new AndarBaharRoundEngine() as unknown as Engine,
      COLOR_PREDICTION: new ColorPredictionRoundEngine() as unknown as Engine,
      NUMBER_PREDICTION: new NumberPredictionRoundEngine() as unknown as Engine,
      WHEEL: new WheelRoundEngine() as unknown as Engine,
      JACKPOT: new JackpotRoundEngine() as unknown as Engine,
      PLINKO: new PlinkoRoundEngine() as unknown as Engine,
      POKER: new PokerRoundEngine() as unknown as Engine,
      BACCARAT: new BaccaratRoundEngine() as unknown as Engine,
      HI_LO: new HiLoRoundEngine() as unknown as Engine,
      KENO: new KenoRoundEngine() as unknown as Engine,
    };
  }

  async onModuleInit(): Promise<void> {
    // Mark interrupted rounds for recovery
    const { error } = await this.supabase.getClient().rpc('finance_mark_interrupted_rounds_for_recovery');
    if (error) throw new InternalServerErrorException(`Financial recovery check failed: ${error.message}`);

    // Start all engines
    for (const gameId of Object.values(GAME_NAMES)) {
      await this.engines[gameId].start();
    }

    // Periodic sync for non-Crash games (Crash uses persistent engine)
    this.syncTimer = setInterval(() => void this.syncNonCrashGames(), 5000); // 5s instead of 100ms
    await this.syncNonCrashGames();
  }

  onModuleDestroy(): void {
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.syncTimer = null;
    for (const engine of Object.values(this.engines)) engine.stop();
  }

  gameId(slug: string): GameId {
    const id = GAME_NAMES[slug];
    if (!id) throw new BadRequestException('Unknown game');
    return id;
  }

  getPublicState(slug: string) {
    return this.engines[this.gameId(slug)].getState();
  }

  async history(slug: string) {
    const gameId = this.gameId(slug);
    const { data, error } = await this.supabase.getClient().from('game_rounds')
      .select('id,round_number,status,result_data,started_at,result_at,completed_at')
      .eq('game_key', gameId.toLowerCase())
      .not('result_data', 'is', null)
      .order('round_number', { ascending: false })
      .limit(50);
    if (error) throw new InternalServerErrorException(error.message);
    return { success: true, rounds: data ?? [] };
  }

  async placeBet(slug: string, playerId: string, body: Record<string, unknown>, idempotencyKey?: string) {
    const gameId = this.gameId(slug);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Invalid bet payload');
    const engine = this.engines[gameId];
    const state = await engine.getState();
    const amount = body.amount;
    if (!state || state.status !== 'BETTING') throw new BadRequestException('Betting is closed');
    if (!Number.isSafeInteger(amount) || (amount as number) <= 0) throw new BadRequestException('Amount must be a positive whole number');
    const key = this.financial.newIdempotencyKey(idempotencyKey);
    const requestHash = this.financial.requestHash({ ...body, amount, idempotencyKey: key, gameId, roundId: state.roundId });

    // Place bet in engine
    const engineBet = this.toEngineBet(gameId, key, body);
    const placed = await engine.placeBet(playerId, engineBet);

    // Persist bet to database via financial RPC
    const betData = this.toEngineBetData(gameId, body);
    const betType = this.getBetType(gameId, body);
    const saved = await this.financial.placeBet({
      betId: placed.betId,
      playerId,
      gameId: gameId.toLowerCase(),
      roundId: state.roundId,
      betType,
      betValue: betData,
      amount: Number(amount),
      idempotencyKey: key,
    });

    // Check if new round needs to be opened
    if (state.roundId !== (await engine.getState())?.roundId) {
      const newState = await engine.getState();
      await this.financial.openRound({
        roundId: newState.roundId,
        gameId: gameId.toLowerCase(),
        roundNumber: newState.roundNumber,
        status: 'BETTING',
        startedAt: new Date(newState.startedAt),
        bettingEndsAt: new Date(newState.bettingEndsAt),
        recoveryData: { lifecycle: gameId.toLowerCase() },
      });
      this.events.publish({
        eventName: 'ROUND_STARTED',
        game: gameId,
        roundId: newState.roundId,
        roundNumber: newState.roundNumber,
        timestamp: new Date().toISOString(),
        data: { status: 'BETTING' },
      });
    }

    // Persist result if available
    const result = state.result ?? state.diceResult ?? state.crashResult;
    if (result) {
      const { error } = await this.supabase.getClient().rpc('finance_record_round_result', {
        p_round_id: state.roundId,
        p_status: state.status,
        p_result_data: result,
        p_result_at: new Date(state.resultAt ?? state.rolledAt ?? state.crashedAt ?? Date.now()).toISOString(),
        p_completed_at: state.completedAt ? new Date(state.completedAt).toISOString() : null,
      });
      if (error) throw new InternalServerErrorException(`Failed to persist ${gameId} result: ${error.message}`);
    }

    // Persist settlements
    for (const settlement of this.settlements(state)) {
      const betId = String(settlement.betId);
      if (!betId) {
        throw new InternalServerErrorException('Settlement missing betId');
      }
      const persistedBetId = await this.lookupBetId(state.roundId, betId);

      const outcome = settlement.status === 'WIN' ? 'WIN' : settlement.status === 'TIE' ? 'TIE' : 'LOSS';
      await this.financial.settleBet({
        betId: persistedBetId,
        outcome,
        returnUnits: this.engineReturnToUnits(settlement.totalReturn),
        idempotencyKey: `${gameId.toLowerCase()}:${state.roundId}:${persistedBetId}:settlement`,
      });
    }

    return { success: true, bet: saved };
  }

  async cashout(slug: string, playerId: string, betId: string, multiplier: number, idempotencyKey?: string) {
    if (slug !== 'crash') throw new BadRequestException('Cashout is only available for Crash');
    const engine = this.engines['CRASH'];
    const state = await engine.getState();
    if (!state) throw new BadRequestException('No active round');
    const key = this.financial.newIdempotencyKey(idempotencyKey);
    return this.financial.crashCashout({ betId, cashoutMultiplier: multiplier, idempotencyKey: key });
  }

  private settlements(state: any): any[] {
    if (Array.isArray(state.settlements)) return state.settlements;
    if (Array.isArray(state.outcomes)) return state.outcomes.map((outcome: any) => ({ betId: outcome.bet.betId, status: outcome.won ? 'WIN' : 'LOSS', totalReturn: outcome.totalReturn }));
    return [];
  }

  private engineReturnToUnits(totalReturn: unknown): number {
    if (typeof totalReturn !== 'number' || !Number.isFinite(totalReturn)) throw new InternalServerErrorException('Invalid engine return');
    // Use exact rounding to handle floating-point precision from engine's 2-decimal rounding
    const units = Math.round(totalReturn * 10);
    if (!Number.isSafeInteger(units)) throw new InternalServerErrorException('Locked engine return is not representable in approved deci-token accounting');
    return units;
  }

  private async lookupBetId(roundId: string, betId: string): Promise<string> {
    const { data, error } = await this.supabase.getClient()
      .from('game_bets')
      .select('id')
      .eq('round_id', roundId)
      .eq('id', betId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException(error.message);
    if (!data) {
      throw new InternalServerErrorException('Missing persisted bet mapping for betId: ' + betId);
    }
    return data.id;
  }

  private toEngineBet(gameId: GameId, betId: string, body: Record<string, unknown>): any {
    const amount = body.amount;
    switch (gameId) {
      case 'TEEN_PATTI':
        return { amount };
      case 'DICE':
        return { type: body.type, ...(body.value === undefined ? {} : { value: body.value }), amount };
      case 'CRASH':
        return { betId, amount, ...(body.autoCashoutMultiplier === undefined ? {} : { autoCashoutMultiplier: body.autoCashoutMultiplier }) };
      case 'DRAGON_TIGER':
      case 'ANDAR_BAHAR':
      case 'COLOR_PREDICTION':
        return { betId, type: body.type, amount };
      case 'NUMBER_PREDICTION':
        return { betId, number: body.number, amount };
      case 'WHEEL':
        return body.type === 'NUMBER'
          ? { betId, type: 'NUMBER', number: body.number, amount }
          : { betId, type: 'COLOR', color: body.color, amount };
      case 'JACKPOT':
        return { betId, numbers: body.numbers, amount };
      case 'PLINKO':
        return { betId, amount, rows: body.rows };
      case 'POKER':
        return { betId, amount, hold: body.hold };
      case 'BACCARAT':
        return { betId, type: body.type, amount };
      case 'HI_LO':
        return { betId, choice: body.choice, amount };
      case 'KENO':
        return { betId, picks: body.picks, amount };
      default:
        return { amount };
    }
  }

  private getBetType(gameId: GameId, body: Record<string, unknown>): string {
    switch (gameId) {
      case 'TEEN_PATTI':
        return 'ANTE';
      case 'DICE':
        return body.type as string;
      case 'DRAGON_TIGER':
      case 'ANDAR_BAHAR':
      case 'COLOR_PREDICTION':
        return body.type as string;
      case 'NUMBER_PREDICTION':
        return 'NUMBER';
      case 'WHEEL':
        return body.type as string;
      case 'JACKPOT':
        return 'PICK';
      case 'PLINKO':
        return 'DROP';
      case 'POKER':
        return 'DRAW';
      case 'BACCARAT':
        return body.type as string;
      case 'HI_LO':
        return body.choice as string;
      case 'KENO':
        return 'PICK';
      default:
        return 'ANTE';
    }
  }

  private toEngineBetData(gameId: GameId, body: Record<string, unknown>): Record<string, unknown> {
    switch (gameId) {
      case 'TEEN_PATTI':
        return {};
      case 'DICE':
        return { type: body.type, ...(body.value === undefined ? {} : { value: body.value }) };
      case 'DRAGON_TIGER':
      case 'ANDAR_BAHAR':
      case 'COLOR_PREDICTION':
        return { type: body.type };
      case 'NUMBER_PREDICTION':
        return { number: body.number };
      case 'WHEEL':
        return body.type === 'NUMBER'
          ? { type: 'NUMBER', number: body.number }
          : { type: 'COLOR', color: body.color };
      case 'JACKPOT':
        return { numbers: body.numbers };
      case 'PLINKO':
        return { rows: body.rows };
      case 'POKER':
        return { hold: body.hold };
      case 'BACCARAT':
        return { type: body.type };
      case 'HI_LO':
        return { choice: body.choice };
      case 'KENO':
        return { picks: body.picks };
      default:
        return {};
    }
  }

  private async syncNonCrashGames(): Promise<void> {
    for (const gameId of Object.values(GAME_NAMES)) {
      if (gameId === 'CRASH') continue;
      await this.syncGame(gameId);
    }
  }

  private async syncGame(gameId: GameId): Promise<void> {
    const engine = this.engines[gameId];
    const state = await engine.getState();
    if (!state || state.status === 'BETTING') return;

    // Persist round if not yet persisted
    const { data: existingRound, error: roundError } = await this.supabase.getClient()
      .from('game_rounds')
      .select('id, status')
      .eq('id', state.roundId)
      .maybeSingle();

    if (roundError) throw new InternalServerErrorException(roundError.message);

    if (!existingRound) {
      await this.financial.openRound({
        roundId: state.roundId,
        gameId: gameId.toLowerCase(),
        roundNumber: state.roundNumber,
        status: 'BETTING',
        startedAt: new Date(state.startedAt),
        bettingEndsAt: new Date(state.bettingEndsAt),
        recoveryData: { lifecycle: gameId.toLowerCase() },
      });
      this.events.publish({
        eventName: 'ROUND_STARTED',
        game: gameId,
        roundId: state.roundId,
        roundNumber: state.roundNumber,
        timestamp: new Date().toISOString(),
        data: { status: 'BETTING' },
      });
    }

    // Persist result if available
    const result = state.result ?? state.diceResult ?? state.crashResult;
    if (result) {
      const { error } = await this.supabase.getClient().rpc('finance_record_round_result', {
        p_round_id: state.roundId,
        p_status: state.status,
        p_result_data: result,
        p_result_at: new Date(state.resultAt ?? state.rolledAt ?? state.crashedAt ?? Date.now()).toISOString(),
        p_completed_at: state.completedAt ? new Date(state.completedAt).toISOString() : null,
      });
      if (error) throw new InternalServerErrorException(`Failed to persist ${gameId} result: ${error.message}`);
    }

    // Persist settlements
    for (const settlement of this.settlements(state)) {
      const betId = String(settlement.betId);
      if (!betId) {
        throw new InternalServerErrorException('Settlement missing betId');
      }
      const persistedBetId = await this.lookupBetId(state.roundId, betId);

      const outcome = settlement.status === 'WIN' ? 'WIN' : settlement.status === 'TIE' ? 'TIE' : 'LOSS';
      await this.financial.settleBet({
        betId: persistedBetId,
        outcome,
        returnUnits: this.engineReturnToUnits(settlement.totalReturn),
        idempotencyKey: `${gameId.toLowerCase()}:${state.roundId}:${persistedBetId}:settlement`,
      });
    }
  }
}
