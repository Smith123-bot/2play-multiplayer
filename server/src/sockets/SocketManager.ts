import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '@2play/shared';
import { APP_VERSION, GAME_STATE_BROADCAST_THROTTLE_MS, SERVER_EVENTS } from '@2play/shared';
import type { Platform } from '../core/Platform';
import type { Room } from '../rooms/Room';
import { createLogger } from '../utils/logger';
import { registerSocketHandlers } from './handlers';

export type GameServer = Server<ClientToServerEvents, ServerToClientEvents>;

/**
 * SocketManager — owns the Socket.IO server and all outbound traffic.
 *
 * Outbound rules:
 *  - `room:updated` is the single source of truth for room state and is sent
 *    per viewer (games may hide information),
 *  - everything else (chat, countdown, rematch, timers) are *events* used for
 *    effects, never for state.
 */
export class SocketManager {
  private io: GameServer | null = null;
  private readonly lastBroadcast = new Map<string, number>();
  private readonly logger = createLogger('SocketManager');

  constructor(private readonly platform: Platform) {}

  attach(httpServer: HttpServer, origins: string[] | '*'): GameServer {
    this.io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
      cors: {
        origin: origins,
        methods: ['GET', 'POST'],
        credentials: true,
      },
      // Mobile networks: be patient, but not infinitely.
      pingInterval: 10_000,
      pingTimeout: 20_000,
      connectTimeout: 15_000,
      transports: ['websocket', 'polling'],
    });

    this.io.on('connection', (socket) => {
      this.logger.debug('socket connected', { socketId: socket.id });
      socket.emit(SERVER_EVENTS.CONNECTION_ESTABLISHED, {
        socketId: socket.id,
        serverTime: Date.now(),
        appVersion: APP_VERSION,
      });
      registerSocketHandlers(this.platform, socket, this);
    });

    this.logger.info('socket.io attached', { origins: origins === '*' ? '*' : origins.join(',') });
    return this.io;
  }

  get server(): GameServer | null {
    return this.io;
  }

  /**
   * Low level emit helper. The shared protocol types the payload per event, but
   * managers emit generically — the cast is contained here (and only here).
   */
  private emitRaw(target: string, event: string, payload: unknown): void {
    const emitter = this.io?.to(target) as unknown as
      | { emit: (name: string, body: unknown) => void }
      | undefined;
    emitter?.emit(event, payload);
  }

  emitToRoom(roomId: string, event: keyof ServerToClientEvents, payload: unknown): void {
    this.emitRaw(roomId, event, payload);
  }

  emitToSocket(socketId: string, event: keyof ServerToClientEvents, payload: unknown): void {
    this.emitRaw(socketId, event, payload);
  }

  emitToPlayer(room: Room, playerId: string, event: keyof ServerToClientEvents, payload: unknown): void {
    const player = room.getPlayer(playerId);
    if (!player?.socketId) return;
    this.emitToSocket(player.socketId, event, payload);
  }

  /** Per-viewer room snapshot (hidden game data never leaves the server). */
  broadcastRoomState(room: Room, force = false): void {
    if (!this.io) return;
    const now = Date.now();
    const last = this.lastBroadcast.get(room.id) ?? 0;

    if (!force && now - last < GAME_STATE_BROADCAST_THROTTLE_MS) {
      this.scheduleTrailingBroadcast(room);
      return;
    }
    this.deliverRoomState(room);
  }

  /**
   * Coalesces bursts of state changes into one trailing snapshot.
   *
   * The pending flag lives in TimerManager itself (not in a local Set) so a
   * cancelled broadcast timer can never leave a stale flag behind — which would
   * silently drop the final snapshot of a match.
   */
  private scheduleTrailingBroadcast(room: Room): void {
    if (this.platform.timerManager.has(room.id, 'turn', 'broadcast')) return;
    this.platform.timerManager.create({
      roomId: room.id,
      type: 'turn',
      delayMs: GAME_STATE_BROADCAST_THROTTLE_MS,
      key: 'broadcast',
      label: 'state-broadcast',
      onComplete: () => this.deliverRoomState(room),
    });
  }

  private deliverRoomState(room: Room): void {
    if (!this.io) return;
    this.platform.timerManager.cancelByKey(room.id, 'turn', 'broadcast');
    this.lastBroadcast.set(room.id, Date.now());
    for (const player of room.players.values()) {
      if (player.isAI || !player.socketId) continue;
      const gameState = this.platform.gameManager.getPublicState(room, player.id);
      this.io.to(player.socketId).emit(SERVER_EVENTS.ROOM_UPDATED, { room: room.toState(player.id, gameState) });
    }
  }

  /** Removes all sockets from a socket.io room (used when a room is closed). */
  clearRoom(roomId: string): void {
    this.lastBroadcast.delete(roomId);
    if (!this.io) return;
    const room = this.io.sockets.adapter.rooms.get(roomId);
    if (!room) return;
    for (const socketId of room) {
      this.io.sockets.sockets.get(socketId)?.leave(roomId);
    }
  }

  disconnectSocket(socketId: string, reason: string): void {
    const socket = this.io?.sockets.sockets.get(socketId);
    if (!socket) return;
    socket.emit(SERVER_EVENTS.ERROR, {
      error: { code: 'E008', name: 'CONNECTION_FAILED', message: reason },
    });
    socket.disconnect(true);
  }

  get connectionCount(): number {
    return this.io?.sockets.sockets.size ?? 0;
  }

  async close(): Promise<void> {
    if (!this.io) return;
    await this.io.close();
    this.io = null;
    this.lastBroadcast.clear();
    this.logger.info('socket.io server closed');
  }
}
