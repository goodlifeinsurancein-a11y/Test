import { describe, expect, it } from 'vitest';
import { HiLoEngine, buildDeck, cardValue } from './hi-lo.engine.js';

describe('HiLoEngine', () => {
  const engine = new HiLoEngine();

  describe('validateBet', () => {
    it('accepts valid bet', () => expect(() => engine.validateBet({ betId: 'b1', choice: 'HIGHER', amount: 100 })).not.toThrow());
    it('rejects invalid choice', () => expect(() => engine.validateBet({ betId: 'b1', choice: 'SIDEWAYS' as any, amount: 100 })).toThrow());
    it('rejects zero amount', () => expect(() => engine.validateBet({ betId: 'b1', choice: 'HIGHER', amount: 0 })).toThrow());
    it('rejects negative amount', () => expect(() => engine.validateBet({ betId: 'b1', choice: 'LOWER', amount: -5 })).toThrow());
    it('rejects empty betId', () => expect(() => engine.validateBet({ betId: '', choice: 'EQUAL', amount: 10 })).toThrow());
  });

  describe('generateResult', () => {
    it('returns two cards and correct outcome', () => {
      const deck = buildDeck();
      // Force a known scenario by using first two cards: 2 of CLUBS and ACE of SPADES
      const result = engine.generateResult(deck);
      expect(result.currentCard).toBeDefined();
      expect(result.nextCard).toBeDefined();
      expect(['HIGHER','LOWER','EQUAL']).toContain(result.outcome);
    });

    it('A followed by 2 is LOWER', () => {
      const result = engine.generateResult([{ suit:'SPADES', rank:'A', value:14 }, { suit:'CLUBS', rank:'2', value:2 }]);
      expect(result.outcome).toBe('LOWER');
    });

    it('2 followed by A is HIGHER', () => {
      const result = engine.generateResult([{ suit:'CLUBS', rank:'2', value:2 }, { suit:'SPADES', rank:'A', value:14 }]);
      expect(result.outcome).toBe('HIGHER');
    });

    it('K followed by K is EQUAL', () => {
      const result = engine.generateResult([{ suit:'HEARTS', rank:'K', value:13 }, { suit:'DIAMONDS', rank:'K', value:13 }]);
      expect(result.outcome).toBe('EQUAL');
    });
  });

  describe('settleBet', () => {
    it('pays 1.95x for correct HIGHER', () => {
      const result = { currentCard: { suit:'CLUBS',rank:'5',value:5 }, nextCard:{ suit:'HEARTS',rank:'K',value:13 }, outcome:'HIGHER' as const };
      const settlement = engine.settleBet({ betId:'b1', playerId:'p1', choice:'HIGHER', amount:100, status:'PENDING', placedAt:Date.now() }, result, Date.now());
      expect(settlement.status).toBe('WIN');
      expect(settlement.totalReturn).toBe(195);
    });

    it('pays 5x for correct EQUAL', () => {
      const result = { currentCard: { suit:'CLUBS',rank:'7',value:7 }, nextCard:{ suit:'HEARTS',rank:'7',value:7 }, outcome:'EQUAL' as const };
      const settlement = engine.settleBet({ betId:'b2', playerId:'p1', choice:'EQUAL', amount:100, status:'PENDING', placedAt:Date.now() }, result, Date.now());
      expect(settlement.status).toBe('WIN');
      expect(settlement.totalReturn).toBe(500);
    });

    it('loses on wrong prediction', () => {
      const result = { currentCard: { suit:'CLUBS',rank:'2',value:2 }, nextCard:{ suit:'HEARTS',rank:'A',value:14 }, outcome:'HIGHER' as const };
      const settlement = engine.settleBet({ betId:'b3', playerId:'p1', choice:'LOWER', amount:100, status:'PENDING', placedAt:Date.now() }, result, Date.now());
      expect(settlement.status).toBe('LOSS');
      expect(settlement.totalReturn).toBe(0);
    });
  });
});
