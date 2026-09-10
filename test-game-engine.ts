import { GameEngine } from './src/games/game.engine.js';
import type { RoundState } from './src/games/round.manager.js';

class TestGameEngine extends GameEngine {
  protected onBettingStart(round: RoundState): void {
    console.log('BETTING:', round.roundNumber);
  }

  protected onBettingEnd(round: RoundState): void {
    console.log('LOCK:', round.roundNumber);
  }

  protected onProcessing(round: RoundState): void {
    console.log('PROCESSING:', round.roundNumber);
  }

  protected async onResult(round: RoundState): Promise<void> {
    console.log('RESULT:', round.roundNumber);
  }

  protected onRoundCompleted(round: RoundState): void {
    console.log('COMPLETED:', round.roundNumber);
  }
}

const engine = new TestGameEngine();

engine.start();

setTimeout(() => {
  engine.stop();
  console.log('ENGINE STOPPED');
}, 24_000);
