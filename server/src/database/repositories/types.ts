import type { GameStatistics, PlayerSummary } from '@2play/shared';

export interface UserRecord {
  id: string;
  sessionToken: string;
  nickname: string;
  avatar: string;
  createdAt: string;
  updatedAt: string;
}

export interface HistoryRecord {
  id: string;
  userId: string;
  gameId: string;
  roomId: string;
  players: PlayerSummary[];
  winnerId: string | null;
  result: 'win' | 'loss' | 'draw';
  score: number;
  durationSeconds: number;
  playedAt: string;
}

export interface NewHistoryRecord {
  userId: string;
  gameId: string;
  roomId: string;
  players: PlayerSummary[];
  winnerId: string | null;
  result: 'win' | 'loss' | 'draw';
  score: number;
  durationSeconds: number;
}

export type DatabaseMode = 'supabase' | 'memory';

/**
 * Persistence contract.
 *
 * Only genuinely persistent data lives here (users, history, statistics,
 * favorites). Live rooms, sockets, timers and game frames are never persisted.
 */
export interface DatabaseRepository {
  readonly mode: DatabaseMode;
  init(): Promise<void>;
  health(): Promise<{ ok: boolean; detail?: string }>;
  close(): Promise<void>;

  upsertUser(input: { sessionToken: string; nickname: string; avatar: string }): Promise<UserRecord | null>;
  findUserBySession(sessionToken: string): Promise<UserRecord | null>;
  findUserById(userId: string): Promise<UserRecord | null>;
  updateUser(userId: string, patch: { nickname?: string; avatar?: string }): Promise<UserRecord | null>;

  recordMatch(input: {
    userId: string;
    gameId: string;
    result: 'win' | 'loss' | 'draw';
    score: number;
    history: NewHistoryRecord;
  }): Promise<void>;

  getHistory(userId: string, limit?: number): Promise<HistoryRecord[]>;
  getStatistics(userId: string): Promise<GameStatistics[]>;
  getStatistic(userId: string, gameId: string): Promise<GameStatistics | null>;

  addFavorite(userId: string, gameId: string): Promise<void>;
  removeFavorite(userId: string, gameId: string): Promise<void>;
  getFavorites(userId: string): Promise<Array<{ gameId: string; createdAt: string }>>;
  isFavorite(userId: string, gameId: string): Promise<boolean>;
}
