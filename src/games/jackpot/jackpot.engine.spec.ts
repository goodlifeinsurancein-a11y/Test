import { afterEach, describe, expect, it, vi } from 'vitest';
import { JackpotEngine } from './jackpot.engine.js';
import { JackpotRoundEngine } from './jackpot.round.engine.js';
import { JackpotBetInput, JackpotResult } from './jackpot.types.js';

const mockResult: JackpotResult = {
  winningNumbers: [1, 5, 10, 15, 20, 30],
  generatedAt: 100,
};

// ── Engine unit tests ──────────────────────────────────────────────

describe('JackpotEngine', () => {
  const engine = new JackpotEngine();

  it('generates 6 unique winning numbers from 1..36', () => {
    for (let i = 0; i < 200; i++) {
      const res = engine.generateResult();
      expect(res.winningNumbers).toHaveLength(6);
      const unique = new Set(res.winningNumbers);
      expect(unique.size).toBe(6);
      for (const n of res.winningNumbers) {
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(36);
      }
      expect(res.generatedAt).toBeGreaterThan(0);
    }
  });

  it('draw distribution is uniform across range (statistical sanity)', () => {
    const counts = new Array(37).fill(0);
    for (let i = 0; i < 5000; i++) {
      for (const n of engine.generateResult().winningNumbers) counts[n]++;
    }
    for (let n = 1; n <= 36; n++) {
      const freq = counts[n] / 5000 / 6;
      expect(freq).toBeGreaterThan(0.020);
      expect(freq).toBeLessThan(0.040);
    }
  });

  it('getPayoutMultiplier returns correct tier values', () => {
    expect(engine.getPayoutMultiplier(6)).toBe(1000);
    expect(engine.getPayoutMultiplier(5)).toBe(100);
    expect(engine.getPayoutMultiplier(4)).toBe(25);
    expect(engine.getPayoutMultiplier(3)).toBe(5);
    expect(engine.getPayoutMultiplier(2)).toBe(0);
    expect(engine.getPayoutMultiplier(1)).toBe(0);
    expect(engine.getPayoutMultiplier(0)).toBe(0);
    expect(engine.getPayoutMultiplier(7)).toBe(0);
  });

  it('countMatches counts correctly', () => {
    const winning = [1, 2, 3, 4, 5, 6];
    expect(engine.countMatches([1, 2, 3], winning)).toBe(3);
    expect(engine.countMatches([1, 2, 7], winning)).toBe(2);
    expect(engine.countMatches([7, 8, 9], winning)).toBe(0);
    expect(engine.countMatches([1, 2, 3, 4, 5, 6], winning)).toBe(6);
  });

  it('settles all win tiers and losses with integer arithmetic', () => {
    const baseBet: JackpotBetInput = { betId: 'x', numbers: [1, 5, 10, 15, 20, 30], amount: 10 };

    // 6 matches → 1000x
    expect(engine.settleBet(baseBet, 'p', mockResult)).toMatchObject({
      matchCount: 6,
      status: 'WIN',
      profit: 10000,
      totalReturn: 10010,
    });

    // 5 matches → 100x  (replace 30 with 21, non-winning)
    expect(engine.settleBet({ ...baseBet, betId: 'm5', numbers: [1, 5, 10, 15, 20, 21] }, 'p', mockResult)).toMatchObject({
      matchCount: 5,
      status: 'WIN',
      profit: 1000,
      totalReturn: 1010,
    });

    // 4 matches → 25x  (replace 20,30 with 21,22)
    expect(engine.settleBet({ ...baseBet, betId: 'm4', numbers: [1, 5, 10, 15, 21, 22] }, 'p', mockResult)).toMatchObject({
      matchCount: 4,
      status: 'WIN',
      profit: 250,
      totalReturn: 260,
    });

    // 3 matches → 5x  (replace 15,20,30 with 21,22,23)
    expect(engine.settleBet({ ...baseBet, betId: 'm3', numbers: [1, 5, 10, 21, 22, 23] }, 'p', mockResult)).toMatchObject({
      matchCount: 3,
      status: 'WIN',
      profit: 50,
      totalReturn: 60,
    });

    // 2 matches → LOSS  (replace 10,15,20,30 with 21,22,23,24)
    expect(engine.settleBet({ ...baseBet, betId: 'm2', numbers: [1, 5, 21, 22, 23, 24] }, 'p', mockResult)).toMatchObject({
      matchCount: 2,
      status: 'LOSS',
      profit: -10,
      totalReturn: 0,
    });
  });

  it('settlement values are exact integers (deci-token precision)', () => {
    const s = engine.settleBet(
      { betId: 'prec', numbers: [1, 5, 10, 15, 20, 30], amount: 999 },
      'p',
      mockResult,
    );
    expect(Number.isInteger(s.profit)).toBe(true);
    expect(Number.isInteger(s.totalReturn)).toBe(true);
    expect(s.profit).toBe(999000);
    expect(s.totalReturn).toBe(999 + 999000);
  });

  it.each([
    { betId: '', numbers: [1, 2, 3], amount: 1, desc: 'empty betId' },
    { betId: 'ok', numbers: [], amount: 1, desc: 'no numbers' },
    { betId: 'ok', numbers: [1, 2, 3, 4, 5, 6, 7], amount: 1, desc: 'too many numbers' },
    { betId: 'ok', numbers: [0, 2, 3], amount: 1, desc: 'out of range low' },
    { betId: 'ok', numbers: [37, 2, 3], amount: 1, desc: 'out of range high' },
    { betId: 'ok', numbers: [1, 1, 2], amount: 1, desc: 'duplicate numbers' },
    { betId: 'ok', numbers: [1, 2, 3], amount: 0, desc: 'zero amount' },
    { betId: 'ok', numbers: [1, 2, 3], amount: -1, desc: 'negative amount' },
    { betId: 'ok', numbers: [1, 2, 3], amount: 1.5, desc: 'decimal amount' },
    { betId: 'ok', numbers: [1, 2, 3], amount: Number.NaN, desc: 'NaN amount' },
  ])('rejects invalid bet: $desc', ({ betId, numbers, amount }) => {
    expect(() => engine.validateBet({ betId, numbers, amount })).toThrow();
  });

  it('rejects invalid player id', () => {
    expect(() => engine.validatePlayerId('')).toThrow();
    expect(() => engine.validatePlayerId(' ')).toThrow();
  });

  it('rejects malformed non-object bet input', () => {
    expect(() => engine.validateBet(null as unknown as JackpotBetInput)).toThrow();
    expect(() => engine.validateBet(undefined as unknown as JackpotBetInput)).toThrow();
  });
});

// ── Round engine lifecycle tests ───────────────────────────────────

function advanceBetting(engine: JackpotRoundEngine) {
  vi.advanceTimersByTime(15_000);
  expect(engine.getState()?.status).toBe('LOCK');
}

function advanceGenerate(engine: JackpotRoundEngine) {
  vi.advanceTimersByTime(1);
  expect(engine.getState()?.status).toBe('GENERATE_RESULT');
}

function advanceResult(engine: JackpotRoundEngine) {
  vi.advanceTimersByTime(1_000);
  expect(engine.getState()?.status).toBe('RESULT');
}

function advanceSettlement(engine: JackpotRoundEngine) {
  vi.advanceTimersByTime(1_000);
  expect(engine.getState()?.status).toBe('SETTLEMENT');
}

function advanceComplete(engine: JackpotRoundEngine) {
  vi.advanceTimersByTime(5_000);
  expect(engine.getState()?.status).toBe('COMPLETED');
}

describe('JackpotRoundEngine', () => {
  afterEach(() => vi.useRealTimers());

  it('starts betting, hides result, and accepts multiple players/bets', () => {
    vi.useFakeTimers();
    const engine = new JackpotRoundEngine();
    engine.start();

    engine.placeBet('p1', { betId: 'a', numbers: [1, 2, 3, 4, 5, 6], amount: 1 });
    engine.placeBet('p1', { betId: 'b', numbers: [7, 8, 9, 10, 11, 12], amount: 2 });
    engine.placeBet('p2', { betId: 'c', numbers: [13, 14, 15, 16, 17, 18], amount: 3 });

    const state = engine.getState();
    expect(state?.status).toBe('BETTING');
    expect(state?.result).toBeNull();
    expect(state?.bets).toHaveLength(3);
    expect(() => engine.placeBet('p', { betId: 'a', numbers: [1], amount: 1 })).toThrow('Duplicate');
    engine.stop();
  });

  it('locks at 15s, hides result, and rejects later bets', () => {
    vi.useFakeTimers();
    const engine = new JackpotRoundEngine();
    engine.start();
    advanceBetting(engine);
    expect(() => engine.placeBet('p', { betId: 'late', numbers: [1], amount: 1 })).toThrow('BETTING');
    engine.stop();
  });

  it('generates once, reveals result, settles, completes, and advances round numbers', () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(JackpotEngine.prototype, 'generateResult').mockReturnValue(mockResult);
    const engine = new JackpotRoundEngine();
    const first = engine.start();

    engine.placeBet('p', { betId: 'win', numbers: [1, 5, 10, 15, 20, 30], amount: 10 });

    advanceBetting(engine);
    advanceGenerate(engine);
    expect(engine.getState()?.result).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);

    advanceResult(engine);
    expect(engine.getState()).toMatchObject({
      status: 'RESULT',
      result: { winningNumbers: mockResult.winningNumbers },
      settlements: [],
    });

    advanceSettlement(engine);
    const s = engine.getState();
    expect(s?.status).toBe('SETTLEMENT');
    expect(s?.settlements).toHaveLength(1);
    expect(s?.settlements[0]).toMatchObject({ betId: 'win', status: 'WIN', profit: 10000, totalReturn: 10010 });

    advanceComplete(engine);
    expect(engine.getState()?.status).toBe('COMPLETED');
    expect(engine.getLastCompletedRound()?.roundId).toBe(first.roundId);

    vi.advanceTimersByTime(1);
    expect(engine.getState()).toMatchObject({ status: 'BETTING', roundNumber: first.roundNumber + 1 });
    engine.stop();
  });

  it('uses one result for every bet and rejects invalid input', () => {
    vi.useFakeTimers();
    vi.spyOn(JackpotEngine.prototype, 'generateResult').mockReturnValue(mockResult);
    const engine = new JackpotRoundEngine();
    engine.start();

    engine.placeBet('p1', { betId: 'win', numbers: [1, 5, 10, 15, 20, 30], amount: 2 });
    engine.placeBet('p2', { betId: 'loss', numbers: [2, 3, 4, 6, 7, 8], amount: 2 });

    expect(() => engine.placeBet('', { betId: 'bad', numbers: [1], amount: 1 })).toThrow();

    advanceBetting(engine);
    advanceGenerate(engine);
    advanceResult(engine);
    advanceSettlement(engine);

    const state = engine.getState();
    expect(state?.settlements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ betId: 'win', status: 'WIN', totalReturn: 2002 }),
        expect.objectContaining({ betId: 'loss', status: 'LOSS', totalReturn: 0 }),
      ]),
    );
    engine.stop();
  });

  it('prevents duplicate start and stop clears timers', () => {
    vi.useFakeTimers();
    const engine = new JackpotRoundEngine();
    engine.start();
    expect(() => engine.start()).toThrow('already running');
    engine.stop();
    vi.advanceTimersByTime(60_000);
    expect(engine.getState()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bets placed by same player can have different numbers', () => {
    vi.useFakeTimers();
    vi.spyOn(JackpotEngine.prototype, 'generateResult').mockReturnValue(mockResult);
    const engine = new JackpotRoundEngine();
    engine.start();

    engine.placeBet('p', { betId: 'a', numbers: [1, 2, 3, 4, 5, 6], amount: 5 });
    engine.placeBet('p', { betId: 'b', numbers: [1, 5, 10, 15, 20, 30], amount: 5 });

    advanceBetting(engine);
    advanceGenerate(engine);
    advanceResult(engine);
    advanceSettlement(engine);

    const s = engine.getState();
    expect(s?.settlements).toHaveLength(2);
    expect(s?.settlements[0].profit).not.toBe(s?.settlements[1].profit);
    engine.stop();
  });

  it('settles bets with 1-5 picked numbers correctly', () => {
    vi.useFakeTimers();
    const result: JackpotResult = { winningNumbers: [1, 2, 3, 4, 5, 6], generatedAt: 1 };
    vi.spyOn(JackpotEngine.prototype, 'generateResult').mockReturnValue(result);
    const engine = new JackpotRoundEngine();
    engine.start();

    // 3 numbers, 3 matches → 5x
    engine.placeBet('p', { betId: 'm3', numbers: [1, 2, 3], amount: 10 });
    // 2 numbers, 2 matches → LOSS
    engine.placeBet('p', { betId: 'm2', numbers: [1, 2], amount: 10 });
    // 1 number, 1 match → LOSS
    engine.placeBet('p', { betId: 'm1', numbers: [1], amount: 10 });

    advanceBetting(engine);
    advanceGenerate(engine);
    advanceResult(engine);
    advanceSettlement(engine);

    const s = engine.getState();
    const byId = Object.fromEntries(s!.settlements.map((x) => [x.betId, x]));
    expect(byId.m3).toMatchObject({ matchCount: 3, status: 'WIN', profit: 50, totalReturn: 60 });
    expect(byId.m2).toMatchObject({ matchCount: 2, status: 'LOSS', profit: -10, totalReturn: 0 });
    expect(byId.m1).toMatchObject({ matchCount: 1, status: 'LOSS', profit: -10, totalReturn: 0 });
    engine.stop();
  });
});
