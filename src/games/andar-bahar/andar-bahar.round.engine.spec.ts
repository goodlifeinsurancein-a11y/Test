import { afterEach, describe, expect, it, vi } from 'vitest';
import { AndarBaharEngine } from './andar-bahar.engine.js';
import { AndarBaharRoundEngine } from './andar-bahar.round.engine.js';
import { Card } from './andar-bahar.types.js';

function fixedDeck(): Card[] {
  const engine = new AndarBaharEngine();
  const prefix: Card[] = [{ rank: '7', suit: 'HEARTS' }, { rank: 'K', suit: 'CLUBS' }, { rank: '3', suit: 'SPADES' }, { rank: '7', suit: 'DIAMONDS' }];
  return [...prefix, ...engine.createDeck().filter((item) => !prefix.some((first) => first.rank === item.rank && first.suit === item.suit))];
}
function advanceToIndicator(engine: AndarBaharRoundEngine): void { vi.advanceTimersByTime(15_000); expect(engine.getState()?.status).toBe('LOCK'); vi.advanceTimersByTime(1); expect(engine.getState()?.status).toBe('INDICATOR'); }

describe('AndarBaharRoundEngine', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  it('starts BETTING, hides future state, and accepts multiple players and bets', () => {
    vi.useFakeTimers(); const engine = new AndarBaharRoundEngine(); engine.start();
    engine.placeBet('p1', { betId: 'one', type: 'ANDAR', amount: 2 }); engine.placeBet('p1', { betId: 'two', type: 'BAHAR', amount: 3 }); engine.placeBet('p2', { betId: 'three', type: 'ANDAR', amount: 4 });
    expect(engine.getState()).toMatchObject({ status: 'BETTING', indicatorCard: null, dealtCards: [], result: null });
    expect(engine.getState()?.bets).toHaveLength(3);
    expect(() => engine.placeBet('p3', { betId: 'one', type: 'ANDAR', amount: 1 })).toThrow('Duplicate bet id'); engine.stop();
  });
  it('locks after exactly 15 seconds and rejects later bets', () => {
    vi.useFakeTimers(); const engine = new AndarBaharRoundEngine(); engine.start(); vi.advanceTimersByTime(15_000);
    expect(engine.getState()).toMatchObject({ status: 'LOCK', indicatorCard: null, dealtCards: [], result: null });
    expect(() => engine.placeBet('p', { betId: 'late', type: 'ANDAR', amount: 1 })).toThrow('BETTING'); engine.stop();
  });
  it('reveals indicator, then dealt cards, match/result, completion, and next round in order', () => {
    vi.useFakeTimers(); vi.spyOn(AndarBaharEngine.prototype, 'shuffleDeck').mockReturnValue(fixedDeck()); const engine = new AndarBaharRoundEngine(); const first = engine.start(); advanceToIndicator(engine);
    expect(engine.getState()).toMatchObject({ status: 'INDICATOR', indicatorCard: { rank: '7', suit: 'HEARTS' }, dealtCards: [], result: null });
    vi.advanceTimersByTime(1_000); expect(engine.getState()).toMatchObject({ status: 'DEAL', dealtCards: [{ side: 'ANDAR' }, { side: 'BAHAR' }, { side: 'ANDAR' }], result: null });
    vi.advanceTimersByTime(1_000); expect(engine.getState()).toMatchObject({ status: 'MATCH', result: { winner: 'ANDAR' } });
    vi.advanceTimersByTime(1_000); expect(engine.getState()?.status).toBe('RESULT');
    vi.advanceTimersByTime(5_000); expect(engine.getState()?.status).toBe('COMPLETED'); expect(engine.getLastCompletedRound()?.roundId).toBe(first.roundId);
    vi.advanceTimersByTime(1); expect(engine.getState()).toMatchObject({ status: 'BETTING', roundNumber: first.roundNumber + 1 }); engine.stop();
  });
  it('uses one indicator/result for every settlement and stops dealing at the first match', () => {
    vi.useFakeTimers(); vi.spyOn(AndarBaharEngine.prototype, 'shuffleDeck').mockReturnValue(fixedDeck()); const engine = new AndarBaharRoundEngine(); engine.start();
    engine.placeBet('p1', { betId: 'andar', type: 'ANDAR', amount: 10 }); engine.placeBet('p2', { betId: 'bahar', type: 'BAHAR', amount: 10 }); advanceToIndicator(engine); vi.advanceTimersByTime(2_000);
    const state = engine.getState(); expect(state?.dealtCards).toHaveLength(3); expect(state?.result?.winner).toBe('ANDAR');
    expect(state?.settlements).toEqual(expect.arrayContaining([expect.objectContaining({ betId: 'andar', status: 'WIN', profit: 10, totalReturn: 20 }), expect.objectContaining({ betId: 'bahar', status: 'LOSS', profit: -10, totalReturn: 0 })])); engine.stop();
  });
  it('rejects invalid player IDs, bet IDs, and malformed amounts', () => {
    vi.useFakeTimers(); const engine = new AndarBaharRoundEngine(); engine.start();
    expect(() => engine.placeBet('', { betId: 'id', type: 'ANDAR', amount: 1 })).toThrow('Player id is required'); expect(() => engine.placeBet('p', { betId: '', type: 'ANDAR', amount: 1 })).toThrow('Bet id is required'); expect(() => engine.placeBet('p', { betId: 'id', type: 'ANDAR', amount: 1.5 })).toThrow('positive whole number'); engine.stop();
  });
  it('prevents duplicate starts and stop cleans every timer', () => {
    vi.useFakeTimers(); const engine = new AndarBaharRoundEngine(); engine.start(); expect(() => engine.start()).toThrow('already running'); engine.stop(); vi.advanceTimersByTime(60_000); expect(engine.isRunning()).toBe(false); expect(engine.getState()).toBeNull(); expect(vi.getTimerCount()).toBe(0);
  });
});
