import type { AIDifficulty, GameAction, GameFinishReason } from '@2play/shared';
import { COLOR_TRAILS_METADATA } from '@2play/shared';
export { COLOR_TRAILS_METADATA };
import type {
  ActionResult,
  GameContext,
  GameModule,
  GameResultDraft,
  RankingDraft,
  ValidationResult,
} from '../GameModule';
import { actionAccepted, actionRejected } from '../GameModule';

/**
 * Color Trails — temporary trails, pickups and matching zones.
 *
 * Not permanent territory. The server steps movement, expires trails, scores
 * pickups/zones and resolves trail collisions.
 */

export type TrailPhase = 'idle' | 'playing' | 'finished';
export type TrailDirection = 'up' | 'down' | 'left' | 'right';
export type TrailHue = 'red' | 'blue' | 'green' | 'yellow';

export interface TrailSegment {
  x: number;
  y: number;
  expiresStep: number;
}

export interface TrailRunner {
  x: number;
  y: number;
  direction: TrailDirection;
  pending: TrailDirection | null;
  trail: TrailSegment[];
  score: number;
  combo: number;
  hue: TrailHue | null;
  pickups: number;
  zones: number;
  hits: number;
  frozenUntil: number;
  disconnected: boolean;
  left: boolean;
}

export interface ColorToken {
  id: string;
  x: number;
  y: number;
  hue: TrailHue;
  kind: 'pickup' | 'zone';
}

export interface ColorTrailsState {
  phase: TrailPhase;
  cols: number;
  rows: number;
  runners: Record<string, TrailRunner>;
  tokens: ColorToken[];
  stepMs: number;
  stepIndex: number;
  accumulatorMs: number;
  startedAt: number | null;
  endsAt: number | null;
  durationMs: number;
  finishReason: GameFinishReason | null;
  lastEvent: string | null;
  nextAIRequestAt: Record<string, number>;
  tokenSeq: number;
}

export const TRAIL_COLS = 24;
export const TRAIL_ROWS = 16;
const STEP_MS = 250;
const MATCH_MS = 150_000;
const TRAIL_LIFE = 8;
const FREEZE_MS = 700;
const PICKUP_POINTS = 10;
const ZONE_POINTS = 25;
const HIT_PENALTY = 10;
const HUES: TrailHue[] = ['red', 'blue', 'green', 'yellow'];
const DELTA: Record<TrailDirection, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};
const REVERSE: Record<TrailDirection, TrailDirection> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
};
const ALL_DIRS: TrailDirection[] = ['up', 'down', 'left', 'right'];
const AI_INTERVAL: Record<AIDifficulty, number> = { easy: 400, medium: 240, hard: 120 };

export function isTrailDirection(value: unknown): value is TrailDirection {
  return value === 'up' || value === 'down' || value === 'left' || value === 'right';
}

function inBounds(cols: number, rows: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < cols && y < rows;
}

function spawnPoint(seat: number, cols: number, rows: number): { x: number; y: number; direction: TrailDirection } {
  if (seat === 0) return { x: 2, y: 2, direction: 'right' };
  if (seat === 1) return { x: cols - 3, y: 2, direction: 'left' };
  if (seat === 2) return { x: 2, y: rows - 3, direction: 'right' };
  return { x: cols - 3, y: rows - 3, direction: 'left' };
}

function occupied(state: ColorTrailsState): Set<string> {
  const set = new Set<string>();
  for (const runner of Object.values(state.runners)) {
    if (runner.left) continue;
    set.add(`${runner.x},${runner.y}`);
  }
  for (const token of state.tokens) set.add(`${token.x},${token.y}`);
  return set;
}

export function spawnToken(state: ColorTrailsState, ctx: GameContext, kind: ColorToken['kind']): ColorToken | null {
  const used = occupied(state);
  const free: Array<{ x: number; y: number }> = [];
  for (let y = 1; y < state.rows - 1; y += 1) {
    for (let x = 1; x < state.cols - 1; x += 1) {
      if (!used.has(`${x},${y}`)) free.push({ x, y });
    }
  }
  if (free.length === 0) return null;
  const cell = free[Math.floor(ctx.random() * free.length)]!;
  state.tokenSeq += 1;
  const token: ColorToken = {
    id: `${kind}-${state.tokenSeq}`,
    x: cell.x,
    y: cell.y,
    hue: HUES[Math.floor(ctx.random() * HUES.length)]!,
    kind,
  };
  state.tokens.push(token);
  return token;
}

function ensureTokens(state: ColorTrailsState, ctx: GameContext): void {
  while (state.tokens.filter((token) => token.kind === 'pickup').length < 4) {
    if (!spawnToken(state, ctx, 'pickup')) break;
  }
  while (state.tokens.filter((token) => token.kind === 'zone').length < 4) {
    if (!spawnToken(state, ctx, 'zone')) break;
  }
}

export function expireTrails(state: ColorTrailsState): void {
  for (const runner of Object.values(state.runners)) {
    runner.trail = runner.trail.filter((segment) => segment.expiresStep > state.stepIndex);
  }
}

function trailCells(state: ColorTrailsState, exceptId: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const [id, runner] of Object.entries(state.runners)) {
    if (id === exceptId || runner.left) continue;
    for (const segment of runner.trail) map.set(`${segment.x},${segment.y}`, id);
  }
  return map;
}

export function stepTrails(state: ColorTrailsState, ctx: GameContext): { pickups: string[]; hits: string[] } {
  const outcome = { pickups: [] as string[], hits: [] as string[] };
  if (state.phase !== 'playing') return outcome;
  const now = ctx.now();
  expireTrails(state);

  const ids = Object.keys(state.runners).filter((id) => !state.runners[id]!.left);
  for (const id of ids) {
    const runner = state.runners[id]!;
    if (runner.pending) {
      runner.direction = runner.pending;
      runner.pending = null;
    }
  }

  for (const id of ids) {
    const runner = state.runners[id]!;
    if (now < runner.frozenUntil) continue;
    const d = DELTA[runner.direction];
    let nx = runner.x + d.dx;
    let ny = runner.y + d.dy;
    if (!inBounds(state.cols, state.rows, nx, ny)) {
      nx = runner.x;
      ny = runner.y;
    }
    const others = trailCells(state, id);
    if (others.has(`${nx},${ny}`)) {
      runner.score = Math.max(0, runner.score - HIT_PENALTY);
      runner.combo = 0;
      runner.hue = null;
      runner.hits += 1;
      runner.trail = [];
      runner.frozenUntil = now + FREEZE_MS;
      outcome.hits.push(id);
      state.lastEvent = `hit:${id}`;
      continue;
    }
    runner.trail.push({ x: runner.x, y: runner.y, expiresStep: state.stepIndex + TRAIL_LIFE });
    runner.x = nx;
    runner.y = ny;

    const here = state.tokens.filter((token) => token.x === nx && token.y === ny);
    for (const token of here) {
      if (token.kind === 'pickup') {
        runner.score += PICKUP_POINTS;
        runner.pickups += 1;
        runner.combo = token.hue === runner.hue ? runner.combo + 1 : 1;
        runner.hue = token.hue;
        outcome.pickups.push(id);
        state.lastEvent = `pickup:${id}:${token.hue}`;
        state.tokens = state.tokens.filter((entry) => entry.id !== token.id);
      } else if (token.kind === 'zone' && runner.hue === token.hue) {
        const bonus = ZONE_POINTS * Math.max(1, runner.combo);
        runner.score += bonus;
        runner.zones += 1;
        runner.combo += 1;
        state.lastEvent = `zone:${id}:${bonus}`;
        outcome.pickups.push(id);
        state.tokens = state.tokens.filter((entry) => entry.id !== token.id);
      }
    }
  }

  state.stepIndex += 1;
  ensureTokens(state, ctx);
  return outcome;
}

export function finishTrails(state: ColorTrailsState, ctx: GameContext, reason: GameFinishReason): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.finishReason = reason;
  state.lastEvent = reason === 'timeout' ? 'timeout' : 'finished';
  ctx.markStateChanged();
  ctx.finish(reason);
}

function makeRunner(seat: number, cols: number, rows: number): TrailRunner {
  const spawn = spawnPoint(seat, cols, rows);
  return {
    x: spawn.x,
    y: spawn.y,
    direction: spawn.direction,
    pending: null,
    trail: [],
    score: 0,
    combo: 0,
    hue: null,
    pickups: 0,
    zones: 0,
    hits: 0,
    frozenUntil: 0,
    disconnected: false,
    left: false,
  };
}

export const colorTrailsGame: GameModule<ColorTrailsState> = {
  metadata: COLOR_TRAILS_METADATA,

  initialize(): void {
    // Stateless module.
  },

  createInitialState(players): ColorTrailsState {
    const runners: Record<string, TrailRunner> = {};
    players.forEach((player, index) => {
      runners[player.id] = makeRunner(index, TRAIL_COLS, TRAIL_ROWS);
    });
    return {
      phase: 'idle',
      cols: TRAIL_COLS,
      rows: TRAIL_ROWS,
      runners,
      tokens: [],
      stepMs: STEP_MS,
      stepIndex: 0,
      accumulatorMs: 0,
      startedAt: null,
      endsAt: null,
      durationMs: MATCH_MS,
      finishReason: null,
      lastEvent: null,
      nextAIRequestAt: {},
      tokenSeq: 0,
    };
  },

  playerJoined(player, state): void {
    if (!state.runners[player.id]) {
      state.runners[player.id] = makeRunner(Object.keys(state.runners).length, state.cols, state.rows);
    }
  },

  playerReady(): void {
    // No per-player readiness behaviour.
  },

  playerLeft(playerId, state, ctx, reason): void {
    const runner = state.runners[playerId];
    if (!runner) return;
    if (reason === 'disconnect') {
      runner.disconnected = true;
      return;
    }
    runner.left = true;
    runner.trail = [];
    if (Object.values(state.runners).every((entry) => entry.left)) finishTrails(state, ctx, 'abandoned');
  },

  start(state, ctx): void {
    if (state.phase === 'playing') return;
    const runners: Record<string, TrailRunner> = {};
    ctx.players.forEach((player, index) => {
      runners[player.id] = makeRunner(index, TRAIL_COLS, TRAIL_ROWS);
    });
    state.runners = runners;
    state.tokens = [];
    state.tokenSeq = 0;
    state.stepIndex = 0;
    state.accumulatorMs = 0;
    state.phase = 'playing';
    state.startedAt = ctx.now();
    state.endsAt = state.startedAt + state.durationMs;
    state.finishReason = null;
    state.lastEvent = 'start';
    ensureTokens(state, ctx);
    ctx.markStateChanged();
    ctx.schedule(state.durationMs, () => finishTrails(state, ctx, 'timeout'), 'gameDuration', 'match-timeout');
  },

  validateAction(playerId, action, state): ValidationResult {
    if (action.type !== 'turn') return { valid: false, reason: 'Unknown action.' };
    if (state.phase !== 'playing') return { valid: false, reason: 'The match is not running.' };
    const direction = action.payload?.direction;
    if (!isTrailDirection(direction)) return { valid: false, reason: 'Use up, down, left or right.' };
    const runner = state.runners[playerId];
    if (!runner || runner.left) return { valid: false, reason: 'You are not in this match.' };
    const effective = runner.pending ?? runner.direction;
    if (REVERSE[effective] === direction) return { valid: false, reason: 'You cannot reverse instantly.' };
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state): ActionResult {
    if (action.type !== 'turn') return actionRejected('Unknown action.');
    const direction = action.payload?.direction;
    if (!isTrailDirection(direction)) return actionRejected('Invalid direction.');
    const runner = state.runners[playerId];
    if (!runner || state.phase !== 'playing') return actionRejected('You cannot steer right now.');
    const effective = runner.pending ?? runner.direction;
    if (REVERSE[effective] === direction) return actionRejected('You cannot reverse instantly.');
    if (effective === direction) return actionAccepted(false);
    runner.pending = direction;
    return actionAccepted(false);
  },

  update(state, deltaTimeMs, ctx): void {
    if (state.phase !== 'playing') return;
    for (const player of ctx.players) {
      if (!player.isAI) continue;
      const runner = state.runners[player.id];
      if (!runner || runner.left) continue;
      const now = ctx.now();
      const difficulty = player.aiDifficulty ?? 'medium';
      if (now >= (state.nextAIRequestAt[player.id] ?? 0)) {
        ctx.requestAI(player.id, 40);
        state.nextAIRequestAt[player.id] = now + AI_INTERVAL[difficulty];
      }
    }
    state.accumulatorMs += deltaTimeMs;
    let guard = 0;
    while (state.accumulatorMs >= state.stepMs && state.phase === 'playing' && guard < 4) {
      state.accumulatorMs -= state.stepMs;
      guard += 1;
      const outcome = stepTrails(state, ctx);
      if (outcome.pickups.length > 0 || outcome.hits.length > 0) ctx.markStateChanged();
    }
  },

  tick(): void {
    // Handled by update().
  },

  calculateScore(playerId, state): number {
    return state.runners[playerId]?.score ?? 0;
  },

  checkWinCondition(state): string[] | null {
    if (state.phase !== 'finished') return null;
    const entries = Object.entries(state.runners).map(([id, runner]) => [id, runner.score] as const);
    if (entries.length === 0) return [];
    const best = Math.max(...entries.map(([, n]) => n));
    return entries.filter(([, n]) => n === best).map(([id]) => id);
  },

  checkDrawCondition(state): boolean {
    return (this.checkWinCondition(state)?.length ?? 0) > 1;
  },

  isGameFinished(state): boolean {
    return state.phase === 'finished';
  },

  finish(state): void {
    state.phase = 'finished';
  },

  getResult(state, ctx): GameResultDraft {
    const ranked = [...ctx.players].sort((a, b) => (state.runners[b.id]?.score ?? 0) - (state.runners[a.id]?.score ?? 0));
    const top = state.runners[ranked[0]?.id ?? '']?.score ?? 0;
    const winners = ranked.filter((player) => (state.runners[player.id]?.score ?? 0) === top).map((player) => player.id);
    const rankings: RankingDraft[] = ranked.map((player, index) => ({
      playerId: player.id,
      rank: index + 1,
      score: state.runners[player.id]?.score ?? 0,
      isWinner: winners.includes(player.id),
      isDraw: winners.length > 1,
      stats: {
        pickups: state.runners[player.id]?.pickups ?? 0,
        zones: state.runners[player.id]?.zones ?? 0,
        combo: state.runners[player.id]?.combo ?? 0,
        hits: state.runners[player.id]?.hits ?? 0,
      },
    }));
    return { winners, isDraw: winners.length > 1, rankings, reason: state.finishReason ?? 'completed' };
  },

  reset(state): ColorTrailsState {
    const seats = Object.keys(state.runners);
    const runners: Record<string, TrailRunner> = {};
    seats.forEach((id, index) => {
      runners[id] = makeRunner(index, state.cols, state.rows);
    });
    return {
      ...state,
      phase: 'idle',
      runners,
      tokens: [],
      stepIndex: 0,
      accumulatorMs: 0,
      startedAt: null,
      endsAt: null,
      finishReason: null,
      lastEvent: null,
      nextAIRequestAt: {},
      tokenSeq: 0,
    };
  },

  cleanup(state): void {
    state.runners = {};
    state.tokens = [];
    state.phase = 'finished';
  },

  getPublicState(state, _viewerId, ctx) {
    return {
      phase: state.phase,
      cols: state.cols,
      rows: state.rows,
      stepMs: state.stepMs,
      stepIndex: state.stepIndex,
      startedAt: state.startedAt,
      endsAt: state.endsAt,
      durationMs: state.durationMs,
      finishReason: state.finishReason,
      lastEvent: state.lastEvent,
      serverTime: ctx.now(),
      tokens: state.tokens.map((token) => ({ ...token })),
      runners: Object.fromEntries(
        Object.entries(state.runners).map(([id, runner]) => [
          id,
          {
            x: runner.x,
            y: runner.y,
            direction: runner.direction,
            trail: runner.trail.map((segment) => ({ x: segment.x, y: segment.y })),
            score: runner.score,
            combo: runner.combo,
            hue: runner.hue,
            pickups: runner.pickups,
            zones: runner.zones,
            frozenUntil: runner.frozenUntil,
            disconnected: runner.disconnected,
          },
        ]),
      ),
    };
  },

  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'playing') return null;
    const runner = state.runners[playerId];
    if (!runner || runner.left) return null;
    const options = ALL_DIRS.filter((dir) => dir !== REVERSE[runner.direction]);
    const safe = options.filter((dir) => {
      const n = { x: runner.x + DELTA[dir].dx, y: runner.y + DELTA[dir].dy };
      return inBounds(state.cols, state.rows, n.x, n.y);
    });
    const pool = safe.length > 0 ? safe : options;
    if (difficulty === 'easy' && ctx.random() < 0.4) {
      return { type: 'turn', payload: { direction: pool[Math.floor(ctx.random() * pool.length)]! } };
    }
    const target = state.tokens.find((token) => token.kind === 'pickup' && (runner.hue === null || token.hue === runner.hue)) ?? state.tokens[0];
    if (!target) return { type: 'turn', payload: { direction: pool[0]! } };
    const scored = pool.map((dir) => {
      const n = { x: runner.x + DELTA[dir].dx, y: runner.y + DELTA[dir].dy };
      const dist = Math.abs(n.x - target.x) + Math.abs(n.y - target.y);
      return { dir, dist };
    });
    scored.sort((a, b) => a.dist - b.dist);
    return { type: 'turn', payload: { direction: scored[0]!.dir } };
  },

  needsUpdateLoop: true,
  maxDurationMs: 6 * 60 * 1000,
};
