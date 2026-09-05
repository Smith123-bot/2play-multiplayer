import type { GameHistoryEntry, GameResult, GameStatistics, PlayerSummary } from '@2play/shared';
import type { Platform } from '../core/Platform';
import type { GameRepositoryStats } from './types';
import type { Room } from '../rooms/Room';
import { createLogger } from '../utils/logger';

export interface StatisticsSummary {
  totalPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  favoriteGameId: string | null;
}

/**
 * Persists match results and exposes statistics/history.
 *
 * Runs off the `game:finished` platform event, so every game benefits from
 * persistence without any game-specific code (spec §77).
 */
export class StatisticsManager {
  private readonly logger = createLogger('StatisticsManager');

  constructor(private readonly platform: Platform) {
    this.platform.eventBus.on('game:finished', ({ room, result }) => {
      // Fire-and-forget: persistence must never block or break gameplay.
      void this.recordMatch(room, result).catch((error: unknown) => {
        this.logger.error('statistics persistence failed', {
          roomId: room.id,
          message: error instanceof Error ? error.message : String(error),
        });
      });
    });
  }

  async recordMatch(room: Room, result: GameResult): Promise<void> {
    const players: PlayerSummary[] = room.orderedPlayers.map((player) => ({
      id: player.id,
      nickname: player.nickname,
      avatar: player.avatar,
    }));
    const durationSeconds = Math.max(
      0,
      Math.round((result.finishedAt - (room.gameStartedAt ?? result.finishedAt)) / 1000),
    );

    for (const player of room.humanPlayers) {
      if (!player.userId) continue;
      const ranking = result.rankings.find((entry) => entry.playerId === player.id);
      const outcome: 'win' | 'loss' | 'draw' = result.isDraw
        ? 'draw'
        : result.winners.includes(player.id)
          ? 'win'
          : 'loss';
      const score = ranking?.score ?? player.score;

      try {
        await this.platform.database.recordMatch({
          userId: player.userId,
          gameId: room.gameId,
          result: outcome,
          score,
          history: {
            userId: player.userId,
            gameId: room.gameId,
            roomId: room.id,
            players,
            winnerId: result.winners[0] ?? null,
            result: outcome,
            score,
            durationSeconds,
          },
        });
        this.logger.debug('match recorded', {
          userId: player.userId,
          gameId: room.gameId,
          outcome,
          score,
        });
      } catch (error) {
        this.logger.error('recordMatch failed', {
          userId: player.userId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // A database outage must never take the platform down.
    void this.platform.database.ensureHealthy();
  }

  async getStatistics(userId: string): Promise<GameStatistics[]> {
    return this.platform.database.getStatistics(userId);
  }

  async getStatistic(userId: string, gameId: string): Promise<GameStatistics | null> {
    return this.platform.database.getStatistic(userId, gameId);
  }

  async getHistory(userId: string, limit?: number): Promise<GameHistoryEntry[]> {
    const records = await this.platform.database.getHistory(userId, limit);
    return records.map((record) => ({
      id: record.id,
      gameId: record.gameId,
      gameName: this.platform.registry.find(record.gameId)?.metadata.name ?? record.gameId,
      roomId: record.roomId,
      players: record.players,
      winnerId: record.winnerId,
      winnerName: record.players.find((player) => player.id === record.winnerId)?.nickname ?? null,
      result: record.result,
      score: record.score,
      durationSeconds: record.durationSeconds,
      playedAt: record.playedAt,
    }));
  }

  async getSummary(userId: string): Promise<StatisticsSummary> {
    const stats = await this.getStatistics(userId);
    const totals = stats.reduce(
      (acc, entry) => ({
        totalPlayed: acc.totalPlayed + entry.totalPlayed,
        wins: acc.wins + entry.wins,
        losses: acc.losses + entry.losses,
        draws: acc.draws + entry.draws,
      }),
      { totalPlayed: 0, wins: 0, losses: 0, draws: 0 },
    );
    const favorite = [...stats].sort((a, b) => b.totalPlayed - a.totalPlayed)[0] ?? null;
    return {
      ...totals,
      winRate: totals.totalPlayed > 0 ? Math.round((totals.wins / totals.totalPlayed) * 100) : 0,
      favoriteGameId: favorite?.gameId ?? null,
    } satisfies GameRepositoryStats;
  }
}
