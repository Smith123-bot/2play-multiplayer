import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPlayer, createTestPlatform, waitFor, type TestPlatform } from '../test/harness';
import type { Platform } from '../core/Platform';
import type { Room } from '../rooms/Room';

async function twoPlayerRoom(platform: Platform, gameId = 'math-rush'): Promise<Room> {
  const host = await createPlayer(platform, 'LifeHost');
  const guest = await createPlayer(platform, 'LifeGuest');
  const room = platform.roomManager.createRoom({
    gameId,
    maxPlayers: 2,
    isPrivate: false,
    host,
  });
  platform.roomManager.joinRoom({ roomId: room.id, player: guest });
  return room;
}

describe('GameLifecycleManager', () => {
  let harness: TestPlatform;
  let platform: Platform;

  beforeEach(() => {
    harness = createTestPlatform();
    platform = harness.platform;
  });

  afterEach(() => harness.destroy());

  it('runs the countdown and starts the match', async () => {
    const room = await twoPlayerRoom(platform);
    for (const player of room.humanPlayers) platform.lobbyManager.setReady(room, player.id, true);

    platform.lifecycleManager.startCountdown(room);
    expect(room.status).toBe('COUNTDOWN');
    expect(platform.gameManager.getPublicState(room)).not.toBeNull();

    await waitFor(() => room.status === 'PLAYING', { timeoutMs: 10_000 });
    expect(room.gameStartedAt).toBeGreaterThan(0);
    expect((room.gameState as { phase?: string }).phase).toBeDefined();
  });

  it('prevents a second countdown while one is running', async () => {
    const room = await twoPlayerRoom(platform);
    for (const player of room.humanPlayers) platform.lobbyManager.setReady(room, player.id, true);
    platform.lifecycleManager.startCountdown(room);
    expect(() => platform.lifecycleManager.startCountdown(room)).toThrow(/countdown/i);
  });

  it('keeps room, players and chat alive across the finish line', async () => {
    const room = await twoPlayerRoom(platform);
    for (const player of room.humanPlayers) platform.lobbyManager.setReady(room, player.id, true);
    platform.lifecycleManager.startCountdown(room);
    await waitFor(() => room.status === 'PLAYING', { timeoutMs: 10_000 });
    platform.chatManager.sendMessage(room, room.humanPlayers[0]!, 'good luck');
    const chatBefore = room.chat.length;

    platform.lifecycleManager.finishMatch(room, 'completed');

    expect(room.status).toBe('REMATCH_WAITING');
    expect(room.players.size).toBe(2);
    expect(room.chat.length).toBeGreaterThanOrEqual(chatBefore);
    expect(room.gameResult).not.toBeNull();
    // Gameplay timers are gone; only the rematch vote timer remains.
    const types = platform.timerManager.timersForRoom(room.id).map((timer) => timer.type);
    expect(types).not.toContain('turn');
    expect(types).not.toContain('gameDuration');
    expect(types).toContain('rematch');
  });

  it('records statistics for every human player', async () => {
    const room = await twoPlayerRoom(platform);
    for (const player of room.humanPlayers) platform.lobbyManager.setReady(room, player.id, true);
    platform.lifecycleManager.startCountdown(room);
    await waitFor(() => room.status === 'PLAYING', { timeoutMs: 10_000 });
    platform.lifecycleManager.finishMatch(room, 'completed');

    await waitFor(async () => true, { timeoutMs: 50 });
    for (const player of room.humanPlayers) {
      const history = await platform.database.getHistory(player.userId!);
      expect(history.length).toBe(1);
      expect(history[0]?.gameId).toBe('math-rush');
    }
  });

  it('abandons the match and returns to the lobby when a player leaves', async () => {
    const room = await twoPlayerRoom(platform);
    for (const player of room.humanPlayers) platform.lobbyManager.setReady(room, player.id, true);
    platform.lifecycleManager.startCountdown(room);
    await waitFor(() => room.status === 'PLAYING', { timeoutMs: 10_000 });

    platform.roomManager.leaveRoom(room, room.humanPlayers[1]!.id, 'leave');
    expect(room.status).toBe('LOBBY');
    expect(room.gameResult).toBeNull();
    expect(platform.timerManager.timersForRoom(room.id).map((timer) => timer.type)).not.toContain('turn');
  });

  it('resets everything when returning to the lobby', async () => {
    const room = await twoPlayerRoom(platform);
    for (const player of room.humanPlayers) platform.lobbyManager.setReady(room, player.id, true);
    platform.lifecycleManager.startCountdown(room);
    await waitFor(() => room.status === 'PLAYING', { timeoutMs: 10_000 });
    platform.lifecycleManager.finishMatch(room, 'completed');

    platform.lifecycleManager.returnToLobby(room);
    expect(room.status).toBe('LOBBY');
    expect(room.gameResult).toBeNull();
    expect(room.gameState).toBeNull();
    expect(room.rematchVotes.size).toBe(0);
    expect(room.orderedPlayers.every((player) => !player.isReady)).toBe(true);
    expect(platform.timerManager.timersForRoom(room.id)).toHaveLength(0);
  });
});
