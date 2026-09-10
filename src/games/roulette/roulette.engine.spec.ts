import { describe, expect, it, vi } from 'vitest';

import { RouletteEngine } from './roulette.engine.js';

describe('RouletteEngine - winning bets', () => {
  it('should calculate a winning RED color bet correctly', () => {
    const eventBus = {
      publish: vi.fn(),
    };

    const engine = new RouletteEngine(eventBus as any);

    engine.start();

    const state = engine.getState();

    expect(state).not.toBeNull();
    expect(state?.status).toBe('BETTING');

    engine.addBet({ betId: "test-bet-1", 
      playerId: 'test-player',
      betType: 'COLOR',
      betValue: 'RED',
      amount: 1,
    });

    state!.status = 'PROCESSING';

    (engine as any).result = {
      number: 7,
      color: 'RED',
    };

    state!.status = 'RESULT';

    const outcomes = engine.calculateBetOutcomes();

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].status).toBe('WIN');
    expect(outcomes[0].profit).toBe(1);
    expect(outcomes[0].totalReturn).toBe(2);

    engine.stop();
  });

  it('should calculate a winning NUMBER bet with 35:1 payout correctly', () => {
    const eventBus = {
      publish: vi.fn(),
    };

    const engine = new RouletteEngine(eventBus as any);

    engine.start();

    const state = engine.getState();

    expect(state).not.toBeNull();
    expect(state?.status).toBe('BETTING');

    engine.addBet({ betId: "test-bet-1", 
      playerId: 'test-player',
      betType: 'NUMBER',
      betValue: '7',
      amount: 1,
    });

    state!.status = 'PROCESSING';

    (engine as any).result = {
      number: 7,
      color: 'RED',
    };

    state!.status = 'RESULT';

    const outcomes = engine.calculateBetOutcomes();

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].status).toBe('WIN');
    expect(outcomes[0].profit).toBe(35);
    expect(outcomes[0].totalReturn).toBe(36);

    engine.stop();
  });
});

describe('RouletteEngine - ODD/EVEN bets', () => {
  it('should calculate a winning ODD bet correctly', () => {
    const eventBus = {
      publish: vi.fn(),
    };

    const engine = new RouletteEngine(eventBus as any);

    engine.start();

    const state = engine.getState();

    expect(state).not.toBeNull();
    expect(state?.status).toBe('BETTING');

    engine.addBet({ betId: "test-bet-1", 
      playerId: 'test-player',
      betType: 'ODD_EVEN',
      betValue: 'ODD',
      amount: 1,
    });

    state!.status = 'PROCESSING';

    (engine as any).result = {
      number: 7,
      color: 'RED',
    };

    state!.status = 'RESULT';

    const outcomes = engine.calculateBetOutcomes();

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].status).toBe('WIN');
    expect(outcomes[0].profit).toBe(1);
    expect(outcomes[0].totalReturn).toBe(2);

    engine.stop();
  });

  it('should calculate a winning EVEN bet correctly', () => {
    const eventBus = {
      publish: vi.fn(),
    };

    const engine = new RouletteEngine(eventBus as any);

    engine.start();

    const state = engine.getState();

    expect(state).not.toBeNull();
    expect(state?.status).toBe('BETTING');

    engine.addBet({ betId: "test-bet-1", 
      playerId: 'test-player',
      betType: 'ODD_EVEN',
      betValue: 'EVEN',
      amount: 1,
    });

    state!.status = 'PROCESSING';

    (engine as any).result = {
      number: 8,
      color: 'BLACK',
    };

    state!.status = 'RESULT';

    const outcomes = engine.calculateBetOutcomes();

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].status).toBe('WIN');
    expect(outcomes[0].profit).toBe(1);
    expect(outcomes[0].totalReturn).toBe(2);

    engine.stop();
  });
});

describe('RouletteEngine - LOW/HIGH bets', () => {
  it('should calculate a winning LOW bet correctly', () => {
    const eventBus = {
      publish: vi.fn(),
    };

    const engine = new RouletteEngine(eventBus as any);

    engine.start();

    const state = engine.getState();

    expect(state).not.toBeNull();
    expect(state?.status).toBe('BETTING');

    engine.addBet({ betId: "test-bet-1", 
      playerId: 'test-player',
      betType: 'LOW_HIGH',
      betValue: 'LOW',
      amount: 1,
    });

    state!.status = 'PROCESSING';

    (engine as any).result = {
      number: 18,
      color: 'BLACK',
    };

    state!.status = 'RESULT';

    const outcomes = engine.calculateBetOutcomes();

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].status).toBe('WIN');
    expect(outcomes[0].profit).toBe(1);
    expect(outcomes[0].totalReturn).toBe(2);

    engine.stop();
  });

  it('should calculate a winning HIGH bet correctly', () => {
    const eventBus = {
      publish: vi.fn(),
    };

    const engine = new RouletteEngine(eventBus as any);

    engine.start();

    const state = engine.getState();

    expect(state).not.toBeNull();
    expect(state?.status).toBe('BETTING');

    engine.addBet({ betId: "test-bet-1", 
      playerId: 'test-player',
      betType: 'LOW_HIGH',
      betValue: 'HIGH',
      amount: 1,
    });

    state!.status = 'PROCESSING';

    (engine as any).result = {
      number: 19,
      color: 'RED',
    };

    state!.status = 'RESULT';

    const outcomes = engine.calculateBetOutcomes();

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].status).toBe('WIN');
    expect(outcomes[0].profit).toBe(1);
    expect(outcomes[0].totalReturn).toBe(2);

    engine.stop();
  });
});

describe('RouletteEngine - DOZEN bets', () => {
  it('should calculate a winning 1-12 dozen bet correctly', () => {
    const eventBus = {
      publish: vi.fn(),
    };

    const engine = new RouletteEngine(eventBus as any);

    engine.start();

    const state = engine.getState();

    expect(state).not.toBeNull();
    expect(state?.status).toBe('BETTING');

    engine.addBet({ betId: "test-bet-1", 
      playerId: 'test-player',
      betType: 'DOZEN',
      betValue: '1-12',
      amount: 1,
    });

    state!.status = 'PROCESSING';

    (engine as any).result = {
      number: 12,
      color: 'RED',
    };

    state!.status = 'RESULT';

    const outcomes = engine.calculateBetOutcomes();

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].status).toBe('WIN');
    expect(outcomes[0].profit).toBe(2);
    expect(outcomes[0].totalReturn).toBe(3);

    engine.stop();
  });

  it('should calculate a winning 13-24 dozen bet correctly', () => {
    const eventBus = {
      publish: vi.fn(),
    };

    const engine = new RouletteEngine(eventBus as any);

    engine.start();

    const state = engine.getState();

    expect(state).not.toBeNull();
    expect(state?.status).toBe('BETTING');

    engine.addBet({ betId: "test-bet-1", 
      playerId: 'test-player',
      betType: 'DOZEN',
      betValue: '13-24',
      amount: 1,
    });

    state!.status = 'PROCESSING';

    (engine as any).result = {
      number: 24,
      color: 'BLACK',
    };

    state!.status = 'RESULT';

    const outcomes = engine.calculateBetOutcomes();

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].status).toBe('WIN');
    expect(outcomes[0].profit).toBe(2);
    expect(outcomes[0].totalReturn).toBe(3);

    engine.stop();
  });

  it('should calculate a winning 25-36 dozen bet correctly', () => {
    const eventBus = {
      publish: vi.fn(),
    };

    const engine = new RouletteEngine(eventBus as any);

    engine.start();

    const state = engine.getState();

    expect(state).not.toBeNull();
    expect(state?.status).toBe('BETTING');

    engine.addBet({ betId: "test-bet-1", 
      playerId: 'test-player',
      betType: 'DOZEN',
      betValue: '25-36',
      amount: 1,
    });

    state!.status = 'PROCESSING';

    (engine as any).result = {
      number: 36,
      color: 'BLACK',
    };

    state!.status = 'RESULT';

    const outcomes = engine.calculateBetOutcomes();

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].status).toBe('WIN');
    expect(outcomes[0].profit).toBe(2);
    expect(outcomes[0].totalReturn).toBe(3);

    engine.stop();
  });
});

describe('RouletteEngine - ZERO special behavior', () => {
  it('should lose COLOR, ODD/EVEN, LOW/HIGH and DOZEN bets when result is ZERO', () => {
    const eventBus = {
      publish: vi.fn(),
    };

    const engine = new RouletteEngine(eventBus as any);

    engine.start();

    const state = engine.getState();

    expect(state).not.toBeNull();
    expect(state?.status).toBe('BETTING');

    engine.addBet({ betId: "test-bet-1", 
      playerId: 'test-player',
      betType: 'COLOR',
      betValue: 'RED',
      amount: 1,
    });

    engine.addBet({ betId: "test-bet-1", 
      playerId: 'test-player',
      betType: 'ODD_EVEN',
      betValue: 'ODD',
      amount: 1,
    });

    engine.addBet({ betId: "test-bet-1", 
      playerId: 'test-player',
      betType: 'LOW_HIGH',
      betValue: 'LOW',
      amount: 1,
    });

    engine.addBet({ betId: "test-bet-1", 
      playerId: 'test-player',
      betType: 'DOZEN',
      betValue: '1-12',
      amount: 1,
    });

    state!.status = 'PROCESSING';

    (engine as any).result = {
      number: 0,
      color: 'GREEN',
    };

    state!.status = 'RESULT';

    const outcomes = engine.calculateBetOutcomes();

    expect(outcomes).toHaveLength(4);

    for (const outcome of outcomes) {
      expect(outcome.status).toBe('LOSS');
      expect(outcome.profit).toBe(0);
      expect(outcome.totalReturn).toBe(0);
    }

    engine.stop();
  });

  it('should win a NUMBER ZERO bet with 35:1 payout', () => {
    const eventBus = {
      publish: vi.fn(),
    };

    const engine = new RouletteEngine(eventBus as any);

    engine.start();

    const state = engine.getState();

    expect(state).not.toBeNull();
    expect(state?.status).toBe('BETTING');

    engine.addBet({ betId: "test-bet-1", 
      playerId: 'test-player',
      betType: 'NUMBER',
      betValue: '0',
      amount: 1,
    });

    state!.status = 'PROCESSING';

    (engine as any).result = {
      number: 0,
      color: 'GREEN',
    };

    state!.status = 'RESULT';

    const outcomes = engine.calculateBetOutcomes();

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].status).toBe('WIN');
    expect(outcomes[0].profit).toBe(35);
    expect(outcomes[0].totalReturn).toBe(36);

    engine.stop();
  });
});

describe('RouletteEngine - multiple bets in same round', () => {
  it('should accept multiple bets from the same player in one round', () => {
    const eventBus = {
      publish: vi.fn(),
    };

    const engine = new RouletteEngine(eventBus as any);

    engine.start();

    const state = engine.getState();

    expect(state).not.toBeNull();
    expect(state?.status).toBe('BETTING');

    engine.addBet({ betId: "test-bet-1", 
      playerId: 'test-player',
      betType: 'COLOR',
      betValue: 'RED',
      amount: 1,
    });

    engine.addBet({ betId: "test-bet-1", 
      playerId: 'test-player',
      betType: 'ODD_EVEN',
      betValue: 'ODD',
      amount: 1,
    });

    engine.addBet({ betId: "test-bet-1", 
      playerId: 'test-player',
      betType: 'LOW_HIGH',
      betValue: 'LOW',
      amount: 1,
    });

    engine.addBet({ betId: "test-bet-1", 
      playerId: 'test-player',
      betType: 'DOZEN',
      betValue: '1-12',
      amount: 1,
    });

    engine.addBet({ betId: "test-bet-1", 
      playerId: 'test-player',
      betType: 'NUMBER',
      betValue: '7',
      amount: 1,
    });

    state!.status = 'PROCESSING';

    (engine as any).result = {
      number: 7,
      color: 'RED',
    };

    state!.status = 'RESULT';

    const outcomes = engine.calculateBetOutcomes();

    expect(outcomes).toHaveLength(5);

    expect(outcomes[0].status).toBe('WIN');
    expect(outcomes[1].status).toBe('WIN');
    expect(outcomes[2].status).toBe('WIN');
    expect(outcomes[3].status).toBe('WIN');
    expect(outcomes[4].status).toBe('WIN');

    expect(outcomes[0].totalReturn).toBe(2);
    expect(outcomes[1].totalReturn).toBe(2);
    expect(outcomes[2].totalReturn).toBe(2);
    expect(outcomes[3].totalReturn).toBe(3);
    expect(outcomes[4].totalReturn).toBe(36);

    engine.stop();
  });
});

describe('RouletteEngine - mixed WIN and LOSS bets', () => {
  it('should calculate winning and losing bets independently', () => {
    const eventBus = {
      publish: vi.fn(),
    };

    const engine = new RouletteEngine(eventBus as any);

    engine.start();

    const state = engine.getState();

    expect(state).not.toBeNull();
    expect(state?.status).toBe('BETTING');

    // Result will be 7 RED

    engine.addBet({ betId: "test-bet-1", 
      playerId: 'test-player',
      betType: 'COLOR',
      betValue: 'RED',
      amount: 1,
    });

    engine.addBet({ betId: "test-bet-1", 
      playerId: 'test-player',
      betType: 'ODD_EVEN',
      betValue: 'EVEN',
      amount: 1,
    });

    engine.addBet({ betId: "test-bet-1", 
      playerId: 'test-player',
      betType: 'LOW_HIGH',
      betValue: 'HIGH',
      amount: 1,
    });

    engine.addBet({ betId: "test-bet-1", 
      playerId: 'test-player',
      betType: 'DOZEN',
      betValue: '13-24',
      amount: 1,
    });

    engine.addBet({ betId: "test-bet-1", 
      playerId: 'test-player',
      betType: 'NUMBER',
      betValue: '7',
      amount: 1,
    });

    state!.status = 'PROCESSING';

    (engine as any).result = {
      number: 7,
      color: 'RED',
    };

    state!.status = 'RESULT';

    const outcomes = engine.calculateBetOutcomes();

    expect(outcomes).toHaveLength(5);

    // RED → WIN
    expect(outcomes[0].status).toBe('WIN');
    expect(outcomes[0].profit).toBe(1);
    expect(outcomes[0].totalReturn).toBe(2);

    // EVEN → LOSS
    expect(outcomes[1].status).toBe('LOSS');
    expect(outcomes[1].profit).toBe(0);
    expect(outcomes[1].totalReturn).toBe(0);

    // HIGH → LOSS
    expect(outcomes[2].status).toBe('LOSS');
    expect(outcomes[2].profit).toBe(0);
    expect(outcomes[2].totalReturn).toBe(0);

    // 13-24 → LOSS
    expect(outcomes[3].status).toBe('LOSS');
    expect(outcomes[3].profit).toBe(0);
    expect(outcomes[3].totalReturn).toBe(0);

    // NUMBER 7 → WIN
    expect(outcomes[4].status).toBe('WIN');
    expect(outcomes[4].profit).toBe(35);
    expect(outcomes[4].totalReturn).toBe(36);

    engine.stop();
  });
});

describe('RouletteEngine - NUMBER boundary and invalid bets', () => {
  it('should accept NUMBER 36 as a valid bet', () => {
    const eventBus = {
      publish: vi.fn(),
    };

    const engine = new RouletteEngine(eventBus as any);

    engine.start();

    expect(() => {
      engine.addBet({ betId: "test-bet-1", 
        playerId: 'test-player',
        betType: 'NUMBER',
        betValue: '36',
        amount: 1,
      });
    }).not.toThrow();

    expect(engine.getState()?.status).toBe('BETTING');

    engine.stop();
  });

  it('should reject NUMBER 37 as invalid', () => {
    const eventBus = {
      publish: vi.fn(),
    };

    const engine = new RouletteEngine(eventBus as any);

    engine.start();

    expect(() => {
      engine.validateBetForService({
      betId: "test-bet-1",
      playerId: 'test-player',
        betType: 'NUMBER',
        betValue: '37',
        amount: 1,
      });
    }).toThrow('Number bet must be between 0 and 36');

    engine.stop();
  });

  it('should reject NUMBER -1 as invalid', () => {
    const eventBus = {
      publish: vi.fn(),
    };

    const engine = new RouletteEngine(eventBus as any);

    engine.start();

    expect(() => {
      engine.validateBetForService({
      betId: "test-bet-1",
      playerId: 'test-player',
        betType: 'NUMBER',
        betValue: '-1',
        amount: 1,
      });
    }).toThrow('Number bet must be between 0 and 36');

    engine.stop();
  });
});

describe('RouletteEngine - LOW/HIGH boundary and invalid bets', () => {
  it('should accept LOW as a valid bet', () => {
    const eventBus = {
      publish: vi.fn(),
    };

    const engine = new RouletteEngine(eventBus as any);

    engine.start();

    expect(() => {
      engine.addBet({ betId: "test-bet-1", 
        playerId: 'test-player',
        betType: 'LOW_HIGH',
        betValue: 'LOW',
        amount: 1,
      });
    }).not.toThrow();

    engine.stop();
  });

  it('should accept HIGH as a valid bet', () => {
    const eventBus = {
      publish: vi.fn(),
    };

    const engine = new RouletteEngine(eventBus as any);

    engine.start();

    expect(() => {
      engine.addBet({ betId: "test-bet-1", 
        playerId: 'test-player',
        betType: 'LOW_HIGH',
        betValue: 'HIGH',
        amount: 1,
      });
    }).not.toThrow();

    engine.stop();
  });

  it('should reject an invalid LOW/HIGH value', () => {
    const eventBus = {
      publish: vi.fn(),
    };

    const engine = new RouletteEngine(eventBus as any);

    engine.start();

    expect(() => {
      engine.validateBetForService({
      betId: "test-bet-1",
      playerId: 'test-player',
        betType: 'LOW_HIGH',
        betValue: '1-18',
        amount: 1,
      });
    }).toThrow('LOW_HIGH must be LOW or HIGH');

    engine.stop();
  });
});

describe('RouletteEngine - DOZEN boundary and invalid bets', () => {
  it('should accept 1-12 as a valid dozen bet', () => {
    const eventBus = {
      publish: vi.fn(),
    };

    const engine = new RouletteEngine(eventBus as any);

    engine.start();

    expect(() => {
      engine.addBet({ betId: "test-bet-1", 
        playerId: 'test-player',
        betType: 'DOZEN',
        betValue: '1-12',
        amount: 1,
      });
    }).not.toThrow();

    engine.stop();
  });

  it('should accept 13-24 as a valid dozen bet', () => {
    const eventBus = {
      publish: vi.fn(),
    };

    const engine = new RouletteEngine(eventBus as any);

    engine.start();

    expect(() => {
      engine.addBet({ betId: "test-bet-1", 
        playerId: 'test-player',
        betType: 'DOZEN',
        betValue: '13-24',
        amount: 1,
      });
    }).not.toThrow();

    engine.stop();
  });

  it('should accept 25-36 as a valid dozen bet', () => {
    const eventBus = {
      publish: vi.fn(),
    };

    const engine = new RouletteEngine(eventBus as any);

    engine.start();

    expect(() => {
      engine.addBet({ betId: "test-bet-1", 
        playerId: 'test-player',
        betType: 'DOZEN',
        betValue: '25-36',
        amount: 1,
      });
    }).not.toThrow();

    engine.stop();
  });

  it('should reject an invalid 1-13 dozen value', () => {
    const eventBus = {
      publish: vi.fn(),
    };

    const engine = new RouletteEngine(eventBus as any);

    engine.start();

    expect(() => {
      engine.validateBetForService({
      betId: "test-bet-1",
      playerId: 'test-player',
        betType: 'DOZEN',
        betValue: '1-13',
        amount: 1,
      });
    }).toThrow('Invalid dozen');

    engine.stop();
  });

  it('should reject an invalid 0-12 dozen value', () => {
    const eventBus = {
      publish: vi.fn(),
    };

    const engine = new RouletteEngine(eventBus as any);

    engine.start();

    expect(() => {
      engine.validateBetForService({
      betId: "test-bet-1",
      playerId: 'test-player',
        betType: 'DOZEN',
        betValue: '0-12',
        amount: 1,
      });
    }).toThrow('Invalid dozen');

    engine.stop();
  });

  it('should reject an invalid 37-48 dozen value', () => {
    const eventBus = {
      publish: vi.fn(),
    };

    const engine = new RouletteEngine(eventBus as any);

    engine.start();

    expect(() => {
      engine.validateBetForService({
      betId: "test-bet-1",
      playerId: 'test-player',
        betType: 'DOZEN',
        betValue: '37-48',
        amount: 1,
      });
    }).toThrow('Invalid dozen');

    engine.stop();
  });
});

describe('RouletteEngine - bet amount validation', () => {
  it('should accept a positive whole-number amount', () => {
    const eventBus = {
      publish: vi.fn(),
    };

    const engine = new RouletteEngine(eventBus as any);

    engine.start();

    expect(() => {
      engine.validateBetForService({
      betId: "test-bet-1",
      playerId: 'test-player',
        betType: 'COLOR',
        betValue: 'RED',
        amount: 1,
      });
    }).not.toThrow();

    expect(() => {
      engine.validateBetForService({
      betId: "test-bet-1",
      playerId: 'test-player',
        betType: 'COLOR',
        betValue: 'RED',
        amount: 100,
      });
    }).not.toThrow();

    engine.stop();
  });

  it('should reject amount 0', () => {
    const eventBus = {
      publish: vi.fn(),
    };

    const engine = new RouletteEngine(eventBus as any);

    engine.start();

    expect(() => {
      engine.validateBetForService({
      betId: "test-bet-1",
      playerId: 'test-player',
        betType: 'COLOR',
        betValue: 'RED',
        amount: 0,
      });
    }).toThrow('Bet amount must be a positive whole number');

    engine.stop();
  });

  it('should reject a negative amount', () => {
    const eventBus = {
      publish: vi.fn(),
    };

    const engine = new RouletteEngine(eventBus as any);

    engine.start();

    expect(() => {
      engine.validateBetForService({
      betId: "test-bet-1",
      playerId: 'test-player',
        betType: 'COLOR',
        betValue: 'RED',
        amount: -1,
      });
    }).toThrow('Bet amount must be a positive whole number');

    engine.stop();
  });

  it('should reject a decimal amount', () => {
    const eventBus = {
      publish: vi.fn(),
    };

    const engine = new RouletteEngine(eventBus as any);

    engine.start();

    expect(() => {
      engine.validateBetForService({
      betId: "test-bet-1",
      playerId: 'test-player',
        betType: 'COLOR',
        betValue: 'RED',
        amount: 1.5,
      });
    }).toThrow('Bet amount must be a positive whole number');

    engine.stop();
  });

  it('should reject NaN amount', () => {
    const eventBus = {
      publish: vi.fn(),
    };

    const engine = new RouletteEngine(eventBus as any);

    engine.start();

    expect(() => {
      engine.validateBetForService({
      betId: "test-bet-1",
      playerId: 'test-player',
        betType: 'COLOR',
        betValue: 'RED',
        amount: NaN,
      });
    }).toThrow('Bet amount must be a positive whole number');

    engine.stop();
  });
});

describe('RouletteEngine - betting lifecycle', () => {
  it('should accept bets during BETTING state', () => {
    const eventBus = {
      publish: vi.fn(),
    };

    const engine = new RouletteEngine(eventBus as any);

    engine.start();

    expect(engine.getState()?.status).toBe('BETTING');

    expect(() => {
      engine.addBet({ betId: "test-bet-1", 
        playerId: 'test-player',
        betType: 'COLOR',
        betValue: 'RED',
        amount: 1,
      });
    }).not.toThrow();

    engine.stop();
  });

  it('should reject bets during PROCESSING state', () => {
    const eventBus = {
      publish: vi.fn(),
    };

    const engine = new RouletteEngine(eventBus as any);

    engine.start();

    const state = engine.getState();

    expect(state).not.toBeNull();

    state!.status = 'PROCESSING';

    expect(() => {
      engine.addBet({ betId: "test-bet-1", 
        playerId: 'test-player',
        betType: 'COLOR',
        betValue: 'RED',
        amount: 1,
      });
    }).toThrow('Bets are accepted only during BETTING');

    engine.stop();
  });
});

describe('RouletteEngine - betting closed states', () => {
  it('should reject bets during LOCK state', () => {
    const eventBus = {
      publish: vi.fn(),
    };

    const engine = new RouletteEngine(eventBus as any);

    engine.start();

    const state = engine.getState();

    expect(state).not.toBeNull();

    state!.status = 'LOCK';

    expect(() => {
      engine.addBet({ betId: "test-bet-1", 
        playerId: 'test-player',
        betType: 'COLOR',
        betValue: 'RED',
        amount: 1,
      });
    }).toThrow('Bets are accepted only during BETTING');

    engine.stop();
  });

  it('should reject bets during RESULT state', () => {
    const eventBus = {
      publish: vi.fn(),
    };

    const engine = new RouletteEngine(eventBus as any);

    engine.start();

    const state = engine.getState();

    expect(state).not.toBeNull();

    state!.status = 'RESULT';

    expect(() => {
      engine.addBet({ betId: "test-bet-1", 
        playerId: 'test-player',
        betType: 'COLOR',
        betValue: 'RED',
        amount: 1,
      });
    }).toThrow('Bets are accepted only during BETTING');

    engine.stop();
  });

  it('should reject bets during COMPLETED state', () => {
    const eventBus = {
      publish: vi.fn(),
    };

    const engine = new RouletteEngine(eventBus as any);

    engine.start();

    const state = engine.getState();

    expect(state).not.toBeNull();

    state!.status = 'COMPLETED';

    expect(() => {
      engine.addBet({ betId: "test-bet-1", 
        playerId: 'test-player',
        betType: 'COLOR',
        betValue: 'RED',
        amount: 1,
      });
    }).toThrow('Bets are accepted only during BETTING');

    engine.stop();
  });
});

describe('RouletteEngine - round lifecycle', () => {
  it('should start in BETTING state', () => {
    const eventBus = {
      publish: vi.fn(),
    };

    const engine = new RouletteEngine(eventBus as any);

    const round = engine.start();

    expect(round.status).toBe('BETTING');
    expect(engine.isRunning()).toBe(true);

    engine.stop();
  });

  it('should follow the correct round state order', () => {
    const eventBus = {
      publish: vi.fn(),
    };

    const engine = new RouletteEngine(eventBus as any);

    engine.start();

    expect(engine.getState()?.status).toBe('BETTING');

    const roundManager = (engine as any).roundManager;

    roundManager.setStatus('LOCK');
    expect(engine.getState()?.status).toBe('LOCK');

    roundManager.setStatus('PROCESSING');
    expect(engine.getState()?.status).toBe('PROCESSING');

    roundManager.setStatus('RESULT');
    expect(engine.getState()?.status).toBe('RESULT');

    roundManager.setStatus('COMPLETED');
    expect(engine.getState()?.status).toBe('COMPLETED');

    engine.stop();
  });

  it('should reject skipping a round state', () => {
    const eventBus = {
      publish: vi.fn(),
    };

    const engine = new RouletteEngine(eventBus as any);

    engine.start();

    const roundManager = (engine as any).roundManager;

    expect(() => {
      roundManager.setStatus('RESULT');
    }).toThrow('Invalid round transition');

    expect(engine.getState()?.status).toBe('BETTING');

    engine.stop();
  });

  it('should reject backward round transitions', () => {
    const eventBus = {
      publish: vi.fn(),
    };

    const engine = new RouletteEngine(eventBus as any);

    engine.start();

    const roundManager = (engine as any).roundManager;

    roundManager.setStatus('LOCK');
    roundManager.setStatus('PROCESSING');

    expect(() => {
      roundManager.setStatus('BETTING');
    }).toThrow('Invalid round transition');

    expect(engine.getState()?.status).toBe('PROCESSING');

    engine.stop();
  });

  it('should reject starting another round while one is active', () => {
    const eventBus = {
      publish: vi.fn(),
    };

    const engine = new RouletteEngine(eventBus as any);

    engine.start();

    expect(() => {
      engine.start();
    }).toThrow('Game engine is already running');

    engine.stop();
  });
});

describe('RouletteEngine - bet type and value security', () => {
  const createEngine = () => {
    const eventBus = {
      publish: vi.fn(),
    };

    const engine = new RouletteEngine(eventBus as any);
    engine.start();

    const roundManager = (engine as any).roundManager;
    roundManager.setStatus('LOCK');
    roundManager.setStatus('PROCESSING');
    roundManager.setStatus('RESULT');

    return engine;
  };

  it('should accept valid COLOR values', () => {
    const engine = createEngine();

    expect(() => {
      engine.validateBetForService({
      betId: "test-bet-1",
      playerId: 'test-player',
        betType: 'COLOR',
        betValue: 'RED',
        amount: 1,
      });
    }).not.toThrow();

    expect(() => {
      engine.validateBetForService({
      betId: "test-bet-1",
      playerId: 'test-player',
        betType: 'COLOR',
        betValue: 'BLACK',
        amount: 1,
      });
    }).not.toThrow();

    engine.stop();
  });

  it('should reject invalid COLOR values', () => {
    const engine = createEngine();

    expect(() => {
      engine.validateBetForService({
      betId: "test-bet-1",
      playerId: 'test-player',
        betType: 'COLOR',
        betValue: 'GREEN',
        amount: 1,
      });
    }).toThrow();

    expect(() => {
      engine.validateBetForService({
      betId: "test-bet-1",
      playerId: 'test-player',
        betType: 'COLOR',
        betValue: 'BLUE',
        amount: 1,
      });
    }).toThrow();

    engine.stop();
  });

  it('should accept valid ODD_EVEN values', () => {
    const engine = createEngine();

    expect(() => {
      engine.validateBetForService({
      betId: "test-bet-1",
      playerId: 'test-player',
        betType: 'ODD_EVEN',
        betValue: 'ODD',
        amount: 1,
      });
    }).not.toThrow();

    expect(() => {
      engine.validateBetForService({
      betId: "test-bet-1",
      playerId: 'test-player',
        betType: 'ODD_EVEN',
        betValue: 'EVEN',
        amount: 1,
      });
    }).not.toThrow();

    engine.stop();
  });

  it('should reject invalid ODD_EVEN values', () => {
    const engine = createEngine();

    expect(() => {
      engine.validateBetForService({
      betId: "test-bet-1",
      playerId: 'test-player',
        betType: 'ODD_EVEN',
        betValue: 'RED',
        amount: 1,
      });
    }).toThrow();

    expect(() => {
      engine.validateBetForService({
      betId: "test-bet-1",
      playerId: 'test-player',
        betType: 'ODD_EVEN',
        betValue: 'MIDDLE',
        amount: 1,
      });
    }).toThrow();

    engine.stop();
  });

  it('should reject completely unknown bet types', () => {
    const engine = createEngine();

    expect(() => {
      engine.validateBetForService({
      betId: "test-bet-1",
      playerId: 'test-player',
        betType: 'UNKNOWN',
        betValue: 'TEST',
        amount: 1,
      } as any);
    }).toThrow();

    expect(() => {
      engine.validateBetForService({
      betId: "test-bet-1",
      playerId: 'test-player',
        betType: 'RANDOM_TYPE',
        betValue: 'RANDOM',
        amount: 1,
      } as any);
    }).toThrow();

    engine.stop();
  });

  it('should reject empty bet type or value', () => {
    const engine = createEngine();

    expect(() => {
      engine.validateBetForService({
      betId: "test-bet-1",
      playerId: 'test-player',
        betType: '',
        betValue: 'RED',
        amount: 1,
      } as any);
    }).toThrow();

    expect(() => {
      engine.validateBetForService({
      betId: "test-bet-1",
      playerId: 'test-player',
        betType: 'COLOR',
        betValue: '',
        amount: 1,
      });
    }).toThrow();

    engine.stop();
  });

  it('should reject wrong-case bet values', () => {
    const engine = createEngine();

    expect(() => {
      engine.validateBetForService({
      betId: "test-bet-1",
      playerId: 'test-player',
        betType: 'COLOR',
        betValue: 'red',
        amount: 1,
      });
    }).toThrow();

    expect(() => {
      engine.validateBetForService({
      betId: "test-bet-1",
      playerId: 'test-player',
        betType: 'ODD_EVEN',
        betValue: 'odd',
        amount: 1,
      });
    }).toThrow();

    engine.stop();
  });

  it('should accept valid NUMBER values from 0 to 36', () => {
    const engine = createEngine();

    for (const number of [0, 1, 18, 36]) {
      expect(() => {
        engine.validateBetForService({
      betId: "test-bet-1",
      playerId: 'test-player',
          betType: 'NUMBER',
          betValue: String(number),
          amount: 1,
        });
      }).not.toThrow();
    }

    engine.stop();
  });

  it('should reject NUMBER values outside 0 to 36', () => {
    const engine = createEngine();

    for (const number of ['-1', '37', '100', 'abc']) {
      expect(() => {
        engine.validateBetForService({
      betId: "test-bet-1",
      playerId: 'test-player',
          betType: 'NUMBER',
          betValue: number,
          amount: 1,
        });
      }).toThrow();
    }

    engine.stop();
  });
});

describe('RouletteEngine - multiple and unlimited bets', () => {
  const createEngine = () => {
    const eventBus = {
      publish: vi.fn(),
    };

    const engine = new RouletteEngine(eventBus as any);
    engine.start();

    return engine;
  };

  let betCounter = 0;
  const makeBet = (
    betType: any,
    betValue: string,
    amount: number,
    playerId = 'test-player',
  ) => ({
    betId: `test-bet-${++betCounter}`,
    playerId,
    betType,
    betValue,
    amount,
  });

  it('should accept multiple bets from the same player', () => {
    const engine = createEngine();

    engine.addBet(makeBet('COLOR', 'RED', 1));
    engine.addBet(makeBet('ODD_EVEN', 'ODD', 2));
    engine.addBet(makeBet('LOW_HIGH', 'LOW', 3));

    const bets = engine.getRouletteState()?.bets;

    expect(bets).toHaveLength(3);

    engine.stop();
  });

  it('should accept multiple bets with the same bet type', () => {
    const engine = createEngine();

    engine.addBet(makeBet('COLOR', 'RED', 1));
    engine.addBet(makeBet('COLOR', 'BLACK', 2));
    engine.addBet(makeBet('COLOR', 'RED', 3));

    const bets = engine.getRouletteState()?.bets;

    expect(bets).toHaveLength(3);

    expect(bets?.[0].amount).toBe(1);
    expect(bets?.[1].amount).toBe(2);
    expect(bets?.[2].amount).toBe(3);

    engine.stop();
  });

  it('should accept bets from multiple players in the same round', () => {
    const engine = createEngine();

    engine.addBet(makeBet('COLOR', 'RED', 1, 'player-1'));
    engine.addBet(makeBet('COLOR', 'BLACK', 2, 'player-2'));
    engine.addBet(makeBet('NUMBER', '7', 3, 'player-3'));

    const bets = engine.getRouletteState()?.bets;

    expect(bets).toHaveLength(3);

    expect(bets?.map((bet) => bet.playerId)).toEqual([
      'player-1',
      'player-2',
      'player-3',
    ]);

    engine.stop();
  });

  it('should have no fixed 10-bet limit', () => {
    const engine = createEngine();

    for (let i = 1; i <= 20; i++) {
      engine.addBet(
        makeBet(
          'NUMBER',
          String(i % 37),
          1,
          `player-${i}`,
        ),
      );
    }

    const bets = engine.getRouletteState()?.bets;

    expect(bets).toHaveLength(20);

    engine.stop();
  });
});

describe('RouletteEngine - payout boundary cases', () => {
  const createEngine = () => {
    const eventBus = {
      publish: vi.fn(),
    };

    const engine = new RouletteEngine(eventBus as any);
    engine.start();

    return engine;
  };

  const setResult = (
    engine: RouletteEngine,
    number: number,
    color: 'RED' | 'BLACK' | 'GREEN',
  ) => {
    const engineAny = engine as any;

    const roundManager = engineAny.roundManager;
    roundManager.setStatus('LOCK');
    roundManager.setStatus('PROCESSING');
    roundManager.setStatus('RESULT');

    engineAny.result = {
      number,
      color,
    };
  };

  it('should pay NUMBER 35:1 when result is 0', () => {
    const engine = createEngine();

    engine.addBet({ betId: "test-bet-1", 
      playerId: 'player-1',
      betType: 'NUMBER',
      betValue: '0',
      amount: 10,
    });

    setResult(engine, 0, 'GREEN');

    const outcomes = engine.calculateBetOutcomes();

    expect(outcomes[0].status).toBe('WIN');
    expect(outcomes[0].profit).toBe(350);
    expect(outcomes[0].totalReturn).toBe(360);

    engine.stop();
  });

  it('should pay NUMBER 35:1 when result is 36', () => {
    const engine = createEngine();

    engine.addBet({ betId: "test-bet-1", 
      playerId: 'player-1',
      betType: 'NUMBER',
      betValue: '36',
      amount: 10,
    });

    setResult(engine, 36, 'RED');

    const outcomes = engine.calculateBetOutcomes();

    expect(outcomes[0].status).toBe('WIN');
    expect(outcomes[0].profit).toBe(350);
    expect(outcomes[0].totalReturn).toBe(360);

    engine.stop();
  });

  it('should make COLOR lose when result is 0', () => {
    const engine = createEngine();

    engine.addBet({ betId: "test-bet-1", 
      playerId: 'player-1',
      betType: 'COLOR',
      betValue: 'RED',
      amount: 10,
    });

    setResult(engine, 0, 'GREEN');

    const outcomes = engine.calculateBetOutcomes();

    expect(outcomes[0].status).toBe('LOSS');
    expect(outcomes[0].profit).toBe(0);
    expect(outcomes[0].totalReturn).toBe(0);

    engine.stop();
  });

  it('should make ODD_EVEN lose when result is 0', () => {
    const engine = createEngine();

    engine.addBet({ betId: "test-bet-1", 
      playerId: 'player-1',
      betType: 'ODD_EVEN',
      betValue: 'EVEN',
      amount: 10,
    });

    setResult(engine, 0, 'GREEN');

    const outcomes = engine.calculateBetOutcomes();

    expect(outcomes[0].status).toBe('LOSS');
    expect(outcomes[0].profit).toBe(0);
    expect(outcomes[0].totalReturn).toBe(0);

    engine.stop();
  });

  it('should make LOW_HIGH lose when result is 0', () => {
    const engine = createEngine();

    engine.addBet({ betId: "test-bet-1", 
      playerId: 'player-1',
      betType: 'LOW_HIGH',
      betValue: 'LOW',
      amount: 10,
    });

    setResult(engine, 0, 'GREEN');

    const outcomes = engine.calculateBetOutcomes();

    expect(outcomes[0].status).toBe('LOSS');
    expect(outcomes[0].profit).toBe(0);
    expect(outcomes[0].totalReturn).toBe(0);

    engine.stop();
  });

  it('should make DOZEN lose when result is 0', () => {
    const engine = createEngine();

    engine.addBet({ betId: "test-bet-1", 
      playerId: 'player-1',
      betType: 'DOZEN',
      betValue: '1-12',
      amount: 10,
    });

    setResult(engine, 0, 'GREEN');

    const outcomes = engine.calculateBetOutcomes();

    expect(outcomes[0].status).toBe('LOSS');
    expect(outcomes[0].profit).toBe(0);
    expect(outcomes[0].totalReturn).toBe(0);

    engine.stop();
  });

  it('should treat 18 as LOW and 19 as HIGH', () => {
    const engine = createEngine();

    engine.addBet({ betId: "test-bet-1", 
      playerId: 'player-1',
      betType: 'LOW_HIGH',
      betValue: 'LOW',
      amount: 10,
    });

    setResult(engine, 18, 'RED');

    let outcomes = engine.calculateBetOutcomes();

    expect(outcomes[0].status).toBe('WIN');
    expect(outcomes[0].totalReturn).toBe(20);

    engine.stop();

    const engine2 = createEngine();

    engine2.addBet({
      betId: "test-bet-1",
      playerId: 'player-1',
      betType: 'LOW_HIGH',
      betValue: 'HIGH',
      amount: 10,
    });

    setResult(engine2, 19, 'RED');

    outcomes = engine2.calculateBetOutcomes();

    expect(outcomes[0].status).toBe('WIN');
    expect(outcomes[0].totalReturn).toBe(20);

    engine2.stop();
  });

  it('should correctly handle all dozen boundaries', () => {
    const cases = [
      { number: 1, value: '1-12' },
      { number: 12, value: '1-12' },
      { number: 13, value: '13-24' },
      { number: 24, value: '13-24' },
      { number: 25, value: '25-36' },
      { number: 36, value: '25-36' },
    ];

    for (const testCase of cases) {
      const engine = createEngine();

      engine.addBet({ betId: "test-bet-1", 
        playerId: 'player-1',
        betType: 'DOZEN',
        betValue: testCase.value,
        amount: 10,
      });

      setResult(
        engine,
        testCase.number,
        testCase.number % 2 === 0 ? 'BLACK' : 'RED',
      );

      const outcomes = engine.calculateBetOutcomes();

      expect(outcomes[0].status).toBe('WIN');
      expect(outcomes[0].profit).toBe(20);
      expect(outcomes[0].totalReturn).toBe(30);

      engine.stop();
    }
  });
});
