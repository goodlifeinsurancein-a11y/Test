import {
  RoundManager,
  RoundState,
} from './round.manager.js';

export abstract class GameEngine {
  protected readonly roundManager = new RoundManager();

  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  protected readonly BETTING_MS = 15_000;
  protected readonly PROCESSING_MS = 3_000;
  protected readonly RESULT_MS = 5_000;

  start(): RoundState {
    if (this.running) {
      throw new Error('Game engine is already running');
    }

    this.running = true;

    return this.startNextRound();
  }

  stop(): void {
    this.running = false;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.roundManager.clearRound();
    this.onStop();
  }

  getState(): RoundState | null {
    return this.roundManager.getCurrentRound();
  }

  setNextRoundNumber(nextRoundNumber: number): void {
    this.roundManager.setNextRoundNumber(nextRoundNumber);
  }

  isRunning(): boolean {
    return this.running;
  }

  protected onBettingStart(_round: RoundState): void {}

  protected onBettingEnd(_round: RoundState): void {}

  protected onProcessing(_round: RoundState): void {}

  protected async onResult(_round: RoundState): Promise<void> {}

  protected onRoundCompleted(_round: RoundState): void {}

  protected onStop(): void {}

  private startNextRound(): RoundState {
    const round = this.roundManager.startRound();

    this.onBettingStart(round);

    this.timer = setTimeout(() => {
      this.lockBetting();
    }, this.BETTING_MS);

    return round;
  }

  private lockBetting(): void {
    if (!this.running) return;

    const round = this.roundManager.setStatus('LOCK');
    this.onBettingEnd(round);

    this.timer = setTimeout(() => {
      this.startProcessing();
    }, 0);
  }

  private startProcessing(): void {
    if (!this.running) return;

    const round = this.roundManager.setStatus('PROCESSING');
    this.onProcessing(round);

    this.timer = setTimeout(() => {
      void this.showResult();
    }, this.PROCESSING_MS);
  }

  private async showResult(): Promise<void> {
    if (!this.running) return;

    const round = this.roundManager.setStatus('RESULT');

    try {
      await this.onResult(round);
    } catch (error) {
      console.error('Game result processing failed:', error);
      return;
    }

    if (!this.running) return;

    this.timer = setTimeout(() => {
      this.completeRound();
    }, this.RESULT_MS);
  }

  private completeRound(): void {
    if (!this.running) return;

    const round = this.roundManager.setStatus('COMPLETED');
    this.onRoundCompleted(round);

    this.timer = setTimeout(() => {
      if (this.running) {
        this.startNextRound();
      }
    }, 0);
  }
}
