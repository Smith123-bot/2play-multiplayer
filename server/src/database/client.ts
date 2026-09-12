import type { GameStatistics, PlayerSummary } from '@2play/shared';
import { hasSupabaseConfig } from '../config/env';
import { createLogger } from '../utils/logger';
import { MemoryRepository } from './repositories/MemoryRepository';
import { SupabaseRepository } from './repositories/SupabaseRepository';
import type {
  DatabaseMode,
  DatabaseRepository,
  HistoryRecord,
  NewHistoryRecord,
  UserRecord,
} from './repositories/types';

export type { DatabaseRepository, DatabaseMode, UserRecord, HistoryRecord, NewHistoryRecord };

export interface DatabaseLike extends DatabaseRepository {
  readonly mode: DatabaseMode;
  init(): Promise<void>;
  healthStatus(): Promise<{ ok: boolean; mode: string; detail?: string }>;
  ensureHealthy(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Database facade.
 *
 * Picks Supabase when credentials exist and the connection verifies, otherwise
 * transparently degrades to the in-memory repository so gameplay keeps working.
 * Nothing above this layer knows which implementation is active, and a
 * mid-session database outage swaps implementations instead of failing.
 */
export class Database implements DatabaseLike {
  private repository: DatabaseRepository;
  private readonly logger = createLogger('Database');
  private initialised = false;
  private healthCache: {
    expiresAt: number;
    value: { ok: boolean; mode: string; detail?: string };
  } | null = null;
  private healthInFlight: Promise<{ ok: boolean; mode: string; detail?: string }> | null = null;
  private static readonly HEALTH_CACHE_MS = 5_000;

  constructor(repository?: DatabaseRepository) {
    this.repository =
      repository ?? (hasSupabaseConfig() ? new SupabaseRepository() : new MemoryRepository());
  }

  get mode(): DatabaseMode {
    return this.repository.mode;
  }

  async init(): Promise<void> {
    if (this.initialised) return;
    this.initialised = true;
    await this.repository.init();
    this.logger.info('database layer ready', { mode: this.repository.mode });
  }

  async healthStatus(): Promise<{ ok: boolean; mode: string; detail?: string }> {
    const now = Date.now();
    if (this.healthCache && this.healthCache.expiresAt > now) return this.healthCache.value;
    if (this.healthInFlight) return this.healthInFlight;

    this.healthInFlight = (async () => {
      const health = await this.repository.health();
      const value = {
        ok: health.ok,
        mode: this.repository.mode,
        ...(health.detail ? { detail: health.detail } : {}),
      };
      this.healthCache = { expiresAt: Date.now() + Database.HEALTH_CACHE_MS, value };
      return value;
    })();
    try {
      return await this.healthInFlight;
    } finally {
      this.healthInFlight = null;
    }
  }

  async ensureHealthy(): Promise<void> {
    if (this.repository.mode !== 'supabase') return;
    const health = await this.healthStatus();
    if (!health.ok) {
      this.logger.warn('Supabase unhealthy — switching to in-memory repository.', {
        detail: health.detail,
      });
      const fallback = new MemoryRepository();
      await fallback.init();
      this.repository = fallback;
      this.healthCache = null;
    }
  }

  async upsertUser(input: {
    sessionToken: string;
    nickname: string;
    avatar: string;
  }): Promise<UserRecord | null> {
    return this.repository.upsertUser(input);
  }

  async findUserBySession(sessionToken: string): Promise<UserRecord | null> {
    return this.repository.findUserBySession(sessionToken);
  }

  async findUserById(userId: string): Promise<UserRecord | null> {
    return this.repository.findUserById(userId);
  }

  async updateUser(
    userId: string,
    patch: { nickname?: string; avatar?: string },
  ): Promise<UserRecord | null> {
    return this.repository.updateUser(userId, patch);
  }

  async recordMatch(input: {
    userId: string;
    gameId: string;
    result: 'win' | 'loss' | 'draw';
    score: number;
    history: NewHistoryRecord;
  }): Promise<void> {
    return this.repository.recordMatch(input);
  }

  async getHistory(userId: string, limit?: number): Promise<HistoryRecord[]> {
    return this.repository.getHistory(userId, limit);
  }

  async getStatistics(userId: string): Promise<GameStatistics[]> {
    return this.repository.getStatistics(userId);
  }

  async getStatistic(userId: string, gameId: string): Promise<GameStatistics | null> {
    return this.repository.getStatistic(userId, gameId);
  }

  async addFavorite(userId: string, gameId: string): Promise<void> {
    return this.repository.addFavorite(userId, gameId);
  }

  async removeFavorite(userId: string, gameId: string): Promise<void> {
    return this.repository.removeFavorite(userId, gameId);
  }

  async getFavorites(userId: string): Promise<Array<{ gameId: string; createdAt: string }>> {
    return this.repository.getFavorites(userId);
  }

  async isFavorite(userId: string, gameId: string): Promise<boolean> {
    return this.repository.isFavorite(userId, gameId);
  }

  /** Snapshot types are re-exported for convenience. */
  declare readonly __types?: PlayerSummary;

  async health(): Promise<{ ok: boolean; detail?: string }> {
    return this.repository.health();
  }

  async close(): Promise<void> {
    await this.repository.close();
    this.healthCache = null;
    this.healthInFlight = null;
    this.initialised = false;
  }
}

export const database: DatabaseLike = new Database();
