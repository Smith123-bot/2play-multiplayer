import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { GameStatistics, PlayerSummary } from '@2play/shared';
import { HISTORY_MAX_ITEMS } from '@2play/shared';
import { env } from '../../config/env';
import { createLogger } from '../../utils/logger';
import type {
  DatabaseRepository,
  HistoryRecord,
  NewHistoryRecord,
  UserRecord,
} from './types';

interface UserRow {
  id: string;
  session_token: string;
  nickname: string;
  avatar: string;
  created_at: string;
  updated_at: string;
}

interface HistoryRow {
  id: string;
  user_id: string;
  game_id: string;
  room_id: string;
  players_json: PlayerSummary[] | null;
  winner_id: string | null;
  result: string;
  score: number;
  duration_seconds: number;
  played_at: string;
}

interface StatisticsRow {
  user_id: string;
  game_id: string;
  wins: number;
  losses: number;
  draws: number;
  total_played: number;
  best_score: number;
  updated_at: string;
}

interface FavoriteRow {
  game_id: string;
  created_at: string;
}

/**
 * Supabase (PostgreSQL) repository.
 *
 * Uses the service-role key when present — server side only, never exposed to
 * the browser. Every call is defensive: a database failure is logged and
 * degraded, it never crashes gameplay (spec §71).
 */
export class SupabaseRepository implements DatabaseRepository {
  public readonly mode = 'supabase' as const;
  private client: SupabaseClient | null = null;
  private readonly logger = createLogger('SupabaseRepository');
  private healthy = false;
  private lastError: string | null = null;

  constructor() {
    const url = env.SUPABASE_URL;
    const key = env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_ANON_KEY;
    if (!url || !key) {
      this.logger.warn('Supabase credentials missing — repository will not initialise.');
      return;
    }
    this.client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { 'x-application-name': '2play-server' } },
    });
  }

  get isConfigured(): boolean {
    return this.client !== null;
  }

  async init(): Promise<void> {
    if (!this.client) return;
    const health = await this.health();
    if (health.ok) {
      this.logger.info('Supabase connection verified', { url: env.SUPABASE_URL });
    } else {
      this.logger.error('Supabase connection failed — falling back to degraded persistence.', {
        detail: health.detail,
      });
    }
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    if (!this.client) return { ok: false, detail: 'Supabase client not configured.' };
    try {
      const { error } = await this.client.from('users').select('id').limit(1);
      if (error) {
        this.healthy = false;
        this.lastError = error.message;
        return { ok: false, detail: error.message };
      }
      this.healthy = true;
      this.lastError = null;
      return { ok: true };
    } catch (error) {
      this.healthy = false;
      this.lastError = error instanceof Error ? error.message : String(error);
      return { ok: false, detail: this.lastError ?? 'unknown error' };
    }
  }

  async close(): Promise<void> {
    this.client = null;
    this.healthy = false;
  }

  private mapUser(row: UserRow): UserRecord {
    return {
      id: row.id,
      sessionToken: row.session_token,
      nickname: row.nickname,
      avatar: row.avatar,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapHistory(row: HistoryRow): HistoryRecord {
    return {
      id: row.id,
      userId: row.user_id,
      gameId: row.game_id,
      roomId: row.room_id,
      players: (row.players_json ?? []) as PlayerSummary[],
      winnerId: row.winner_id,
      result: (row.result === 'win' || row.result === 'loss' || row.result === 'draw'
        ? row.result
        : 'draw') as 'win' | 'loss' | 'draw',
      score: row.score ?? 0,
      durationSeconds: row.duration_seconds ?? 0,
      playedAt: row.played_at,
    };
  }

  private mapStatistics(row: StatisticsRow): GameStatistics {
    return {
      userId: row.user_id,
      gameId: row.game_id,
      wins: row.wins ?? 0,
      losses: row.losses ?? 0,
      draws: row.draws ?? 0,
      totalPlayed: row.total_played ?? 0,
      bestScore: row.best_score ?? 0,
      updatedAt: row.updated_at,
    };
  }

  async upsertUser(input: {
    sessionToken: string;
    nickname: string;
    avatar: string;
  }): Promise<UserRecord | null> {
    if (!this.client) return null;
    try {
      const { data, error } = await this.client
        .from('users')
        .upsert(
          { session_token: input.sessionToken, nickname: input.nickname, avatar: input.avatar },
          { onConflict: 'session_token' },
        )
        .select('*')
        .single();
      if (error) throw error;
      return data ? this.mapUser(data as UserRow) : null;
    } catch (error) {
      this.logger.error('upsertUser failed', { message: (error as Error).message });
      return null;
    }
  }

  async findUserBySession(sessionToken: string): Promise<UserRecord | null> {
    if (!this.client) return null;
    try {
      const { data, error } = await this.client
        .from('users')
        .select('*')
        .eq('session_token', sessionToken)
        .maybeSingle();
      if (error) throw error;
      return data ? this.mapUser(data as UserRow) : null;
    } catch (error) {
      this.logger.error('findUserBySession failed', { message: (error as Error).message });
      return null;
    }
  }

  async findUserById(userId: string): Promise<UserRecord | null> {
    if (!this.client) return null;
    try {
      const { data, error } = await this.client
        .from('users')
        .select('*')
        .eq('id', userId)
        .maybeSingle();
      if (error) throw error;
      return data ? this.mapUser(data as UserRow) : null;
    } catch (error) {
      this.logger.error('findUserById failed', { message: (error as Error).message });
      return null;
    }
  }

  async updateUser(
    userId: string,
    patch: { nickname?: string; avatar?: string },
  ): Promise<UserRecord | null> {
    if (!this.client) return null;
    try {
      const { data, error } = await this.client
        .from('users')
        .update({
          ...(patch.nickname ? { nickname: patch.nickname } : {}),
          ...(patch.avatar ? { avatar: patch.avatar } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      return data ? this.mapUser(data as UserRow) : null;
    } catch (error) {
      this.logger.error('updateUser failed', { message: (error as Error).message });
      return null;
    }
  }

  async recordMatch(input: {
    userId: string;
    gameId: string;
    result: 'win' | 'loss' | 'draw';
    score: number;
    history: NewHistoryRecord;
  }): Promise<void> {
    if (!this.client) return;
    try {
      const { error: rpcError } = await this.client.rpc('record_match_result', {
        p_user_id: input.userId,
        p_game_id: input.gameId,
        p_result: input.result,
        p_score: input.score,
      });
      if (rpcError) throw rpcError;

      const { error: historyError } = await this.client.from('game_history').insert({
        user_id: input.userId,
        game_id: input.history.gameId,
        room_id: input.history.roomId,
        players_json: input.history.players,
        winner_id: input.history.winnerId,
        result: input.history.result,
        score: input.history.score,
        duration_seconds: input.history.durationSeconds,
        played_at: new Date().toISOString(),
      });
      if (historyError) throw historyError;
    } catch (error) {
      this.logger.error('recordMatch failed', {
        message: (error as Error).message,
        gameId: input.gameId,
      });
    }
  }

  async getHistory(userId: string, limit = HISTORY_MAX_ITEMS): Promise<HistoryRecord[]> {
    if (!this.client) return [];
    try {
      const { data, error } = await this.client
        .from('game_history')
        .select('*')
        .eq('user_id', userId)
        .order('played_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return ((data ?? []) as HistoryRow[]).map((row) => this.mapHistory(row));
    } catch (error) {
      this.logger.error('getHistory failed', { message: (error as Error).message });
      return [];
    }
  }

  async getStatistics(userId: string): Promise<GameStatistics[]> {
    if (!this.client) return [];
    try {
      const { data, error } = await this.client
        .from('statistics')
        .select('*')
        .eq('user_id', userId);
      if (error) throw error;
      return ((data ?? []) as StatisticsRow[]).map((row) => this.mapStatistics(row));
    } catch (error) {
      this.logger.error('getStatistics failed', { message: (error as Error).message });
      return [];
    }
  }

  async getStatistic(userId: string, gameId: string): Promise<GameStatistics | null> {
    if (!this.client) return null;
    try {
      const { data, error } = await this.client
        .from('statistics')
        .select('*')
        .eq('user_id', userId)
        .eq('game_id', gameId)
        .maybeSingle();
      if (error) throw error;
      return data ? this.mapStatistics(data as StatisticsRow) : null;
    } catch (error) {
      this.logger.error('getStatistic failed', { message: (error as Error).message });
      return null;
    }
  }

  async addFavorite(userId: string, gameId: string): Promise<void> {
    if (!this.client) return;
    try {
      const { error } = await this.client
        .from('favorites')
        .upsert({ user_id: userId, game_id: gameId }, { onConflict: 'user_id,game_id' });
      if (error) throw error;
    } catch (error) {
      this.logger.error('addFavorite failed', { message: (error as Error).message });
    }
  }

  async removeFavorite(userId: string, gameId: string): Promise<void> {
    if (!this.client) return;
    try {
      const { error } = await this.client
        .from('favorites')
        .delete()
        .eq('user_id', userId)
        .eq('game_id', gameId);
      if (error) throw error;
    } catch (error) {
      this.logger.error('removeFavorite failed', { message: (error as Error).message });
    }
  }

  async getFavorites(userId: string): Promise<Array<{ gameId: string; createdAt: string }>> {
    if (!this.client) return [];
    try {
      const { data, error } = await this.client
        .from('favorites')
        .select('game_id, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return ((data ?? []) as FavoriteRow[]).map((row) => ({
        gameId: row.game_id,
        createdAt: row.created_at,
      }));
    } catch (error) {
      this.logger.error('getFavorites failed', { message: (error as Error).message });
      return [];
    }
  }

  async isFavorite(userId: string, gameId: string): Promise<boolean> {
    const favorites = await this.getFavorites(userId);
    return favorites.some((favorite) => favorite.gameId === gameId);
  }

  get status(): { healthy: boolean; lastError: string | null } {
    return { healthy: this.healthy, lastError: this.lastError };
  }
}
