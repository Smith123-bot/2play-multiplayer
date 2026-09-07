import type { AIDifficulty, GameAction, GameFinishReason } from '@2play/shared';
import { PLATFORM_DASH_METADATA } from '@2play/shared';
export { PLATFORM_DASH_METADATA };
import type {
  ActionResult,
  GameContext,
  GameModule,
  GameResultDraft,
  RankingDraft,
  ValidationResult,
} from '../GameModule';
import { actionAccepted, actionRejected } from '../GameModule';
import {
  COURSE_IDS,
  courseById,
  movingX,
  type CourseId,
  type CoursePlatform,
  type DashCourse,
} from './courses';

/**
 * Platform Dash 2D — short server-simulated obstacle race.
 *
 * Clients send only input flags (`left` / `right` / `jump`). Positions,
 * collisions, checkpoints and finish order are computed here.
 */

export type DashPhase = 'idle' | 'playing' | 'finished';

export interface DashRunner {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  grounded: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  checkpoint: { x: number; y: number };
  checkpointIndex: number;
  falls: number;
  frozenUntil: number;
  finished: boolean;
  finishMs: number | null;
  disconnected: boolean;
  leftMatch: boolean;
}

export interface DashState {
  phase: DashPhase;
  courseId: CourseId | string;
  courseName: string;
  width: number;
  height: number;
  platforms: CoursePlatform[];
  spawn: { x: number; y: number };
  runners: Record<string, DashRunner>;
  finishOrder: string[];
  stepMs: number;
  accumulatorMs: number;
  startedAt: number | null;
  endsAt: number | null;
  durationMs: number;
  finishReason: GameFinishReason | null;
  lastEvent: string | null;
  nextAIRequestAt: Record<string, number>;
  crumbled: Record<string, number>;
}

const PLAYER_W = 16;
const PLAYER_H = 26;
const GRAVITY = 1600;
const MOVE_SPEED = 170;
const JUMP_V = 520;
const PAD_V = 680;
const MAX_FALL = 900;
const STEP_MS = 16;
const MAX_SUBSTEPS = 20;
const MATCH_MS = 3 * 60 * 1000;
const FREEZE_MS = 450;
const CRUMBLE_MS = 700;
const PLACE_POINTS = [100, 75, 50, 25];
const AI_INTERVAL: Record<AIDifficulty, number> = { easy: 280, medium: 160, hard: 90 };

function aabb(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

export function livePlatformX(platform: CoursePlatform, now: number): number {
  return movingX(platform, now);
}

function spawnRunner(spawn: { x: number; y: number }): DashRunner {
  return {
    x: spawn.x,
    y: spawn.y,
    vx: 0,
    vy: 0,
    w: PLAYER_W,
    h: PLAYER_H,
    grounded: false,
    left: false,
    right: false,
    jump: false,
    checkpoint: { ...spawn },
    checkpointIndex: 0,
    falls: 0,
    frozenUntil: 0,
    finished: false,
    finishMs: null,
    disconnected: false,
    leftMatch: false,
  };
}

function respawn(runner: DashRunner, now: number): void {
  runner.x = runner.checkpoint.x;
  runner.y = runner.checkpoint.y;
  runner.vx = 0;
  runner.vy = 0;
  runner.grounded = false;
  runner.falls += 1;
  runner.frozenUntil = now + FREEZE_MS;
}

function placePoints(index: number): number {
  return PLACE_POINTS[Math.min(index, PLACE_POINTS.length - 1)] ?? 25;
}

/** One physics sub-step. Exported for tests. */
export function stepRunner(
  state: DashState,
  runner: DashRunner,
  dt: number,
  now: number,
): { fell: boolean; finished: boolean; checkpoint: boolean } {
  const outcome = { fell: false, finished: false, checkpoint: false };
  if (runner.finished || runner.leftMatch) return outcome;
  if (now < runner.frozenUntil) {
    runner.vx = 0;
    runner.vy = 0;
    return outcome;
  }

  const wish = (runner.right ? 1 : 0) - (runner.left ? 1 : 0);
  runner.vx = wish * MOVE_SPEED;
  runner.vy = Math.max(-MAX_FALL, runner.vy - GRAVITY * dt);

  if (runner.jump && runner.grounded) {
    runner.vy = JUMP_V;
    runner.grounded = false;
  }

  const nx = runner.x + runner.vx * dt;
  let ny = runner.y + runner.vy * dt;
  const prevY = runner.y;
  runner.grounded = false;

  const solids = state.platforms.filter((platform) => {
    if (platform.kind === 'spike') return true;
    if (platform.kind === 'finish') return false;
    if (platform.kind === 'crumble' && (state.crumbled[platform.id] ?? 0) > 0 && now >= state.crumbled[platform.id]!) {
      return false;
    }
    return true;
  });

  runner.x = Math.min(state.width - runner.w, Math.max(0, nx));

  for (const platform of solids) {
    const px = livePlatformX(platform, now);
    if (!aabb(runner.x, ny, runner.w, runner.h, px, platform.y, platform.w, platform.h)) continue;

    if (platform.kind === 'spike') {
      respawn(runner, now);
      outcome.fell = true;
      return outcome;
    }

    if (platform.kind === 'checkpoint') {
      if (runner.checkpoint.x < px) {
        runner.checkpoint = { x: px, y: platform.y + platform.h };
        runner.checkpointIndex += 1;
        outcome.checkpoint = true;
      }
    }

    const platTop = platform.y + platform.h;
    const platBottom = platform.y;
    // Land on top when falling onto the platform.
    if (runner.vy <= 0 && prevY >= platTop - 2) {
      ny = platTop;
      runner.vy = 0;
      runner.grounded = true;
      if (platform.kind === 'pad') runner.vy = PAD_V;
      if (platform.kind === 'crumble' && !state.crumbled[platform.id]) {
        state.crumbled[platform.id] = now + CRUMBLE_MS;
      }
      if (platform.kind === 'moving') {
        const next = livePlatformX(platform, now + dt * 1000);
        runner.x += next - px;
      }
    } else if (runner.vy > 0 && prevY + runner.h <= platBottom + 2) {
      ny = platBottom - runner.h;
      runner.vy = 0;
    } else {
      if (runner.vx > 0) runner.x = px - runner.w;
      else if (runner.vx < 0) runner.x = px + platform.w;
      runner.vx = 0;
    }
  }

  runner.y = ny;

  if (runner.y < -80) {
    respawn(runner, now);
    outcome.fell = true;
    return outcome;
  }

  const finish = state.platforms.find((platform) => platform.kind === 'finish');
  if (finish && aabb(runner.x, runner.y, runner.w, runner.h, finish.x, finish.y, finish.w, finish.h)) {
    outcome.finished = true;
  }
  return outcome;
}

export function stepWorld(state: DashState, deltaMs: number, ctx: GameContext): void {
  if (state.phase !== 'playing') return;
  state.accumulatorMs += deltaMs;
  let guard = 0;
  const now = ctx.now();
  while (state.accumulatorMs >= state.stepMs && state.phase === 'playing' && guard < MAX_SUBSTEPS) {
    state.accumulatorMs -= state.stepMs;
    guard += 1;
    const dt = state.stepMs / 1000;
    for (const [playerId, runner] of Object.entries(state.runners)) {
      const before = runner.checkpointIndex;
      const outcome = stepRunner(state, runner, dt, now);
      if (outcome.fell) {
        state.lastEvent = `fall:${playerId}`;
        ctx.markStateChanged();
      }
      if (outcome.checkpoint && runner.checkpointIndex !== before) {
        state.lastEvent = `check:${playerId}`;
        ctx.markStateChanged();
      }
      if (outcome.finished && !runner.finished) {
        runner.finished = true;
        runner.finishMs = now - (state.startedAt ?? now);
        runner.vx = 0;
        runner.left = false;
        runner.right = false;
        runner.jump = false;
        state.finishOrder.push(playerId);
        state.lastEvent = `finish:${playerId}`;
        ctx.markStateChanged();
      }
    }
  }

  const active = Object.values(state.runners).filter((runner) => !runner.leftMatch && !runner.disconnected);
  const unfinished = active.filter((runner) => !runner.finished);
  if (active.length > 0 && unfinished.length === 0) {
    finishDash(state, ctx, 'completed');
  }
}

export function finishDash(state: DashState, ctx: GameContext, reason: GameFinishReason): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.finishReason = reason;
  state.lastEvent = reason === 'timeout' ? 'timeout' : 'finished';
  ctx.markStateChanged();
  ctx.finish(reason);
}

function scoreOf(state: DashState, playerId: string): number {
  const index = state.finishOrder.indexOf(playerId);
  if (index >= 0) return placePoints(index);
  return 0;
}

export const platformDashGame: GameModule<DashState> = {
  metadata: PLATFORM_DASH_METADATA,

  initialize(): void {
    // Stateless module.
  },

  createInitialState(players, config): DashState {
    const course: DashCourse = courseById(config.gridSize, () => 0.5);
    return {
      phase: 'idle',
      courseId: course.id,
      courseName: course.name,
      width: course.width,
      height: course.height,
      platforms: course.platforms.map((platform) => ({ ...platform })),
      spawn: { ...course.spawn },
      runners: Object.fromEntries(players.map((player) => [player.id, spawnRunner(course.spawn)])),
      finishOrder: [],
      stepMs: STEP_MS,
      accumulatorMs: 0,
      startedAt: null,
      endsAt: null,
      durationMs: MATCH_MS,
      finishReason: null,
      lastEvent: null,
      nextAIRequestAt: {},
      crumbled: {},
    };
  },

  playerJoined(player, state): void {
    if (!state.runners[player.id]) state.runners[player.id] = spawnRunner(state.spawn);
  },

  playerReady(): void {
    // No per-player readiness behaviour.
  },

  playerLeft(playerId, state, ctx, reason): void {
    const runner = state.runners[playerId];
    if (!runner) return;
    if (reason === 'disconnect') {
      runner.disconnected = true;
      runner.left = false;
      runner.right = false;
      runner.jump = false;
      return;
    }
    runner.leftMatch = true;
    runner.left = false;
    runner.right = false;
    runner.jump = false;
    const remaining = Object.values(state.runners).filter((entry) => !entry.leftMatch);
    if (remaining.length === 0) finishDash(state, ctx, 'abandoned');
  },

  start(state, ctx): void {
    if (state.phase === 'playing') return;
    const course = courseById(
      COURSE_IDS.includes(state.courseId as CourseId) ? state.courseId : undefined,
      ctx.random,
    );
    state.courseId = course.id;
    state.courseName = course.name;
    state.width = course.width;
    state.height = course.height;
    state.platforms = course.platforms.map((platform) => ({ ...platform }));
    state.spawn = { ...course.spawn };
    state.runners = {};
    for (const player of ctx.players) {
      state.runners[player.id] = spawnRunner(course.spawn);
    }
    state.finishOrder = [];
    state.crumbled = {};
    state.accumulatorMs = 0;
    state.phase = 'playing';
    state.startedAt = ctx.now();
    state.endsAt = state.startedAt + state.durationMs;
    state.finishReason = null;
    state.lastEvent = 'start';
    ctx.markStateChanged();
    ctx.schedule(state.durationMs, () => finishDash(state, ctx, 'timeout'), 'gameDuration', 'match-timeout');
  },

  validateAction(playerId, action, state): ValidationResult {
    if (action.type !== 'input') return { valid: false, reason: 'Unknown action.' };
    if (state.phase !== 'playing') return { valid: false, reason: 'The race is not running.' };
    const runner = state.runners[playerId];
    if (!runner) return { valid: false, reason: 'You are not in this race.' };
    if (runner.finished) return { valid: false, reason: 'You already finished.' };
    const payload = action.payload ?? {};
    if (typeof payload.left !== 'boolean' && typeof payload.right !== 'boolean' && typeof payload.jump !== 'boolean') {
      return { valid: false, reason: 'Send left, right or jump.' };
    }
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state): ActionResult {
    if (action.type !== 'input') return actionRejected('Unknown action.');
    const runner = state.runners[playerId];
    if (!runner || state.phase !== 'playing' || runner.finished) {
      return actionRejected('You cannot move right now.');
    }
    const payload = action.payload ?? {};
    if (typeof payload.left === 'boolean') runner.left = payload.left;
    if (typeof payload.right === 'boolean') runner.right = payload.right;
    if (typeof payload.jump === 'boolean') runner.jump = payload.jump;
    return actionAccepted(false);
  },

  update(state, deltaTimeMs, ctx): void {
    if (state.phase !== 'playing') return;
    for (const player of ctx.players) {
      if (!player.isAI) continue;
      const runner = state.runners[player.id];
      if (!runner || runner.finished || runner.leftMatch) continue;
      const now = ctx.now();
      const difficulty = player.aiDifficulty ?? 'medium';
      if (now >= (state.nextAIRequestAt[player.id] ?? 0)) {
        ctx.requestAI(player.id, 40);
        state.nextAIRequestAt[player.id] = now + AI_INTERVAL[difficulty];
      }
    }
    stepWorld(state, deltaTimeMs, ctx);
  },

  tick(): void {
    // Handled by update().
  },

  calculateScore(playerId, state): number {
    return scoreOf(state, playerId);
  },

  checkWinCondition(state): string[] | null {
    if (state.phase !== 'finished') return null;
    if (state.finishOrder.length > 0) return [state.finishOrder[0]!];
    const ranked = Object.entries(state.runners).sort((a, b) => b[1].x - a[1].x);
    return ranked[0] ? [ranked[0][0]] : [];
  },

  checkDrawCondition(state): boolean {
    if (state.phase !== 'finished') return false;
    if (state.finishOrder.length >= 2 && state.finishOrder[0] && state.finishOrder[1]) {
      const a = state.runners[state.finishOrder[0]];
      const b = state.runners[state.finishOrder[1]];
      return Boolean(a && b && a.finishMs === b.finishMs);
    }
    return false;
  },

  isGameFinished(state): boolean {
    return state.phase === 'finished';
  },

  finish(state): void {
    state.phase = 'finished';
  },

  getResult(state, ctx): GameResultDraft {
    const ranked = [...ctx.players].sort((a, b) => {
      const ia = state.finishOrder.indexOf(a.id);
      const ib = state.finishOrder.indexOf(b.id);
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1;
      if (ib >= 0) return 1;
      return (state.runners[b.id]?.x ?? 0) - (state.runners[a.id]?.x ?? 0);
    });
    const winner = ranked[0]?.id;
    const rankings: RankingDraft[] = ranked.map((player, index) => ({
      playerId: player.id,
      rank: index + 1,
      score: scoreOf(state, player.id),
      isWinner: player.id === winner,
      isDraw: false,
      stats: {
        timeMs: state.runners[player.id]?.finishMs ?? 0,
        falls: state.runners[player.id]?.falls ?? 0,
        x: Math.round(state.runners[player.id]?.x ?? 0),
      },
    }));
    return {
      winners: winner ? [winner] : [],
      isDraw: false,
      rankings,
      reason: state.finishReason ?? 'completed',
    };
  },

  reset(state): DashState {
    const seats = Object.keys(state.runners);
    return {
      ...state,
      phase: 'idle',
      runners: Object.fromEntries(seats.map((id) => [id, spawnRunner(state.spawn)])),
      finishOrder: [],
      accumulatorMs: 0,
      startedAt: null,
      endsAt: null,
      finishReason: null,
      lastEvent: null,
      nextAIRequestAt: {},
      crumbled: {},
    };
  },

  cleanup(state): void {
    state.runners = {};
    state.phase = 'finished';
  },

  getPublicState(state, _viewerId, ctx) {
    return {
      phase: state.phase,
      courseId: state.courseId,
      courseName: state.courseName,
      width: state.width,
      height: state.height,
      spawn: { ...state.spawn },
      platforms: state.platforms.map((platform) => ({
        ...platform,
        x: livePlatformX(platform, ctx.now()),
        gone: platform.kind === 'crumble' && (state.crumbled[platform.id] ?? 0) > 0 && ctx.now() >= state.crumbled[platform.id]!,
      })),
      finishOrder: [...state.finishOrder],
      startedAt: state.startedAt,
      endsAt: state.endsAt,
      durationMs: state.durationMs,
      finishReason: state.finishReason,
      lastEvent: state.lastEvent,
      serverTime: ctx.now(),
      runners: Object.fromEntries(
        Object.entries(state.runners).map(([id, runner]) => [
          id,
          {
            x: runner.x,
            y: runner.y,
            vx: runner.vx,
            vy: runner.vy,
            w: runner.w,
            h: runner.h,
            grounded: runner.grounded,
            finished: runner.finished,
            finishMs: runner.finishMs,
            falls: runner.falls,
            checkpointIndex: runner.checkpointIndex,
            frozenUntil: runner.frozenUntil,
            disconnected: runner.disconnected,
          },
        ]),
      ),
    };
  },

  getAIMove(playerId, difficulty, state): GameAction | null {
    if (state.phase !== 'playing') return null;
    const runner = state.runners[playerId];
    if (!runner || runner.finished || runner.leftMatch) return null;
    const look = runner.x + (difficulty === 'easy' ? 28 : 48);
    const feet = runner.y - 4;
    const floorAhead = state.platforms.some((platform) => {
      if (platform.kind === 'spike' || platform.kind === 'finish') return false;
      const px = livePlatformX(platform, 0);
      return look >= px && look <= px + platform.w && Math.abs(platform.y + platform.h - feet) < 40;
    });
    const spikeAhead = state.platforms.some((platform) => {
      if (platform.kind !== 'spike') return false;
      return look >= platform.x - 8 && look <= platform.x + platform.w + 8 && runner.y < platform.y + 40;
    });
    const jump = (!floorAhead && runner.grounded) || spikeAhead || (difficulty !== 'easy' && runner.grounded && ctxJumpPad(state, runner));
    return { type: 'input', payload: { left: false, right: true, jump } };
  },

  needsUpdateLoop: true,
  maxDurationMs: 5 * 60 * 1000,
};

function ctxJumpPad(state: DashState, runner: DashRunner): boolean {
  return state.platforms.some(
    (platform) =>
      platform.kind === 'pad' &&
      runner.x + runner.w > platform.x &&
      runner.x < platform.x + platform.w &&
      runner.grounded,
  );
}
