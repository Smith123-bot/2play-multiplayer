import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPlayer, createTestPlatform, type TestPlatform } from '../test/harness';
import type { Platform } from '../core/Platform';
import { AppError } from '../utils/errors';

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
