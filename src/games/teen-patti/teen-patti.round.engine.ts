import { randomUUID } from 'node:crypto';
import { TeenPattiEngine } from './teen-patti.engine.js';
import {
  TeenPattiBet,
  TeenPattiCard,
  TeenPattiHand,
  TeenPattiPlayerRound,
  TeenPattiRoundResult,
  TeenPattiRoundState,
  TeenPattiSettlement,
} from './teen-patti.types.js';

export class TeenPattiRoundEngine {
  readonly BETTING_MS = 15_000;
  readonly DEAL_MS = 1_000;
  readonly COMPARE_MS = 1_000;
  readonly SETTLEMENT_MS = 1_000;
  readonly RESULT_MS = 5_000;
  readonly MAX_PLAYERS = 16;

  private readonly cardEngine: TeenPattiEngine;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private current: TeenPattiRoundState | null = null;
  private remainingDeck: TeenPattiCard[] = [];
  private lastResult: TeenPattiRoundResult | null = null;
  private nextRoundNumber = 1;

  constructor(cardEngine: TeenPattiEngine = new TeenPattiEngine()) {
    this.cardEngine = cardEngine;
  }

  start(): TeenPattiRoundState {
    if (this.running) throw new Error('Teen Patti round engine is already running');
    this.running = true;
    return this.startNextRound();
  }

  stop(): void {
    this.running = false;
    this.clearTimer();
    this.current = null;
    this.remainingDeck = [];
  }

  isRunning(): boolean {
    return this.running;
  }

  getState(): TeenPattiRoundState | null {
    return this.getTeenPattiState();
  }

  getTeenPattiState(): TeenPattiRoundState | null {
    return this.current ? this.publicState(this.current) : null;
  }

  getLastResult(): TeenPattiRoundResult | null {
    return this.lastResult ? this.cloneResult(this.lastResult) : null;
  }

  placeBet(playerId: string, amount: number): void {
    const round = this.current;
    if (!round || round.status !== 'BETTING') throw new Error('Bets are accepted only during BETTING');
    this.cardEngine.validatePlayerId(playerId);
    const bet: TeenPattiBet = { playerId, amount };
    this.cardEngine.validateBet(bet);
    if (round.players.some((player) => player.playerId === playerId)) {
      throw new Error('Player already placed a Teen Patti bet');
    }
    if (round.players.length >= this.MAX_PLAYERS || this.cardsNeededForNewPlayer(round) > this.remainingDeck.length) {
      throw new Error('Not enough cards remaining for another player');
    }
    round.players.push({ playerId, cards: [], hand: null, bet, result: null, profit: 0, totalReturn: 0 });
  }

  private startNextRound(): TeenPattiRoundState {
    const now = Date.now();
    this.remainingDeck = this.cardEngine.shuffleDeck(this.cardEngine.createDeck());
    this.current = {
      roundId: randomUUID(),
      roundNumber: this.nextRoundNumber++,
      status: 'BETTING',
      startedAt: now,
      bettingEndsAt: now + this.BETTING_MS,
      lockedAt: null,
      dealtAt: null,
      comparedAt: null,
      settledAt: null,
      resultAt: null,
      completedAt: null,
      dealerCards: [],
      dealerHand: null,
      players: [],
      settlements: [],
    };
    this.schedule(() => this.lock(), this.BETTING_MS);
    return this.publicState(this.current);
  }

  private lock(): void {
    if (!this.running || !this.current) return;
    this.current.status = 'LOCK';
    this.current.lockedAt = Date.now();
    this.schedule(() => this.deal(), 0);
  }

  private deal(): void {
    if (!this.running || !this.current) return;
    this.current.status = 'DEAL';
    this.current.dealtAt = Date.now();
    this.current.dealerCards = this.takeCards(3);
    this.current.dealerHand = this.cardEngine.evaluateHand(this.current.dealerCards);
    for (const player of this.current.players) {
      player.cards = this.takeCards(3);
      player.hand = this.cardEngine.evaluateHand(player.cards);
    }
    this.schedule(() => this.compare(), this.DEAL_MS);
  }

  private compare(): void {
    if (!this.running || !this.current || !this.current.dealerHand) return;
    this.current.status = 'COMPARE';
    this.current.comparedAt = Date.now();
    for (const player of this.current.players) {
      if (!player.hand) throw new Error('Player hand is not available');
      const comparison = this.cardEngine.compareHands(player.hand, this.current.dealerHand);
      player.result = comparison > 0 ? 'WIN' : comparison < 0 ? 'LOSS' : 'TIE';
    }
    this.schedule(() => this.settle(), this.COMPARE_MS);
  }

  private settle(): void {
    if (!this.running || !this.current || !this.current.dealerHand) return;
    this.current.status = 'SETTLEMENT';
    this.current.settledAt = Date.now();
    this.current.settlements = this.current.players.map((player) => {
      if (!player.hand) throw new Error('Player hand is not available');
      const settlement = this.cardEngine.settleBet(player.bet, player.hand, this.current!.dealerHand!, this.current!.settledAt!);
      player.result = settlement.result;
      player.profit = settlement.profit;
      player.totalReturn = settlement.totalReturn;
      return settlement;
    });
    this.schedule(() => this.result(), this.SETTLEMENT_MS);
  }

  private result(): void {
    if (!this.running || !this.current) return;
    this.current.status = 'RESULT';
    this.current.resultAt = Date.now();
    this.schedule(() => this.complete(), this.RESULT_MS);
  }

  private complete(): void {
    if (!this.running || !this.current || !this.current.dealerHand) return;
    this.current.status = 'COMPLETED';
    this.current.completedAt = Date.now();
    this.lastResult = this.toResult(this.current);
    this.schedule(() => {
      if (this.running) this.startNextRound();
    }, 0);
  }

  private takeCards(count: number): TeenPattiCard[] {
    const dealt = this.cardEngine.dealCards(this.remainingDeck, count);
    this.remainingDeck = dealt.remainingDeck;
    return dealt.hand;
  }

  private cardsNeededForNewPlayer(round: TeenPattiRoundState): number {
    return 3 + (round.players.length + 1) * 3;
  }

  private schedule(callback: () => void, delay: number): void {
    this.clearTimer();
    this.timer = setTimeout(callback, delay);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private publicState(round: TeenPattiRoundState): TeenPattiRoundState {
    const visible = round.status === 'RESULT' || round.status === 'COMPLETED';
    return {
      ...round,
      dealerCards: visible ? this.cloneCards(round.dealerCards) : [],
      dealerHand: visible ? this.cloneHand(round.dealerHand) : null,
      players: round.players.map((player) => this.clonePlayer(player, visible)),
      settlements: visible ? round.settlements.map((settlement) => ({ ...settlement })) : [],
    };
  }

  private toResult(round: TeenPattiRoundState): TeenPattiRoundResult {
    if (!round.dealerHand || round.completedAt === null) throw new Error('Teen Patti round is not completed');
    return {
      roundId: round.roundId,
      roundNumber: round.roundNumber,
      dealerCards: this.cloneCards(round.dealerCards),
      dealerHand: this.cloneHand(round.dealerHand)!,
      players: round.players.map((player) => this.clonePlayer(player, true)),
      settlements: round.settlements.map((settlement) => ({ ...settlement })),
      completedAt: round.completedAt,
    };
  }

  private cloneResult(result: TeenPattiRoundResult): TeenPattiRoundResult {
    return {
      ...result,
      dealerCards: this.cloneCards(result.dealerCards),
      dealerHand: this.cloneHand(result.dealerHand)!,
      players: result.players.map((player) => this.clonePlayer(player, true)),
      settlements: result.settlements.map((settlement) => ({ ...settlement })),
    };
  }

  private clonePlayer(player: TeenPattiPlayerRound, visible: boolean): TeenPattiPlayerRound {
    return {
      playerId: player.playerId,
      cards: visible ? this.cloneCards(player.cards) : [],
      hand: visible ? this.cloneHand(player.hand) : null,
      bet: { ...player.bet },
      result: visible ? player.result : null,
      profit: visible ? player.profit : 0,
      totalReturn: visible ? player.totalReturn : 0,
    };
  }

  private cloneCards(cards: readonly TeenPattiCard[]): TeenPattiCard[] {
    return cards.map((card) => ({ ...card }));
  }

  private cloneHand(hand: TeenPattiHand | null): TeenPattiHand | null {
    return hand ? { ...hand, cards: this.cloneCards(hand.cards) } : null;
  }
}
