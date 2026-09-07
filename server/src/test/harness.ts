import type { Platform, PlatformConfig } from '../core/Platform';
import { EventBus } from '../core/EventBus';
import { RateLimiter } from '../core/RateLimiter';
import { TimerManager } from '../core/TimerManager';
import { GameRegistry } from '../games/registry/GameRegistry';
import { RoomStore } from '../rooms/RoomStore';
import { MemoryRepository } from '../database/repositories/MemoryRepository';
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
import { reactionRaceGame } from '../games/reaction-race';
import { memoryMatchGame } from '../games/memory-match';
import { wordRaceGame } from '../games/word-race';
import { dotsAndBoxesGame } from '../games/dots-and-boxes';
import { mathRushGame } from '../games/math-rush';
import { battle2048Game } from '../games/2048-battle';
import { mazeRaceGame } from '../games/maze-race-2d';
import { wordScrambleGame } from '../games/word-scramble-battle';
import { shapeMatchGame } from '../games/shape-match-battle';
import { snakeBattleGame } from '../games/snake-battle';
import { trafficDodgeGame } from '../games/traffic-dodge-race';
import { targetRushGame } from '../games/target-rush';
import { captureTheFlagGame } from '../games/capture-the-flag-2d';
import { paddleDuelGame } from '../games/paddle-duel';
import { brickBreakerGame } from '../games/brick-breaker-battle';
import { patternMemoryGame } from '../games/pattern-memory-battle';
import { bombPassGame } from '../games/bomb-pass-2d';
import { drawGuessGame } from '../games/draw-guess-battle';
import { secretRoleGame } from '../games/secret-role';
import { platformDashGame } from '../games/platform-dash-2d';
import { colorClashGame } from '../games/color-clash';
import { territoryRushGame } from '../games/territory-rush';
import { hexaConquestGame } from '../games/hexa-conquest';
import { colorTrailsGame } from '../games/color-trails';
import { coinHuntersGame } from '../games/coin-hunters-arena';
import { castleSiegeGame } from '../games/castle-siege-2d';
import { trafficControlGame } from '../games/traffic-control-battle';
import { magnetMazeGame } from '../games/magnet-maze';
import { shopRushGame } from '../games/shop-rush-battle';
import type { SocketManager } from '../sockets/SocketManager';
import type { DatabaseLike } from '../database/client';
import type { Room } from '../rooms/Room';
import type { ServerPlayer } from '../rooms/ServerPlayer';
import type { RoomSettings } from '@2play/shared';

export interface Emission {
  event: string;
  payload: unknown;
}

export interface TestPlatform {
  platform: Platform;
  emissions: Emission[];
  clearEmissions: () => void;
  destroy: () => void;
}

/**
 * Builds a fully wired platform for unit tests, with a recording
 * (non-networked) socket manager. No HTTP server, no sockets, no database.
 */
export function createTestPlatform(
  overrides: Partial<PlatformConfig> = {},
  options: { games?: 'all' | 'none' } = {},
): TestPlatform {
  const emissions: Emission[] = [];

  const config: PlatformConfig = {
    maxRooms: 50,
    maxPlayersPerRoom: 4,
    reconnectGraceMs: 120_000,
    rematchTimeoutMs: 60_000,
    roomTimeoutMs: 300_000,
    roomMaxLifetimeMs: 14_400_000,
    actionRateLimitPerSec: 20,
    chatRateLimitPerSec: 5,
    ...overrides,
  };

  const platform = {} as Platform;
  platform.config = config;
  platform.eventBus = new EventBus();
  platform.timerManager = new TimerManager();
  platform.rateLimiter = new RateLimiter();
  platform.registry = new GameRegistry();
  platform.roomStore = new RoomStore();

  const repository = new MemoryRepository();
  const database = {
    mode: 'memory',
    init: () => repository.init(),
    ensureHealthy: () => Promise.resolve(),
    healthStatus: () => repository.health().then((health) => ({ ...health, mode: 'memory' as const })),
    close: () => repository.close(),
    upsertUser: (input: Parameters<MemoryRepository['upsertUser']>[0]) => repository.upsertUser(input),
    findUserBySession: (token: string) => repository.findUserBySession(token),
    findUserById: (id: string) => repository.findUserById(id),
    updateUser: (id: string, patch: Parameters<MemoryRepository['updateUser']>[1]) =>
      repository.updateUser(id, patch),
    recordMatch: (input: Parameters<MemoryRepository['recordMatch']>[0]) => repository.recordMatch(input),
    getHistory: (id: string, limit?: number) => repository.getHistory(id, limit),
    getStatistics: (id: string) => repository.getStatistics(id),
    getStatistic: (id: string, gameId: string) => repository.getStatistic(id, gameId),
    addFavorite: (id: string, gameId: string) => repository.addFavorite(id, gameId),
    removeFavorite: (id: string, gameId: string) => repository.removeFavorite(id, gameId),
    getFavorites: (id: string) => repository.getFavorites(id),
    isFavorite: (id: string, gameId: string) => repository.isFavorite(id, gameId),
    health: () => repository.health(),
  } as unknown as DatabaseLike;

  platform.database = database;

  platform.connectionManager = new ConnectionManager(platform);
  platform.chatManager = new ChatManager(platform);
  platform.roomManager = new RoomManager(platform);
  platform.reconnectionManager = new ReconnectionManager(platform);
  platform.lobbyManager = new LobbyManager(platform);
  platform.gameManager = new GameManager(platform);
  platform.lifecycleManager = new GameLifecycleManager(platform);
  platform.multiplayerManager = new MultiplayerManager(platform);
  platform.rematchManager = new RematchManager(platform);
  platform.statisticsManager = new StatisticsManager(platform);
  platform.favoriteManager = new FavoriteManager(platform);

  platform.socketManager = {
    emitToRoom: (roomId: string, event: string, payload: unknown) => {
      emissions.push({ event: `${roomId}:${event}`, payload });
    },
    emitToPlayer: (_room: unknown, playerId: string, event: string, payload: unknown) => {
      emissions.push({ event: `${playerId}:${event}`, payload });
    },
    emitToSocket: (socketId: string, event: string, payload: unknown) => {
      emissions.push({ event: `${socketId}:${event}`, payload });
    },
    broadcastRoomState: () => {
      emissions.push({ event: 'broadcast', payload: null });
    },
    clearRoom: () => undefined,
    connectionCount: 0,
  } as unknown as SocketManager;

  if (options.games !== 'none') {
    for (const game of [
      reactionRaceGame,
      memoryMatchGame,
      wordRaceGame,
      dotsAndBoxesGame,
      mathRushGame,
      battle2048Game,
      mazeRaceGame,
      wordScrambleGame,
      shapeMatchGame,
      snakeBattleGame,
      trafficDodgeGame,
      targetRushGame,
      captureTheFlagGame,
      paddleDuelGame,
      brickBreakerGame,
      patternMemoryGame,
      bombPassGame,
      drawGuessGame,
      secretRoleGame,
      platformDashGame,
      colorClashGame,
      territoryRushGame,
      hexaConquestGame,
      colorTrailsGame,
      coinHuntersGame,
      castleSiegeGame,
      trafficControlGame,
      magnetMazeGame,
      shopRushGame,
    ]) {
      platform.registry.register(game);
    }
  }

  return {
    platform,
    emissions,
    clearEmissions: () => {
      emissions.length = 0;
    },
    destroy: () => {
      platform.timerManager.dispose();
      platform.eventBus.removeAllListeners();
    },
  };
}

export async function createPlayer(
  platform: Platform,
  nickname: string,
  socketId = `socket-${nickname}`,
): Promise<{
  playerId: string;
  sessionToken: string;
  nickname: string;
  avatar: string;
  userId: string;
  socketId: string;
}> {
  const session = await platform.connectionManager.authenticate({
    nickname,
    avatar: '🦊',
    socketId,
    clientKey: `test-${nickname}`,
  });
  return {
    playerId: session.session.playerId,
    sessionToken: session.session.sessionToken,
    nickname,
    avatar: session.session.avatar,
    userId: session.session.userId,
    socketId,
  };
}

/** Waits for a condition ( timers are real, so polling is used). */
export async function waitFor(
  predicate: () => boolean,
  { timeoutMs = 5000, intervalMs = 25 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface GameFixture {
  room: Room;
  players: ServerPlayer[];
}

/**
 * Creates a room that is already PLAYING with a freshly initialised game state.
 * Game logic is exercised through the real GameManager (validation + hooks).
 */
export async function createGameFixture(
  platform: Platform,
  gameId: string,
  options: { settings?: Partial<RoomSettings>; playerCount?: number } = {},
): Promise<GameFixture> {
  const host = await createPlayer(platform, 'GameHost');
  const guest = await createPlayer(platform, 'GameGuest');
  const room = platform.roomManager.createRoom({
    gameId,
    maxPlayers: options.playerCount ?? 2,
    isPrivate: false,
    ...(options.settings ? { settings: options.settings } : {}),
    host,
  });
  platform.roomManager.joinRoom({ roomId: room.id, player: guest });
  room.status = 'PLAYING';
  room.gameStartedAt = Date.now();
  platform.gameManager.createState(room);
  platform.gameManager.start(room);
  return { room, players: room.orderedPlayers };
}

export type { Room, ServerPlayer };
