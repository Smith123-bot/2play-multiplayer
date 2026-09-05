import { DIFFICULTIES } from '../constants';

export const AI_DIFFICULTIES = DIFFICULTIES;
export type AIDifficulty = (typeof DIFFICULTIES)[number];

export const PLAYER_ROLES = ['player', 'spectator'] as const;
export type PlayerRole = (typeof PLAYER_ROLES)[number];

/**
 * The only player shape a client ever receives.
 * `sessionToken` is deliberately absent: it never leaves the server.
 */
export interface Player {
  id: string;
  nickname: string;
  avatar: string;
  isHost: boolean;
  isReady: boolean;
  isConnected: boolean;
  isAI: boolean;
  aiDifficulty: AIDifficulty | null;
  score: number;
  seatIndex: number;
  joinedAt: number;
  /** True while the player is inside the reconnection grace period. */
  isDisconnected: boolean;
  /** Epoch ms deadline after which a disconnected player is removed. */
  reconnectDeadline: number | null;
  /** Latest disconnect timestamp (null while connected). */
  disconnectedAt: number | null;
  role: PlayerRole;
}

export interface PlayerSummary {
  id: string;
  nickname: string;
  avatar: string;
}

/** Identity handed to the client after a successful authentication. */
export interface SessionInfo {
  userId: string;
  sessionToken: string;
  playerId: string;
  nickname: string;
  avatar: string;
  createdAt: number;
}
