import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPlayer, createTestPlatform, type TestPlatform } from '../test/harness';
import type { Platform } from '../core/Platform';
import type { GameModule } from '../games/GameModule';
import { AppError } from '../utils/errors';

/** Minimal, valid module for a game with no AI support (never used to fake AI). */
const noAiGame: GameModule = {
  metadata: {
    id: 'no-ai-stub',
    name: 'No AI Stub',
    description: 'Test-only game with no AI support.',
    category: 'strategy',
    icon: '🧪',
    thumbnail: '🧪',
    minPlayers: 2,
    maxPlayers: 2,
    supportedPlayerCounts: [2],
    hasAI: false,
    aiDifficulties: [],
    estimatedDuration: 60,
    difficulty: 'easy',
    controls: 'n/a',
    rules: ['n/a'],
    scoring: 'n/a',
    winCondition: 'n/a',
    tags: [],
    featured: false,
    version: '1.0.0',
  },
  initialize: () => undefined,
  createInitialState: () => ({}),
  playerJoined: () => undefined,
  playerReady: () => undefined,
  playerLeft: () => undefined,
  start: () => undefined,
  validateAction: () => ({ valid: true }),
  handlePlayerAction: () => ({ accepted: true, stateChanged: false }),
  update: () => undefined,
  tick: () => undefined,
  calculateScore: () => 0,
  checkWinCondition: () => null,
  checkDrawCondition: () => false,
  isGameFinished: () => false,
  finish: () => undefined,
  getResult: () => ({ winners: [], isDraw: true, rankings: [] }),
  reset: (state) => state,
  cleanup: () => undefined,
  getPublicState: () => ({}),
};

describe('RoomManager', () => {
  let harness: TestPlatform;
  let platform: Platform;

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
  });

  afterEach(() => harness.destroy());

  it('creates a room with a 6 character code and a host', async () => {
    const host = await createPlayer(platform, 'HostOne');
    const room = platform.roomManager.createRoom({
      gameId: 'reaction-race',
      maxPlayers: 2,
      isPrivate: false,
      host,
    });

    expect(room.id).toMatch(/^[A-Z0-9]{6}$/);
    expect(room.status).toBe('LOBBY');
    expect(room.players.size).toBe(1);
    expect(room.hostPlayerId).toBe(host.playerId);
    expect(room.players.get(host.playerId)?.isHost).toBe(true);
    expect(platform.roomStore.size).toBe(1);
  });

  it('rejects unsupported player counts and unknown games', async () => {
    const host = await createPlayer(platform, 'HostTwo');
    expect(() =>
      platform.roomManager.createRoom({ gameId: 'nope', maxPlayers: 2, isPrivate: false, host }),
    ).toThrow(AppError);
    expect(() =>
      platform.roomManager.createRoom({ gameId: 'reaction-race', maxPlayers: 9, isPrivate: false, host }),
    ).toThrow(AppError);
  });

  it('joins players, rejects full rooms and duplicates', async () => {
    const host = await createPlayer(platform, 'Alpha');
    const guest = await createPlayer(platform, 'Bravo');
    const third = await createPlayer(platform, 'Charlie');

    const room = platform.roomManager.createRoom({
      gameId: 'memory-match',
      maxPlayers: 2,
      isPrivate: false,
      host,
    });

    const joined = platform.roomManager.joinRoom({ roomId: room.id, player: guest });
    expect(joined.rejoined).toBe(false);
    expect(room.players.size).toBe(2);

    expect(() => platform.roomManager.joinRoom({ roomId: room.id, player: third })).toThrow(AppError);

    // Re-joining with the same session is idempotent.
    const again = platform.roomManager.joinRoom({ roomId: room.id, player: guest });
    expect(again.rejoined).toBe(true);
    expect(room.players.size).toBe(2);
  });

  it('promotes a new host when the host leaves', async () => {
    const host = await createPlayer(platform, 'HostX');
    const guest = await createPlayer(platform, 'GuestY');
    const room = platform.roomManager.createRoom({
      gameId: 'math-rush',
      maxPlayers: 2,
      isPrivate: false,
      host,
    });
    platform.roomManager.joinRoom({ roomId: room.id, player: guest });

    platform.roomManager.leaveRoom(room, host.playerId, 'leave');
    expect(room.players.size).toBe(1);
    expect(room.hostPlayerId).toBe(guest.playerId);
  });

  it('closes the room when the last player leaves', async () => {
    const host = await createPlayer(platform, 'SoloPlayer');
    const room = platform.roomManager.createRoom({
      gameId: 'word-race',
      maxPlayers: 2,
      isPrivate: false,
      host,
    });
    platform.roomManager.leaveRoom(room, host.playerId, 'leave');
    expect(platform.roomStore.size).toBe(0);
    expect(room.status).toBe('CLOSED');
  });

  it('lets the host kick a player but not themselves', async () => {
    const host = await createPlayer(platform, 'KickHost');
    const guest = await createPlayer(platform, 'KickGuest');
    const room = platform.roomManager.createRoom({
      gameId: 'dots-and-boxes',
      maxPlayers: 2,
      isPrivate: false,
      host,
    });
    platform.roomManager.joinRoom({ roomId: room.id, player: guest });

    expect(() => platform.roomManager.kickPlayer(room, guest.playerId, host.playerId)).toThrow(AppError);
    platform.roomManager.kickPlayer(room, host.playerId, guest.playerId);
    expect(room.players.size).toBe(1);
  });

  it('adds and removes AI opponents', async () => {
    const host = await createPlayer(platform, 'AiHost');
    const room = platform.roomManager.createRoom({
      gameId: 'memory-match',
      maxPlayers: 3,
      isPrivate: false,
      host,
    });

    const ai = platform.roomManager.addAI(room, host.playerId, 'hard');
    expect(ai.isAI).toBe(true);
    expect(ai.aiDifficulty).toBe('hard');
    expect(ai.isReady).toBe(true);

    platform.roomManager.removeAI(room, host.playerId, ai.id);
    expect(room.players.size).toBe(1);
  });

  it('lists only public, joinable rooms', async () => {
    const host = await createPlayer(platform, 'ListHost');
    const otherHost = await createPlayer(platform, 'PrivateHost');
    const publicRoom = platform.roomManager.createRoom({
      gameId: 'reaction-race',
      maxPlayers: 2,
      isPrivate: false,
      host,
    });
    platform.roomManager.createRoom({
      gameId: 'reaction-race',
      maxPlayers: 2,
      isPrivate: true,
      host: otherHost,
    });

    const rooms = platform.roomManager.listRooms();
    expect(rooms).toHaveLength(1);
    expect(rooms[0]?.id).toBe(publicRoom.id);
    expect(rooms[0]?.gameName).toBe('Reaction Race');
  });

  it('leaveRoom is idempotent — calling it twice never throws or corrupts state', async () => {
    const host = await createPlayer(platform, 'IdemHost');
    const room = platform.roomManager.createRoom({
      gameId: 'reaction-race',
      maxPlayers: 2,
      isPrivate: false,
      host,
    });

    expect(() => platform.roomManager.leaveRoom(room, host.playerId, 'leave')).not.toThrow();
    expect(platform.roomStore.size).toBe(0);
    expect(room.status).toBe('CLOSED');

    // Second leave for the same player/room: no player left to remove, must
    // be a safe no-op (spec: "LEAVE_ROOM / LEAVE_ROOM must NOT cause an error
    // or corrupt room state").
    expect(() => platform.roomManager.leaveRoom(room, host.playerId, 'leave')).not.toThrow();
    expect(platform.roomStore.size).toBe(0);
  });

  it('frees the player to create/join another room immediately after leaving (fixes the stale "already in a room" bug)', async () => {
    const host = await createPlayer(platform, 'FreedHost');
    const first = platform.roomManager.createRoom({
      gameId: 'reaction-race',
      maxPlayers: 2,
      isPrivate: false,
      host,
    });

    expect(() =>
      platform.roomManager.createRoom({ gameId: 'reaction-race', maxPlayers: 2, isPrivate: false, host }),
    ).toThrow(AppError);

    platform.roomManager.leaveRoom(first, host.playerId, 'leave');
    expect(platform.roomManager.findRoomOfPlayer(host.playerId)).toBeUndefined();

    const second = platform.roomManager.createRoom({
      gameId: 'memory-match',
      maxPlayers: 2,
      isPrivate: false,
      host,
    });
    expect(second.id).not.toBe(first.id);
    expect(second.players.size).toBe(1);
  });

  it('createQuickPlayMatch starts a real AI match directly — no room-code UX, no lobby wait', async () => {
    const host = await createPlayer(platform, 'QuickPlayer');
    const room = platform.roomManager.createQuickPlayMatch({
      gameId: 'reaction-race',
      aiDifficulty: 'hard',
      host,
    });

    expect(room.isQuickPlay).toBe(true);
    expect(room.isPrivate).toBe(true);
    expect(room.players.size).toBe(2);
    const ai = [...room.players.values()].find((player) => player.isAI);
    expect(ai).toBeDefined();
    expect(ai?.aiDifficulty).toBe('hard');
    expect(room.getPlayer(host.playerId)?.isReady).toBe(true);
  });

  it('createQuickPlayMatch configures every AI seat for a 3-4 player game', async () => {
    const host = await createPlayer(platform, 'QuickPlayerMulti');
    const room = platform.roomManager.createQuickPlayMatch({
      gameId: 'secret-role', // minPlayers 3, maxPlayers 4, no 2-player support
      aiDifficulty: 'easy',
      host,
    });

    expect(room.players.size).toBeGreaterThanOrEqual(3);
    const aiCount = [...room.players.values()].filter((player) => player.isAI).length;
    expect(aiCount).toBe(room.players.size - 1);
  });

  it('createQuickPlayMatch rejects games without AI support (never fakes AI)', async () => {
    platform.registry.register(noAiGame);
    const host = await createPlayer(platform, 'NoAiHost');
    expect(() =>
      platform.roomManager.createQuickPlayMatch({ gameId: 'no-ai-stub', aiDifficulty: 'medium', host }),
    ).toThrow(AppError);
  });

  it('closes rooms that have been empty past the timeout', async () => {
    const shortHarness = createTestPlatform({ roomTimeoutMs: 10 });
    const host = await createPlayer(shortHarness.platform, 'SweepHost');
    const room = shortHarness.platform.roomManager.createRoom({
      gameId: 'reaction-race',
      maxPlayers: 2,
      isPrivate: false,
      host,
    });
    room.emptyAt = Date.now() - 1000;
    const result = shortHarness.platform.roomManager.sweep();
    expect(result.closed).toBe(1);
    expect(shortHarness.platform.roomStore.size).toBe(0);
    shortHarness.destroy();
  });
});
