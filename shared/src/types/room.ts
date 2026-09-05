import type { Player } from './player';
import type { GameResult } from './game';
import type { ChatMessage } from './chat';

export const ROOM_STATUSES = [
  'WAITING',
  'LOBBY',
  'READY',
  'COUNTDOWN',
  'PLAYING',
  'PAUSED',
  'GAME_FINISHED',
  'RESULT',
  'REMATCH_WAITING',
  'NEW_MATCH',
  'CLOSED',
] as const;

export type RoomStatus = (typeof ROOM_STATUSES)[number];

/** Legal lifecycle transitions. Enforced by GameLifecycleManager. */
export const ROOM_TRANSITIONS: Record<RoomStatus, readonly RoomStatus[]> = {
  WAITING: ['LOBBY', 'CLOSED'],
  LOBBY: ['READY', 'WAITING', 'COUNTDOWN', 'CLOSED'],
  READY: ['LOBBY', 'COUNTDOWN', 'CLOSED'],
  COUNTDOWN: ['PLAYING', 'LOBBY', 'CLOSED'],
  PLAYING: ['GAME_FINISHED', 'PAUSED', 'RESULT', 'CLOSED'],
  PAUSED: ['PLAYING', 'RESULT', 'CLOSED'],
  GAME_FINISHED: ['RESULT', 'CLOSED'],
  RESULT: ['REMATCH_WAITING', 'LOBBY', 'CLOSED'],
  REMATCH_WAITING: ['NEW_MATCH', 'LOBBY', 'CLOSED'],
  NEW_MATCH: ['COUNTDOWN', 'LOBBY', 'CLOSED'],
  CLOSED: [],
};

export interface RoomSettings {
  playerCount: number;
  aiOpponents: number;
  aiDifficulty: 'easy' | 'medium' | 'hard';
  gridSize?: string;
  rounds?: number;
}

/**
 * The room snapshot broadcast to clients. Contains no secrets and no hidden
 * game information (game modules decide what goes into `gameState`).
 */
export interface RoomState {
  id: string;
  gameId: string;
  hostPlayerId: string;
  maxPlayers: number;
  isPrivate: boolean;
  status: RoomStatus;
  players: Player[];
  /** Remaining seconds during COUNTDOWN. */
  countdownValue: number;
  /** Increments on every rematch. */
  matchNumber: number;
  gameStartedAt: number | null;
  gameResult: GameResult | null;
  gameState: unknown;
  rematchVotes: Record<string, boolean>;
  /** Epoch ms deadline of the rematch vote window. */
  rematchDeadline: number | null;
  settings: RoomSettings;
  chat: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  /** Monotonic counter used by clients to drop stale snapshots. */
  stateVersion: number;
}

/** Compact room representation for the public room browser. */
export interface RoomSummary {
  id: string;
  gameId: string;
  gameName: string;
  hostNickname: string;
  playerCount: number;
  maxPlayers: number;
  isPrivate: boolean;
  status: RoomStatus;
  createdAt: number;
}
