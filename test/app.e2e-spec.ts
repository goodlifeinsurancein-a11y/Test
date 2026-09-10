import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { SupabaseService } from './../src/supabase/supabase.service.js';
import { IntegratedGamesService } from './../src/games/integrated-games.service.js';
import { GameModule } from './../src/games/game.module.js';
import { RouletteEngine } from './../src/games/roulette/roulette.engine.js';
import { FinancialRouletteService } from './../src/games/roulette/financial-roulette.service.js';

const mockQueryBuilder = {
  eq: () => mockQueryBuilder,
  maybeSingle: () => Promise.resolve({ data: { id: 'test', balance_units: 0, round_number: 1 }, error: null }),
  limit: () => mockQueryBuilder,
  order: () => mockQueryBuilder,
  not: () => mockQueryBuilder,
  is: () => mockQueryBuilder,
  single: () => Promise.resolve({ data: null, error: null }),
  in: () => mockQueryBuilder,
};

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SupabaseService)
      .useValue({
        getClient: () => ({
          rpc: (fnName: string) => {
            if (fnName === 'finance_mark_interrupted_rounds_for_recovery') {
              return Promise.resolve({ data: 0, error: null });
            }
            if (fnName === 'finance_open_round') {
              return Promise.resolve({ data: { round_id: 'test', already_exists: false }, error: null });
            }
            if (fnName === 'finance_place_crash_bet_atomic') {
              return Promise.resolve({ data: { bet_id: 'test', round_id: 'test', amount: 10, idempotent: false }, error: null });
            }
            return Promise.resolve({ data: null, error: null });
          },
          from: () => ({
            select: () => mockQueryBuilder,
          }),
          getAuthClient: () => ({
            auth: {
              signInWithPassword: () => Promise.resolve({ data: { session: { access_token: 'test', refresh_token: 'test' }, user: { id: 'test', email: 'test@test.com' } }, error: null }),
              getUser: () => Promise.resolve({ data: { user: { id: 'test', email: 'test@test.com' } }, error: null }),
              admin: {
                createUser: () => Promise.resolve({ data: { user: { id: 'test' } }, error: null }),
                updateUserById: () => Promise.resolve({ data: { user: { id: 'test' } }, error: null }),
                deleteUser: () => Promise.resolve({ data: null, error: null }),
              },
            },
          }),
        }),
      })
      .overrideProvider(IntegratedGamesService)
      .useValue({
        start: () => Promise.resolve(),
        stop: () => {},
        getPublicState: () => Promise.resolve({ roundId: 'test', roundNumber: 1, status: 'BETTING', currentMultiplier: 1 }),
        getLastCompletedRound: () => Promise.resolve(null),
        history: () => Promise.resolve({ success: true, rounds: [] }),
        placeBet: () => Promise.resolve({ success: true, bet: { id: 'test' } }),
        cashout: () => Promise.resolve({ success: true, betId: 'test', totalReturn: 10 }),
      })
      .overrideProvider(RouletteEngine)
      .useValue({
        start: () => {},
        stop: () => {},
        getState: () => ({ roundId: 'test', roundNumber: 1, status: 'BETTING' }),
        getRouletteState: () => ({ roundId: 'test', roundNumber: 1, status: 'BETTING' }),
        getLastResult: () => null,
        setNextRoundNumber: () => {},
        setPayoutHandler: () => {},
        addBet: () => {},
        validateBetForService: () => {},
      })
      .overrideProvider(FinancialRouletteService)
      .useValue({
        initialise: () => Promise.resolve(),
        getState: () => ({ roundId: 'test', roundNumber: 1, status: 'BETTING' }),
        getLastResult: () => Promise.reject(new Error('Not found')),
        history: () => Promise.resolve({ success: true, rounds: [] }),
        placeBet: () => Promise.resolve({ success: true, bet: { id: 'test' } }),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200);
  });

  it('/ready (GET)', () => {
    return request(app.getHttpServer())
      .get('/ready')
      .expect(200);
  });

  afterEach(async () => {
    await app.close();
  });
});
