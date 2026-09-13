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

  it('keeps a live match running when a player leaves but enough seats remain', async () => {
    // 3-seat math-rush room: 2 humans + 1 AI.
    const host = await createPlayer(platform, 'DepHost');
    const guest = await createPlayer(platform, 'DepGuest');
    const room = platform.roomManager.createRoom({
      gameId: 'math-rush',
      maxPlayers: 3,
      isPrivate: false,
      host,
    });
    platform.roomManager.joinRoom({ roomId: room.id, player: guest });
    platform.roomManager.addAI(room, host.playerId, 'hard');

    for (const player of room.humanPlayers) {
      platform.lobbyManager.setReady(room, player.id, true);
    }
    room.status = 'PLAYING';
    room.gameStartedAt = Date.now();
    platform.gameManager.createState(room);
    platform.gameManager.start(room);
    expect(room.players.size).toBe(3);

    // The guest walks out mid-match. One human + one AI still satisfies the
    // 2 seat minimum, so the match must continue rather than be abandoned.
    platform.roomManager.leaveRoom(room, guest.playerId, 'leave');

    expect(room.players.size).toBe(2);
    expect(room.status).toBe('PLAYING');
    expect(room.gameResult).toBeNull();
    expect(room.aiPlayers).toHaveLength(1);
  });

  it('ends a live match once the remaining seats fall below the game minimum', async () => {
    const host = await createPlayer(platform, 'AbnHost');
    const guest = await createPlayer(platform, 'AbnGuest');
    const room = platform.roomManager.createRoom({
      gameId: 'math-rush',
      maxPlayers: 2,
      isPrivate: false,
      host,
    });
    platform.roomManager.joinRoom({ roomId: room.id, player: guest });
    for (const player of room.humanPlayers) {
      platform.lobbyManager.setReady(room, player.id, true);
    }
    room.status = 'PLAYING';
    room.gameStartedAt = Date.now();
    platform.gameManager.createState(room);
    platform.gameManager.start(room);

    // No AI seats: one human left is below the 2 seat minimum, so the match
    // cannot continue. (math-rush's own `playerLeft` hook may finish it first;
    // either way the room must leave the playing state and end up in the lobby,
    // because no rematch is possible with a single seat.)
    platform.roomManager.leaveRoom(room, guest.playerId, 'leave');

    expect(room.players.size).toBe(1);
    expect(['PLAYING', 'COUNTDOWN', 'PAUSED']).not.toContain(room.status);
    expect(room.status).toBe('LOBBY');
    expect(platform.rematchManager.canRematch(room)).toBe(false);
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
  /**
   * Host migration. Without it a room whose host walks out can never start
   * again — `LobbyManager.canStart` needs a host — so the seat must move to a
   * remaining human and everyone must be told.
   */
  it('promotes a remaining human to host when the host leaves, and announces it', async () => {
    const host = await createPlayer(platform, 'MigrateHost');
    const guest = await createPlayer(platform, 'MigrateGuest');
    const room = platform.roomManager.createRoom({
      gameId: 'reaction-race',
      maxPlayers: 2,
      isPrivate: false,
      host,
    });
    platform.roomManager.joinRoom({ roomId: room.id, player: guest });
    expect(room.hostPlayerId).toBe(host.playerId);

    const announced: string[] = [];
    platform.eventBus.on('room:host-changed', ({ room: changed, player }) => {
      expect(changed.id).toBe(room.id);
      announced.push(player.id);
    });

    platform.roomManager.leaveRoom(room, host.playerId, 'leave');

    expect(announced).toEqual([guest.playerId]);
    expect(room.hostPlayerId).toBe(guest.playerId);
    expect(room.players.get(guest.playerId)?.isHost).toBe(true);
    // Exactly one host flag survives — a second one would make ownership
    // ambiguous for kick/start permissions.
    expect([...room.players.values()].filter((player) => player.isHost)).toHaveLength(1);
    // And the room is still startable by its new owner.
    expect(room.status).toBe('LOBBY');
  });

  it('keeps exactly one host when a non-host leaves first', async () => {
    const host = await createPlayer(platform, 'StayHost');
    const guest = await createPlayer(platform, 'LeaveGuest');
    const room = platform.roomManager.createRoom({
      gameId: 'reaction-race',
      maxPlayers: 3,
      isPrivate: false,
      host,
    });
    platform.roomManager.joinRoom({ roomId: room.id, player: guest });

    let announced = 0;
    platform.eventBus.on('room:host-changed', () => {
      announced += 1;
    });

    platform.roomManager.leaveRoom(room, guest.playerId, 'leave');

    expect(announced).toBe(0);
    expect(room.hostPlayerId).toBe(host.playerId);
    expect(room.players.get(host.playerId)?.isHost).toBe(true);
  });

  it('never promotes an AI seat to host, and closes the room when no human is left', async () => {
    const host = await createPlayer(platform, 'SoloHost');
    const room = platform.roomManager.createRoom({
      gameId: 'reaction-race',
      maxPlayers: 2,
      isPrivate: false,
      host,
    });
    const ai = platform.roomManager.addAI(room, host.playerId, 'medium');
    expect(ai).not.toBeNull();

    let announced = 0;
    platform.eventBus.on('room:host-changed', () => {
      announced += 1;
    });

    platform.roomManager.leaveRoom(room, host.playerId, 'leave');

    // An AI cannot own a room: there would be nobody left to start or kick.
    expect(announced).toBe(0);
    expect(platform.roomStore.size).toBe(0);
  });
});
