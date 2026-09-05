import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPlayer, createTestPlatform, waitFor, type TestPlatform } from '../test/harness';
import type { Platform } from '../core/Platform';
import { AppError } from '../utils/errors';
import type { Room } from '../rooms/Room';

async function roomWithTwoPlayers(platform: Platform): Promise<Room> {
  const host = await createPlayer(platform, 'ReHost');
  const guest = await createPlayer(platform, 'ReGuest');
  const room = platform.roomManager.createRoom({
    gameId: 'math-rush',
    maxPlayers: 2,
    isPrivate: false,
    host,
  });
  platform.roomManager.joinRoom({ roomId: room.id, player: guest });
  return room;
}

describe('ReconnectionManager', () => {
  let harness: TestPlatform;
  let platform: Platform;

  beforeEach(() => {
    harness = createTestPlatform({ reconnectGraceMs: 400 });
    platform = harness.platform;
  });

  afterEach(() => harness.destroy());

  it('keeps the seat and starts the grace period on disconnect', async () => {
    const room = await roomWithTwoPlayers(platform);
    const guest = room.humanPlayers[1]!;

    platform.reconnectionManager.handleDisconnect(room, guest);

    expect(guest.isConnected).toBe(false);
    expect(guest.isDisconnected).toBe(true);
    expect(guest.reconnectDeadline).toBeGreaterThan(Date.now());
    expect(room.players.has(guest.id)).toBe(true);
    expect(harness.emissions.some((entry) => entry.event.endsWith(':player:disconnected'))).toBe(true);
  });

  it('restores the player when they reconnect inside the window', async () => {
    const room = await roomWithTwoPlayers(platform);
    const guest = room.humanPlayers[1]!;

    platform.reconnectionManager.handleDisconnect(room, guest);
    const restored = platform.reconnectionManager.attemptReconnect({
      roomId: room.id,
      sessionToken: guest.sessionToken,
      socketId: 'new-socket',
    });

    expect(restored.restored).toBe(true);
    expect(guest.isConnected).toBe(true);
    expect(guest.socketId).toBe('new-socket');
    expect(guest.reconnectDeadline).toBeNull();
    expect(harness.emissions.some((entry) => entry.event.endsWith(':player:reconnected'))).toBe(true);
  });

  it('rejects reconnect attempts with a bad token', async () => {
    const room = await roomWithTwoPlayers(platform);
    const guest = room.humanPlayers[1]!;
    platform.reconnectionManager.handleDisconnect(room, guest);

    expect(() =>
      platform.reconnectionManager.attemptReconnect({
        roomId: room.id,
        sessionToken: 'not-a-real-token',
        socketId: 'socket-x',
      }),
    ).toThrow(AppError);
  });

  it('removes the player when the grace period expires', async () => {
    const room = await roomWithTwoPlayers(platform);
    const guest = room.humanPlayers[1]!;

    platform.reconnectionManager.handleDisconnect(room, guest);
    await waitFor(() => !room.players.has(guest.id), { timeoutMs: 3000 });

    expect(room.players.size).toBe(1);
    expect(platform.timerManager.activeCount).toBe(0);
  });

  it('is idempotent for duplicate disconnects', async () => {
    const room = await roomWithTwoPlayers(platform);
    const guest = room.humanPlayers[1]!;

    platform.reconnectionManager.handleDisconnect(room, guest);
    const deadline = guest.reconnectDeadline;
    platform.reconnectionManager.handleDisconnect(room, guest);
    expect(guest.reconnectDeadline).toBe(deadline);
  });
});
