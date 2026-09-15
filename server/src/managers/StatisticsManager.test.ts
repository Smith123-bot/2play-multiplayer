import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GameResult } from '@2play/shared';
import { createPlayer, createTestPlatform, type TestPlatform } from '../test/harness';
import type { Platform } from '../core/Platform';
import type { Room } from '../rooms/Room';

async function twoPlayerRoom(platform: Platform, gameId = 'chess'): Promise<Room> {
  const host = await createPlayer(platform, 'StatHost');
  const guest = await createPlayer(platform, 'StatGuest');
  const room = platform.roomManager.createRoom({
    gameId,
    maxPlayers: 2,
    isPrivate: false,
    host,
  });
  platform.roomManager.joinRoom({ roomId: room.id, player: guest });
  return room;
}

function resultFor(room: Room, winners: string[], isDraw = false): GameResult {
  return {
    gameId: room.gameId,
    roomId: room.id,
    matchNumber: room.matchNumber,
    winners,
    rankings: room.orderedPlayers.map((player, index) => ({
      playerId: player.id,
      nickname: player.nickname,
      avatar: player.avatar,
      score: 100 - index * 10,
      rank: index + 1,
      isAI: false,
    })),
    isDraw,
    durationSeconds: 120,
    finishedAt: Date.now(),
    reason: isDraw ? 'draw' : 'completed',
  };
}

describe('StatisticsManager persistence', () => {
  let harness: TestPlatform;
  let platform: Platform;

  beforeEach(() => {
    harness = createTestPlatform();
    platform = harness.platform;
  });

  afterEach(() => harness.destroy());

  it('records a win for the winner and a loss for the loser, exactly once', async () => {
    const room = await twoPlayerRoom(platform);
    const [host, guest] = room.orderedPlayers;
    await platform.statisticsManager.recordMatch(room, resultFor(room, [host!.id]));

    const hostStats = await platform.database.getStatistic(host!.userId!, room.gameId);
    expect(hostStats).toMatchObject({ wins: 1, losses: 0, draws: 0, totalPlayed: 1 });
    const guestStats = await platform.database.getStatistic(guest!.userId!, room.gameId);
    expect(guestStats).toMatchObject({ wins: 0, losses: 1, draws: 0, totalPlayed: 1 });

    const hostHistory = await platform.database.getHistory(host!.userId!);
    expect(hostHistory).toHaveLength(1);
    expect(hostHistory[0]).toMatchObject({ gameId: room.gameId, result: 'win' });
  });

  it('records a draw for every human player', async () => {
    const room = await twoPlayerRoom(platform, 'rock-paper-scissors');
    const [host, guest] = room.orderedPlayers;
    await platform.statisticsManager.recordMatch(room, resultFor(room, [], true));

    for (const player of [host!, guest!]) {
      const stats = await platform.database.getStatistic(player.userId!, room.gameId);
      expect(stats).toMatchObject({ wins: 0, losses: 0, draws: 1, totalPlayed: 1 });
    }
  });

  it('ignores a duplicate finish event instead of double-counting', async () => {
    const room = await twoPlayerRoom(platform);
    const [host] = room.orderedPlayers;
    const result = resultFor(room, [host!.id]);

    await platform.statisticsManager.recordMatch(room, result);
    await platform.statisticsManager.recordMatch(room, result);

    const stats = await platform.database.getStatistic(host!.userId!, room.gameId);
    expect(stats).toMatchObject({ wins: 1, totalPlayed: 1 });
    expect(await platform.database.getHistory(host!.userId!)).toHaveLength(1);
  });

  it('records a rematch as a separate match, not a duplicate', async () => {
    const room = await twoPlayerRoom(platform);
    const [host] = room.orderedPlayers;

    await platform.statisticsManager.recordMatch(room, resultFor(room, [host!.id]));
    room.matchNumber += 1;
    await platform.statisticsManager.recordMatch(room, resultFor(room, [host!.id]));

    const stats = await platform.database.getStatistic(host!.userId!, room.gameId);
    expect(stats).toMatchObject({ wins: 2, totalPlayed: 2 });
    expect(await platform.database.getHistory(host!.userId!)).toHaveLength(2);
  });

  it('persists through the game:finished event without game-specific code', async () => {
    const room = await twoPlayerRoom(platform, 'ludo');
    const [host, guest] = room.orderedPlayers;
    platform.eventBus.emit('game:finished', { room, result: resultFor(room, [guest!.id]) });

    // The event path is fire-and-forget by design; wait for the write.
    const deadline = Date.now() + 5000;
    let stats = await platform.database.getStatistic(guest!.userId!, room.gameId);
    while (!stats && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      stats = await platform.database.getStatistic(guest!.userId!, room.gameId);
    }
    expect(stats).toMatchObject({ wins: 1, totalPlayed: 1 });
    const hostStats = await platform.database.getStatistic(host!.userId!, room.gameId);
    expect(hostStats).toMatchObject({ losses: 1, totalPlayed: 1 });
  });
});
