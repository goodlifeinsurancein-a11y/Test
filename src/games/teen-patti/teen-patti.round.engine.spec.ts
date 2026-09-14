import { afterEach, describe, expect, it, vi } from 'vitest';
import { TeenPattiEngine } from './teen-patti.engine.js';
import { TeenPattiRoundEngine } from './teen-patti.round.engine.js';

function advanceTo(engine: TeenPattiRoundEngine, status: 'LOCK' | 'DEAL' | 'COMPARE' | 'SETTLEMENT' | 'RESULT'): void {
  if (status === 'LOCK') vi.advanceTimersByTime(15_000);
  if (status === 'DEAL') { vi.advanceTimersByTime(15_000); vi.advanceTimersByTime(1); }
  if (status === 'COMPARE') { vi.advanceTimersByTime(15_000); vi.advanceTimersByTime(1); vi.advanceTimersByTime(1_000); }
  if (status === 'SETTLEMENT') { vi.advanceTimersByTime(15_000); vi.advanceTimersByTime(1); vi.advanceTimersByTime(1_000); vi.advanceTimersByTime(1_000); }
  if (status === 'RESULT') { vi.advanceTimersByTime(15_000); vi.advanceTimersByTime(1); vi.advanceTimersByTime(1_000); vi.advanceTimersByTime(1_000); vi.advanceTimersByTime(1_000); }
}

describe('TeenPattiRoundEngine', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('starts in BETTING with all cards, winners, results, and settlements hidden', () => {
    vi.useFakeTimers();
    const engine = new TeenPattiRoundEngine();
    engine.start();
    engine.placeBet('player', 1);
    expect(engine.getTeenPattiState()).toMatchObject({ status: 'BETTING', dealerCards: [], dealerHand: null, settlements: [] });
    expect(engine.getTeenPattiState()?.players[0]).toMatchObject({ cards: [], hand: null, result: null });
    engine.stop();
  });

  it('uses one shared round deck with no duplicate physical cards across dealer and all players', () => {
    vi.useFakeTimers();
    const engine = new TeenPattiRoundEngine();
    engine.start();
    engine.placeBet('player-1', 10);
    engine.placeBet('player-2', 10);
    engine.placeBet('player-3', 10);
    advanceTo(engine, 'RESULT');
    const state = engine.getTeenPattiState();
    const allCards = [...(state?.dealerCards ?? []), ...(state?.players.flatMap((player) => player.cards) ?? [])];
    expect(allCards).toHaveLength(12);
    expect(new Set(allCards.map((item) => `${item.rank}-${item.suit}`))).toHaveLength(12);
    engine.stop();
  });

  it('enforces the 16-player physical deck capacity and rejects an additional player', () => {
    vi.useFakeTimers();
    const engine = new TeenPattiRoundEngine();
    engine.start();
    for (let index = 0; index < 16; index += 1) engine.placeBet(`player-${index}`, 1);
    expect(engine.getTeenPattiState()?.players).toHaveLength(16);
    expect(() => engine.placeBet('player-16', 1)).toThrow('Not enough cards remaining');
    engine.stop();
  });

  it('validates player and bet input, rejects duplicate player bets, and rejects bets after LOCK', () => {
    vi.useFakeTimers();
    const engine = new TeenPattiRoundEngine();
    engine.start();
    expect(() => engine.placeBet('', 1)).toThrow();
    expect(() => engine.placeBet('player', 0)).toThrow();
    expect(() => engine.placeBet('player', -1)).toThrow();
    expect(() => engine.placeBet('player', 1.5)).toThrow();
    expect(() => engine.placeBet('player', Number.NaN)).toThrow();
    expect(() => engine.placeBet('player', Infinity)).toThrow();
    expect(() => engine.placeBet('player', '1' as never)).toThrow();
    engine.placeBet('player', 1);
    expect(() => engine.placeBet('player', 1)).toThrow('already placed');
    advanceTo(engine, 'LOCK');
    expect(() => engine.placeBet('late', 1)).toThrow('BETTING');
    engine.stop();
  });

  it('runs LOCK, DEAL, COMPARE, SETTLEMENT, RESULT, COMPLETED, and NEXT with hidden state before RESULT', () => {
    vi.useFakeTimers();
    const engine = new TeenPattiRoundEngine();
    const first = engine.start();
    engine.placeBet('player', 10);
    advanceTo(engine, 'LOCK');
    expect(engine.getTeenPattiState()).toMatchObject({ status: 'LOCK', dealerCards: [], settlements: [] });
    vi.advanceTimersByTime(1);
    expect(engine.getTeenPattiState()).toMatchObject({ status: 'DEAL', dealerCards: [], settlements: [] });
    expect(engine.getTeenPattiState()?.players[0]).toMatchObject({ cards: [], result: null });
    vi.advanceTimersByTime(1_000);
    expect(engine.getTeenPattiState()?.status).toBe('COMPARE');
    expect(engine.getTeenPattiState()?.players[0]?.result).toBeNull();
    vi.advanceTimersByTime(1_000);
    expect(engine.getTeenPattiState()).toMatchObject({ status: 'SETTLEMENT', settlements: [] });
    vi.advanceTimersByTime(1_000);
    expect(engine.getTeenPattiState()).toMatchObject({ status: 'RESULT', dealerHand: expect.any(Object) });
    expect(engine.getTeenPattiState()?.players[0]?.result).not.toBeNull();
    expect(engine.getTeenPattiState()?.settlements).toHaveLength(1);
    vi.advanceTimersByTime(5_000);
    expect(engine.getLastResult()).toMatchObject({ roundId: first.roundId, completedAt: expect.any(Number) });
    vi.advanceTimersByTime(1);
    expect(engine.getTeenPattiState()).toMatchObject({ status: 'BETTING', roundNumber: first.roundNumber + 1, dealerCards: [] });
    engine.stop();
  });

  it('returns safe copies, uses a fresh deck on the next round, and clears timers on stop', () => {
    vi.useFakeTimers();
    const shuffle = vi.spyOn(TeenPattiEngine.prototype, 'shuffleDeck');
    const engine = new TeenPattiRoundEngine();
    const first = engine.start();
    engine.placeBet('player', 10);
    advanceTo(engine, 'RESULT');
    const visible = engine.getTeenPattiState();
    const originalRank = visible?.dealerCards[0]?.rank;
    visible?.dealerCards[0] && (visible.dealerCards[0].rank = '2');
    expect(engine.getTeenPattiState()?.dealerCards[0]?.rank).toBe(originalRank);
    vi.advanceTimersByTime(5_000);
    vi.advanceTimersByTime(1);
    expect(shuffle).toHaveBeenCalledTimes(2);
    expect(engine.getTeenPattiState()?.roundId).not.toBe(first.roundId);
    engine.stop();
    expect(engine.getTeenPattiState()).toBeNull();
    expect(engine.isRunning()).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(vi.getTimerCount()).toBe(0);
  });
});