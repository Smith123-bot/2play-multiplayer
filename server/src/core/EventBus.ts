import { EventEmitter } from 'node:events';
import type { GameResult } from '@2play/shared';
import type { Room } from '../rooms/Room';
import type { ServerPlayer } from '../rooms/ServerPlayer';
import { createLogger, type Logger } from '../utils/logger';

export type LeaveReason = 'leave' | 'kick' | 'timeout' | 'disconnect' | 'closed';

export interface PlatformEventMap {
  'room:created': { room: Room };
  'room:closed': { room: Room; reason: 'empty' | 'lifetime' | 'server' | 'host' };
  'room:game-changed': { room: Room; previousGameId: string };
  'room:player-joined': { room: Room; player: ServerPlayer };
  'room:player-left': { room: Room; player: ServerPlayer; reason: LeaveReason };
  'room:host-changed': { room: Room; player: ServerPlayer };
  'player:disconnected': { room: Room; player: ServerPlayer; reconnectDeadline: number };
  'player:reconnected': { room: Room; player: ServerPlayer };
  'lobby:all-ready': { room: Room };
  'game:started': { room: Room };
  'game:finished': { room: Room; result: GameResult };
  'rematch:started': { room: Room; matchNumber: number };
  'rematch:cancelled': { room: Room };
  'room:state-changed': { room: Room };
}

/**
 * Internal (never exposed over the socket) event bus used to decouple managers:
 * chat system messages, statistics persistence and socket broadcasting all
 * subscribe here instead of being hard-wired into the lifecycle manager.
 */
export class EventBus {
  private readonly emitter = new EventEmitter();
  private readonly logger: Logger = createLogger('EventBus');

  constructor() {
    // Managers may legitimately register several listeners per event.
    this.emitter.setMaxListeners(50);
  }

  on<K extends keyof PlatformEventMap>(
    event: K,
    listener: (payload: PlatformEventMap[K]) => void,
  ): () => void {
    this.emitter.on(event, listener as (payload: unknown) => void);
    return () => this.off(event, listener);
  }

  once<K extends keyof PlatformEventMap>(
    event: K,
    listener: (payload: PlatformEventMap[K]) => void,
  ): () => void {
    this.emitter.once(event, listener as (payload: unknown) => void);
    return () => this.off(event, listener);
  }

  off<K extends keyof PlatformEventMap>(
    event: K,
    listener: (payload: PlatformEventMap[K]) => void,
  ): void {
    this.emitter.off(event, listener as (payload: unknown) => void);
  }

  emit<K extends keyof PlatformEventMap>(event: K, payload: PlatformEventMap[K]): void {
    try {
      this.emitter.emit(event, payload);
    } catch (error) {
      // A broken listener must never break gameplay.
      this.logger.error('event listener failed', {
        event,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }
}
