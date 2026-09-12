import type { GameAction, GameConfig, GameFinishReason } from '@2play/shared';
import { BRICK_BREAKER_METADATA } from '@2play/shared';
export { BRICK_BREAKER_METADATA };
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
 * Brick Breaker Battle — two identical arenas, server-simulated.
 *
 * Both players break a mirrored 7x4 wall on the platform update clock (50 ms
 * sub-steps). Clients send only paddle intents — brick state, ball paths,
 * combos, lives and scores are authoritative here. The public state carries
 * velocities + `serverTime` so clients may extrapolate for smoothness.
 */

export type BrickPhase = 'idle' | 'playing' | 'finished';
export type BrickIntent = 'left' | 'right' | 'stop';
export type PowerUpKind = 'wide' | 'slow' | 'life' | 'points';

export interface BrickBall {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** A falling power-up capsule waiting to be caught (or missed). */
export interface PowerUpCapsule {
  id: number;
  kind: PowerUpKind;
  x: number;
  y: number;
}

export interface BrickArena {
  paddleX: number; // paddle centre
  paddleDir: -1 | 0 | 1;
  ball: BrickBall;
  launchAt: number | null; // parked on the paddle until this time
  bricks: boolean[]; // row-major, rows x brickCols
  /** Rows in the CURRENT wall — grows one per level. */
  rows: number;
  /** Current level, 1..MAX_LEVEL. */
  level: number;
  destroyed: number; // bricks broken in the current wall
  levelsCleared: number;
  chain: number; // bricks broken without a paddle touch
  lives: number;
  score: number;
  bricksBroken: number;
  powerUps: PowerUpCapsule[];
  powerUpCounter: number;
  /** Server time until which the paddle is widened. */
  wideUntil: number;
  /** Server time until which the ball is slowed. */
  slowUntil: number;
  done: boolean; // cleared the final wall or out of lives
  doneAt: number | null;
  disconnected: boolean;
  left: boolean;
}

export interface BrickBreakerState {
  phase: BrickPhase;
  width: number;
  height: number;
  paddleWidth: number;
  paddleHeight: number;
  ballRadius: number;
  brickCols: number;
  brickRows: number;
  brickValues: number[]; // points per row (row 0 = top)
  clearBonus: number;
  arenas: Record<string, BrickArena>;
  stepMs: number;
  accumulatorMs: number;
  startedAt: number | null;
  endsAt: number | null;
  durationMs: number;
  finishReason: GameFinishReason | null;
  lastEvent: string | null;
  nextAIRequestAt: Record<string, number>;
}

const ARENA_W = 100;
const ARENA_H = 70;
const PADDLE_W = 16;
const PADDLE_H = 2;
const PADDLE_Y = ARENA_H - 4;
const BALL_R = 1;
const BRICK_COLS = 7;
const BRICK_ROWS = 4;
const BRICK_W = 13;
const BRICK_H = 4;
const BRICK_GAP = 1;
const BRICK_OFFSET_X = (ARENA_W - (BRICK_COLS * BRICK_W + (BRICK_COLS - 1) * BRICK_GAP)) / 2;
const BRICK_OFFSET_Y = 6;
const BRICK_VALUES = [30, 25, 20, 15, 10, 10];
const CLEAR_BONUS = 100;
const STEP_MS = 50;
const MAX_SUBSTEPS = 6;
const PADDLE_SPEED = 55; // units/s
const BALL_SPEED_START = 38;
const BALL_SPEED_INC = 1.2;
const BALL_SPEED_MAX = 62;
/** Extra starting ball speed per level beyond the first. */
export const BALL_SPEED_LEVEL_INC = 4;
const MAX_LAUNCH_DEG = 50;
const LAUNCH_DELAY_MS = 1100;
const START_LIVES = 3;
export const MAX_LIVES = 5;
const MATCH_MS = 3 * 60 * 1000;
const AI_REQUEST_INTERVAL_MS = 180;

/* ------------------------------------------------------------------ */
/* Power-ups & levels                                                  */
/* ------------------------------------------------------------------ */

/** Chance a broken brick drops a capsule (deterministic via the platform PRNG). */
export const POWERUP_DROP_CHANCE = 0.18;
export const POWERUP_FALL_SPEED = 14; // units/s
export const POWERUP_R = 1.6;
export const POWERUP_POINTS = 75;
export const WIDE_MULT = 1.4;
export const WIDE_MS = 12_000;
export const SLOW_MULT = 0.75;
export const SLOW_MS = 8_000;
/** At most this many capsules falling per arena at once. */
export const MAX_FALLING_POWERUPS = 3;
/** Walls: level 1 → 4 rows, level 2 → 5 rows, level 3 → 6 rows. */
export const MAX_LEVEL = 3;

/** Ball speed a fresh launch gets at the given level. */
export function ballSpeedForLevel(level: number): number {
  return BALL_SPEED_START + (Math.min(MAX_LEVEL, Math.max(1, level)) - 1) * BALL_SPEED_LEVEL_INC;
}

/** Wall rows for a level (4 + one per level beyond the first). */
export function rowsForLevel(level: number): number {
  return BRICK_ROWS + (Math.min(MAX_LEVEL, Math.max(1, level)) - 1);
}

export function totalBricksFor(rows: number): number {
  return BRICK_COLS * rows;
}

export function isBrickIntent(value: unknown): value is BrickIntent {
  return value === 'left' || value === 'right' || value === 'stop';
}

/** Rectangle of a brick cell (row-major). Exported for tests + AI. */
export function brickRect(index: number): { x: number; y: number; w: number; h: number } {
  const row = Math.floor(index / BRICK_COLS);
  const col = index % BRICK_COLS;
  return {
    x: BRICK_OFFSET_X + col * (BRICK_W + BRICK_GAP),
    y: BRICK_OFFSET_Y + row * (BRICK_H + BRICK_GAP),
    w: BRICK_W,
    h: BRICK_H,
  };
}

/** Effective paddle width (wide power-up). Exported for tests + AI. */
export function effectivePaddleWidth(arena: BrickArena, baseWidth: number, now: number): number {
  return arena.wideUntil > now ? baseWidth * WIDE_MULT : baseWidth;
}

/** Ball motion scale for the slow power-up. */
export function ballSpeedScale(arena: BrickArena, now: number): number {
  return arena.slowUntil > now ? SLOW_MULT : 1;
}

/** Folds a coordinate into [low, high] with mirror reflections. */
function foldRange(value: number, low: number, high: number): number {
  const span = high - low;
  let v = value - low;
  const period = 2 * span;
  v = ((v % period) + period) % period;
  if (v > span) v = period - v;
  return v + low;
}

/** Predicts the ball's x when it descends to paddle depth (walls reflect). */
export function predictBallX(ball: BrickBall, targetY: number, width: number, radius: number): number {
  if (ball.vy === 0) return ball.x;
  const t = (targetY - ball.y) / ball.vy;
  if (t <= 0) return ball.x;
  return foldRange(ball.x + ball.vx * t, radius, width - radius);
}

function freshBricks(rows: number): boolean[] {
  return Array<boolean>(totalBricksFor(rows)).fill(true);
}

function newArena(): BrickArena {
  return {
    paddleX: ARENA_W / 2,
    paddleDir: 0,
    ball: { x: ARENA_W / 2, y: PADDLE_Y - BALL_R - 0.5, vx: 0, vy: 0 },
    launchAt: null,
    bricks: freshBricks(BRICK_ROWS),
    rows: BRICK_ROWS,
    level: 1,
    destroyed: 0,
    levelsCleared: 0,
    chain: 0,
    lives: START_LIVES,
    score: 0,
    bricksBroken: 0,
    powerUps: [],
    powerUpCounter: 0,
    wideUntil: 0,
    slowUntil: 0,
    done: false,
    doneAt: null,
    disconnected: false,
    left: false,
  };
}

/** Parks the ball on the paddle for a delayed launch. Exported for tests. */
export function parkBall(arena: BrickArena, now: number): void {
  arena.ball = { x: arena.paddleX, y: PADDLE_Y - BALL_R - 0.5, vx: 0, vy: 0 };
  arena.launchAt = now + LAUNCH_DELAY_MS;
  arena.chain = 0;
}

/** Launches a parked ball upward at a random angle. Exported for tests. */
export function launchBall(arena: BrickArena, ctx: GameContext): void {
  if (arena.launchAt === null) return;
  const angle = ((ctx.random() * 2 - 1) * MAX_LAUNCH_DEG * Math.PI) / 180;
  const speed = Math.min(BALL_SPEED_MAX, ballSpeedForLevel(arena.level));
  arena.ball = {
    x: arena.paddleX,
    y: PADDLE_Y - BALL_R - 0.5,
    vx: Math.sin(angle) * speed,
    vy: -Math.cos(angle) * speed,
  };
  arena.launchAt = null;
  ctx.markStateChanged();
}

function arenaDone(arena: BrickArena, now: number): void {
  arena.done = true;
  arena.doneAt = now;
  arena.paddleDir = 0;
}

/** Applies a caught power-up. Returns the event suffix. */
function applyPowerUp(arena: BrickArena, kind: PowerUpKind, now: number): string {
  if (kind === 'wide') {
    arena.wideUntil = now + WIDE_MS;
  } else if (kind === 'slow') {
    arena.slowUntil = now + SLOW_MS;
  } else if (kind === 'life') {
    arena.lives = Math.min(MAX_LIVES, arena.lives + 1);
  } else {
    arena.score += POWERUP_POINTS;
  }
  return kind;
}

/**
 * Handles a sub-step of one arena. Returns an event name or null.
 *
 * The ball integrates in micro-steps (never more than ~1.4 units at a time) so
 * it can never tunnel through a thin brick or the paddle at high speed.
 */
function stepArena(
  state: BrickBreakerState,
  playerId: string,
  arena: BrickArena,
  dt: number,
  now: number,
  ctx: GameContext,
): string | null {
  if (arena.done) return null;
  let event: string | null = null;

  // Paddle.
  arena.paddleX = Math.min(
    state.width - state.paddleWidth / 2,
    Math.max(state.paddleWidth / 2, arena.paddleX + arena.paddleDir * PADDLE_SPEED * dt),
  );

  // Parked ball rides the paddle until launch.
  if (arena.launchAt !== null) {
    arena.ball.x = arena.paddleX;
    arena.ball.y = PADDLE_Y - state.ballRadius - 0.5;
    if (now >= arena.launchAt) {
      launchBall(arena, ctx);
      event = `launch:${playerId}`;
    }
  } else {
    // Ball motion, micro-stepped to prevent tunnelling.
    const scale = ballSpeedScale(arena, now);
    const speed = Math.hypot(arena.ball.vx, arena.ball.vy) * scale;
    const micro = Math.max(1, Math.ceil((speed * dt) / 1.4));
    const mdt = dt / micro;
    for (let step = 0; step < micro && event === null; step += 1) {
      let nx = arena.ball.x + arena.ball.vx * scale * mdt;
      let ny = arena.ball.y + arena.ball.vy * scale * mdt;

      // Side walls.
      if (nx < state.ballRadius) {
        nx = 2 * state.ballRadius - nx;
        arena.ball.vx = Math.abs(arena.ball.vx);
      } else if (nx > state.width - state.ballRadius) {
        nx = 2 * (state.width - state.ballRadius) - nx;
        arena.ball.vx = -Math.abs(arena.ball.vx);
      }
      // Ceiling.
      if (ny < state.ballRadius) {
        ny = 2 * state.ballRadius - ny;
        arena.ball.vy = Math.abs(arena.ball.vy);
      }
      arena.ball.x = nx;
      arena.ball.y = ny;

      // Bricks — circle-vs-AABB approximated by expanded AABB; one brick per step.
      for (let index = 0; index < arena.bricks.length; index += 1) {
        if (!arena.bricks[index]) continue;
        const rect = brickRect(index);
        const r = state.ballRadius;
        if (
          nx + r > rect.x &&
          nx - r < rect.x + rect.w &&
          ny + r > rect.y &&
          ny - r < rect.y + rect.h
        ) {
          arena.bricks[index] = false;
          arena.destroyed += 1;
          arena.bricksBroken += 1;
          arena.chain += 1;
          const row = Math.floor(index / BRICK_COLS);
          const multiplier = Math.min(4, arena.chain);
          arena.score += state.brickValues[row]! * multiplier;
          // Maybe drop a power-up capsule where the brick was.
          if (
            arena.powerUps.length < MAX_FALLING_POWERUPS &&
            ctx.random() < POWERUP_DROP_CHANCE
          ) {
            const roll = ctx.random();
            const kind: PowerUpKind =
              roll < 0.3 ? 'wide' : roll < 0.55 ? 'slow' : roll < 0.75 ? 'points' : 'life';
            arena.powerUpCounter += 1;
            arena.powerUps.push({ id: arena.powerUpCounter, kind, x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });
          }
          // Reflect on the shallowest penetration axis.
          const overlapX = Math.min(nx + r - rect.x, rect.x + rect.w - (nx - r));
          const overlapY = Math.min(ny + r - rect.y, rect.y + rect.h - (ny - r));
          if (overlapX < overlapY) {
            arena.ball.vx = -arena.ball.vx;
            arena.ball.x = arena.ball.x + (nx + r - rect.x < rect.x + rect.w - (nx - r) ? -overlapX : overlapX);
          } else {
            arena.ball.vy = -arena.ball.vy;
            arena.ball.y = arena.ball.y + (ny + r - rect.y < rect.y + rect.h - (ny - r) ? -overlapY : overlapY);
          }
          // Nudge the speed upward.
          const newSpeed = Math.hypot(arena.ball.vx, arena.ball.vy);
          if (newSpeed > 0) {
            const scaled = Math.min(BALL_SPEED_MAX, newSpeed + BALL_SPEED_INC) / newSpeed;
            arena.ball.vx *= scaled;
            arena.ball.vy *= scaled;
          }
          if (arena.destroyed >= totalBricksFor(arena.rows)) {
            // Wall cleared: bank the level bonus and advance (or finish).
            arena.levelsCleared += 1;
            arena.score += state.clearBonus * arena.level;
            if (arena.level >= MAX_LEVEL) {
              arenaDone(arena, now);
              event = `cleared:${playerId}`;
            } else {
              arena.level += 1;
              arena.rows = rowsForLevel(arena.level);
              arena.bricks = freshBricks(arena.rows);
              arena.destroyed = 0;
              arena.lives = Math.min(MAX_LIVES, arena.lives + 1);
              parkBall(arena, now);
              event = `level:${playerId}:${arena.level}`;
            }
          } else {
            event = `brick:${playerId}`;
          }
          break;
        }
      }
      if (event !== null) break;

      // Paddle save.
      const paddleW = effectivePaddleWidth(arena, state.paddleWidth, now);
      const half = paddleW / 2 + state.ballRadius;
      if (
        arena.ball.vy > 0 &&
        ny + state.ballRadius >= PADDLE_Y - state.paddleHeight / 2 &&
        Math.abs(nx - arena.paddleX) <= half
      ) {
        const rel = Math.min(1, Math.max(-1, (nx - arena.paddleX) / half));
        const angle = rel * (MAX_LAUNCH_DEG * Math.PI) / 180;
        const speed2 = Math.min(BALL_SPEED_MAX, Math.hypot(arena.ball.vx, arena.ball.vy) + 0.8);
        arena.ball.vx = Math.sin(angle) * speed2;
        arena.ball.vy = -Math.cos(angle) * speed2;
        arena.ball.y = PADDLE_Y - state.paddleHeight / 2 - state.ballRadius - 0.01;
        arena.chain = 0; // combo resets on a save
        event = `save:${playerId}`;
        break;
      }

      // Miss → life lost.
      if (ny - state.ballRadius > state.height + 1) {
        arena.lives -= 1;
        arena.chain = 0;
        if (arena.lives <= 0) {
          arena.lives = 0;
          parkBall(arena, now);
          arenaDone(arena, now);
          return `out:${playerId}`;
        }
        parkBall(arena, now);
        return `miss:${playerId}`;
      }
    }
  }

  // Falling power-ups: catch with the paddle or lose them below the floor.
  if (arena.powerUps.length > 0) {
    const paddleW = effectivePaddleWidth(arena, state.paddleWidth, now);
    const half = paddleW / 2 + POWERUP_R;
    const kept: PowerUpCapsule[] = [];
    for (const capsule of arena.powerUps) {
      capsule.y += POWERUP_FALL_SPEED * dt;
      if (
        capsule.y + POWERUP_R >= PADDLE_Y - state.paddleHeight / 2 &&
        capsule.y < PADDLE_Y + state.paddleHeight &&
        Math.abs(capsule.x - arena.paddleX) <= half
      ) {
        const kind = applyPowerUp(arena, capsule.kind, now);
        if (event === null) event = `power:${playerId}:${kind}`;
      } else if (capsule.y - POWERUP_R <= state.height + 2) {
        kept.push(capsule);
      }
      // Missed capsules simply vanish below the floor.
    }
    arena.powerUps = kept;
  }

  return event;
}

/**
 * Advances every arena by `deltaTimeMs`. Exported for tests.
 */
export function stepBreaker(state: BrickBreakerState, deltaTimeMs: number, now: number, ctx: GameContext): void {
  if (state.phase !== 'playing') return;
  state.accumulatorMs += deltaTimeMs;
  let guard = 0;
  let anyEvent = false;
  while (state.accumulatorMs >= state.stepMs && state.phase === 'playing' && guard < MAX_SUBSTEPS) {
    state.accumulatorMs -= state.stepMs;
    guard += 1;
    for (const [playerId, arena] of Object.entries(state.arenas)) {
      if (arena.left && arena.done) continue;
      const event = stepArena(state, playerId, arena, state.stepMs / 1000, now, ctx);
      if (event) {
        state.lastEvent = event;
        anyEvent = true;
        if (event.startsWith('cleared:') || event.startsWith('out:')) {
          endIfAllDone(state, ctx);
        }
      }
    }
  }
  if (anyEvent) ctx.markStateChanged();
}

function endIfAllDone(state: BrickBreakerState, ctx: GameContext): void {
  if (state.phase !== 'playing') return;
  const arenas = Object.values(state.arenas);
  const active = arenas.filter((arena) => !arena.left && !arena.done);
  if (active.length === 0) {
    state.phase = 'finished';
    state.finishReason = 'completed';
    state.lastEvent = 'won';
    ctx.markStateChanged();
    ctx.finish('completed');
  }
}

/** Timeout: banked scores decide. Exported for tests. */
export function finishBreakerOnTimeout(state: BrickBreakerState, ctx: GameContext): void {
  if (state.phase !== 'playing') return;
  state.phase = 'finished';
  state.finishReason = 'timeout';
  state.lastEvent = 'won';
  ctx.markStateChanged();
  ctx.finish('timeout');
}

/** Ranking: score, then earlier finish, then lives. Exported for tests. */
export function computeBreakerRanking(state: BrickBreakerState, ctx: GameContext): RankingDraft[] {
  const ranked = [...ctx.players].sort((a, b) => {
    const scoreDiff = (state.arenas[b.id]?.score ?? 0) - (state.arenas[a.id]?.score ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    const aDone = state.arenas[a.id]?.doneAt ?? Number.MAX_SAFE_INTEGER;
    const bDone = state.arenas[b.id]?.doneAt ?? Number.MAX_SAFE_INTEGER;
    if (aDone !== bDone) return aDone - bDone;
    const livesDiff = (state.arenas[b.id]?.lives ?? 0) - (state.arenas[a.id]?.lives ?? 0);
    if (livesDiff !== 0) return livesDiff;
    return a.seatIndex - b.seatIndex;
  });
  const best = ranked[0];
  const winners = best
    ? ranked
        .filter(
          (player) =>
            (state.arenas[player.id]?.score ?? 0) === (state.arenas[best.id]?.score ?? 0) &&
            (state.arenas[player.id]?.doneAt ?? Number.MAX_SAFE_INTEGER) ===
              (state.arenas[best.id]?.doneAt ?? Number.MAX_SAFE_INTEGER) &&
            (state.arenas[player.id]?.lives ?? 0) === (state.arenas[best.id]?.lives ?? 0),
        )
        .map((player) => player.id)
    : [];
  return ranked.map((player, index) => {
    const arena = state.arenas[player.id];
    return {
      playerId: player.id,
      rank: index + 1,
      score: arena?.score ?? 0,
      isWinner: winners.includes(player.id),
      isDraw: winners.length > 1,
      stats: {
        bricks: arena?.bricksBroken ?? 0,
        lives: arena?.lives ?? 0,
        cleared: arena?.levelsCleared ?? 0,
      },
    };
  });
}

/* ------------------------------------------------------------------ */
/* Module                                                              */
/* ------------------------------------------------------------------ */

export const brickBreakerGame: GameModule<BrickBreakerState> = {
  metadata: BRICK_BREAKER_METADATA,

  initialize(_config: GameConfig): void {
    // Stateless module.
  },

  createInitialState(players, _config): BrickBreakerState {
    return {
      phase: 'idle',
      width: ARENA_W,
      height: ARENA_H,
      paddleWidth: PADDLE_W,
      paddleHeight: PADDLE_H,
      ballRadius: BALL_R,
      brickCols: BRICK_COLS,
      brickRows: BRICK_ROWS,
      brickValues: [...BRICK_VALUES],
      clearBonus: CLEAR_BONUS,
      arenas: Object.fromEntries(players.map((player) => [player.id, newArena()])),
      stepMs: STEP_MS,
      accumulatorMs: 0,
      startedAt: null,
      endsAt: null,
      durationMs: MATCH_MS,
      finishReason: null,
      lastEvent: null,
      nextAIRequestAt: {},
    };
  },

  playerJoined(player, state): void {
    if (!state.arenas[player.id]) state.arenas[player.id] = newArena();
  },

  playerReady(): void {
    // No per-player readiness behaviour.
  },

  playerLeft(playerId, state, ctx, reason): void {
    const arena = state.arenas[playerId];
    if (!arena) return;
    if (reason === 'disconnect') {
      arena.disconnected = true;
      arena.paddleDir = 0;
      return;
    }
    arena.left = true;
    arena.paddleDir = 0;
    state.lastEvent = `left:${playerId}`;
    ctx.markStateChanged();
    endIfAllDone(state, ctx);
  },

  start(state, ctx): void {
    if (state.phase === 'playing') return;
    state.arenas = Object.fromEntries(ctx.players.map((player) => [player.id, newArena()]));
    state.phase = 'playing';
    state.accumulatorMs = 0;
    state.startedAt = ctx.now();
    state.endsAt = state.startedAt + state.durationMs;
    state.finishReason = null;
    state.lastEvent = 'start';
    state.nextAIRequestAt = {};
    for (const arena of Object.values(state.arenas)) parkBall(arena, ctx.now());
    ctx.markStateChanged();

    ctx.schedule(
      state.durationMs,
      () => finishBreakerOnTimeout(state, ctx),
      'gameDuration',
      'match-timeout',
    );
  },

  validateAction(playerId, action, state): ValidationResult {
    if (action.type !== 'move') return { valid: false, reason: 'Unknown action.' };
    const direction = action.payload?.direction;
    if (!isBrickIntent(direction)) {
      return { valid: false, reason: 'Invalid direction — use left, right or stop.' };
    }
    if (state.phase !== 'playing') return { valid: false, reason: 'The match is not running.' };
    const arena = state.arenas[playerId];
    if (!arena) return { valid: false, reason: 'You are not part of this match.' };
    if (arena.done) return { valid: false, reason: 'Your run is over.' };
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state): ActionResult {
    if (action.type !== 'move') return actionRejected('Unknown action.');
    const direction = action.payload?.direction;
    if (!isBrickIntent(direction)) return actionRejected('Invalid direction.');
    const arena = state.arenas[playerId];
    if (!arena) return actionRejected('You are not part of this match.');
    if (state.phase !== 'playing') return actionRejected('The match is not running.');
    if (arena.done) return actionRejected('Your run is over.');
    arena.paddleDir = direction === 'left' ? -1 : direction === 'right' ? 1 : 0;
    return actionAccepted(false);
  },

  update(state, deltaTimeMs, ctx): void {
    if (state.phase !== 'playing') return;

    for (const player of ctx.players) {
      if (!player.isAI) continue;
      if (!state.arenas[player.id]) continue;
      const now = ctx.now();
      if (now >= (state.nextAIRequestAt[player.id] ?? 0)) {
        ctx.requestAI(player.id, 60);
        state.nextAIRequestAt[player.id] = now + AI_REQUEST_INTERVAL_MS;
      }
    }

    stepBreaker(state, deltaTimeMs, ctx.now(), ctx);
  },

  tick(): void {
    // Handled by update().
  },

  calculateScore(playerId, state): number {
    return state.arenas[playerId]?.score ?? 0;
  },

  checkWinCondition(state): string[] | null {
    if (state.phase !== 'finished') return null;
    const entries = Object.entries(state.arenas).filter(([, arena]) => !arena.left);
    if (entries.length === 0) return [];
    const best = Math.max(...entries.map(([, arena]) => arena.score));
    return entries.filter(([, arena]) => arena.score === best).map(([playerId]) => playerId);
  },

  checkDrawCondition(state): boolean {
    if (state.phase !== 'finished') return false;
    return this.checkWinCondition(state)!.length > 1;
  },

  isGameFinished(state): boolean {
    return state.phase === 'finished';
  },

  finish(state): void {
    state.phase = 'finished';
  },

  getResult(state, ctx): GameResultDraft {
    const rankings = computeBreakerRanking(state, ctx);
    const winners = rankings.filter((entry) => entry.isWinner).map((entry) => entry.playerId);
    return {
      winners,
      isDraw: winners.length > 1,
      rankings,
      reason: state.finishReason ?? 'completed',
    };
  },

  reset(state): BrickBreakerState {
    const seats = Object.keys(state.arenas);
    return {
      ...state,
      phase: 'idle',
      arenas: Object.fromEntries(seats.map((playerId) => [playerId, newArena()])),
      accumulatorMs: 0,
      startedAt: null,
      endsAt: null,
      finishReason: null,
      lastEvent: null,
      nextAIRequestAt: {},
    };
  },

  cleanup(): void {
    // Stateless module.
  },

  getPublicState(state, _viewerId, ctx) {
    const now = ctx.now();
    return {
      phase: state.phase,
      width: state.width,
      height: state.height,
      paddleWidth: state.paddleWidth,
      paddleHeight: state.paddleHeight,
      paddleY: PADDLE_Y,
      ballRadius: state.ballRadius,
      brickCols: state.brickCols,
      brickRows: state.brickRows,
      brickValues: [...state.brickValues],
      clearBonus: state.clearBonus,
      maxLevel: MAX_LEVEL,
      powerUpPoints: POWERUP_POINTS,
      startedAt: state.startedAt,
      endsAt: state.endsAt,
      finishReason: state.finishReason,
      lastEvent: state.lastEvent,
      serverTime: now,
      arenas: Object.fromEntries(
        Object.entries(state.arenas).map(([playerId, arena]) => [
          playerId,
          {
            paddleX: arena.paddleX,
            paddleDir: arena.paddleDir,
            paddleW: effectivePaddleWidth(arena, state.paddleWidth, now),
            ball: { ...arena.ball },
            launchAt: arena.launchAt,
            bricks: [...arena.bricks],
            rows: arena.rows,
            level: arena.level,
            levelsCleared: arena.levelsCleared,
            slowUntil: arena.slowUntil,
            wideUntil: arena.wideUntil,
            powerUps: arena.powerUps.map((capsule) => ({ ...capsule })),
            destroyed: arena.destroyed,
            chain: arena.chain,
            lives: arena.lives,
            score: arena.score,
            bricksBroken: arena.bricksBroken,
            done: arena.done,
            doneAt: arena.doneAt,
            disconnected: arena.disconnected,
            left: arena.left,
          },
        ]),
      ),
    };
  },

  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'playing') return null;
    const arena = state.arenas[playerId];
    if (!arena || arena.done || arena.left) return null;

    let target = state.width / 2;
    if (arena.launchAt === null && arena.ball.vy > 0) {
      target =
        difficulty === 'hard'
          ? predictBallX(arena.ball, PADDLE_Y, state.width, state.ballRadius)
          : arena.ball.x;
    } else if (arena.launchAt === null && arena.ball.vy < 0) {
      // Rising: drift toward where bricks remain.
      let centre = 0;
      let count = 0;
      for (let index = 0; index < arena.bricks.length; index += 1) {
        if (!arena.bricks[index]) continue;
        const rect = brickRect(index);
        centre += rect.x + rect.w / 2;
        count += 1;
      }
      if (count > 0) target = centre / count;
    }

    const slop: Record<string, number> = { easy: 8, medium: 3, hard: 1 };
    if (difficulty === 'easy' && ctx.random() < 0.25) target = arena.paddleX;
    const offset = target - arena.paddleX + (ctx.random() * 2 - 1) * slop[difficulty]!;
    const paddleW = effectivePaddleWidth(arena, state.paddleWidth, ctx.now());
    if (Math.abs(offset) < paddleW * 0.15) {
      return { type: 'move', payload: { direction: 'stop' } };
    }
    return { type: 'move', payload: { direction: offset < 0 ? 'left' : 'right' } };
  },

  needsUpdateLoop: true,
  maxDurationMs: 5 * 60 * 1000,
};
