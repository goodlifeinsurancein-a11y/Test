import { describe, expect, it } from 'vitest';
import { AndarBaharEngine } from './andar-bahar.engine.js';
import { AndarBaharBetInput, Card } from './andar-bahar.types.js';

const card = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });

describe('AndarBaharEngine deck and dealing', () => {
  const engine = new AndarBaharEngine();
  it('creates 52 unique cards across four suits and thirteen ranks', () => {
    const deck = engine.createDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map((item) => `${item.rank}-${item.suit}`)).size).toBe(52);
    expect(new Set(deck.map((item) => item.suit))).toEqual(new Set(['SPADES', 'HEARTS', 'DIAMONDS', 'CLUBS']));
    expect(new Set(deck.map((item) => item.rank))).toHaveLength(13);
  });
  it('shuffles securely and removes exactly one indicator card', () => {
    const deck = engine.createDeck(); const shuffled = engine.shuffleDeck(deck); const dealt = engine.dealIndicator(shuffled);
    expect(new Set(shuffled.map((item) => `${item.rank}-${item.suit}`))).toEqual(new Set(deck.map((item) => `${item.rank}-${item.suit}`)));
    expect(dealt.remainingDeck).toHaveLength(51);
    expect(dealt.remainingDeck).not.toContainEqual(dealt.indicatorCard);
  });
  it('alternates ANDAR then BAHAR, stops at the first match, and ignores suits', () => {
    const indicator = card('7', 'HEARTS');
    const deal = engine.dealUntilMatch(indicator, [card('K', 'CLUBS'), card('3', 'SPADES'), card('7', 'DIAMONDS'), card('7', 'CLUBS')]);
    expect(deal.dealtCards.map((item) => item.side)).toEqual(['ANDAR', 'BAHAR', 'ANDAR']);
    expect(deal.dealtCards).toHaveLength(3);
    expect(deal.result.winner).toBe('ANDAR');
    expect(deal.result.matchingCard.card).toEqual(card('7', 'DIAMONDS'));
  });
  it('returns BAHAR when the first matching card is dealt on Bahar', () => {
    const deal = engine.dealUntilMatch(card('A', 'SPADES'), [card('K', 'CLUBS'), card('A', 'HEARTS')]);
    expect(deal.result.winner).toBe('BAHAR');
  });
});

describe('AndarBaharEngine bets and settlement', () => {
  const engine = new AndarBaharEngine();
  const result = engine.dealUntilMatch(card('7', 'HEARTS'), [card('K', 'CLUBS'), card('7', 'SPADES')]).result;
  it('uses locked ANDAR and BAHAR payout ratios', () => { expect(engine.getPayoutRatio('ANDAR')).toBe(1); expect(engine.getPayoutRatio('BAHAR')).toBe(0.9); });
  it('settles BAHAR wins without floating-point garbage and losses correctly', () => {
    expect(engine.settleBet({ betId: 'win', type: 'BAHAR', amount: 10 }, 'p', result, 1)).toMatchObject({ status: 'WIN', profit: 9, totalReturn: 19 });
    expect(engine.settleBet({ betId: 'loss', type: 'ANDAR', amount: 10 }, 'p', result, 1)).toMatchObject({ status: 'LOSS', profit: -10, totalReturn: 0 });
  });
  it.each([
    { betId: '', type: 'ANDAR', amount: 1 }, { betId: 'type', type: 'INVALID', amount: 1 }, { betId: 'zero', type: 'ANDAR', amount: 0 }, { betId: 'negative', type: 'ANDAR', amount: -1 }, { betId: 'decimal', type: 'ANDAR', amount: 1.5 }, { betId: 'nan', type: 'ANDAR', amount: Number.NaN }, { betId: 'infinity', type: 'ANDAR', amount: Infinity },
  ])('rejects invalid bet input: %o', (bet) => { expect(() => engine.validateBet(bet as AndarBaharBetInput)).toThrow(); });
  it('rejects invalid player IDs', () => { expect(() => engine.validatePlayerId('')).toThrow(); expect(() => engine.validatePlayerId('  ')).toThrow(); });
});
