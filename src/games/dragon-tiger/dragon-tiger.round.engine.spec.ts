import { afterEach, describe, expect, it, vi } from 'vitest';

import { DragonTigerEngine } from './dragon-tiger.engine.js';
import { DragonTigerRoundEngine } from './dragon-tiger.round.engine.js';
import { Card } from './dragon-tiger.types.js';

const fixedDeck: Card[] = [
  { rank: 'K', suit: 'SPADES' },
  { rank: 'A', suit: 'HEARTS' },
];

function startDeal(engine: DragonTigerRoundEngine): void {
  vi.advanceTimersByTime(15_000);
  expect(engine.getState()?.status).toBe('LOCK');
  vi.advanceTimersByTime(1);
  expect(engine.getState()?.status).toBe('DEAL');
}

describe('DragonTigerRoundEngine', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('starts in BETTING and supports multiple players and bets', () => {
    vi.useFakeTimers();
    const engine = new DragonTigerRoundEngine();
    engine.start();
    engine.placeBet('player-a', { betId: 'a-dragon', type: 'DRAGON', amount: 2 });
    engine.placeBet('player-a', { betId: 'a-tie', type: 'TIE', amount: 3 });
    engine.placeBet('player-b', { betId: 'b-tiger', type: 'TIGER', amount: 4 });

    expect(engine.getState()).toMatchObject({
      status: 'BETTING', dragonCard: null, tigerCard: null, result: null,
    });
    expect(engine.getState()?.bets).toHaveLength(3);
    expect(() => engine.placeBet('player-c', { betId: 'a-dragon', type: 'DRAGON', amount: 1 }))
      .toThrow('Duplicate bet id');
    engine.stop();
  });

  it('locks after 15 seconds and rejects later bets', () => {
    vi.useFakeTimers();
    const engine = new DragonTigerRoundEngine();
    engine.start();
    vi.advanceTimersByTime(15_000);

    expect(engine.getState()).toMatchObject({ status: 'LOCK', dragonCard: null, tigerCard: null });
    expect(() => engine.placeBet('player', { betId: 'late', type: 'DRAGON', amount: 1 }))
      .toThrow('BETTING');
    engine.stop();
  });

  it('deals, compares, reveals the result, completes, and starts the next round', () => {
    vi.useFakeTimers();
    vi.spyOn(DragonTigerEngine.prototype, 'shuffleDeck').mockReturnValue(fixedDeck);
    const engine = new DragonTigerRoundEngine();
    const firstRound = engine.start();
    startDeal(engine);

    expect(engine.getState()).toMatchObject({
      status: 'DEAL', dragonCard: fixedDeck[0], tigerCard: fixedDeck[1], result: null,
    });
    vi.advanceTimersByTime(1_000);
    expect(engine.getState()).toMatchObject({ status: 'COMPARE', result: null, settlements: [] });
    vi.advanceTimersByTime(1_000);
    expect(engine.getState()).toMatchObject({ status: 'RESULT', result: { winner: 'DRAGON' } });
    vi.advanceTimersByTime(5_000);
    expect(engine.getState()?.status).toBe('COMPLETED');
    expect(engine.getLastCompletedRound()?.roundId).toBe(firstRound.roundId);
    vi.advanceTimersByTime(1);
    expect(engine.getState()).toMatchObject({ status: 'BETTING', roundNumber: firstRound.roundNumber + 1 });
    engine.stop();
  });

  it('uses one shared result and settles every bet correctly', () => {
    vi.useFakeTimers();
    vi.spyOn(DragonTigerEngine.prototype, 'shuffleDeck').mockReturnValue(fixedDeck);
    const engine = new DragonTigerRoundEngine();
    engine.start();
    engine.placeBet('player-a', { betId: 'winner', type: 'DRAGON', amount: 10 });
    engine.placeBet('player-b', { betId: 'loser', type: 'TIGER', amount: 10 });
    engine.placeBet('player-c', { betId: 'tie-loss', type: 'TIE', amount: 10 });
    startDeal(engine);
    vi.advanceTimersByTime(2_000);

    const state = engine.getState();
    expect(state?.result?.winner).toBe('DRAGON');
    expect(state?.settlements).toEqual(expect.arrayContaining([
      expect.objectContaining({ betId: 'winner', status: 'WIN', profit: 10, totalReturn: 20 }),
      expect.objectContaining({ betId: 'loser', status: 'LOSS', profit: -10, totalReturn: 0 }),
      expect.objectContaining({ betId: 'tie-loss', status: 'LOSS', profit: -10, totalReturn: 0 }),
    ]));
    engine.stop();
  });

  it('rejects invalid players, bet IDs, and amounts', () => {
    vi.useFakeTimers();
    const engine = new DragonTigerRoundEngine();
    engine.start();
    expect(() => engine.placeBet('', { betId: 'bet', type: 'DRAGON', amount: 1 }))
      .toThrow('Player id is required');
    expect(() => engine.placeBet('player', { betId: '', type: 'DRAGON', amount: 1 }))
      .toThrow('Bet id is required');
    expect(() => engine.placeBet('player', { betId: 'bet', type: 'DRAGON', amount: 0 }))
      .toThrow('positive whole number');
    engine.stop();
  });

  it('cannot start twice and stop clears its timer', () => {
    vi.useFakeTimers();
    const engine = new DragonTigerRoundEngine();
    engine.start();
    expect(() => engine.start()).toThrow('already running');
    engine.stop();
    vi.advanceTimersByTime(60_000);
    expect(engine.isRunning()).toBe(false);
    expect(engine.getState()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
