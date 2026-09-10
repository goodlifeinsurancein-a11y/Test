import { describe, expect, it, vi } from 'vitest';

import { RouletteService } from './roulette.service.js';
import { RouletteEngine } from './roulette.engine.js';
import { FinancialService } from '../../wallet/financial.service.js';

describe('RouletteService - winning payout', () => {
  it('should credit the winner with the total return and persist the round', async () => {
    const eventBus = {
      publish: vi.fn(),
    };

    const engine = new RouletteEngine(eventBus as any);
    const financial = {
      wholeTokensToUnits: vi.fn().mockImplementation((n) => n * 10),
      settleBet: vi.fn().mockResolvedValue({ success: true }),
    };
    const supabaseClient = {
      rpc: vi.fn().mockResolvedValue({
        data: { success: true, alreadyRecorded: false },
        error: null,
      }),
    };

    const supabase = {
      getClient: () => supabaseClient,
    };

    const service = new RouletteService(
      supabase as any,
      engine,
      financial as any,
      eventBus as any,
    );

    engine.start();

    const round = engine.getState();

    expect(round).not.toBeNull();
    expect(round?.status).toBe('BETTING');

    engine.addBet({
      betId: 'test-bet-1',
      playerId: 'test-player',
      betType: 'COLOR',
      betValue: 'RED',
      amount: 1,
    });

    (engine as any).result = {
      number: 7,
      color: 'RED',
    };

    round!.status = 'RESULT';
    round!.resultAt = Date.now();

    const result = await service.settleRoundPayouts();

    expect(result.success).toBe(true);
    expect(result.alreadySettled).toBe(false);

    const secondResult = await service.settleRoundPayouts();

    expect(secondResult.success).toBe(true);
    expect(secondResult.alreadySettled).toBe(true);
    expect(secondResult.outcomes).toHaveLength(0);

    expect(financial.settleBet).toHaveBeenCalledWith(
      expect.objectContaining({
        betId: 'test-bet-1',
        outcome: 'WIN',
        returnUnits: 20,
      })
    );

    expect(supabaseClient.rpc).toHaveBeenCalledWith(
      'finance_record_round_result',
      expect.objectContaining({
        p_round_id: round!.roundId,
        p_result_data: { number: 7, color: 'RED' },
      })
    );

    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0].status).toBe('WIN');
    expect(result.outcomes[0].profit).toBe(1);
    expect(result.outcomes[0].totalReturn).toBe(2);

    engine.stop();
  });
});

describe('RouletteService - insufficient balance', () => {
  it('should reject a bet when the player has insufficient balance', async () => {
    const eventBus = {
      publish: vi.fn(),
    };

    const engine = new RouletteEngine(eventBus as any);
    const financial = {
      wholeTokensToUnits: vi.fn().mockImplementation((n) => n * 10),
      newIdempotencyKey: vi.fn().mockReturnValue('idem-1'),
      idempotencyUuid: vi.fn().mockReturnValue('bet-1'),
      placeBet: vi.fn().mockImplementation(async ({ betId, playerId, gameId, roundId, betType, betValue, amount, idempotencyKey }) => {
        // Simulate the RPC rejecting with insufficient balance
        throw new Error('insufficient wallet balance');
      }),
    };

    const supabaseClient = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: null,
      }),
    };

    const supabase = {
      getClient: () => supabaseClient,
    };

    const service = new RouletteService(
      supabase as any,
      engine,
      financial as any,
      eventBus as any,
    );

    engine.start();

    const round = engine.getState();

    expect(round).not.toBeNull();
    expect(round?.status).toBe('BETTING');

    await expect(
      service.placeBet('test-player', round!.roundId, 'COLOR', 'RED', 1),
    ).rejects.toThrow('insufficient wallet balance');

    expect(financial.placeBet).toHaveBeenCalled();

    engine.stop();
  });
});

describe('RouletteService - bet rollback', () => {
  it('should refund the wallet when debit succeeds but RAM bet placement fails', async () => {
    const eventBus = {
      publish: vi.fn(),
    };

    const engine = new RouletteEngine(eventBus as any);
    const financial = {
      wholeTokensToUnits: vi.fn().mockImplementation((n) => n * 10),
      newIdempotencyKey: vi.fn().mockReturnValue('idem-1'),
      idempotencyUuid: vi.fn().mockReturnValue('bet-1'),
      placeBet: vi.fn().mockResolvedValue({ success: true, idempotent: false }),
      settleBet: vi.fn().mockResolvedValue({ success: true }),
    };

    const supabaseClient = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: null,
      }),
    };

    const supabase = {
      getClient: () => supabaseClient,
    };

    const service = new RouletteService(
      supabase as any,
      engine,
      financial as any,
      eventBus as any,
    );

    engine.start();

    const round = engine.getState();

    expect(round).not.toBeNull();
    expect(round?.status).toBe('BETTING');

    // Make engine reject the bet (simulate RAM failure)
    engine.addBet = vi.fn().mockImplementation(() => {
      throw new Error('RAM bet placement failed');
    });

    await expect(
      service.placeBet('test-player', round!.roundId, 'COLOR', 'RED', 1),
    ).rejects.toThrow('RAM bet placement failed');

    expect(financial.settleBet).toHaveBeenCalledWith(
      expect.objectContaining({
        betId: 'bet-1',
        outcome: 'VOID',
        returnUnits: 10,
      })
    );

    engine.stop();
  });
});
