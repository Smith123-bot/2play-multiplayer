import type { GameAction, GameConfig, GameFinishReason } from '@2play/shared';
import { SYNC_JUMP_METADATA } from '@2play/shared';
export { SYNC_JUMP_METADATA };
import type {
  ActionResult,
  GameContext,
  GameModule,
  GamePlayerView,
  GameResultDraft,
  RankingDraft,
  ValidationResult,
} from '../GameModule';
import { actionAccepted, actionRejected } from '../GameModule';
import { SYNC_LEVELS, SYNC_TOTAL_LEVELS, type SyncLevel } from './levels';

export * from './levels';

/**
 * Sync Jump — a two lane cooperative obstacle run.
 *
 * Both partners run the SAME course in their own lane. The twist is the sync
 * meter: the closer together their progress stays, the more every step is
 * worth. Drifting apart drains the meter and slows scoring, so the fastest
 * route is to move as a pair.
 *
 * The world is a fixed-step grid simulation (no floating point physics), which
 * keeps it fully deterministic and cheap to validate on the server.
 */

export type SyncPhase = 'idle' | 'playing' | 'level-clear' | 'finished';

export type SyncCell = 'empty' | 'ground' | 'gap' | 'obstacle' | 'checkpoint' | 'finish';

export interface SyncRunner {
  /** Horizontal cell on the course. */
  x: number;
  /** 0 = on the ground, 1..JUMP_HEIGHT = airborne. */
  height: number;
  /** Remaining airborne ticks. */
  airborne: number;
  checkpoint: number;
  falls: number;
  jumps: number;
  perfectJumps: number;
  finished: boolean;
  finishedAt: number | null;
  disconnected: boolean;
  left: boolean;
}

export interface SyncState {
  phase: SyncPhase;
  level: number;
  totalLevels: number;
  levelName: string;
  hint: string;
  length: number;
  course: SyncCell[];
  players: Record<string, SyncRunner>;
  /** 0..100 — how closely the partners are moving together. */
  syncMeter: number;
  syncSamples: number;
  syncTotal: number;
  perfectTicks: number;
  teamScore: number;
  levelsCleared: number;
  mistakes: number;
  levelStartedAt: number | null;
  levelEndsAt: number | null;
  lastEvent: string | null;
  finishReason: GameFinishReason | null;
  nextAIRequestAt: Record<string, number>;
}

/* ------------------------------------------------------------------ */
/* Tunables                                                            */
/* ------------------------------------------------------------------ */

export const JUMP_TICKS = 3;
export const SYNC_WINDOW = 3;
export const LEVEL_CLEAR_SCORE = 250;
export const CHECKPOINT_SCORE = 20;
export const FALL_PENALTY = 30;
export const STEP_SCORE = 4;
export const PERFECT_SYNC_BONUS = 120;
export const TIME_BONUS_MAX = 150;
export const LEVEL_BREAK_MS = 2_600;
export const SYNC_TICK_MS = 400;

export function isSyncDirection(value: unknown): value is 'left' | 'right' {
  return value === 'left' || value === 'right';
}

const CHAR_TO_CELL: Record<string, SyncCell> = {
  '=': 'ground',
  '_': 'gap',
  '^': 'obstacle',
  'C': 'checkpoint',
  'F': 'finish',
};

export function levelAt(index: number): SyncLevel {
  const level = SYNC_LEVELS[Math.max(0, Math.min(index, SYNC_LEVELS.length - 1))];
  return level ?? (SYNC_LEVELS[0] as SyncLevel);
}

export function buildCourse(level: SyncLevel): SyncCell[] {
  return [...level.course].map((char) => CHAR_TO_CELL[char] ?? 'ground');
}

export function cellAt(state: SyncState, x: number): SyncCell {
  if (x < 0 || x >= state.length) return 'empty';
  return state.course[x] ?? 'empty';
}

function runnersOf(state: SyncState): SyncRunner[] {
  return Object.values(state.players).filter((runner) => !runner.left);
}

/**
 * Sync is derived from how far apart the partners are on the course.
 * Same cell = perfect, within SYNC_WINDOW = good, beyond that = drifting.
 */
export function computeSync(state: SyncState): number {
  const runners = runnersOf(state).filter((runner) => !runner.disconnected);
  if (runners.length < 2) return 0;
  const [first, second] = runners;
  if (!first || !second) return 0;
  const gap = Math.abs(first.x - second.x);
  if (gap === 0) return 100;
  if (gap >= SYNC_WINDOW * 3) return 0;
  return Math.max(0, Math.round(100 - (gap / (SYNC_WINDOW * 3)) * 100));
}

/** Multiplier applied to points earned, driven by the live sync meter. */
export function syncMultiplier(meter: number): number {
  if (meter >= 90) return 2;
  if (meter >= 60) return 1.5;
  if (meter >= 30) return 1;
  return 0.5;
}

export function finishSync(state: SyncState, ctx: GameContext, reason: GameFinishReason): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.finishReason = reason;
  state.levelEndsAt = null;
  state.lastEvent = reason === 'timeout' ? 'timeout' : 'finished';
  ctx.markStateChanged();
  ctx.finish(reason);
}

export function loadLevel(state: SyncState, ctx: GameContext): void {
  const level = levelAt(state.level);
  state.levelName = level.name;
  state.hint = level.hint;
  state.course = buildCourse(level);
  state.length = state.course.length;

  for (const runner of Object.values(state.players)) {
    runner.x = 0;
    runner.height = 0;
    runner.airborne = 0;
    runner.checkpoint = 0;
    runner.finished = false;
    runner.finishedAt = null;
  }

  state.phase = 'playing';
  state.syncMeter = 100;
  state.levelStartedAt = ctx.now();
  state.levelEndsAt = ctx.now() + level.timeLimit * 1000;
  state.lastEvent = `level:${state.level}`;
  ctx.markStateChanged();

  ctx.schedule(
    level.timeLimit * 1000,
    () => {
      if (state.phase !== 'playing') return;
      state.lastEvent = 'level-timeout';
      finishSync(state, ctx, 'timeout');
    },
    'turn',
    `level-${state.level}`,
  );

  for (const player of ctx.players) {
    if (player.isAI) ctx.requestAI(player.id, 600);
  }
}

export function completeLevel(state: SyncState, ctx: GameContext): void {
  if (state.phase !== 'playing') return;
  const level = levelAt(state.level);
  const elapsed = ctx.now() - (state.levelStartedAt ?? ctx.now());
  const limit = level.timeLimit * 1000;

  state.teamScore += LEVEL_CLEAR_SCORE;
  state.teamScore += Math.round(TIME_BONUS_MAX * Math.min(1, Math.max(0, limit - elapsed) / limit));
  // Average sync across the level turns into a teamwork bonus.
  const averageSync = state.syncSamples > 0 ? state.syncTotal / state.syncSamples : 0;
  state.teamScore += Math.round((averageSync / 100) * PERFECT_SYNC_BONUS);
  state.levelsCleared += 1;
  state.lastEvent = `level-clear:${state.level}`;

  if (state.level + 1 >= state.totalLevels) {
    finishSync(state, ctx, 'completed');
    return;
  }

  state.level += 1;
  state.phase = 'level-clear';
  state.levelEndsAt = ctx.now() + LEVEL_BREAK_MS;
  ctx.markStateChanged();
  ctx.schedule(
    LEVEL_BREAK_MS,
    () => {
      if (state.phase !== 'level-clear') return;
      loadLevel(state, ctx);
    },
    'turn',
    `break-${state.level}`,
  );
}

/** Both partners must be in the finish zone before the level clears. */
export function bothFinished(state: SyncState): boolean {
  const runners = runnersOf(state);
  if (runners.length < 2) return false;
  return runners.every((runner) => runner.finished);
}

function makeRunner(): SyncRunner {
  return {
    x: 0,
    height: 0,
    airborne: 0,
    checkpoint: 0,
    falls: 0,
    jumps: 0,
    perfectJumps: 0,
    finished: false,
    finishedAt: null,
    disconnected: false,
    left: false,
  };
}

function resolveLevels(config: GameConfig): number {
  if (typeof config.rounds === 'number' && Number.isFinite(config.rounds)) {
    return Math.min(SYNC_TOTAL_LEVELS, Math.max(1, Math.round(config.rounds)));
  }
  return SYNC_TOTAL_LEVELS;
}

/**
 * Resolves a runner landing on cell `x`.
 * Airborne runners clear gaps and obstacles; grounded ones do not.
 */
function resolveLanding(state: SyncState, runner: SyncRunner, ctx: GameContext): string | null {
  const cell = cellAt(state, runner.x);
  const airborne = runner.airborne > 0;

  if ((cell === 'gap' || cell === 'obstacle') && !airborne) {
    // Missed the jump: back to the last checkpoint.
    runner.x = runner.checkpoint;
    runner.height = 0;
    runner.airborne = 0;
    runner.falls += 1;
    state.mistakes += 1;
    state.teamScore = Math.max(0, state.teamScore - FALL_PENALTY);
    return 'fall';
  }

  if (cell === 'checkpoint' && runner.checkpoint < runner.x) {
    runner.checkpoint = runner.x;
    state.teamScore += CHECKPOINT_SCORE;
    return 'checkpoint';
  }

  if (cell === 'finish' && !runner.finished) {
    runner.finished = true;
    runner.finishedAt = ctx.now();
    return 'finish';
  }

  return null;
}

export const syncJumpGame: GameModule<SyncState> = {
  metadata: SYNC_JUMP_METADATA,

  initialize(): void {
    // Stateless module.
  },

  createInitialState(players: readonly GamePlayerView[], config: GameConfig): SyncState {
    const state: SyncState = {
      phase: 'idle',
      level: 0,
      totalLevels: resolveLevels(config),
      levelName: '',
      hint: '',
      length: 0,
      course: [],
      players: {},
      syncMeter: 100,
      syncSamples: 0,
      syncTotal: 0,
      perfectTicks: 0,
      teamScore: 0,
      levelsCleared: 0,
      mistakes: 0,
      levelStartedAt: null,
      levelEndsAt: null,
      lastEvent: null,
      finishReason: null,
      nextAIRequestAt: {},
    };
    for (const player of players) state.players[player.id] = makeRunner();
    return state;
  },

  playerJoined(player, state): void {
    const existing = state.players[player.id];
    if (existing) {
      existing.disconnected = false;
      return;
    }
    state.players[player.id] = makeRunner();
  },

  playerReady(): void {
    // Lobby concern.
  },

  playerLeft(playerId, state, ctx, reason): void {
    const runner = state.players[playerId];
    if (!runner) return;
    if (reason === 'disconnect') {
      runner.disconnected = true;
      ctx.markStateChanged();
      return;
    }
    runner.left = true;
    if (runnersOf(state).length < 2) finishSync(state, ctx, 'abandoned');
  },

  start(state, ctx): void {
    if (state.phase === 'playing') return;
    state.players = {};
    for (const player of ctx.players) state.players[player.id] = makeRunner();
    state.level = 0;
    state.teamScore = 0;
    state.levelsCleared = 0;
    state.mistakes = 0;
    state.syncSamples = 0;
    state.syncTotal = 0;
    state.perfectTicks = 0;
    state.finishReason = null;
    state.nextAIRequestAt = {};
    loadLevel(state, ctx);
  },

  validateAction(playerId, action, state): ValidationResult {
    if (['score', 'win', 'complete', 'finish', 'sync', 'teleport'].includes(action.type)) {
      return { valid: false, reason: 'The server owns the course.' };
    }
    if (state.phase !== 'playing') return { valid: false, reason: 'The course is not live.' };

    const runner = state.players[playerId];
    if (!runner || runner.left) return { valid: false, reason: 'You are not in this run.' };
    if (runner.disconnected) return { valid: false, reason: 'Reconnect to keep running.' };
    if (runner.finished) return { valid: false, reason: 'You already reached the finish.' };

    if (action.type === 'jump') return { valid: true };
    if (action.type !== 'move') return { valid: false, reason: 'Unknown action.' };
    if (!isSyncDirection(action.payload?.direction)) {
      return { valid: false, reason: 'Use left or right.' };
    }
    const next = runner.x + (action.payload.direction === 'right' ? 1 : -1);
    if (next < 0) return { valid: false, reason: 'That is the start of the course.' };
    if (next >= state.length) return { valid: false, reason: 'That is past the finish.' };
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    if (state.phase !== 'playing') return actionRejected('The course is not live.');
    const runner = state.players[playerId];
    if (!runner || runner.left || runner.disconnected) return actionRejected('You cannot act.');
    if (runner.finished) return actionRejected('Already finished.');

    let event = `move:${playerId}`;

    if (action.type === 'jump') {
      if (runner.airborne > 0) return actionRejected('Already airborne.');
      runner.airborne = JUMP_TICKS;
      runner.height = 1;
      runner.jumps += 1;
      // Jumping in sync with your partner is what the game rewards.
      if (state.syncMeter >= 90) {
        runner.perfectJumps += 1;
        state.perfectTicks += 1;
      }
      event = `jump:${playerId}`;
    } else if (action.type === 'move') {
      const direction = action.payload?.direction;
      if (!isSyncDirection(direction)) return actionRejected('Invalid direction.');
      const next = runner.x + (direction === 'right' ? 1 : -1);
      if (next < 0 || next >= state.length) return actionRejected('Out of bounds.');

      runner.x = next;
      if (runner.airborne > 0) {
        runner.airborne -= 1;
        runner.height = runner.airborne > 0 ? 1 : 0;
      }

      const outcome = resolveLanding(state, runner, ctx);
      if (outcome === 'fall') event = `fall:${playerId}`;
      else if (outcome === 'checkpoint') event = `checkpoint:${playerId}`;
      else if (outcome === 'finish') event = `finish:${playerId}`;
      else if (direction === 'right') {
        // Forward progress scores, scaled by how in-sync the pair is.
        state.teamScore += Math.round(STEP_SCORE * syncMultiplier(state.syncMeter));
      }
    } else {
      return actionRejected('Unknown action.');
    }

    // Recompute the sync meter from the authoritative positions.
    state.syncMeter = computeSync(state);
    state.syncSamples += 1;
    state.syncTotal += state.syncMeter;

    state.lastEvent = event;
    ctx.markStateChanged();

    if (bothFinished(state)) completeLevel(state, ctx);
    return actionAccepted();
  },

  update(state, _deltaTimeMs, ctx): void {
    if (state.phase !== 'playing') return;
    const now = ctx.now();
    for (const view of ctx.players) {
      if (!view.isAI) continue;
      const runner = state.players[view.id];
      if (!runner || runner.left || runner.finished) continue;
      const difficulty = view.aiDifficulty ?? 'medium';
      const interval = difficulty === 'easy' ? 900 : difficulty === 'hard' ? 420 : 620;
      if (now >= (state.nextAIRequestAt[view.id] ?? 0)) {
        ctx.requestAI(view.id, 40);
        state.nextAIRequestAt[view.id] = now + interval;
      }
    }
  },

  tick(): void {
    // Handled by update().
  },

  calculateScore(_playerId, state): number {
    return state.teamScore;
  },

  checkWinCondition(state): string[] | null {
    if (state.phase !== 'finished') return null;
    if (state.levelsCleared > 0) return Object.keys(state.players);
    return [];
  },

  checkDrawCondition(state): boolean {
    return state.phase === 'finished' && state.levelsCleared === 0;
  },

  isGameFinished(state): boolean {
    return state.phase === 'finished';
  },

  finish(state): void {
    state.phase = 'finished';
    state.levelEndsAt = null;
  },

  getResult(state, ctx): GameResultDraft {
    const cleared = state.levelsCleared > 0;
    const averageSync = state.syncSamples > 0 ? Math.round(state.syncTotal / state.syncSamples) : 0;
    const rankings: RankingDraft[] = ctx.players.map((player) => {
      const runner = state.players[player.id];
      return {
        playerId: player.id,
        rank: 1,
        score: state.teamScore,
        isWinner: cleared,
        isDraw: !cleared,
        stats: {
          levelsCleared: state.levelsCleared,
          syncScore: averageSync,
          falls: runner?.falls ?? 0,
          perfectJumps: runner?.perfectJumps ?? 0,
        },
      };
    });
    return {
      winners: cleared ? ctx.players.map((player) => player.id) : [],
      isDraw: !cleared,
      rankings,
      reason: state.finishReason ?? 'completed',
    };
  },

  reset(state): SyncState {
    return {
      ...state,
      phase: 'idle',
      level: 0,
      levelName: '',
      hint: '',
      length: 0,
      course: [],
      players: Object.fromEntries(Object.keys(state.players).map((id) => [id, makeRunner()])),
      syncMeter: 100,
      syncSamples: 0,
      syncTotal: 0,
      perfectTicks: 0,
      teamScore: 0,
      levelsCleared: 0,
      mistakes: 0,
      levelStartedAt: null,
      levelEndsAt: null,
      lastEvent: null,
      finishReason: null,
      nextAIRequestAt: {},
    };
  },

  cleanup(state): void {
    state.players = {};
    state.course = [];
    state.phase = 'finished';
  },

  getPublicState(state, viewerId, ctx) {
    return {
      phase: state.phase,
      level: state.level,
      totalLevels: state.totalLevels,
      levelName: state.levelName,
      hint: state.hint,
      length: state.length,
      course: state.course,
      syncMeter: state.syncMeter,
      averageSync: state.syncSamples > 0 ? Math.round(state.syncTotal / state.syncSamples) : 0,
      multiplier: syncMultiplier(state.syncMeter),
      teamScore: state.teamScore,
      levelsCleared: state.levelsCleared,
      mistakes: state.mistakes,
      levelEndsAt: state.levelEndsAt,
      lastEvent: state.lastEvent,
      finishReason: state.finishReason,
      serverTime: ctx.now(),
      me: viewerId ?? null,
      players: Object.fromEntries(
        Object.entries(state.players).map(([id, runner]) => [
          id,
          {
            x: runner.x,
            height: runner.height,
            airborne: runner.airborne > 0,
            checkpoint: runner.checkpoint,
            falls: runner.falls,
            jumps: runner.jumps,
            perfectJumps: runner.perfectJumps,
            finished: runner.finished,
            disconnected: runner.disconnected,
          },
        ]),
      ),
    };
  },

  /**
   * Co-op AI partner. It jumps before gaps/obstacles and — crucially — waits
   * when it gets too far ahead, so it actively maintains the sync meter.
   */
  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'playing') return null;
    const runner = state.players[playerId];
    if (!runner || runner.left || runner.finished) return null;

    const partner = runnersOf(state).find((other) => other !== runner);

    // Hold position when too far ahead — this is the cooperative behaviour.
    if (partner && !partner.finished && runner.x - partner.x >= SYNC_WINDOW && difficulty !== 'easy') {
      return null;
    }

    const next = cellAt(state, runner.x + 1);
    if ((next === 'gap' || next === 'obstacle') && runner.airborne === 0) {
      // Easy partners sometimes mistime the jump.
      if (difficulty === 'easy' && ctx.random() < 0.3) {
        return { type: 'move', payload: { direction: 'right' } };
      }
      return { type: 'jump' };
    }

    if (runner.x + 1 >= state.length) return null;
    return { type: 'move', payload: { direction: 'right' } };
  },

  needsUpdateLoop: true,
  maxDurationMs: 30 * 60 * 1000,
};
