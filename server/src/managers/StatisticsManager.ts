import type {
  GameHistoryEntry,
  GamePopularity,
  GameResult,
  GameStatistics,
  PlayerSummary,
} from '@2play/shared';
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

  /**
   * Platform-wide "most played" ranking (spec: real usage, never fabricated).
   *
   * This is intentionally process-lifetime only — a lightweight, additive
   * layer on top of the existing per-user persistence rather than a new
   * database table. It never blocks or replaces `recordMatch`.
   */
  private readonly globalPlayCounts = new Map<
    string,
    { count: number; players: Set<string>; lastPlayedAt: number }
  >();

  /**
   * Idempotency guard: the server-generated `room.matchIdFor(matchNumber)`
   * identifier is written to the database. The same identifier is also persisted as
   * `match_id`, so database retries remain idempotent after this process guard
   * is evicted. A duplicate `game:finished` emission (retried finish, double
   * event) must never double-count a match; a rematch bumps `matchNumber`,
   * so it always records as a separate match.
   */
  private readonly recordedMatches = new Set<string>();

  /**
   * The guard only needs to cover live rooms plus a safety margin — entries
   * are evicted oldest-first so a long-lived process cannot grow this set
   * without bound.
   */
  private static readonly RECORDED_MATCHES_CAP = 10_000;

  constructor(private readonly platform: Platform) {
    this.platform.eventBus.on('game:finished', ({ room, result }) => {
      // Fire-and-forget: persistence must never block or break gameplay.
      // `recordMatch` also gates the process-lifetime popularity projection by
      // the same server-generated match identifier.
      void this.recordMatch(room, result).catch((error: unknown) => {
        this.logger.error('statistics persistence failed', {
          roomId: room.id,
          message: error instanceof Error ? error.message : String(error),
        });
      });
    });
  }

  private recordGlobalPopularity(gameId: string, playerIds: string[], finishedAt: number): void {
    const entry = this.globalPlayCounts.get(gameId) ?? {
      count: 0,
      players: new Set<string>(),
      lastPlayedAt: 0,
    };
    entry.count += 1;
    for (const playerId of playerIds) entry.players.add(playerId);
    entry.lastPlayedAt = Math.max(entry.lastPlayedAt, finishedAt);
    this.globalPlayCounts.set(gameId, entry);
  }

  /** Real, non-fabricated "most played" ranking — highest completed-match count first. */
  getGlobalPopularity(): GamePopularity[] {
    return [...this.globalPlayCounts.entries()]
      .map(([gameId, entry]) => ({
        gameId,
        playCount: entry.count,
        uniquePlayers: entry.players.size,
        lastPlayedAt: entry.lastPlayedAt,
      }))
      .sort((a, b) => b.playCount - a.playCount || b.lastPlayedAt - a.lastPlayedAt);
  }

  async recordMatch(room: Room, result: GameResult): Promise<void> {
    const matchNumber = result.matchNumber;
    const matchId = room.matchIdFor(matchNumber);
    const matchKey = `${room.id}:${matchNumber}`;
    if (this.recordedMatches.has(matchKey)) {
      this.logger.debug('duplicate finish ignored', {
        roomId: room.id,
        matchNumber,
      });
      return;
    }
    this.recordedMatches.add(matchKey);
    this.recordGlobalPopularity(
      room.gameId,
      room.humanPlayers.map((player) => player.id),
      result.finishedAt,
    );
    while (this.recordedMatches.size > StatisticsManager.RECORDED_MATCHES_CAP) {
      const oldest = this.recordedMatches.values().next().value as string | undefined;
      if (oldest === undefined) break;
      this.recordedMatches.delete(oldest);
    }
    const players: PlayerSummary[] = room.orderedPlayers.map((player) => ({
      id: player.id,
      nickname: player.nickname,
      avatar: player.avatar,
    }));
    const durationSeconds = Math.max(
      0,
      Math.round((result.finishedAt - (room.gameStartedAt ?? result.finishedAt)) / 1000),
    );

    await Promise.all(
      room.humanPlayers.map(async (player) => {
        if (!player.userId) return;
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
              matchId,
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
      }),
    );

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

  async getSummary(
    userId: string,
    existingStatistics?: GameStatistics[],
  ): Promise<StatisticsSummary> {
    const stats = existingStatistics ?? (await this.getStatistics(userId));
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
