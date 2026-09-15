import type { Server } from 'node:http';
import http from 'node:http';
import { env } from '../config/env';
import { database } from '../database/client';
import { GameLoader } from '../managers/GameLoader';
import { createApp } from '../app';
import { EventBus } from './EventBus';
import { createHealthSignals } from './Health';
import type { Platform, PlatformConfig } from './Platform';
import { RateLimiter } from './RateLimiter';
import { TimerManager } from './TimerManager';
import { GameRegistry } from '../games/registry/GameRegistry';
import { RoomStore } from '../rooms/RoomStore';
import { ChatManager } from '../managers/ChatManager';
import { ConnectionManager } from '../managers/ConnectionManager';
import { FavoriteManager } from '../managers/FavoriteManager';
import { GameLifecycleManager } from '../managers/GameLifecycleManager';
import { GameManager } from '../managers/GameManager';
import { LobbyManager } from '../managers/LobbyManager';
import { MultiplayerManager } from '../managers/MultiplayerManager';
import { ReconnectionManager } from '../managers/ReconnectionManager';
import { RematchManager } from '../managers/RematchManager';
import { RoomManager } from '../managers/RoomManager';
import { StatisticsManager } from '../managers/StatisticsManager';
import { SocketManager } from '../sockets/SocketManager';
import { parseCorsOrigins } from '../config/env';
import { createLogger } from '../utils/logger';

/**
 * ApplicationManager — builds the platform, wires managers, subscribes the
 * socket bridge to platform events and owns graceful shutdown.
 */
export class ApplicationManager {
  private readonly platform = {} as Platform;
  private readonly logger = createLogger('ApplicationManager');
  private server: Server | null = null;
  /** Serialised form of the last published public room listing (diff gate). */
  private lastPublicRoomsJson: string | null = null;

  getPlatform(): Platform {
    return this.platform;
  }

  /** Phase 1: construct every subsystem (no I/O). */
  build(): Platform {
    const config: PlatformConfig = {
      maxRooms: env.MAX_ROOMS,
      maxPlayersPerRoom: env.MAX_PLAYERS_PER_ROOM,
      reconnectGraceMs: env.RECONNECT_GRACE_MS,
      rematchTimeoutMs: env.REMATCH_TIMEOUT_MS,
      roomTimeoutMs: env.ROOM_TIMEOUT_MS,
      roomMaxLifetimeMs: env.ROOM_MAX_LIFETIME_MS,
      actionRateLimitPerSec: env.ACTION_RATE_LIMIT_PER_SEC,
      chatRateLimitPerSec: env.CHAT_RATE_LIMIT_PER_SEC,
      authRateLimitPerMin: env.AUTH_RATE_LIMIT_PER_MIN,
    };

    this.platform.config = config;
    this.platform.eventBus = new EventBus();
    this.platform.timerManager = new TimerManager();
    this.platform.rateLimiter = new RateLimiter();
    this.platform.healthSignals = createHealthSignals();
    this.platform.registry = new GameRegistry();
    this.platform.roomStore = new RoomStore();
    this.platform.database = database;

    this.platform.connectionManager = new ConnectionManager(this.platform);
    this.platform.chatManager = new ChatManager(this.platform);
    this.platform.roomManager = new RoomManager(this.platform);
    this.platform.reconnectionManager = new ReconnectionManager(this.platform);
    this.platform.lobbyManager = new LobbyManager(this.platform);
    this.platform.gameManager = new GameManager(this.platform);
    this.platform.lifecycleManager = new GameLifecycleManager(this.platform);
    this.platform.multiplayerManager = new MultiplayerManager(this.platform);
    this.platform.rematchManager = new RematchManager(this.platform);
    this.platform.statisticsManager = new StatisticsManager(this.platform);
    this.platform.favoriteManager = new FavoriteManager(this.platform);
    this.platform.socketManager = new SocketManager(this.platform);

    this.registerSocketBridge();

    return this.platform;
  }

  /**
   * Wires platform events to outbound socket traffic.
   * Managers stay free of socket code; only this bridge knows about both.
   */
  private registerSocketBridge(): void {
    const bus = this.platform.eventBus;

    bus.on('room:state-changed', ({ room }) => {
      this.platform.socketManager.broadcastRoomState(room);
    });

    // Public room browser: push the listing to every connected client whenever
    // it may have changed (created / joined / left / closed / game or host
    // change / match start / finish / rematch / any lobby transition). The
    // publish itself is diff-gated, so high-frequency gameplay snapshots that
    // do not affect the listing cost one cheap filter and emit nothing.
    const republishPublicRooms = () => this.publishPublicRooms();
    bus.on('room:created', republishPublicRooms);
    bus.on('room:player-joined', republishPublicRooms);
    bus.on('room:player-left', republishPublicRooms);
    bus.on('room:closed', republishPublicRooms);
    bus.on('room:game-changed', republishPublicRooms);
    bus.on('room:host-changed', republishPublicRooms);
    bus.on('game:started', republishPublicRooms);
    bus.on('game:finished', republishPublicRooms);
    bus.on('rematch:started', republishPublicRooms);
    bus.on('rematch:cancelled', republishPublicRooms);
    bus.on('room:state-changed', republishPublicRooms);

    bus.on('room:player-joined', ({ room, player }) => {
      this.platform.socketManager.emitToRoom(room.id, 'room:player-joined', {
        roomId: room.id,
        player: player.toPublic(),
      });
    });

    bus.on('room:player-left', ({ room, player, reason }) => {
      this.platform.socketManager.emitToRoom(room.id, 'room:player-left', {
        roomId: room.id,
        playerId: player.id,
        nickname: player.nickname,
        reason,
      });
    });

    bus.on('room:host-changed', ({ room }) => {
      this.platform.socketManager.broadcastRoomState(room, true);
    });

    bus.on('lobby:all-ready', ({ room }) => {
      this.platform.socketManager.emitToRoom(room.id, 'lobby:all-ready', {
        roomId: room.id,
        canStart: true,
      });
    });

    bus.on('room:closed', ({ room }) => {
      this.platform.socketManager.clearRoom(room.id);
    });
  }

  /**
   * Pushes the current public room listing to all connected sockets.
   *
   * Diff-gated: the serialised listing is compared with the last published one
   * and identical snapshots emit nothing, so subscribing to the hot
   * `room:state-changed` event stays cheap. Private and Quick Play rooms are
   * excluded by `RoomManager.listRooms` itself, so they can never leak here.
   */
  private publishPublicRooms(): void {
    const rooms = this.platform.roomManager.listRooms();
    const json = JSON.stringify(rooms);
    if (json === this.lastPublicRoomsJson) return;
    this.lastPublicRoomsJson = json;
    this.platform.socketManager.emitToAll('room:list', { rooms });
  }

  /** Phase 2: connect the database, load games, start the HTTP + socket server. */
  async start(): Promise<{ httpServer: Server; port: number }> {
    this.build();

    await this.platform.database.init().catch((error: unknown) => {
      this.logger.error('database init failed — continuing in degraded mode', {
        message: error instanceof Error ? error.message : String(error),
      });
    });

    new GameLoader(this.platform).load();

    const app = createApp(this.platform);
    const httpServer = http.createServer(app);
    this.platform.socketManager.attach(httpServer, parseCorsOrigins());

    this.platform.lifecycleManager.startMaintenance();

    await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(env.PORT, env.HOST, () => resolve());
    });

    this.server = httpServer;
    const address = httpServer.address();
    const actualPort = typeof address === 'object' && address !== null ? address.port : env.PORT;
    this.logger.info('2PLAY server listening', {
      port: actualPort,
      host: env.HOST,
      env: env.NODE_ENV,
      games: this.platform.registry.size,
    });

    return { httpServer, port: actualPort };
  }

  /** Phase 3: graceful shutdown — timers, sockets, rooms, database, server. */
  async stop(): Promise<void> {
    this.logger.info('shutting down 2PLAY server');
    this.platform.timerManager.dispose();

    for (const room of this.platform.roomStore.all()) {
      this.platform.roomManager.closeRoom(room, 'server');
    }

    await this.platform.socketManager.close();
    await this.platform.database.close();

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server?.close(() => resolve());
      });
      this.server = null;
    }
    this.platform.eventBus.removeAllListeners();
    this.logger.info('shutdown complete');
  }
}
