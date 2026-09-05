import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPlayer, createTestPlatform, waitFor, type TestPlatform } from '../test/harness';
import type { Platform } from '../core/Platform';
import type { Room } from '../rooms/Room';

async function twoPlayerRoom(platform: Platform): Promise<Room> {
  const host = await createPlayer(platform, 'RmHost');
  const guest = await createPlayer(platform, 'RmGuest');
  const room = platform.roomManager.createRoom({
    gameId: 'math-rush',
    maxPlayers: 2,
    isPrivate: false,
    host,
  });
  platform.roomManager.joinRoom({ roomId: room.id, player: guest });
  return room;
}

/** Drives the room to RESULT so rematch voting can be tested. */
async function finishedMatch(platform: Platform, room: Room): Promise<void> {
  for (const player of room.humanPlayers) platform.lobbyManager.setReady(room, player.id, true);
  platform.lifecycleManager.startCountdown(room);
  await waitFor(() => room.status === 'PLAYING', { timeoutMs: 10_000 });
  platform.lifecycleManager.finishMatch(room, 'completed');
}

describe('RematchManager', () => {
  let harness: TestPlatform;
  let platform: Platform;

  beforeEach(() => {
    harness = createTestPlatform({ rematchTimeoutMs: 1000 });
    platform = harness.platform;
  });

  afterEach(() => harness.destroy());

  it('opens voting after a finished match and keeps the room alive', async () => {
    const room = await twoPlayerRoom(platform);
    await finishedMatch(platform, room);

    expect(room.status).toBe('REMATCH_WAITING');
    expect(room.gameResult).not.toBeNull();
    expect(room.players.size).toBe(2);
    expect(room.rematchDeadline).toBeGreaterThan(Date.now());
  });

  it('requires every eligible player to vote yes', async () => {
    const room = await twoPlayerRoom(platform);
    await finishedMatch(platform, room);
    const [host, guest] = room.humanPlayers;

    platform.rematchManager.vote(room, host!.id, true);
    expect(room.status).toBe('REMATCH_WAITING');
    expect(room.rematchVotes.get(host!.id)).toBe(true);

    platform.rematchManager.vote(room, guest!.id, true);
    await waitFor(() => room.matchNumber === 2, { timeoutMs: 3000 });
    expect(['NEW_MATCH', 'COUNTDOWN']).toContain(room.status);
  });

  it('starts the rematch exactly once even with duplicate votes', async () => {
    const room = await twoPlayerRoom(platform);
    await finishedMatch(platform, room);
    const [host, guest] = room.humanPlayers;

    // Once the rematch starts the vote window closes, so late votes are rejected.
    const voteSafely = (playerId: string) => {
      try {
        platform.rematchManager.vote(room, playerId, true);
      } catch {
        /* expected: voting is closed after the rematch starts */
      }
    };

    voteSafely(host!.id);
    voteSafely(host!.id);
    voteSafely(guest!.id);
    voteSafely(guest!.id);
    voteSafely(guest!.id);

    await waitFor(() => room.matchNumber === 2, { timeoutMs: 3000 });
    expect(room.matchNumber).toBe(2);
    expect(room.players.size).toBe(2);

    // No second rematch may be created by the duplicate votes.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(room.matchNumber).toBe(2);
  });

  it('allows a player to withdraw their vote', async () => {
    const room = await twoPlayerRoom(platform);
    await finishedMatch(platform, room);
    const [host, guest] = room.humanPlayers;

    platform.rematchManager.vote(room, host!.id, true);
    platform.rematchManager.cancel(room, host!.id);
    expect(room.rematchVotes.has(host!.id)).toBe(false);
    expect(room.status).toBe('REMATCH_WAITING');
    expect(guest).toBeDefined();
  });

  it('returns to the lobby when the vote window expires', async () => {
    const room = await twoPlayerRoom(platform);
    await finishedMatch(platform, room);

    await waitFor(() => room.status === 'LOBBY', { timeoutMs: 5000 });
    expect(room.gameResult).toBeNull();
    expect(room.rematchDeadline).toBeNull();
    expect(room.players.size).toBe(2);
  });
});
