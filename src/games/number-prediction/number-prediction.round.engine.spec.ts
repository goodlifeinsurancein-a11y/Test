import { afterEach, describe, expect, it, vi } from 'vitest';
import { NumberPredictionEngine } from './number-prediction.engine.js';
import { NumberPredictionRoundEngine } from './number-prediction.round.engine.js';

describe('NumberPredictionRoundEngine', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('supports multiple players and multiple bets per player while hiding the result', () => {
    vi.useFakeTimers();
    const rounds = new NumberPredictionRoundEngine();
    rounds.start();
    rounds.placeBet('player-1', { betId: 'one', number: 1, amount: 1 });
    rounds.placeBet('player-1', { betId: 'two', number: 2, amount: 2 });
    rounds.placeBet('player-2', { betId: 'three', number: 3, amount: 3 });
    expect(rounds.getState()).toMatchObject({ status: 'BETTING', result: null });
    expect(rounds.getState()?.bets).toHaveLength(3);
    rounds.stop();
  });

  it('rejects invalid players, duplicate bet ids, and malformed bets', () => {
    vi.useFakeTimers();
    const rounds = new NumberPredictionRoundEngine();
    rounds.start();
    expect(() => rounds.placeBet('', { betId: 'bad-player', number: 1, amount: 1 })).toThrow();
    rounds.placeBet('player', { betId: 'duplicate', number: 1, amount: 1 });
    expect(() => rounds.placeBet('player-2', { betId: 'duplicate', number: 2, amount: 1 })).toThrow('Duplicate');
    expect(() => rounds.placeBet('player', { betId: 'bad', number: 1, amount: 0 })).toThrow();
    rounds.stop();
  });

  it('locks at fifteen seconds and rejects bets after lock', () => {
    vi.useFakeTimers();
    const rounds = new NumberPredictionRoundEngine();
    rounds.start();
    vi.advanceTimersByTime(15_000);
    expect(rounds.getState()).toMatchObject({ status: 'LOCK', result: null });
    expect(() => rounds.placeBet('player', { betId: 'late', number: 1, amount: 1 })).toThrow('BETTING');
    rounds.stop();
  });

  it('keeps the secure result hidden until RESULT and settles correctly', () => {
    vi.useFakeTimers();
    vi.spyOn(NumberPredictionEngine.prototype, 'generateResult').mockReturnValue({ number: 7, generatedAt: 100 });
    const rounds = new NumberPredictionRoundEngine();
    const first = rounds.start();
    rounds.placeBet('winner', { betId: 'win', number: 7, amount: 100 });
    rounds.placeBet('loser', { betId: 'loss', number: 2, amount: 100 });
    vi.advanceTimersByTime(15_000);
    expect(rounds.getState()?.result).toBeNull();
    vi.advanceTimersByTime(1);
    expect(rounds.getState()).toMatchObject({ status: 'GENERATE_RESULT', result: null });
    vi.advanceTimersByTime(1_000);
    expect(rounds.getState()).toMatchObject({ status: 'RESULT', result: { number: 7 }, settlements: [] });
    vi.advanceTimersByTime(1_000);
    expect(rounds.getState()).toMatchObject({
      status: 'SETTLEMENT',
      settlements: expect.arrayContaining([
        expect.objectContaining({ betId: 'win', status: 'WIN', profit: 900, totalReturn: 1000 }),
        expect.objectContaining({ betId: 'loss', status: 'LOSS', profit: -100, totalReturn: 0 }),
      ]),
    });
    vi.advanceTimersByTime(5_000);
    expect(rounds.getState()).toMatchObject({ status: 'COMPLETED', result: { number: 7 } });
    expect(rounds.getLastCompletedRound()).toMatchObject({ roundId: first.roundId, result: { number: 7 } });
  });

  it('creates the next round and cleans up timers on stop', () => {
    vi.useFakeTimers();
    const rounds = new NumberPredictionRoundEngine();
    const first = rounds.start();
    expect(() => rounds.start()).toThrow('already running');
    vi.advanceTimersByTime(15_000); vi.advanceTimersByTime(1); vi.advanceTimersByTime(1_000); vi.advanceTimersByTime(1_000); vi.advanceTimersByTime(5_000); vi.advanceTimersByTime(1);
    expect(rounds.getState()).toMatchObject({ status: 'BETTING', roundNumber: first.roundNumber + 1, result: null });
    rounds.stop();
    expect(rounds.isRunning()).toBe(false);
    expect(rounds.getState()).toBeNull();
    vi.advanceTimersByTime(60_000);
    expect(vi.getTimerCount()).toBe(0);
  });
});
