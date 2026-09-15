import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import type { ClientToServerEvents, RoomState, ServerToClientEvents } from '@2play/shared';
import {
  APP_VERSION,
  GAME_STATE_BROADCAST_THROTTLE_MS,
  SERVER_EVENTS,
  SOCKET_MAX_PAYLOAD_BYTES,
} from '@2play/shared';
import type { Platform } from '../core/Platform';
import { env } from '../config/env';
import { socketClientKey } from '../utils/clientIp';
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
  /**
   * Last chat transcript version delivered to each socket. When a snapshot is
   * due and the room's `chatVersion` is unchanged for this socket, the chat
   * array is omitted entirely. Chat history is measured at ~83% of a snapshot
   * payload, and realtime games broadcast 4 snapshots/second — re-streaming an
   * (up to 100 message) transcript each time dominates mobile bandwidth.
   * Entries are removed in `clearRoom` and `forgetSocket`.
   */
  private readonly lastChatVersion = new Map<string, number>();
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
      /**
       * Cap socket frames the way `express.json({ limit: '32kb' })` caps HTTP
       * bodies. No legitimate event comes close: the largest are a chat message
       * (a few hundred bytes) and a game action. Socket.IO's 1MB default would
       * otherwise let a client force megabyte allocations per frame.
       */
      maxHttpBufferSize: SOCKET_MAX_PAYLOAD_BYTES,
    });

    // Bound unauthenticated connection churn before allocating application
    // listeners/session work. This complements per-event and auth limits.
    //
    // The key is the PROXY-AWARE client address (see `socketClientKey`): behind
    // a reverse proxy every player shares the proxy IP, and an address-keyed
    // limiter then trips for the whole deployment at once — new connections
    // bounced for a minute at a time is exactly the reported "server randomly
    // disappears" symptom. Trust follows TRUST_PROXY hops only, and the default
    // (0) keeps the raw socket address, so a direct deployment cannot be
    // spoofed via X-Forwarded-For.
    this.io.use((socket, next) => {
      const clientKey = socketClientKey(socket.handshake, env.TRUST_PROXY);
      socket.data.clientKey = clientKey;
      const limit = this.platform.rateLimiter.consume(
        `socket-connect:${clientKey}`,
        env.SOCKET_CONNECT_RATE_LIMIT_PER_MIN,
        60_000,
      );
      if (!limit.allowed) {
        next(new Error('Connection rate limit exceeded.'));
        return;
      }
      next();
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
      { emit: (name: string, body: unknown) => void } | undefined;
    emitter?.emit(event, payload);
  }

  emitToRoom(roomId: string, event: keyof ServerToClientEvents, payload: unknown): void {
    this.emitRaw(roomId, event, payload);
  }

  emitToSocket(socketId: string, event: keyof ServerToClientEvents, payload: unknown): void {
    this.emitRaw(socketId, event, payload);
  }

  emitToPlayer(
    room: Room,
    playerId: string,
    event: keyof ServerToClientEvents,
    payload: unknown,
  ): void {
    const player = room.getPlayer(playerId);
    if (!player?.socketId) return;
    this.emitToSocket(player.socketId, event, payload);
  }

  /**
   * Broadcasts to EVERY connected socket.
   *
   * Used for the public room list (`room:list`): every Home screen updates the
   * moment a public room appears, fills or closes, with no polling. The payload
   * must only ever contain safe public summaries (see `RoomManager.listRooms` —
   * private and Quick Play rooms are never enumerable).
   */
  emitToAll(event: keyof ServerToClientEvents, payload: unknown): void {
    const emitter = this.io as unknown as
      | { emit: (name: string, body: unknown) => void }
      | null;
    emitter?.emit(event, payload);
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
      this.io
        .to(player.socketId)
        .emit(SERVER_EVENTS.ROOM_UPDATED, { room: this.snapshotFor(room, player.id, player.socketId) });
    }
  }

  /**
   * Per-viewer room snapshot with incremental chat.
   *
   * The transcript is only serialised into the snapshot when it changed for
   * this viewer since the previous one; otherwise the field is omitted and the
   * client keeps the array it already has. Authoritative room/game state is
   * ALWAYS complete — only the append-only chat history is incremental.
   */
  private snapshotFor(room: Room, playerId: string, socketId: string): RoomState {
    const gameState = this.platform.gameManager.getPublicState(room, playerId);
    const state = room.toState(playerId, gameState);
    if (this.lastChatVersion.get(socketId) === room.chatVersion) {
      delete state.chat;
    } else {
      this.lastChatVersion.set(socketId, room.chatVersion);
    }
    return state;
  }

  /**
   * Immediate authoritative snapshot for ONE viewer, bypassing the throttle.
   *
   * `broadcastRoomState` coalesces bursts, which is right for the room as a
   * whole — but it makes a player wait up to a full throttle window (on top of
   * the game's own tick) to see the consequence of their own hit, capture or
   * elimination. The acting player is the one who needs instant feedback, so
   * they get their snapshot straight away while everyone else still rides the
   * throttled broadcast. Outbound traffic stays bounded: one extra targeted
   * frame per accepted action, never a full-room burst.
   *
   * This does not weaken server authority — the state is computed by the server
   * from the canonical room, exactly like the broadcast path; only the delivery
   * timing differs.
   *
   * Deliberately does NOT touch `lastBroadcast`: the room's group snapshot is
   * still due on its own schedule, and both frames reach this socket in order.
   */
  deliverRoomStateToPlayer(room: Room, playerId: string): void {
    if (!this.io) return;
    const player = room.getPlayer(playerId);
    if (!player || player.isAI || !player.socketId) return;
    this.io
      .to(player.socketId)
      .emit(SERVER_EVENTS.ROOM_UPDATED, {
        room: this.snapshotFor(room, playerId, player.socketId),
      });
  }

  /** Removes all sockets from a socket.io room (used when a room is closed). */
  clearRoom(roomId: string): void {
    this.lastBroadcast.delete(roomId);
    if (!this.io) return;
    const room = this.io.sockets.adapter.rooms.get(roomId);
    if (!room) return;
    for (const socketId of room) {
      this.lastChatVersion.delete(socketId);
      this.io.sockets.sockets.get(socketId)?.leave(roomId);
    }
  }

  /** Called on socket disconnect so chat bookkeeping never outlives a socket. */
  forgetSocket(socketId: string): void {
    this.lastChatVersion.delete(socketId);
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
