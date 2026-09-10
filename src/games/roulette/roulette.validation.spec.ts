import { describe, expect, it, vi } from 'vitest';

import { BadRequestException } from '@nestjs/common';

import { RouletteService } from './roulette.service.js';
import { RouletteEngine } from './roulette.engine.js';

function createService() {
  const eventBus = {
    publish: vi.fn(),
  };

  const engine = new RouletteEngine(eventBus as any);

  const walletService = {
    getMyWallet: vi.fn(),
    creditAtomic: vi.fn(),
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
    walletService as any,
    eventBus as any,
  );

  engine.start();

  return {
    service,
    engine,
    eventBus,
    walletService,
    supabaseClient,
  };
}

describe('RouletteService - bet validation', () => {
  it('should reject a bet during LOCK', async () => {
    const { service, engine } = createService();
    const round = engine.getState()!;

    round.status = 'LOCK';

    await expect(
      service.placeBet(
        'test-player',
        round.roundId,
        'COLOR',
        'RED',
        1,
      ),
    ).rejects.toThrow(BadRequestException);

    engine.stop();
  });

  it('should reject a bet during PROCESSING', async () => {
    const { service, engine } = createService();
    const round = engine.getState()!;

    round.status = 'PROCESSING';

    await expect(
      service.placeBet(
        'test-player',
        round.roundId,
        'COLOR',
        'RED',
        1,
      ),
    ).rejects.toThrow(BadRequestException);

    engine.stop();
  });

  it('should reject a bet during RESULT', async () => {
    const { service, engine } = createService();
    const round = engine.getState()!;

    round.status = 'RESULT';

    await expect(
      service.placeBet(
        'test-player',
        round.roundId,
        'COLOR',
        'RED',
        1,
      ),
    ).rejects.toThrow(BadRequestException);

    engine.stop();
  });

  it('should reject amount 0', async () => {
    const { service, engine } = createService();
    const round = engine.getState()!;

    await expect(
      service.placeBet(
        'test-player',
        round.roundId,
        'COLOR',
        'RED',
        0,
      ),
    ).rejects.toThrow(BadRequestException);

    engine.stop();
  });

  it('should reject a negative amount', async () => {
    const { service, engine } = createService();
    const round = engine.getState()!;

    await expect(
      service.placeBet(
        'test-player',
        round.roundId,
        'COLOR',
        'RED',
        -1,
      ),
    ).rejects.toThrow(BadRequestException);

    engine.stop();
  });

  it('should reject a decimal amount', async () => {
    const { service, engine } = createService();
    const round = engine.getState()!;

    await expect(
      service.placeBet(
        'test-player',
        round.roundId,
        'COLOR',
        'RED',
        1.5,
      ),
    ).rejects.toThrow(BadRequestException);

    engine.stop();
  });

  it('should reject roulette number 37', async () => {
    const { service, engine } = createService();
    const round = engine.getState()!;

    await expect(
      service.placeBet(
        'test-player',
        round.roundId,
        'NUMBER',
        '37',
        1,
      ),
    ).rejects.toThrow(BadRequestException);

    engine.stop();
  });

  it('should reject an invalid color', async () => {
    const { service, engine } = createService();
    const round = engine.getState()!;

    await expect(
      service.placeBet(
        'test-player',
        round.roundId,
        'COLOR',
        'BLUE',
        1,
      ),
    ).rejects.toThrow(BadRequestException);

    engine.stop();
  });

  it('should reject an invalid roundId', async () => {
    const { service, engine } = createService();

    await expect(
      service.placeBet(
        'test-player',
        'invalid-round-id',
        'COLOR',
        'RED',
        1,
      ),
    ).rejects.toThrow(BadRequestException);

    engine.stop();
  });
});
