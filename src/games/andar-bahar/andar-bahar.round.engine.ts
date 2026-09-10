import { randomUUID } from 'node:crypto';
import { AndarBaharEngine } from './andar-bahar.engine.js';
import { AndarBaharBet, AndarBaharBetInput, AndarBaharRound, CompletedAndarBaharRound } from './andar-bahar.types.js';

/** In-memory Andar Bahar lifecycle; no controller, wallet, or persistence dependency. */
export class AndarBaharRoundEngine {
  readonly BETTING_MS = 15_000; readonly INDICATOR_MS = 1_000; readonly DEAL_MS = 1_000; readonly MATCH_MS = 1_000; readonly RESULT_MS = 5_000;
  private timer: ReturnType<typeof setTimeout> | null = null; private running = false; private currentRound: AndarBaharRound | null = null; private lastCompletedRound: CompletedAndarBaharRound | null = null; private nextRoundNumber = 1; private remainingDeck: import('./andar-bahar.types.js').Card[] = [];
  constructor(private readonly engine = new AndarBaharEngine()) {}
  start(): AndarBaharRound { if (this.running) throw new Error('Andar Bahar round engine is already running'); this.running = true; return this.startNextRound(); }
  stop(): void { this.running = false; if (this.timer) clearTimeout(this.timer); this.timer = null; this.currentRound = null; this.remainingDeck = []; }
  isRunning(): boolean { return this.running; }
  getState(): AndarBaharRound | null { return this.currentRound ? this.toPublicRound(this.currentRound) : null; }
  getLastCompletedRound(): CompletedAndarBaharRound | null { return this.lastCompletedRound ? this.toCompletedRound(this.lastCompletedRound) : null; }
  placeBet(playerId: string, bet: AndarBaharBetInput): AndarBaharBet {
    const round = this.requireBettingRound(); this.engine.validatePlayerId(playerId); this.engine.validateBet(bet);
    if (round.bets.some((placedBet) => placedBet.betId === bet.betId)) throw new Error('Duplicate bet id');
    const placedBet: AndarBaharBet = { ...bet, playerId, status: 'PENDING', placedAt: Date.now() }; round.bets.push(placedBet); return { ...placedBet };
  }
  private startNextRound(): AndarBaharRound {
    const startedAt = Date.now(); this.remainingDeck = [];
    this.currentRound = { roundId: randomUUID(), roundNumber: this.nextRoundNumber++, status: 'BETTING', startedAt, bettingEndsAt: startedAt + this.BETTING_MS, lockedAt: null, indicatorAt: null, dealtAt: null, matchedAt: null, resultAt: null, completedAt: null, indicatorCard: null, dealtCards: [], result: null, bets: [], settlements: [] };
    this.timer = setTimeout(() => this.lockBetting(), this.BETTING_MS); return this.toPublicRound(this.currentRound);
  }
  private lockBetting(): void { if (!this.running || !this.currentRound) return; this.currentRound.status = 'LOCK'; this.currentRound.lockedAt = Date.now(); this.timer = setTimeout(() => this.showIndicator(), 0); }
  private showIndicator(): void { if (!this.running || !this.currentRound) return; const dealt = this.engine.dealIndicator(this.engine.shuffleDeck(this.engine.createDeck())); this.remainingDeck = dealt.remainingDeck; this.currentRound.status = 'INDICATOR'; this.currentRound.indicatorAt = Date.now(); this.currentRound.indicatorCard = dealt.indicatorCard; this.timer = setTimeout(() => this.dealCards(), this.INDICATOR_MS); }
  private dealCards(): void { if (!this.running || !this.currentRound || !this.currentRound.indicatorCard) return; const dealt = this.engine.dealUntilMatch(this.currentRound.indicatorCard, this.remainingDeck); this.currentRound.status = 'DEAL'; this.currentRound.dealtAt = Date.now(); this.currentRound.dealtCards = dealt.dealtCards; this.currentRound.result = dealt.result; this.timer = setTimeout(() => this.matchRound(), this.DEAL_MS); }
  private matchRound(): void { if (!this.running || !this.currentRound || !this.currentRound.result) return; this.currentRound.status = 'MATCH'; this.currentRound.matchedAt = Date.now(); this.currentRound.settlements = this.currentRound.bets.map((bet) => { const settlement = this.engine.settleBet(bet, bet.playerId, this.currentRound!.result!, this.currentRound!.matchedAt!); bet.status = settlement.status; return settlement; }); this.timer = setTimeout(() => this.showResult(), this.MATCH_MS); }
  private showResult(): void { if (!this.running || !this.currentRound) return; this.currentRound.status = 'RESULT'; this.currentRound.resultAt = Date.now(); this.timer = setTimeout(() => this.completeRound(), this.RESULT_MS); }
  private completeRound(): void { if (!this.running || !this.currentRound || !this.currentRound.result) return; this.currentRound.status = 'COMPLETED'; this.currentRound.completedAt = Date.now(); this.lastCompletedRound = this.toCompletedRound(this.currentRound); this.timer = setTimeout(() => { if (this.running) this.startNextRound(); }, 0); }
  private requireBettingRound(): AndarBaharRound { if (!this.currentRound || this.currentRound.status !== 'BETTING') throw new Error('Andar Bahar bets are accepted only during BETTING'); return this.currentRound; }
  private toPublicRound(round: AndarBaharRound): AndarBaharRound {
    const revealIndicator = round.status !== 'BETTING' && round.status !== 'LOCK'; const revealCards = ['DEAL', 'MATCH', 'RESULT', 'COMPLETED'].includes(round.status); const revealResult = ['MATCH', 'RESULT', 'COMPLETED'].includes(round.status);
    return { ...round, indicatorCard: revealIndicator && round.indicatorCard ? { ...round.indicatorCard } : null, dealtCards: revealCards ? round.dealtCards.map((item) => ({ ...item, card: { ...item.card } })) : [], result: revealResult && round.result ? { ...round.result, indicatorCard: { ...round.result.indicatorCard }, matchingCard: { ...round.result.matchingCard, card: { ...round.result.matchingCard.card } } } : null, bets: round.bets.map((bet) => ({ ...bet, status: revealResult ? bet.status : 'PENDING' })), settlements: revealResult ? round.settlements.map((settlement) => ({ ...settlement })) : [] };
  }
  private toCompletedRound(round: AndarBaharRound): CompletedAndarBaharRound { if (!round.indicatorCard || !round.result || round.completedAt === null) throw new Error('Andar Bahar round is not completed'); return { ...this.toPublicRound(round), indicatorCard: { ...round.indicatorCard }, result: { ...round.result, indicatorCard: { ...round.result.indicatorCard }, matchingCard: { ...round.result.matchingCard, card: { ...round.result.matchingCard.card } } }, completedAt: round.completedAt, settlements: round.settlements.map((settlement) => ({ ...settlement })) }; }
}
