import {
  Inject,
  Module,
  OnModuleInit,
} from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { WalletModule } from '../wallet/wallet.module.js';
import { FinancialRouletteService } from './roulette/financial-roulette.service.js';
import { RouletteEngine } from './roulette/roulette.engine.js';
import { FinancialRouletteController } from './roulette/financial-roulette.controller.js';
import { SupabaseService } from '../supabase/supabase.service.js';
import { EventBusModule } from '../events/event-bus.module.js';
import { EventBusService } from '../events/event-bus.service.js';
import { IntegratedGamesService } from './integrated-games.service.js';
import { IntegratedGamesController } from './integrated-games.controller.js';

@Module({
  imports: [AuthModule, WalletModule, EventBusModule],
  controllers: [FinancialRouletteController, IntegratedGamesController],
  providers: [RouletteEngine, FinancialRouletteService, IntegratedGamesService],
  exports: [RouletteEngine, FinancialRouletteService],
})
export class GameModule implements OnModuleInit {
  constructor(
    @Inject(RouletteEngine) private readonly rouletteEngine: RouletteEngine,
    @Inject(FinancialRouletteService) private readonly rouletteService: FinancialRouletteService,
    @Inject(SupabaseService) private readonly supabase: SupabaseService,
    @Inject(EventBusService) private readonly eventBus: EventBusService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.eventBus.subscribe('BET_PLACED', (event) => {
      console.log('[EventBus] BET_PLACED:', event);
    });

    this.eventBus.subscribe('ROUND_STARTED', (event) => {
      console.log('[EventBus] ROUND_STARTED:', event);
    });

    this.eventBus.subscribe('ROUND_LOCKED', (event) => {
      console.log('[EventBus] ROUND_LOCKED:', event);
    });

    this.eventBus.subscribe('ROUND_RESULT', (event) => {
      console.log('[EventBus] ROUND_RESULT:', event);
    });

    this.eventBus.subscribe('BET_WON', (event) => {
      console.log('[EventBus] BET_WON:', event);
    });

    this.eventBus.subscribe('BET_LOST', (event) => {
      console.log('[EventBus] BET_LOST:', event);
    });

    this.eventBus.subscribe('ROUND_COMPLETED', (event) => {
      console.log('[EventBus] ROUND_COMPLETED:', event);
    });

    await this.rouletteService.initialise();

    const { data, error } = await this.supabase
      .getClient()
      .from('roulette_rounds')
      .select('round_number')
      .order('round_number', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(
        `Failed to load last roulette round number: ${error.message}`,
      );
    }

    const lastRoundNumber = data?.round_number
      ? Number(data.round_number)
      : 0;

    this.rouletteEngine.setNextRoundNumber(
      lastRoundNumber + 1,
    );

    console.log(
      `[Roulette] Starting from round #${lastRoundNumber + 1}`,
    );

    this.rouletteEngine.start();
  }
}
