import { afterEach, describe, expect, it, vi } from 'vitest';

import { CrashEngine } from './crash.engine.js';
import { CrashRoundEngine } from './crash.round.engine.js';

function startRunning(engine: CrashRoundEngine): void {
  vi.advanceTimersByTime(15_000);
  expect(engine.getState()?.status).toBe('LOCK');
  vi.advanceTimersByTime(1);
  expect(engine.getState()?.status).toBe('RUNNING');
}

describe('CrashRoundEngine', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('keeps betting open for 15 seconds and supports multiple players and bets', () => {
    vi.useFakeTimers();
    const engine = new CrashRoundEngine();
    engine.start();

    engine.placeBet('player-a', { betId: 'a-1', amount: 2 });
    engine.placeBet('player-a', { betId: 'a-2', amount: 3, autoCashoutMultiplier: 2 });
    engine.placeBet('player-b', { betId: 'b-1', amount: 4 });

    expect(engine.getState()).toMatchObject({
      status: 'BETTING', currentMultiplier: 1, crashResult: null,
    });
    expect(engine.getState()?.bets).toHaveLength(3);
    expect(() => engine.placeBet('player-c', { betId: 'a-1', amount: 1 }))
      .toThrow('Duplicate bet id');
  });

  it('rejects malformed bets and bets after LOCK', () => {
    vi.useFakeTimers();
    const engine = new CrashRoundEngine();
    engine.start();

    expect(() => engine.placeBet('', { betId: 'bet', amount: 1 }))
      .toThrow('Player id is required');
    expect(() => engine.placeBet('player', { betId: '', amount: 1 }))
      .toThrow('Bet id is required');
    expect(() => engine.placeBet('player', { betId: 'bad', amount: 0 }))
      .toThrow('positive whole number');

    vi.advanceTimersByTime(15_000);
    expect(() => engine.placeBet('player', { betId: 'late', amount: 1 }))
      .toThrow('BETTING');
  });

  it('runs, increases the live multiplier, hides the crash point, and completes', () => {
    vi.useFakeTimers();
    vi.spyOn(CrashEngine.prototype, 'generateCrashPoint').mockReturnValue(1.03);
    const engine = new CrashRoundEngine();
    const firstRound = engine.start();
    startRunning(engine);

    expect(engine.getState()?.crashResult).toBeNull();
    vi.advanceTimersByTime(100);
    expect(engine.getState()).toMatchObject({ status: 'RUNNING', currentMultiplier: 1.01 });
    vi.advanceTimersByTime(200);
    expect(engine.getState()).toMatchObject({
      status: 'CRASH',
      currentMultiplier: 1.03,
      crashResult: { crashMultiplier: 1.03 },
    });

    vi.advanceTimersByTime(1_000);
    expect(engine.getState()?.status).toBe('RESULT');
    vi.advanceTimersByTime(5_000);
    expect(engine.getState()?.status).toBe('COMPLETED');
    expect(engine.getLastCompletedRound()?.roundId).toBe(firstRound.roundId);
    vi.advanceTimersByTime(1);
    expect(engine.getState()).toMatchObject({
      status: 'BETTING', roundNumber: firstRound.roundNumber + 1,
    });
    engine.stop();
  });

  it('allows one manual cashout and settles it at the requested live multiplier', () => {
    vi.useFakeTimers();
    vi.spyOn(CrashEngine.prototype, 'generateCrashPoint').mockReturnValue(2);
    const engine = new CrashRoundEngine();
    engine.start();
    engine.placeBet('player-a', { betId: 'manual', amount: 10 });
    startRunning(engine);
    vi.advanceTimersByTime(50 * 100);

    expect(engine.cashOut('manual', 1.5)).toMatchObject({
      status: 'WIN', profit: 5, totalReturn: 15,
    });
    expect(() => engine.cashOut('manual', 1.5)).toThrow('already been settled');
    engine.stop();
  });

  it('rejects a manual cashout above the current multiplier', () => {
    vi.useFakeTimers();
    vi.spyOn(CrashEngine.prototype, 'generateCrashPoint').mockReturnValue(2);
    const engine = new CrashRoundEngine();
    engine.start();
    engine.placeBet('player-a', { betId: 'manual', amount: 1 });
    startRunning(engine);

    expect(() => engine.cashOut('manual', 1.01))
      .toThrow('cannot exceed the current multiplier');
    engine.stop();
  });

  it('automatically cashes out before a later crash at the actual trigger multiplier', () => {
    vi.useFakeTimers();
    vi.spyOn(CrashEngine.prototype, 'generateCrashPoint').mockReturnValue(1.05);
    const engine = new CrashRoundEngine();
    engine.start();
    engine.placeBet('player-a', {
      betId: 'auto', amount: 10, autoCashoutMultiplier: 1.02,
    });
    startRunning(engine);
    vi.advanceTimersByTime(200);

    expect(engine.getState()?.bets[0]).toMatchObject({
      status: 'CASHED_OUT', cashoutMultiplier: 1.02,
    });
    vi.advanceTimersByTime(300);
    expect(engine.getState()?.status).toBe('CRASH');
    expect(engine.getState()?.settlements).toContainEqual(
      expect.objectContaining({ betId: 'auto', status: 'WIN', profit: 0.2, totalReturn: 10.2 }),
    );
    engine.stop();
  });

  it('loses an auto-cashout bet when the crash happens first', () => {
    vi.useFakeTimers();
    vi.spyOn(CrashEngine.prototype, 'generateCrashPoint').mockReturnValue(1.02);
    const engine = new CrashRoundEngine();
    engine.start();
    engine.placeBet('player-a', {
      betId: 'late-auto', amount: 5, autoCashoutMultiplier: 1.03,
    });
    startRunning(engine);
    vi.advanceTimersByTime(200);

    expect(engine.getState()?.status).toBe('CRASH');
    expect(engine.getState()?.settlements).toContainEqual(
      expect.objectContaining({ betId: 'late-auto', status: 'LOSS', profit: -5, totalReturn: 0 }),
    );
    expect(() => engine.cashOut('late-auto', 1.01)).toThrow('RUNNING');
    engine.stop();
  });

  it('uses one shared crash result and preserves winners while active bets lose', () => {
    vi.useFakeTimers();
    const point = vi.spyOn(CrashEngine.prototype, 'generateCrashPoint').mockReturnValue(1.03);
    const engine = new CrashRoundEngine();
    engine.start();
    engine.placeBet('player-a', { betId: 'winner', amount: 10, autoCashoutMultiplier: 1.01 });
    engine.placeBet('player-b', { betId: 'loser', amount: 10 });
    startRunning(engine);
    vi.advanceTimersByTime(300);

    const state = engine.getState();
    expect(point).toHaveBeenCalledTimes(1);
    expect(state?.crashResult?.crashMultiplier).toBe(1.03);
    expect(state?.settlements).toEqual(expect.arrayContaining([
      expect.objectContaining({ betId: 'winner', status: 'WIN', totalReturn: 10.1 }),
      expect.objectContaining({ betId: 'loser', status: 'LOSS', totalReturn: 0 }),
    ]));
    engine.stop();
  });

  it('stop clears both transition and multiplier timers', () => {
    vi.useFakeTimers();
    vi.spyOn(CrashEngine.prototype, 'generateCrashPoint').mockReturnValue(10);
    const engine = new CrashRoundEngine();
    engine.start();
    startRunning(engine);

    engine.stop();
    vi.advanceTimersByTime(60_000);
    expect(engine.isRunning()).toBe(false);
    expect(engine.getState()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
