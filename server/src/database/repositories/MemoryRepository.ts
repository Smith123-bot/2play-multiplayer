import type { GameStatistics, PlayerSummary } from '@2play/shared';
import { HISTORY_MAX_ITEMS } from '@2play/shared';
import { createId } from '../../utils/ids';
import { createLogger } from '../../utils/logger';
import type {
  DatabaseRepository,
  HistoryRecord,
  NewHistoryRecord,
  UserRecord,
} from './types';

/**
 * In-memory fallback repository.
 *
 * Used when Supabase credentials are absent so that local gameplay (and the
 * whole acceptance test suite) works without a database. Persistent features
 * keep working for the lifetime of the server process; the health endpoint
 * reports `mode: "memory"` so this is always visible, never silent.
 */
export class MemoryRepository implements DatabaseRepository {
  public readonly mode = 'memory' as const;
  private readonly users = new Map<string, UserRecord>();
  private readonly usersBySession = new Map<string, string>();
  private readonly history = new Map<string, HistoryRecord[]>();
  private readonly statistics = new Map<string, GameStatistics>();
  private readonly favorites = new Map<string, Map<string, string>>();
  private readonly logger = createLogger('MemoryRepository');

  async init(): Promise<void> {
    this.logger.warn(
      'No Supabase configuration found — running with in-memory persistence (data is NOT durable).',
    );
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: true, detail: 'in-memory fallback (no Supabase configured)' };
  }

  async close(): Promise<void> {
    this.users.clear();
    this.usersBySession.clear();
    this.history.clear();
    this.statistics.clear();
    this.favorites.clear();
  }

  async upsertUser(input: {
    sessionToken: string;
    nickname: string;
    avatar: string;
  }): Promise<UserRecord | null> {
    const existingId = this.usersBySession.get(input.sessionToken);
    const nowIso = new Date().toISOString();
    if (existingId) {
      const existing = this.users.get(existingId);
      if (existing) {
        const updated: UserRecord = {
          ...existing,
          nickname: input.nickname,
          avatar: input.avatar,
          updatedAt: nowIso,
        };
        this.users.set(existingId, updated);
        return updated;
      }
    }
    const record: UserRecord = {
      id: createId(),
      sessionToken: input.sessionToken,
      nickname: input.nickname,
      avatar: input.avatar,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    this.users.set(record.id, record);
    this.usersBySession.set(record.sessionToken, record.id);
    return record;
  }

  async findUserBySession(sessionToken: string): Promise<UserRecord | null> {
    const id = this.usersBySession.get(sessionToken);
    if (!id) return null;
    return this.users.get(id) ?? null;
  }

  async findUserById(userId: string): Promise<UserRecord | null> {
    return this.users.get(userId) ?? null;
  }

  async updateUser(
    userId: string,
    patch: { nickname?: string; avatar?: string },
  ): Promise<UserRecord | null> {
    const existing = this.users.get(userId);
    if (!existing) return null;
    const updated: UserRecord = {
      ...existing,
      ...(patch.nickname ? { nickname: patch.nickname } : {}),
      ...(patch.avatar ? { avatar: patch.avatar } : {}),
      updatedAt: new Date().toISOString(),
    };
    this.users.set(userId, updated);
    return updated;
  }

  async recordMatch(input: {
    userId: string;
    gameId: string;
    result: 'win' | 'loss' | 'draw';
    score: number;
    history: NewHistoryRecord;
  }): Promise<void> {
    const key = `${input.userId}:${input.gameId}`;
    const current: GameStatistics =
      this.statistics.get(key) ??
      ({
        userId: input.userId,
        gameId: input.gameId,
        wins: 0,
        losses: 0,
        draws: 0,
        totalPlayed: 0,
        bestScore: 0,
        updatedAt: new Date().toISOString(),
      } satisfies GameStatistics);

    this.statistics.set(key, {
      userId: input.userId,
      gameId: input.gameId,
      wins: current.wins + (input.result === 'win' ? 1 : 0),
      losses: current.losses + (input.result === 'loss' ? 1 : 0),
      draws: current.draws + (input.result === 'draw' ? 1 : 0),
      totalPlayed: current.totalPlayed + 1,
      bestScore: Math.max(current.bestScore, input.score),
      updatedAt: new Date().toISOString(),
    });

    const list = this.history.get(input.userId) ?? [];
    list.unshift({
      id: createId(),
      userId: input.userId,
      gameId: input.history.gameId,
      roomId: input.history.roomId,
      players: input.history.players,
      winnerId: input.history.winnerId,
      result: input.history.result,
      score: input.history.score,
      durationSeconds: input.history.durationSeconds,
      playedAt: new Date().toISOString(),
    });
    this.history.set(input.userId, list.slice(0, HISTORY_MAX_ITEMS));
  }

  async getHistory(userId: string, limit = HISTORY_MAX_ITEMS): Promise<HistoryRecord[]> {
    return (this.history.get(userId) ?? []).slice(0, limit);
  }

  async getStatistics(userId: string): Promise<GameStatistics[]> {
    return [...this.statistics.values()].filter((stat) => stat.userId === userId);
  }

  async getStatistic(userId: string, gameId: string): Promise<GameStatistics | null> {
    return this.statistics.get(`${userId}:${gameId}`) ?? null;
  }

  async addFavorite(userId: string, gameId: string): Promise<void> {
    const set = this.favorites.get(userId) ?? new Map<string, string>();
    if (!set.has(gameId)) set.set(gameId, new Date().toISOString());
    this.favorites.set(userId, set);
  }

  async removeFavorite(userId: string, gameId: string): Promise<void> {
    this.favorites.get(userId)?.delete(gameId);
  }

  async getFavorites(userId: string): Promise<Array<{ gameId: string; createdAt: string }>> {
    const set = this.favorites.get(userId);
    if (!set) return [];
    return [...set.entries()]
      .map(([gameId, createdAt]) => ({ gameId, createdAt }))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  async isFavorite(userId: string, gameId: string): Promise<boolean> {
    return this.favorites.get(userId)?.has(gameId) ?? false;
  }
}

export type { PlayerSummary };
