import { randomInt } from 'node:crypto';
import { AndarBaharBetInput, AndarBaharBetType, AndarBaharResult, AndarBaharSettlement, AndarBaharSide, Card, CardRank, CardSuit, DealtCard } from './andar-bahar.types.js';

const SUITS: CardSuit[] = ['SPADES', 'HEARTS', 'DIAMONDS', 'CLUBS'];
const RANKS: CardRank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

/** Stateless secure deck, alternating-deal, validation, and settlement logic. */
export class AndarBaharEngine {
  createDeck(): Card[] { return SUITS.flatMap((suit) => RANKS.map((rank) => ({ suit, rank }))); }
  shuffleDeck(deck: Card[]): Card[] {
    const shuffled = [...deck];
    for (let index = shuffled.length - 1; index > 0; index--) {
      const swap = randomInt(0, index + 1);
      [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
    }
    return shuffled;
  }
  dealIndicator(deck: Card[]): { indicatorCard: Card; remainingDeck: Card[] } {
    if (deck.length !== 52) throw new Error('A fresh 52-card deck is required');
    const [indicatorCard, ...remainingDeck] = deck;
    if (!indicatorCard) throw new Error('Indicator card is required');
    return { indicatorCard: { ...indicatorCard }, remainingDeck: remainingDeck.map((card) => ({ ...card })) };
  }
  dealUntilMatch(indicatorCard: Card, remainingDeck: Card[]): { dealtCards: DealtCard[]; result: AndarBaharResult } {
    const dealtCards: DealtCard[] = [];
    for (const [index, card] of remainingDeck.entries()) {
      const dealtCard: DealtCard = { side: index % 2 === 0 ? 'ANDAR' : 'BAHAR', card: { ...card }, position: index + 1 };
      dealtCards.push(dealtCard);
      if (card.rank === indicatorCard.rank) return { dealtCards, result: { winner: dealtCard.side, matchingCard: { ...dealtCard, card: { ...card } }, indicatorCard: { ...indicatorCard } } };
    }
    throw new Error('No matching card found in the remaining deck');
  }
  validatePlayerId(playerId: string): void { if (typeof playerId !== 'string' || playerId.trim().length === 0) throw new Error('Player id is required'); }
  validateBet(bet: AndarBaharBetInput): void {
    if (!bet || typeof bet !== 'object') throw new Error('A valid Andar Bahar bet is required');
    if (typeof bet.betId !== 'string' || bet.betId.trim().length === 0) throw new Error('Bet id is required');
    if (bet.type !== 'ANDAR' && bet.type !== 'BAHAR') throw new Error('Invalid Andar Bahar bet type');
    if (!Number.isInteger(bet.amount) || bet.amount < 1) throw new Error('Bet amount must be a positive whole number');
  }
  getPayoutRatio(type: AndarBaharBetType): number { if (type !== 'ANDAR' && type !== 'BAHAR') throw new Error('Invalid Andar Bahar bet type'); return type === 'ANDAR' ? 1 : 0.9; }
  settleBet(bet: AndarBaharBetInput, playerId: string, result: AndarBaharResult, settledAt = Date.now()): AndarBaharSettlement {
    this.validateBet(bet); this.validatePlayerId(playerId);
    if (bet.type !== result.winner) return { betId: bet.betId, playerId, type: bet.type, status: 'LOSS', amount: bet.amount, profit: -bet.amount, totalReturn: 0, settledAt };
    const profit = this.roundTokenValue(bet.amount * this.getPayoutRatio(bet.type));
    return { betId: bet.betId, playerId, type: bet.type, status: 'WIN', amount: bet.amount, profit, totalReturn: this.roundTokenValue(bet.amount + profit), settledAt };
  }
  private roundTokenValue(value: number): number { return Math.round((value + Number.EPSILON) * 100) / 100; }
}
