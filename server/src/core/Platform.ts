import type { DatabaseLike } from '../database/client';
import type { GameRegistry } from '../games/registry/GameRegistry';
import type { ChatManager } from '../managers/ChatManager';
import type { ConnectionManager } from '../managers/ConnectionManager';
import type { FavoriteManager } from '../managers/FavoriteManager';
import type { GameLifecycleManager } from '../managers/GameLifecycleManager';
import type { GameManager } from '../managers/GameManager';
import type { LobbyManager } from '../managers/LobbyManager';
import type { MultiplayerManager } from '../managers/MultiplayerManager';
import type { ReconnectionManager } from '../managers/ReconnectionManager';
import type { RematchManager } from '../managers/RematchManager';
import type { RoomManager } from '../managers/RoomManager';
import type { StatisticsManager } from '../managers/StatisticsManager';
import type { RoomStore } from '../rooms/RoomStore';
import type { SocketManager } from '../sockets/SocketManager';
import type { EventBus } from './EventBus';

export interface PlatformConfig {
  maxRooms: number;
  maxPlayersPerRoom: number;
  reconnectGraceMs: number;
  rematchTimeoutMs: number;
  roomTimeoutMs: number;
  roomMaxLifetimeMs: number;
  actionRateLimitPerSec: number;
  chatRateLimitPerSec: number;
}
import type { RateLimiter } from './RateLimiter';
import type { TimerManager } from './TimerManager';

/**
 * Dependency container shared by every manager.
 *
 * Managers receive the container (not each other's internals) and only resolve
 * collaborators at call time, which keeps the wiring order simple while still
 * making dependencies explicit and mockable in tests.
 */
export interface Platform {
  eventBus: EventBus;
  timerManager: TimerManager;
  rateLimiter: RateLimiter;
  registry: GameRegistry;
  roomStore: RoomStore;
  database: DatabaseLike;
  config: PlatformConfig;

  roomManager: RoomManager;
  lobbyManager: LobbyManager;
  gameManager: GameManager;
  lifecycleManager: GameLifecycleManager;
  multiplayerManager: MultiplayerManager;
  rematchManager: RematchManager;
  connectionManager: ConnectionManager;
  reconnectionManager: ReconnectionManager;
  chatManager: ChatManager;
  statisticsManager: StatisticsManager;
  favoriteManager: FavoriteManager;
  socketManager: SocketManager;
}
