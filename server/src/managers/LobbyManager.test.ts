import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPlayer, createTestPlatform, type TestPlatform } from '../test/harness';
import type { Platform } from '../core/Platform';
import type { Room } from '../rooms/Room';

async function twoPlayerRoom(platform: Platform, gameId = 'reaction-race'): Promise<Room> {
  const host = await createPlayer(platform, 'LobbyHost');
  const guest = await createPlayer(platform, 'LobbyGuest');
  const room = platform.roomManager.createRoom({
    gameId,
    maxPlayers: 2,
    isPrivate: false,
    host,
  });
  platform.roomManager.joinRoom({ roomId: room.id, player: guest });
  return room;
}

describe('LobbyManager', () => {
  let harness: TestPlatform;
  let platform: Platform;

  beforeEach(() => {
    harness = createTestPlatform();
    platform = harness.platform;
  });

  afterEach(() => harness.destroy());

  it('moves LOBBY → READY when every human is ready', async () => {
    const room = await twoPlayerRoom(platform);
    const [host, guest] = room.humanPlayers;

    expect(platform.lobbyManager.canStart(room)).toBe(false);
    platform.lobbyManager.setReady(room, host!.id, true);
    expect(room.status).toBe('LOBBY');

    platform.lobbyManager.setReady(room, guest!.id, true);
    expect(room.status).toBe('READY');
    expect(platform.lobbyManager.canStart(room)).toBe(true);

    platform.lobbyManager.setReady(room, guest!.id, false);
    expect(room.status).toBe('LOBBY');
  });

  it('explains why a match cannot start', async () => {
    const room = await twoPlayerRoom(platform);
    const [host, guest] = room.humanPlayers;
    expect(platform.lobbyManager.startBlockedReason(room)).toContain(host!.nickname);
    platform.lobbyManager.setReady(room, host!.id, true);
    platform.lobbyManager.setReady(room, guest!.id, true);
    expect(platform.lobbyManager.startBlockedReason(room)).toBeNull();
  });

  it('starts with one human plus one AI opponent', async () => {
    const host = await createPlayer(platform, 'SoloHost');
    const room = platform.roomManager.createRoom({
      gameId: 'dots-and-boxes',
      maxPlayers: 2,
      isPrivate: false,
      host,
    });
    platform.roomManager.addAI(room, host.playerId, 'medium');
    platform.lobbyManager.setReady(room, host.playerId, true);
    expect(platform.lobbyManager.canStart(room)).toBe(true);
  });

  it('lets only the host change the game or settings', async () => {
    const room = await twoPlayerRoom(platform);
    const [host, guest] = room.humanPlayers;

    expect(() => platform.lobbyManager.selectGame(room, guest!.id, 'math-rush')).toThrow();
    platform.lobbyManager.selectGame(room, host!.id, 'math-rush');
    expect(room.gameId).toBe('math-rush');
    expect(room.orderedPlayers.every((player) => !player.isReady)).toBe(true);

    expect(() => platform.lobbyManager.updateSettings(room, guest!.id, { playerCount: 4 })).toThrow();
    platform.lobbyManager.updateSettings(room, host!.id, { playerCount: 4 });
    expect(room.maxPlayers).toBe(4);
  });

  it('validates player counts against the game metadata', async () => {
    const room = await twoPlayerRoom(platform, 'memory-match');
    const host = room.humanPlayers[0]!;
    expect(() => platform.lobbyManager.updateSettings(room, host.id, { playerCount: 9 })).toThrow();
    expect(() => platform.lobbyManager.updateSettings(room, host.id, { gridSize: '99x99' })).toThrow();
    platform.lobbyManager.updateSettings(room, host.id, { gridSize: '6x6' });
    expect(room.settings.gridSize).toBe('6x6');
  });
});
