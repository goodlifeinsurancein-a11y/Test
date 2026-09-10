import { afterEach, describe, expect, it, vi } from 'vitest';
import { WheelEngine } from './wheel.engine.js';
import { WheelRoundEngine } from './wheel.round.engine.js';

describe('WheelRoundEngine', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('accepts multiple players, multiple bets, and both bet types during betting', () => {
    vi.useFakeTimers();
    const rounds = new WheelRoundEngine();
    rounds.start();
    rounds.placeBet('player-1', { betId: 'number', type: 'NUMBER', number: 1, amount: 1 });
    rounds.placeBet('player-1', { betId: 'red', type: 'COLOR', color: 'RED', amount: 2 });
    rounds.placeBet('player-2', { betId: 'black', type: 'COLOR', color: 'BLACK', amount: 3 });

    const state = rounds.getState();
    expect(state).toMatchObject({ status: 'BETTING', result: null, settlements: [] });
    expect(state?.bets).toHaveLength(3);
    expect(state?.bets.every((bet) => bet.status === 'PENDING')).toBe(true);
    expect(() => rounds.placeBet('player-3', { betId: 'number', type: 'NUMBER', number: 2, amount: 1 })).toThrow('Duplicate');
    rounds.stop();
  });

  it('rejects malformed bets and rejects every bet after the lock transition', () => {
    vi.useFakeTimers();
    const rounds = new WheelRoundEngine();
    rounds.start();
    expect(() => rounds.placeBet('', { betId: 'bad-player', type: 'NUMBER', number: 1, amount: 1 })).toThrow();
    expect(() => rounds.placeBet('player', { betId: '', type: 'NUMBER', number: 1, amount: 1 })).toThrow();
    expect(() => rounds.placeBet('player', { betId: 'bad-type', type: 'NUMBER', number: 10, amount: 1 } as never)).toThrow();
    vi.advanceTimersByTime(15_000);
    expect(rounds.getState()).toMatchObject({ status: 'LOCK', result: null });
    expect(() => rounds.placeBet('player', { betId: 'late', type: 'COLOR', color: 'RED', amount: 1 })).toThrow('BETTING');
    rounds.stop();
  });

  it('does not leak the generated result or color before RESULT', () => {
    vi.useFakeTimers();
    vi.spyOn(WheelEngine.prototype, 'generateResult').mockReturnValue({ number: 0, color: 'GREEN', generatedAt: 100 });
    const rounds = new WheelRoundEngine();
    rounds.start();
    rounds.placeBet('player', { betId: 'green', type: 'COLOR', color: 'GREEN', amount: 1 });
    vi.advanceTimersByTime(15_000);
    expect(rounds.getState()).toMatchObject({ status: 'LOCK', result: null, settlements: [] });
    vi.advanceTimersByTime(1);
    const generated = rounds.getState();
    expect(generated).toMatchObject({ status: 'GENERATE_RESULT', result: null, settlements: [] });
    expect(generated?.bets[0]?.status).toBe('PENDING');
    rounds.stop();
  });

  it('reveals number, color, and win/loss information at RESULT then exposes settlements', () => {
    vi.useFakeTimers();
    vi.spyOn(WheelEngine.prototype, 'generateResult').mockReturnValue({ number: 0, color: 'GREEN', generatedAt: 100 });
    const rounds = new WheelRoundEngine();
    rounds.start();
    rounds.placeBet('winner', { betId: 'green', type: 'COLOR', color: 'GREEN', amount: 100 });
    rounds.placeBet('loser', { betId: 'red', type: 'COLOR', color: 'RED', amount: 100 });
    vi.advanceTimersByTime(15_000);
    vi.advanceTimersByTime(1);
    vi.advanceTimersByTime(1_000);
    expect(rounds.getState()).toMatchObject({
      status: 'RESULT',
      result: { number: 0, color: 'GREEN' },
      settlements: [],
      bets: expect.arrayContaining([
        expect.objectContaining({ betId: 'green', status: 'WIN' }),
        expect.objectContaining({ betId: 'red', status: 'LOSS' }),
      ]),
    });
    vi.advanceTimersByTime(1_000);
    expect(rounds.getState()).toMatchObject({
      status: 'SETTLEMENT',
      settlements: expect.arrayContaining([
        expect.objectContaining({ betId: 'green', profit: 900, totalReturn: 1000 }),
        expect.objectContaining({ betId: 'red', profit: -100, totalReturn: 0 }),
      ]),
    });
    rounds.stop();
  });

  it('completes a round, creates the next round, and clears all timers on stop', () => {
    vi.useFakeTimers();
    vi.spyOn(WheelEngine.prototype, 'generateResult').mockReturnValue({ number: 1, color: 'RED', generatedAt: 100 });
    const rounds = new WheelRoundEngine();
    const first = rounds.start();
    expect(() => rounds.start()).toThrow('already running');
    vi.advanceTimersByTime(15_000);
    vi.advanceTimersByTime(1);
    vi.advanceTimersByTime(1_000);
    vi.advanceTimersByTime(1_000);
    vi.advanceTimersByTime(5_000);
    expect(rounds.getLastCompletedRound()).toMatchObject({
      roundId: first.roundId,
      status: 'COMPLETED',
      result: { number: 1, color: 'RED' },
    });
    vi.advanceTimersByTime(1);
    expect(rounds.getState()).toMatchObject({ status: 'BETTING', roundNumber: first.roundNumber + 1, result: null });
    rounds.stop();
    expect(rounds.isRunning()).toBe(false);
    expect(rounds.getState()).toBeNull();
    vi.advanceTimersByTime(60_000);
    expect(vi.getTimerCount()).toBe(0);
  });
});
