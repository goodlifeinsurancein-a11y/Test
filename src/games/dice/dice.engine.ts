import { randomInt } from 'node:crypto';

export type DiceBetType =
  | 'EXACT_TOTAL'
  | 'ODD'
  | 'EVEN'
  | 'LOW'
  | 'HIGH'
  | 'DOUBLE';

export interface DiceBet {
  type: DiceBetType;
  value?: number;
  amount: number;
}

export interface DiceResult {
  dice1: number;
  dice2: number;
  total: number;
  isDouble: boolean;
}

export interface DiceBetResult {
  bet: DiceBet;
  won: boolean;
  profit: number;
  totalReturn: number;
}

export class DiceEngine {
  private readonly exactTotalPayout: Record<number, number> = {
    2: 35,
    3: 17,
    4: 11,
    5: 8,
    6: 6,
    7: 5,
    8: 6,
    9: 8,
    10: 11,
    11: 17,
    12: 35,
  };

  roll(): DiceResult {
    const dice1 = randomInt(1, 7);
    const dice2 = randomInt(1, 7);

    return {
      dice1,
      dice2,
      total: dice1 + dice2,
      isDouble: dice1 === dice2,
    };
  }

  validateBet(bet: DiceBet): void {
    if (!bet || typeof bet !== 'object') {
      throw new Error('A valid dice bet is required');
    }

    if (!this.isValidBetType(bet.type)) {
      throw new Error('Invalid dice bet type');
    }

    if (!Number.isInteger(bet.amount) || bet.amount < 1) {
      throw new Error('Bet amount must be a positive whole number');
    }

    if (bet.type === 'EXACT_TOTAL') {
      const exactTotal = bet.value;

      if (
        exactTotal === undefined ||
        !Number.isInteger(exactTotal) ||
        exactTotal < 2 ||
        exactTotal > 12
      ) {
        throw new Error('Exact total must be an integer between 2 and 12');
      }
    }
  }

  getPayoutRatio(bet: DiceBet): number {
    this.validateBet(bet);

    switch (bet.type) {
      case 'EXACT_TOTAL':
        return this.exactTotalPayout[bet.value!];

      case 'ODD':
      case 'EVEN':
      case 'LOW':
      case 'HIGH':
        return 1;

      case 'DOUBLE':
        return 10;
    }
  }

  isWinningBet(bet: DiceBet, result: DiceResult): boolean {
    this.validateBet(bet);
    this.validateResult(result);

    switch (bet.type) {
      case 'EXACT_TOTAL':
        return bet.value === result.total;

      case 'ODD':
        return result.total % 2 === 1;

      case 'EVEN':
        return result.total % 2 === 0;

      case 'LOW':
        return result.total >= 2 && result.total <= 6;

      case 'HIGH':
        return result.total >= 8 && result.total <= 12;

      case 'DOUBLE':
        return result.isDouble;
    }
  }

  settleBet(bet: DiceBet, result: DiceResult): DiceBetResult {
    this.validateBet(bet);

    const won = this.isWinningBet(bet, result);

    if (!won) {
      return {
        bet,
        won: false,
        profit: -bet.amount,
        totalReturn: 0,
      };
    }

    const ratio = this.getPayoutRatio(bet);
    const profit = bet.amount * ratio;

    return {
      bet,
      won: true,
      profit,
      totalReturn: bet.amount + profit,
    };
  }

  private isValidBetType(type: unknown): type is DiceBetType {
    return (
      type === 'EXACT_TOTAL' ||
      type === 'ODD' ||
      type === 'EVEN' ||
      type === 'LOW' ||
      type === 'HIGH' ||
      type === 'DOUBLE'
    );
  }

  private validateResult(result: DiceResult): void {
    if (
      !result ||
      !Number.isInteger(result.dice1) ||
      !Number.isInteger(result.dice2) ||
      result.dice1 < 1 ||
      result.dice1 > 6 ||
      result.dice2 < 1 ||
      result.dice2 > 6 ||
      result.total !== result.dice1 + result.dice2 ||
      result.isDouble !== (result.dice1 === result.dice2)
    ) {
      throw new Error('Invalid dice result');
    }
  }
}
