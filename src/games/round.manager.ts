import { randomUUID } from 'node:crypto';

export type RoundStatus =
  | 'BETTING'
  | 'LOCK'
  | 'PROCESSING'
  | 'RESULT'
  | 'COMPLETED';

export interface RoundState {
  roundId: string;
  roundNumber: number;
  status: RoundStatus;
  startedAt: number;
  bettingEndsAt: number;
  resultAt: number | null;
  completedAt: number | null;
}

const VALID_TRANSITIONS: Record<RoundStatus, RoundStatus[]> = {
  BETTING: ['LOCK'],
  LOCK: ['PROCESSING'],
  PROCESSING: ['RESULT'],
  RESULT: ['COMPLETED'],
  COMPLETED: [],
};

export class RoundManager {
  private currentRound: RoundState | null = null;
  private nextRoundNumber = 1;

  startRound(): RoundState {
    if (this.currentRound?.status !== 'COMPLETED' && this.currentRound !== null) {
      throw new Error('A round is already active');
    }

    const now = Date.now();

    this.currentRound = {
      roundId: randomUUID(),
      roundNumber: this.nextRoundNumber++,
      status: 'BETTING',
      startedAt: now,
      bettingEndsAt: now + 15_000,
      resultAt: null,
      completedAt: null,
    };

    return this.currentRound;
  }

  getCurrentRound(): RoundState | null {
    return this.currentRound;
  }

  setNextRoundNumber(nextRoundNumber: number): void {
    if (!Number.isInteger(nextRoundNumber) || nextRoundNumber < 1) {
      throw new Error('Next round number must be a positive integer');
    }

    this.nextRoundNumber = nextRoundNumber;
  }

  setStatus(nextStatus: RoundStatus): RoundState {
    if (!this.currentRound) {
      throw new Error('No active round');
    }

    const currentStatus = this.currentRound.status;
    const allowed = VALID_TRANSITIONS[currentStatus];

    if (!allowed.includes(nextStatus)) {
      throw new Error(
        `Invalid round transition: ${currentStatus} -> ${nextStatus}`,
      );
    }

    this.currentRound.status = nextStatus;

    if (nextStatus === 'RESULT') {
      this.currentRound.resultAt = Date.now();
    }

    if (nextStatus === 'COMPLETED') {
      this.currentRound.completedAt = Date.now();
    }

    return this.currentRound;
  }

  clearRound(): void {
    this.currentRound = null;
  }
}
