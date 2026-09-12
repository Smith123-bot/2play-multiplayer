import type { GameAction, GameConfig, GameFinishReason } from '@2play/shared';
import { PADDLE_DUEL_METADATA } from '@2play/shared';
export { PADDLE_DUEL_METADATA };
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
 * Paddle Duel — two paddles, one server-simulated ball.
 *
 * The platform ticks `update()` on its fixed clock; this module sub-steps the
 * physics on a 50 ms accumulator, so the simulation is identical for every
 * client and every match. Clients only send paddle intents (`up` / `down` /
 * `stop`) — never positions, never scores. The public state carries the ball
 * velocity plus `serverTime` so clients may *extrapolate* smoothly between
 * broadcasts; the server state stays the single source of truth.
 */

export type PaddlePhase = 'idle' | 'playing' | 'finished';
export type PaddleSide = 'left' | 'right';
export type PaddleIntent = 'up' | 'down' | 'stop';

export interface PaddlePlayerState {
  side: PaddleSide;
  y: number; // paddle centre
  dir: -1 | 0 | 1;
  score: number;
  rallies: number; // paddle hits
  bestRally: number;
  pointStreak: number;
  disconnected: boolean;
  left: boolean;
  latestInputSeq: number;
}

export interface PaddleBall {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface PaddleDuelState {
  phase: PaddlePhase;
  width: number;
  height: number;
  paddleWidth: number;
  paddleHeight: number;
  ballRadius: number;
  paddles: Record<string, PaddlePlayerState>;
  ball: PaddleBall;
  serveAt: number | null;
  servingTo: PaddleSide | null;
  rallyHits: number;
  scoreLimit: number;
  stepMs: number;
  accumulatorMs: number;
  startedAt: number | null;
  endsAt: number | null;
  durationMs: number;
  finishReason: GameFinishReason | null;
  lastEvent: string | null;
  nextAIRequestAt: Record<string, number>;
  pointNumber: number;
  lastHit: { x: number; y: number; at: number } | null;
  impactCounter: number;
  lastImpact: {
    id: number;
    kind: 'paddle' | 'wall' | 'point';
    x: number;
    y: number;
    at: number;
  } | null;
}

const ARENA_W = 100;
const ARENA_H = 60;
const PADDLE_W = 2;
const PADDLE_H = 12;
const PADDLE_INSET = 3;
const BALL_R = 1;
const STEP_MS = 16;
const MAX_SUBSTEPS = 20;
const PADDLE_SPEED = 42; // units per second
const BALL_SPEED_START = 40;
const BALL_SPEED_INC = 3.5;
const BALL_SPEED_MAX = 78;
const MAX_BOUNCE_DEG = 58;
const PADDLE_SPIN = 0.16;
const SERVE_DELAY_MS = 1200;
const SERVE_ANGLE_MAX_DEG = 30;
const MATCH_MS = 3 * 60 * 1000;
const SCORE_LIMIT_DEFAULT = 7;
const SCORE_LIMIT_MIN = 3;
const SCORE_LIMIT_MAX = 15;
const AI_REQUEST_INTERVAL_MS = 180;
const MISS_MARGIN = 4; // ball must fully exit before a point is called

export function isPaddleIntent(value: unknown): value is PaddleIntent {
  return value === 'up' || value === 'down' || value === 'stop';
}

export function scoreLimitFor(requested?: number): number {
  if (typeof requested === 'number' && Number.isFinite(requested)) {
    return Math.min(SCORE_LIMIT_MAX, Math.max(SCORE_LIMIT_MIN, Math.round(requested)));
  }
  return SCORE_LIMIT_DEFAULT;
}

function paddleFace(side: PaddleSide): number {
  // The face the ball bounces off.
  return side === 'left' ? PADDLE_INSET + PADDLE_W : ARENA_W - PADDLE_INSET - PADDLE_W;
}

function sideOf(paddles: Record<string, PaddlePlayerState>, side: PaddleSide): string | null {
  for (const [playerId, paddle] of Object.entries(paddles)) {
    if (paddle.side === side) return playerId;
  }
  return null;
}

/** Folds a coordinate into [low, high] with mirror reflections (wall bounces). */
export function foldRange(value: number, low: number, high: number): number {
  const span = high - low;
  let v = value - low;
  const period = 2 * span;
  v = ((v % period) + period) % period; // [0, period)
  if (v > span) v = period - v;
  return v + low;
}

/** Predicts the ball's y when it reaches a side (walls reflect). For AI + tests. */
export function predictBallY(
  ball: PaddleBall,
  targetX: number,
  height: number,
  radius: number,
): number {
  if (ball.vx === 0) return ball.y;
  const t = (targetX - ball.x) / ball.vx;
  if (t <= 0) return ball.y;
  return foldRange(ball.y + ball.vy * t, radius, height - radius);
}

/** Places the ball dead-centre and schedules the next serve. Exported for tests. */
export function resetPoint(state: PaddleDuelState, servingTo: PaddleSide, now: number): void {
  state.ball = { x: ARENA_W / 2, y: ARENA_H / 2, vx: 0, vy: 0 };
  state.serveAt = now + SERVE_DELAY_MS;
  state.servingTo = servingTo;
  state.rallyHits = 0;
}

/** Launches the ball after the serve delay. Exported for tests. */
export function launchServe(state: PaddleDuelState, ctx: GameContext): void {
  if (state.serveAt === null || state.servingTo === null) return;
  const roll = ctx.random() * 2 - 1;
  const sign = roll < 0 ? -1 : 1;
  const angle = (sign * (8 + Math.abs(roll) * (SERVE_ANGLE_MAX_DEG - 8)) * Math.PI) / 180;
  const dir = state.servingTo === 'left' ? -1 : 1;
  state.ball = {
    x: ARENA_W / 2,
    y: ARENA_H / 2,
    vx: Math.cos(angle) * BALL_SPEED_START * dir,
    vy: Math.sin(angle) * BALL_SPEED_START,
  };
  state.serveAt = null;
  state.servingTo = null;
  state.lastEvent = 'serve';
  ctx.markStateChanged();
}

function recordImpact(
  state: PaddleDuelState,
  kind: 'paddle' | 'wall' | 'point',
  x: number,
  y: number,
  now: number,
): void {
  state.impactCounter += 1;
  state.lastImpact = { id: state.impactCounter, kind, x, y, at: now };
}

function scorePoint(state: PaddleDuelState, scorerSide: PaddleSide, ctx: GameContext): void {
  const scorer = sideOf(state.paddles, scorerSide);
  if (scorer) {
    state.paddles[scorer]!.score += 1;
    state.paddles[scorer]!.pointStreak += 1;
    for (const [id, paddle] of Object.entries(state.paddles)) {
      if (id !== scorer) paddle.pointStreak = 0;
    }
  }
  state.pointNumber += 1;
  recordImpact(state, 'point', scorerSide === 'left' ? state.width : 0, state.ball.y, ctx.now());
  state.lastEvent = `point:${scorer ?? scorerSide}`;
  ctx.markStateChanged();
  if (scorer && state.paddles[scorer]!.score >= state.scoreLimit) {
    finishPaddleMatch(state, ctx, 'completed');
    return;
  }
  // The conceder receives the next serve.
  resetPoint(state, scorerSide === 'left' ? 'right' : 'left', ctx.now());
}

/** Reflects the ball off a paddle, angled by where it struck. */
function bounceOffPaddle(
  state: PaddleDuelState,
  paddle: PaddlePlayerState,
  ctx: GameContext,
): void {
  const speed = Math.min(BALL_SPEED_MAX, Math.hypot(state.ball.vx, state.ball.vy) + BALL_SPEED_INC);
  const half = state.paddleHeight / 2 + state.ballRadius;
  // Contact location sets the angle; moving into the ball adds limited, learnable spin.
  const rel = Math.min(
    0.96,
    Math.max(-0.96, (state.ball.y - paddle.y) / half + paddle.dir * PADDLE_SPIN),
  );
  const angle = (rel * (MAX_BOUNCE_DEG * Math.PI)) / 180;
  const dir = paddle.side === 'left' ? 1 : -1;
  state.ball.vx = Math.cos(angle) * speed * dir;
  state.ball.vy = Math.sin(angle) * speed;
  state.ball.x = paddleFace(paddle.side) + state.ballRadius * dir + dir * 0.01;
  state.rallyHits += 1;
  paddle.rallies += 1;
  paddle.bestRally = Math.max(paddle.bestRally, state.rallyHits);
  state.lastHit = { x: state.ball.x, y: state.ball.y, at: ctx.now() };
  recordImpact(state, 'paddle', state.ball.x, state.ball.y, ctx.now());
  state.lastEvent = 'paddle';
  ctx.markStateChanged();
}

/**
 * Advances the simulation by `deltaTimeMs`. Exported for tests.
 * `now` is the authoritative clock (ctx.now()).
 */
export function stepDuel(
  state: PaddleDuelState,
  deltaTimeMs: number,
  now: number,
  ctx: GameContext,
): void {
  if (state.phase !== 'playing') return;
  state.accumulatorMs += deltaTimeMs;
  let guard = 0;
  while (state.accumulatorMs >= state.stepMs && state.phase === 'playing' && guard < MAX_SUBSTEPS) {
    state.accumulatorMs -= state.stepMs;
    guard += 1;
    const dt = state.stepMs / 1000;

    // Paddles chase their intent, clamped inside the arena.
    for (const paddle of Object.values(state.paddles)) {
      paddle.y = Math.min(
        state.height - state.paddleHeight / 2,
        Math.max(state.paddleHeight / 2, paddle.y + paddle.dir * PADDLE_SPEED * dt),
      );
    }

    // Serve countdown.
    if (state.serveAt !== null) {
      if (now >= state.serveAt) launchServe(state, ctx);
      continue; // ball frozen at centre until launched
    }

    const prevX = state.ball.x;
    const prevY = state.ball.y;
    let nx = state.ball.x + state.ball.vx * dt;
    let ny = state.ball.y + state.ball.vy * dt;

    // Top / bottom walls.
    if (ny < state.ballRadius) {
      ny = 2 * state.ballRadius - ny;
      state.ball.vy = Math.abs(state.ball.vy);
      state.lastEvent = 'wall';
      recordImpact(state, 'wall', nx, state.ballRadius, now);
      ctx.markStateChanged();
    } else if (ny > state.height - state.ballRadius) {
      ny = 2 * (state.height - state.ballRadius) - ny;
      state.ball.vy = -Math.abs(state.ball.vy);
      state.lastEvent = 'wall';
      recordImpact(state, 'wall', nx, state.height - state.ballRadius, now);
      ctx.markStateChanged();
    }
    state.ball.y = ny;

    // Left paddle crossing (ball moving left).
    const leftId = sideOf(state.paddles, 'left');
    const left = leftId ? state.paddles[leftId] : null;
    if (left && state.ball.vx < 0) {
      const face = paddleFace('left');
      if (prevX - state.ballRadius >= face && nx - state.ballRadius < face) {
        const fraction = Math.max(0, Math.min(1, (prevX - state.ballRadius - face) / (prevX - nx)));
        const crossingY = prevY + (state.ball.y - prevY) * fraction;
        if (Math.abs(crossingY - left.y) <= state.paddleHeight / 2 + state.ballRadius) {
          bounceOffPaddle(state, left, ctx);
          nx = state.ball.x;
        }
      }
    }

    // Right paddle crossing (ball moving right).
    const rightId = sideOf(state.paddles, 'right');
    const right = rightId ? state.paddles[rightId] : null;
    if (right && state.ball.vx > 0 && state.phase === 'playing') {
      const face = paddleFace('right');
      if (prevX + state.ballRadius <= face && nx + state.ballRadius > face) {
        const fraction = Math.max(0, Math.min(1, (face - prevX - state.ballRadius) / (nx - prevX)));
        const crossingY = prevY + (state.ball.y - prevY) * fraction;
        if (Math.abs(crossingY - right.y) <= state.paddleHeight / 2 + state.ballRadius) {
          bounceOffPaddle(state, right, ctx);
          nx = state.ball.x;
        }
      }
    }

    if (state.phase !== 'playing') break;
    state.ball.x = nx;

    // A full miss scores for the opposite side.
    if (nx < -MISS_MARGIN) {
      scorePoint(state, 'right', ctx);
    } else if (nx > state.width + MISS_MARGIN) {
      scorePoint(state, 'left', ctx);
    }
  }
}

/** Timeout: the leader wins, equal scores are a draw. Exported for tests. */
export function finishPaddleOnTimeout(state: PaddleDuelState, ctx: GameContext): void {
  if (state.phase !== 'playing') return;
  finishPaddleMatch(state, ctx, 'timeout');
}

function finishPaddleMatch(
  state: PaddleDuelState,
  ctx: GameContext,
  reason: GameFinishReason,
): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.finishReason = reason;
  state.serveAt = null;
  state.servingTo = null;
  state.lastEvent = 'won';
  ctx.markStateChanged();
  ctx.finish(reason);
}

function endIfEveryoneLeft(state: PaddleDuelState, ctx: GameContext): void {
  const present = Object.values(state.paddles).filter((paddle) => !paddle.left);
  if (state.phase === 'playing' && present.length <= 1) {
    finishPaddleMatch(state, ctx, 'completed');
  }
}

/** Ranking: stayed players first, then score, then seat. */
export function computePaddleRanking(state: PaddleDuelState, ctx: GameContext): RankingDraft[] {
  const ranked = [...ctx.players].sort((a, b) => {
    const leftDiff =
      Number(state.paddles[a.id]?.left ?? true) - Number(state.paddles[b.id]?.left ?? true);
    if (leftDiff !== 0) return leftDiff;
    const scoreDiff = (state.paddles[b.id]?.score ?? 0) - (state.paddles[a.id]?.score ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    return a.seatIndex - b.seatIndex;
  });
  const top = ranked[0];
  const bestScore = top ? (state.paddles[top.id]?.score ?? 0) : 0;
  const bestStayed = top ? !(state.paddles[top.id]?.left ?? true) : false;
  const winners = ranked
    .filter(
      (player) =>
        !(state.paddles[player.id]?.left ?? true) === bestStayed &&
        (state.paddles[player.id]?.score ?? 0) === bestScore,
    )
    .map((player) => player.id);
  return ranked.map((player, index) => ({
    playerId: player.id,
    rank: index + 1,
    score: state.paddles[player.id]?.score ?? 0,
    isWinner: winners.includes(player.id),
    isDraw: winners.length > 1,
    stats: {
      rallies: state.paddles[player.id]?.rallies ?? 0,
      bestRally: state.paddles[player.id]?.bestRally ?? 0,
      pointStreak: state.paddles[player.id]?.pointStreak ?? 0,
      side: state.paddles[player.id]?.side === 'right' ? 1 : 0,
    },
  }));
}

/* ------------------------------------------------------------------ */
/* Module                                                              */
/* ------------------------------------------------------------------ */

export const paddleDuelGame: GameModule<PaddleDuelState> = {
  metadata: PADDLE_DUEL_METADATA,

  initialize(_config: GameConfig): void {
    // Stateless module.
  },

  createInitialState(players, config): PaddleDuelState {
    return {
      phase: 'idle',
      width: ARENA_W,
      height: ARENA_H,
      paddleWidth: PADDLE_W,
      paddleHeight: PADDLE_H,
      ballRadius: BALL_R,
      paddles: Object.fromEntries(
        players.map((player, index) => [
          player.id,
          {
            side: index % 2 === 0 ? 'left' : 'right',
            y: ARENA_H / 2,
            dir: 0,
            score: 0,
            rallies: 0,
            bestRally: 0,
            pointStreak: 0,
            disconnected: false,
            left: false,
            latestInputSeq: -1,
          },
        ]),
      ),
      ball: { x: ARENA_W / 2, y: ARENA_H / 2, vx: 0, vy: 0 },
      serveAt: null,
      servingTo: null,
      rallyHits: 0,
      scoreLimit: scoreLimitFor(config.rounds),
      stepMs: STEP_MS,
      accumulatorMs: 0,
      startedAt: null,
      endsAt: null,
      durationMs: MATCH_MS,
      finishReason: null,
      lastEvent: null,
      nextAIRequestAt: {},
      pointNumber: 0,
      lastHit: null,
      impactCounter: 0,
      lastImpact: null,
    };
  },

  playerJoined(player, state): void {
    if (state.paddles[player.id]) return;
    const usedLeft = Object.values(state.paddles).some((paddle) => paddle.side === 'left');
    state.paddles[player.id] = {
      side: usedLeft ? 'right' : 'left',
      y: ARENA_H / 2,
      dir: 0,
      score: 0,
      rallies: 0,
      bestRally: 0,
      pointStreak: 0,
      disconnected: false,
      left: false,
      latestInputSeq: -1,
    };
  },

  playerReady(): void {
    // No per-player readiness behaviour.
  },

  playerLeft(playerId, state, ctx, reason): void {
    const paddle = state.paddles[playerId];
    if (!paddle) return;
    if (reason === 'disconnect') {
      paddle.disconnected = true;
      paddle.dir = 0;
      return;
    }
    paddle.left = true;
    paddle.dir = 0;
    state.lastEvent = `left:${playerId}`;
    ctx.markStateChanged();
    endIfEveryoneLeft(state, ctx);
  },

  start(state, ctx): void {
    if (state.phase === 'playing') return;
    state.paddles = {};
    ctx.players.forEach((player, index) => {
      state.paddles[player.id] = {
        side: index % 2 === 0 ? 'left' : 'right',
        y: ARENA_H / 2,
        dir: 0,
        score: 0,
        rallies: 0,
        bestRally: 0,
        pointStreak: 0,
        disconnected: false,
        left: false,
        latestInputSeq: -1,
      };
    });
    state.phase = 'playing';
    state.accumulatorMs = 0;
    state.rallyHits = 0;
    state.startedAt = ctx.now();
    state.endsAt = state.startedAt + state.durationMs;
    state.finishReason = null;
    state.lastEvent = 'start';
    state.nextAIRequestAt = {};
    state.pointNumber = 0;
    state.lastHit = null;
    state.impactCounter = 0;
    state.lastImpact = null;
    resetPoint(state, ctx.random() < 0.5 ? 'left' : 'right', ctx.now());
    ctx.markStateChanged();

    ctx.schedule(
      state.durationMs,
      () => finishPaddleOnTimeout(state, ctx),
      'gameDuration',
      'match-timeout',
    );
  },

  validateAction(playerId, action, state): ValidationResult {
    if (action.type !== 'move') return { valid: false, reason: 'Unknown action.' };
    const direction = action.payload?.direction;
    if (!isPaddleIntent(direction)) {
      return { valid: false, reason: 'Invalid direction — use up, down or stop.' };
    }
    if (state.phase !== 'playing') return { valid: false, reason: 'The match is not running.' };
    const paddle = state.paddles[playerId];
    if (!paddle) return { valid: false, reason: 'You are not part of this match.' };
    const sequence = action.payload?.sequence;
    if (
      sequence !== undefined &&
      (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 0)
    ) {
      return { valid: false, reason: 'Invalid input sequence.' };
    }
    if (typeof sequence === 'number' && sequence <= paddle.latestInputSeq) {
      return { valid: false, reason: 'Stale input.' };
    }
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state): ActionResult {
    if (action.type !== 'move') return actionRejected('Unknown action.');
    const direction = action.payload?.direction;
    if (!isPaddleIntent(direction)) return actionRejected('Invalid direction.');
    const paddle = state.paddles[playerId];
    if (!paddle) return actionRejected('You are not part of this match.');
    if (state.phase !== 'playing') return actionRejected('The match is not running.');
    const sequence = action.payload?.sequence;
    if (
      sequence !== undefined &&
      (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 0)
    )
      return actionRejected('Invalid input sequence.');
    if (typeof sequence === 'number' && sequence <= paddle.latestInputSeq)
      return actionRejected('Stale input.');
    if (typeof sequence === 'number') paddle.latestInputSeq = sequence;
    paddle.dir = direction === 'up' ? -1 : direction === 'down' ? 1 : 0;
    return actionAccepted(false); // position updates on the server clock
  },

  update(state, deltaTimeMs, ctx): void {
    if (state.phase !== 'playing') return;

    for (const player of ctx.players) {
      if (!player.isAI) continue;
      if (!state.paddles[player.id]) continue;
      const now = ctx.now();
      if (now >= (state.nextAIRequestAt[player.id] ?? 0)) {
        ctx.requestAI(player.id, 60);
        state.nextAIRequestAt[player.id] = now + AI_REQUEST_INTERVAL_MS;
      }
    }

    stepDuel(state, deltaTimeMs, ctx.now(), ctx);
  },

  tick(): void {
    // Handled by update().
  },

  calculateScore(playerId, state): number {
    return state.paddles[playerId]?.score ?? 0;
  },

  checkWinCondition(state): string[] | null {
    if (state.phase !== 'finished') return null;
    const ranked = Object.entries(state.paddles)
      .sort((a, b) => b[1].score - a[1].score || Number(a[1].left) - Number(b[1].left))
      .filter(([, paddle]) => !paddle.left);
    if (ranked.length === 0) return [];
    const best = ranked[0]![1].score;
    return ranked.filter(([, paddle]) => paddle.score === best).map(([playerId]) => playerId);
  },

  checkDrawCondition(state): boolean {
    if (state.phase !== 'finished') return false;
    const winners = this.checkWinCondition(state)!;
    return winners.length > 1;
  },

  isGameFinished(state): boolean {
    return state.phase === 'finished';
  },

  finish(state): void {
    state.phase = 'finished';
  },

  getResult(state, ctx): GameResultDraft {
    const rankings = computePaddleRanking(state, ctx);
    const winners = rankings.filter((entry) => entry.isWinner).map((entry) => entry.playerId);
    return {
      winners,
      isDraw: winners.length > 1,
      rankings,
      reason: state.finishReason ?? 'completed',
    };
  },

  reset(state): PaddleDuelState {
    const seats = Object.keys(state.paddles);
    return {
      ...state,
      phase: 'idle',
      paddles: Object.fromEntries(
        seats.map((playerId) => [
          playerId,
          {
            ...state.paddles[playerId]!,
            y: ARENA_H / 2,
            dir: 0,
            score: 0,
            rallies: 0,
            bestRally: 0,
            pointStreak: 0,
            disconnected: false,
            left: false,
            latestInputSeq: -1,
          },
        ]),
      ),
      ball: { x: ARENA_W / 2, y: ARENA_H / 2, vx: 0, vy: 0 },
      serveAt: null,
      servingTo: null,
      rallyHits: 0,
      accumulatorMs: 0,
      startedAt: null,
      endsAt: null,
      finishReason: null,
      lastEvent: null,
      nextAIRequestAt: {},
      pointNumber: 0,
      lastHit: null,
      impactCounter: 0,
      lastImpact: null,
    };
  },

  cleanup(): void {
    // Stateless module.
  },

  getPublicState(state, _viewerId, ctx) {
    return {
      phase: state.phase,
      width: state.width,
      height: state.height,
      paddleWidth: state.paddleWidth,
      paddleHeight: state.paddleHeight,
      ballRadius: state.ballRadius,
      ball: { ...state.ball },
      serveAt: state.serveAt,
      servingTo: state.servingTo,
      rallyHits: state.rallyHits,
      pointNumber: state.pointNumber,
      lastHit: state.lastHit ? { ...state.lastHit } : null,
      lastImpact: state.lastImpact ? { ...state.lastImpact } : null,
      scoreLimit: state.scoreLimit,
      startedAt: state.startedAt,
      endsAt: state.endsAt,
      finishReason: state.finishReason,
      lastEvent: state.lastEvent,
      serverTime: ctx.now(),
      paddles: Object.fromEntries(
        Object.entries(state.paddles).map(([playerId, paddle]) => [
          playerId,
          {
            side: paddle.side,
            y: paddle.y,
            dir: paddle.dir,
            latestInputSeq: paddle.latestInputSeq,
            score: paddle.score,
            rallies: paddle.rallies,
            bestRally: paddle.bestRally,
            pointStreak: paddle.pointStreak,
            disconnected: paddle.disconnected,
            left: paddle.left,
          },
        ]),
      ),
    };
  },

  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'playing') return null;
    const paddle = state.paddles[playerId];
    if (!paddle || paddle.left) return null;

    const towardsMe = paddle.side === 'left' ? state.ball.vx < 0 : state.ball.vx > 0;
    const half = state.paddleHeight / 2;
    let target = state.height / 2;

    if (state.serveAt !== null) {
      // Drift to centre while waiting for the serve.
      target = state.height / 2;
    } else if (towardsMe) {
      const face = paddleFace(paddle.side);
      const predicted = predictBallY(state.ball, face, state.height, state.ballRadius);
      if (difficulty === 'hard') target = predicted;
      else if (difficulty === 'medium') target = state.ball.y * 0.25 + predicted * 0.75;
      else target = state.ball.y;
    } else {
      target = state.height / 2;
    }

    // Difficulty: error margin and willingness to react.
    const slop: Record<string, number> = { easy: 7, medium: 3.5, hard: 1 };
    const laziness: Record<string, number> = { easy: 0.25, medium: 0.08, hard: 0 };
    if (difficulty === 'easy' && ctx.random() < 0.25) {
      target = paddle.y; // daydream
    }
    const offset = target - paddle.y + (ctx.random() * 2 - 1) * slop[difficulty]!;
    if (Math.abs(offset) < half * 0.25) {
      return { type: 'move', payload: { direction: 'stop' } };
    }
    if (laziness[difficulty]! > 0 && !towardsMe && Math.abs(offset) < half) {
      return { type: 'move', payload: { direction: 'stop' } };
    }
    return { type: 'move', payload: { direction: offset < 0 ? 'up' : 'down' } };
  },

  needsUpdateLoop: true,
  maxDurationMs: 5 * 60 * 1000,
};
