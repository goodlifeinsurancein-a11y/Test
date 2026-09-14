import { randomUUID } from 'node:crypto';
import { PokerEngine } from './poker.engine.js';
import {
  PokerBet,
  PokerCard,
  PokerHand,
  PokerPlayerRound,
  PokerRoundResult,
  PokerRoundState,
  PokerSettlement,
} from './poker.types.js';

export class PokerRoundEngine {
  readonly BETTING_MS = 15_000;
  readonly DEAL_MS = 1_000;
  readonly COMPARE_MS = 1_000;
  readonly SETTLEMENT_MS = 5_000;
  readonly RESULT_MS = 1_000;
  readonly MAX_PLAYERS = 8;

  private readonly pokerEngine: PokerEngine;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private current: PokerRoundState | null = null;
  private remainingDeck: PokerCard[] = [];
  private lastResult: PokerRoundResult | null = null;
  private nextRoundNumber = 1;

  constructor(pokerEngine: PokerEngine = new PokerEngine()) {
    this.pokerEngine = pokerEngine;
  }

  start(): PokerRoundState {
    if (this.running) throw new Error('Poker round engine is already running');
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

  getState(): PokerRoundState | null {
    return this.current ? this.publicState(this.current) : null;
  }

  getLastCompletedRound(): PokerRoundResult | null {
    return this.lastResult ? this.cloneResult(this.lastResult) : null;
  }

  /** Backward-compatible alias for callers using the previous API name. */
  getLastResult(): PokerRoundResult | null {
    return this.getLastCompletedRound();
  }

  placeBet(playerId: string, amount: number): void {
    const round = this.current;
    if (!round || round.status !== 'BETTING') {
      throw new Error('Bets are accepted only during BETTING');
    }
    this.pokerEngine.validatePlayerId(playerId);
    if (round.players.some((p) => p.playerId === playerId)) {
      throw new Error('Player already placed a poker bet');
    }
    if (round.players.length >= this.MAX_PLAYERS) {
      throw new Error('Maximum number of players reached');
    }
    if (!Number.isInteger(amount) || amount < 1) {
      throw new Error('Bet amount must be a positive whole number');
    }
    const bet: PokerBet = { playerId, amount };
    round.players.push({
      playerId,
      cards: [],
      hand: null,
      bet,
      result: null,
      profit: 0,
      totalReturn: 0,
    });
  }

  submitHold(playerId: string, holdIndices: number[]): void {
    const round = this.current;
    if (!round || round.status !== 'LOCK') {
      throw new Error('Hold selection is accepted only during LOCK');
    }
    const player = round.players.find((p) => p.playerId === playerId);
    if (!player) {
      throw new Error('Player has not placed a bet in this round');
    }
    if (!Array.isArray(holdIndices)) {
      throw new Error('Hold must be an array');
    }
    for (const idx of holdIndices) {
      if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx > 4) {
        throw new Error('Hold indices must be integers between 0 and 4');
      }
    }
    if (new Set(holdIndices).size !== holdIndices.length) {
      throw new Error('Hold indices must be unique');
    }
    player.bet.hold = [...holdIndices];
  }

  private startNextRound(): PokerRoundState {
    const now = Date.now();
    this.remainingDeck = this.pokerEngine.shuffleDeck(this.pokerEngine.createDeck());
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

    for (const player of this.current.players) {
      if (!player.bet.hold) {
        player.bet.hold = [];
      }
    }

    this.schedule(() => this.deal(), 0);
  }

  private deal(): void {
    if (!this.running || !this.current) return;
    this.current.status = 'DEAL';
    this.current.dealtAt = Date.now();

    for (const player of this.current.players) {
      const { hand, remainingDeck } = this.pokerEngine.dealCards(this.remainingDeck, 5);
      player.cards = hand;
      this.remainingDeck = remainingDeck;

      const holdIndices = player.bet.hold ?? [];
      const { finalHand, remainingDeck: deckAfterDraw } = this.pokerEngine.draw(
        player.cards,
        holdIndices,
        this.remainingDeck,
      );
      player.cards = finalHand;
      this.remainingDeck = deckAfterDraw;
      player.hand = this.pokerEngine.evaluateHand(player.cards);
    }

    this.schedule(() => this.compare(), this.DEAL_MS);
  }

  private compare(): void {
    if (!this.running || !this.current) return;
    this.current.status = 'COMPARE';
    this.current.comparedAt = Date.now();

    for (const player of this.current.players) {
      if (!player.hand) throw new Error('Player hand is not available');
      const settlement = this.pokerEngine.settleBet(player.bet, player.hand, this.current.comparedAt!);
      player.result = settlement.result;
      player.profit = settlement.profit;
      player.totalReturn = settlement.totalReturn;
      this.current.settlements.push(settlement);
    }

    this.schedule(() => this.settle(), this.COMPARE_MS);
  }

  private settle(): void {
    if (!this.running || !this.current) return;
    this.current.status = 'SETTLEMENT';
    this.current.settledAt = Date.now();
    this.schedule(() => this.result(), this.SETTLEMENT_MS);
  }

  private result(): void {
    if (!this.running || !this.current) return;
    this.current.status = 'RESULT';
    this.current.resultAt = Date.now();
    this.schedule(() => this.complete(), this.RESULT_MS);
  }

  private complete(): void {
    if (!this.running || !this.current) return;
    this.current.status = 'COMPLETED';
    this.current.completedAt = Date.now();
    this.lastResult = this.toResult(this.current);
    this.schedule(() => {
      if (this.running) this.startNextRound();
    }, 0);
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

  private publicState(round: PokerRoundState): PokerRoundState {
    const visible = round.status !== 'BETTING' && round.status !== 'LOCK';
    return {
      ...round,
      players: round.players.map((player) => this.clonePlayer(player, visible)),
      settlements: visible ? round.settlements.map((s) => ({ ...s })) : [],
    };
  }

  private toResult(round: PokerRoundState): PokerRoundResult {
    if (round.completedAt === null) throw new Error('Poker round is not completed');
    return {
      roundId: round.roundId,
      roundNumber: round.roundNumber,
      players: round.players.map((player) => this.clonePlayer(player, true)),
      settlements: round.settlements.map((s) => ({ ...s })),
      completedAt: round.completedAt,
    };
  }

  private cloneResult(result: PokerRoundResult): PokerRoundResult {
    return {
      ...result,
      players: result.players.map((player) => this.clonePlayer(player, true)),
      settlements: result.settlements.map((s) => ({ ...s })),
    };
  }

  private clonePlayer(player: PokerPlayerRound, visible: boolean): PokerPlayerRound {
    return {
      playerId: player.playerId,
      cards: visible ? player.cards.map((card) => ({ ...card })) : [],
      hand: visible && player.hand ? { ...player.hand, cards: player.hand.cards.map((c) => ({ ...c })) } : null,
      bet: { ...player.bet, hold: player.bet.hold ? [...player.bet.hold] : undefined },
      result: visible ? player.result : null,
      profit: visible ? player.profit : 0,
      totalReturn: visible ? player.totalReturn : 0,
    };
  }
}
