import { afterEach, describe, expect, it, vi } from 'vitest';

import { DiceEngine, DiceResult } from './dice.engine.js';
import { DiceRoundEngine } from './dice.round.engine.js';

const sharedResult: DiceResult = {
  dice1: 3,
  dice2: 4,
  total: 7,
  isDouble: false,
};

describe('DiceRoundEngine', () => {
  afterEach(() => vi.useRealTimers());

  it('accepts multiple bets from multiple players during BETTING', () => {
    const engine = new DiceRoundEngine();
    engine.start();

    engine.placeBet('player-a', { type: 'ODD', amount: 2 });
    engine.placeBet('player-a', { type: 'EXACT_TOTAL', value: 7, amount: 3 });
    engine.placeBet('player-b', { type: 'HIGH', amount: 4 });

    const state = engine.getState();
    expect(state?.status).toBe('BETTING');
    expect(state?.bets).toHaveLength(3);
    expect(new Set(state?.bets.map((bet) => bet.playerId))).toEqual(
      new Set(['player-a', 'player-b']),
    );
    engine.stop();
  });

  it('locks, rolls once, reveals results, completes, and starts the next round', () => {
    vi.useFakeTimers();
    const roll = vi.spyOn(DiceEngine.prototype, 'roll').mockReturnValue(sharedResult);
    const engine = new DiceRoundEngine();
    const firstRound = engine.start();
    engine.placeBet('player-a', { type: 'ODD', amount: 2 });

    vi.advanceTimersByTime(15_000);
    expect(engine.getState()?.status).toBe('LOCK');
    expect(() => engine.placeBet('player-b', { type: 'EVEN', amount: 1 }))
      .toThrow('Dice bets are accepted only during BETTING');

    vi.advanceTimersByTime(1);
    expect(engine.getState()?.status).toBe('ROLL');
    expect(engine.getState()?.diceResult).toBeNull();

    vi.advanceTimersByTime(3_000);
    expect(engine.getState()?.status).toBe('RESULT');
    expect(engine.getState()?.diceResult).toEqual(sharedResult);

    vi.advanceTimersByTime(5_000);
    expect(engine.getState()?.status).toBe('COMPLETED');
    expect(engine.getLastCompletedRound()?.roundId).toBe(firstRound.roundId);
    expect(roll).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    expect(engine.getState()?.status).toBe('BETTING');
    expect(engine.getState()?.roundNumber).toBe(firstRound.roundNumber + 1);
    engine.stop();
  });

  it('settles every bet against the one shared result', () => {
    vi.useFakeTimers();
    vi.spyOn(DiceEngine.prototype, 'roll').mockReturnValue(sharedResult);
    const engine = new DiceRoundEngine();
    engine.start();
    engine.placeBet('player-a', { type: 'EXACT_TOTAL', value: 7, amount: 2 });
    engine.placeBet('player-b', { type: 'HIGH', amount: 3 });
    engine.placeBet('player-c', { type: 'EVEN', amount: 4 });

    vi.advanceTimersByTime(18_001);
    const state = engine.getState();
    expect(state?.status).toBe('RESULT');
    expect(state?.outcomes).toHaveLength(3);
    expect(state?.outcomes.map((outcome) => outcome.profit)).toEqual([10, -3, -4]);
    expect(state?.outcomes.map((outcome) => outcome.totalReturn)).toEqual([12, 0, 0]);
    expect(state?.outcomes.every((outcome) => outcome.bet.playerId.length > 0)).toBe(true);
    engine.stop();
  });

  it('rejects malformed player and bet input', () => {
    const engine = new DiceRoundEngine();
    engine.start();

    expect(() => engine.placeBet('', { type: 'ODD', amount: 1 }))
      .toThrow('Player id is required');
    expect(() => engine.placeBet('player-a', { type: 'LOW', amount: 0 }))
      .toThrow('positive whole number');
    engine.stop();
  });
});
