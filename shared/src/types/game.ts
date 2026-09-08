import type { AIDifficulty, PlayerSummary } from './player';

export type GameCategory = 'reflex' | 'memory' | 'word' | 'strategy' | 'math';
export type GameDifficulty = 'easy' | 'medium' | 'hard';

export interface GameMetadata {
  id: string;
  name: string;
  description: string;
  category: GameCategory;
  icon: string;
  /** Emoji/asset used for the card art (kept 2D: emoji, CSS or SVG). */
  thumbnail: string;
  minPlayers: number;
  maxPlayers: number;
  supportedPlayerCounts: number[];
  hasAI: boolean;
  aiDifficulties: AIDifficulty[];
  /** Estimated session length in seconds. */
  estimatedDuration: number;
  difficulty: GameDifficulty;
  controls: string;
  rules: string[];
  scoring: string;
  winCondition: string;
  tags: string[];
  featured: boolean;
  /** Optional per-game options surfaced in the lobby (e.g. grid sizes). */
  gridOptions?: string[];
  /** Round based games (best of N) expose a round count in the lobby. */
  hasRounds?: boolean;
  defaultRounds?: number;
  version: string;
}

export interface GameConfig {
  /** Total seats in the room (humans + AI). */
  playerCount: number;
  /** Human players in the room. */
  humanCount: number;
  aiOpponents: number;
  aiDifficulty: AIDifficulty;
  gridSize?: string;
  rounds?: number;
  seed?: number;
}

export interface GameAction {
  type: string;
  payload?: Record<string, unknown>;
}

export interface PlayerRanking {
  playerId: string;
  nickname: string;
  avatar: string;
  rank: number;
  score: number;
  isWinner: boolean;
  isDraw: boolean;
  isAI: boolean;
  /** Game specific extras (rounds won, best reaction, pairs found...). */
  stats: Record<string, number>;
}

export type GameFinishReason = 'completed' | 'abandoned' | 'forfeit' | 'timeout' | 'draw';

export interface GameResult {
  gameId: string;
  roomId: string;
  matchNumber: number;
  winners: string[];
  rankings: PlayerRanking[];
  isDraw: boolean;
  durationSeconds: number;
  finishedAt: number;
  reason: GameFinishReason;
}

export interface GameHistoryEntry {
  id: string;
  gameId: string;
  gameName: string;
  roomId: string;
  players: PlayerSummary[];
  winnerId: string | null;
  winnerName: string | null;
  result: 'win' | 'loss' | 'draw';
  score: number;
  durationSeconds: number;
  playedAt: string;
}

export interface GameStatistics {
  userId: string;
  gameId: string;
  wins: number;
  losses: number;
  draws: number;
  totalPlayed: number;
  bestScore: number;
  updatedAt: string;
}

export interface FavoriteGame {
  gameId: string;
  createdAt: string;
}

/**
 * Real, platform-wide "most played" signal (spec: never fabricated numbers).
 * Tracked for the lifetime of the server process from completed matches.
 */
export interface GamePopularity {
  gameId: string;
  playCount: number;
  uniquePlayers: number;
  lastPlayedAt: number;
}
