import type {
  AIDifficulty,
  GameAction,
  GameConfig,
  GameFinishReason,
  GameMetadata,
  PlayerRanking,
  TimerType,
} from '@2play/shared';
import type { Logger } from '../utils/logger';

/* ------------------------------------------------------------------ */
/* Player view handed to game modules                                  */
/* ------------------------------------------------------------------ */

/** Read-only projection of a room player. Games never see sockets/tokens. */
export interface GamePlayerView {
  id: string;
  nickname: string;
  avatar: string;
  isAI: boolean;
  aiDifficulty: AIDifficulty | null;
  isConnected: boolean;
  seatIndex: number;
  isHost: boolean;
}

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

export interface ValidationResult {
  valid: boolean;
  /** Human readable reason, safe to show to the player. */
  reason?: string;
}

export interface ActionResult {
  accepted: boolean;
  /** Whether the canonical state changed (triggers a broadcast). */
  stateChanged: boolean;
  reason?: string;
}

export const ACTION_REJECTED: ActionResult = { accepted: false, stateChanged: false };
export function actionAccepted(stateChanged = true): ActionResult {
  return { accepted: true, stateChanged };
}
export function actionRejected(reason?: string): ActionResult {
  return { accepted: false, stateChanged: false, ...(reason ? { reason } : {}) };
}

export type RankingDraft = Omit<PlayerRanking, 'nickname' | 'avatar' | 'isAI'>;

/** What a game module returns when the match is over. */
export interface GameResultDraft {
  winners: string[];
  isDraw: boolean;
  rankings: RankingDraft[];
  reason?: GameFinishReason;
}

/* ------------------------------------------------------------------ */
/* Context                                                             */
/* ------------------------------------------------------------------ */

/**
 * Everything a game module is allowed to touch.
 *
 * Deliberately does NOT expose RoomManager, SocketManager, the database or
 * other games (spec §13). Timers are requested through `schedule()` which
 * routes into TimerManager, so no game can leak an unmanaged timer.
 */
export interface GameContext {
  readonly roomId: string;
  readonly gameId: string;
  readonly matchNumber: number;
  readonly config: GameConfig;
  /** Snapshot of the players at the time the call is made. */
  readonly players: readonly GamePlayerView[];
  readonly seed: number;
  readonly logger: Logger;

  now(): number;
  /** Seeded PRNG — deterministic, fair and testable. */
  random(): number;

  /** Managed timer. Re-creating the same `key` cancels the previous one. */
  schedule(
    delayMs: number,
    callback: () => void,
    type?: TimerType,
    key?: string,
  ): string;
  cancel(timerId: string): void;

  /** Ask the platform to execute an AI action after `delayMs` (same validation path as humans). */
  requestAI(playerId: string, delayMs: number): void;

  /** Tell the platform the canonical state changed and must be broadcast. */
  markStateChanged(): void;

  /** The game asks the platform to finalise the match. */
  finish(reason?: GameFinishReason): void;
}

/* ------------------------------------------------------------------ */
/* Module contract                                                     */
/* ------------------------------------------------------------------ */

/**
 * Every game implements this interface. The platform only ever talks to games
 * through it, which is what makes games plug-and-play (spec §12).
 */
export interface GameModule<S = unknown> {
  readonly metadata: GameMetadata;

  /** Called once when the room configures the game. */
  initialize(config: GameConfig): void;

  createInitialState(players: readonly GamePlayerView[], config: GameConfig): S;

  playerJoined(player: GamePlayerView, state: S, ctx: GameContext): void;
  playerReady(playerId: string, state: S, ctx: GameContext): void;
  playerLeft(playerId: string, state: S, ctx: GameContext, reason?: 'leave' | 'disconnect' | 'kick' | 'timeout'): void;

  start(state: S, ctx: GameContext): void;

  validateAction(playerId: string, action: GameAction, state: S, ctx: GameContext): ValidationResult;
  handlePlayerAction(playerId: string, action: GameAction, state: S, ctx: GameContext): ActionResult;

  /** Fixed step simulation; called by the platform tick loop when needed. */
  update(state: S, deltaTimeMs: number, ctx: GameContext): void;
  /** Legacy/alternative per-tick hook kept for the contract. */
  tick(state: S, ctx: GameContext): void;

  calculateScore(playerId: string, state: S): number;
  checkWinCondition(state: S): string[] | null;
  checkDrawCondition(state: S): boolean;
  isGameFinished(state: S): boolean;

  finish(state: S, ctx: GameContext): void;
  getResult(state: S, ctx: GameContext): GameResultDraft;

  /** Reset for a rematch. Returns a fresh state (room/players/chat preserved). */
  reset(state: S): S;
  cleanup(state: S): void;

  /**
   * Per-viewer projection of the state.
   * Games with hidden information (Memory Match) MUST strip hidden data here.
   */
  getPublicState(state: S, viewerId: string | undefined, ctx: GameContext): unknown;

  /** Optional AI opponent. Must be a legal, difficulty-scaled move. */
  getAIMove?(
    playerId: string,
    difficulty: AIDifficulty,
    state: S,
    ctx: GameContext,
  ): GameAction | null;

  /** Set to true when the module relies on `update()` being called regularly. */
  readonly needsUpdateLoop?: boolean;
  /** Hard cap after which the platform force-finishes the match. */
  readonly maxDurationMs?: number;
}

/** Runtime guard used by the registry. */
export function isGameModule(value: unknown): value is GameModule {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<GameModule>;
  if (!candidate.metadata || typeof candidate.metadata !== 'object') return false;
  const required: Array<keyof GameModule> = [
    'initialize',
    'createInitialState',
    'playerJoined',
    'playerReady',
    'playerLeft',
    'start',
    'handlePlayerAction',
    'update',
    'tick',
    'validateAction',
    'calculateScore',
    'checkWinCondition',
    'checkDrawCondition',
    'isGameFinished',
    'finish',
    'getResult',
    'reset',
    'cleanup',
    'getPublicState',
  ];
  return required.every((key) => typeof candidate[key] === 'function');
}
