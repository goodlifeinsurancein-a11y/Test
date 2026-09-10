import { randomUUID } from 'node:crypto';
import { HiLoEngine, buildDeck, shuffle } from './hi-lo.engine.js';
import { HiLoBet, HiLoBetInput, HiLoResult, HiLoRound, CompletedHiLoRound } from './hi-lo.types.js';

export class HiLoRoundEngine {
  readonly BETTING_MS = 15_000;
  readonly GENERATE_MS = 1_000;
  readonly RESULT_MS = 5_000;
  readonly SETTLEMENT_MS = 5_000;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private current: HiLoRound | null = null;
  private last: CompletedHiLoRound | null = null;
  private nextNumber = 1;
  constructor(private readonly engine = new HiLoEngine()) {}

  start(): HiLoRound {
    if (this.running) throw new Error('HiLo engine already running');
    this.running = true;
    return this.nextRound();
  }
  stop(): void { this.running = false; if (this.timer) clearTimeout(this.timer); this.timer = null; this.current = null; }
  isRunning(): boolean { return this.running; }
  getState(): HiLoRound | null { return this.current ? { ...this.current } : null; }
  getLastCompletedRound(): CompletedHiLoRound | null { return this.last as CompletedHiLoRound | null; }

  placeBet(playerId: string, bet: HiLoBetInput): HiLoBet {
    if (!this.current || this.current.status !== 'BETTING') throw new Error('Betting is closed');
    this.engine.validateBet(bet);
    if (this.current.bets.some(b => b.betId === bet.betId)) throw new Error('Duplicate bet id');
    const placed: HiLoBet = { ...bet, playerId, status: 'PENDING', placedAt: Date.now() };
    this.current.bets.push(placed);
    return { ...placed };
  }

  private nextRound(): HiLoRound {
    const now = Date.now();
    this.current = { roundId: randomUUID(), roundNumber: this.nextNumber++, status: 'BETTING', startedAt: now, bettingEndsAt: now + this.BETTING_MS, lockedAt: null, generatedAt: null, resultAt: null, settledAt: null, completedAt: null, result: null, bets: [], settlements: [] };
    this.timer = setTimeout(() => this.lock(), this.BETTING_MS);
    return { ...this.current };
  }
  private lock(): void { if (!this.running || !this.current) return; this.current.status = 'LOCK'; this.current.lockedAt = Date.now(); this.timer = setTimeout(() => this.generate(), 0); }
  private generate(): void {
    if (!this.running || !this.current) return;
    this.current.status = 'GENERATE_RESULT';
    const deck = shuffle(buildDeck());
    this.current.result = this.engine.generateResult(deck);
    this.current.generatedAt = Date.now();
    this.timer = setTimeout(() => this.result(), this.GENERATE_MS);
  }
  private result(): void { if (!this.running || !this.current || !this.current.result) return; this.current.status = 'RESULT'; this.current.resultAt = Date.now(); this.timer = setTimeout(() => this.settle(), this.RESULT_MS); }
  private settle(): void {
    if (!this.running || !this.current || !this.current.result) return;
    this.current.status = 'SETTLEMENT'; this.current.settledAt = Date.now();
    this.current.settlements = this.current.bets.map(b => this.engine.settleBet(b, this.current!.result!, this.current!.settledAt!));
    this.timer = setTimeout(() => this.complete(), this.SETTLEMENT_MS);
  }
  private complete(): void {
    if (!this.running || !this.current || !this.current.result) return;
    this.current.status = 'COMPLETED'; this.current.completedAt = Date.now();
    this.last = this.current as CompletedHiLoRound;
    this.timer = setTimeout(() => { if (this.running) this.nextRound(); }, 0);
  }
}
