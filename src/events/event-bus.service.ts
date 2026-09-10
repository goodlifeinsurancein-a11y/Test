import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter } from 'node:events';

import {
  GameEvent,
  GameEventName,
} from './game-events.js';

type GameEventHandler = (
  event: GameEvent,
) => void | Promise<void>;

@Injectable()
export class EventBusService implements OnModuleDestroy {
  private readonly emitter = new EventEmitter();

  publish(event: GameEvent): void {
    this.emitter.emit(event.eventName, event);
  }

  subscribe(
    eventName: GameEventName,
    handler: GameEventHandler,
  ): () => void {
    this.emitter.on(eventName, handler);

    return () => {
      this.emitter.off(eventName, handler);
    };
  }

  onModuleDestroy(): void {
    this.emitter.removeAllListeners();
  }
}
