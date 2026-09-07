import type { AIDifficulty, GameAction, GameConfig, GameFinishReason } from '@2play/shared';
import { SNAKE_BATTLE_METADATA } from '@2play/shared';
export { SNAKE_BATTLE_METADATA };
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
 * Snake Battle — two snakes on one server-timed grid.
 *
 * The platform ticks `update()` on a fixed clock (GAME_TICK_MS); each tick the
 * server moves every living snake one cell, resolves food/collisions and
 * broadcasts. Clients only send turn intents — never positions, never scores.
 */

export type SnakePhase = 'idle' | 'playing' | 'finished';
export type SnakeDirection = 'up' | 'down' | 'left' | 'right';

export interface SnakeSegment {
  x: number;
  y: number;
}

export interface SnakePlayerState {
  body: SnakeSegment[]; // head first
  direction: SnakeDirection;
  pendingDirection: SnakeDirection | null;
  alive: boolean;
  deathStep: number | null;
  diedAt: number | null;
  score: number;
  foodEaten: number;
  growPending: number;
  disconnected: boolean;
  left: boolean;
}

export interface SnakeFood {
  x: number;
  y: number;
  value: number;
}

export interface SnakeBattleState {
  phase: SnakePhase;
  cols: number;
  rows: number;
  snakes: Record<string, SnakePlayerState>;
  foods: SnakeFood[];
  stepMs: number;
  stepIndex: number;
  accumulatorMs: number;
  startedAt: number | null;
  endsAt: number | null;
  durationMs: number;
  finishReason: GameFinishReason | null;
  lastEvent: string | null;
  nextAIRequestAt: Record<string, number>;
}

const COLS = 17;
const ROWS = 17;
const STEP_MS = 250;
const MATCH_MS = 3 * 60 * 1000;
const FOOD_COUNT = 2;
const FOOD_POINTS = 10;
const AI_REQUEST_INTERVAL_MS = 280;

const DIRECTIONS: Record<SnakeDirection, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

const ALL_DIRECTIONS: SnakeDirection[] = ['up', 'down', 'left', 'right'];

export function isSnakeDirection(value: unknown): value is SnakeDirection {
  return value === 'up' || value === 'down' || value === 'left' || value === 'right';
}

export function isReverse(a: SnakeDirection, b: SnakeDirection): boolean {
  const pairs: Record<SnakeDirection, SnakeDirection> = { up: 'down', down: 'up', left: 'right', right: 'left' };
  return pairs[a] === b;
}

function snakeAt(snakes: Record<string, SnakePlayerState>, x: number, y: number): boolean {
  return Object.values(snakes).some(
    (snake) => snake.alive && snake.body.some((segment) => segment.x === x && segment.y === y),
  );
}

function foodAt(foods: SnakeFood[], x: number, y: number): boolean {
  return foods.some((food) => food.x === x && food.y === y);
}

/** Spawns one food pellet on a random free cell. Exported for tests. */
export function spawnFood(state: SnakeBattleState, ctx: GameContext): void {
  const free: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < state.cols; y += 1) {
    for (let x = 0; x < state.rows; x += 1) {
      if (!snakeAt(state.snakes, x, y) && !foodAt(state.foods, x, y)) free.push({ x, y });
    }
  }
  if (free.length === 0) return;
  const cell = free[Math.floor(ctx.random() * free.length)]!;
  state.foods.push({ x: cell.x, y: cell.y, value: FOOD_POINTS });
}



interface StepOutcome {
  deaths: string[];
  ate: string[];
}

/**
 * Advances the whole board by one cell-step (server authoritative). Exported
 * for tests.
 */
export function stepSnakes(state: SnakeBattleState, ctx: GameContext): StepOutcome {
  const aliveIds = Object.entries(state.snakes)
    .filter(([, snake]) => snake.alive)
    .map(([id]) => id);
  const outcome: StepOutcome = { deaths: [], ate: [] };
  if (aliveIds.length === 0) return outcome;

  // 1) Resolve every turn (validated against the queued direction to stop
  //    double-turn reversals).
  for (const id of aliveIds) {
    const snake = state.snakes[id]!;
    if (snake.pendingDirection) {
      snake.direction = snake.pendingDirection;
      snake.pendingDirection = null;
    }
  }

  // 2) Compute new heads + growth simultaneously.
  const plans = new Map<string, { head: SnakeSegment; eats: boolean; willGrow: boolean }>();
  for (const id of aliveIds) {
    const snake = state.snakes[id]!;
    const delta = DIRECTIONS[snake.direction];
    const head = { x: snake.body[0]!.x + delta.dx, y: snake.body[0]!.y + delta.dy };
    const eats = foodAt(state.foods, head.x, head.y);
    plans.set(id, { head, eats, willGrow: eats || snake.growPending > 0 });
  }

  // 3) Post-move bodies (used for collision checks).
  const postBodies = new Map<string, SnakeSegment[]>();
  for (const id of aliveIds) {
    const snake = state.snakes[id]!;
    const plan = plans.get(id)!;
    const body: SnakeSegment[] = [plan.head, ...snake.body];
    if (!plan.willGrow) body.pop();
    postBodies.set(id, body);
  }

  // 4) Deaths: walls, head-to-head, bodies. A snake never collides with its
  //    own NEW head — only with the rest of its (post-move) body.
  const dead = new Set<string>();
  for (const id of aliveIds) {
    const plan = plans.get(id)!;
    if (plan.head.x < 0 || plan.head.y < 0 || plan.head.x >= state.cols || plan.head.y >= state.rows) {
      dead.add(id);
      continue;
    }
    const ownRest = postBodies.get(id)!.slice(1);
    if (ownRest.some((cell) => cell.x === plan.head.x && cell.y === plan.head.y)) {
      dead.add(id);
      continue;
    }
    for (const other of aliveIds) {
      if (other === id) continue;
      const otherPlan = plans.get(other)!;
      if (otherPlan.head.x === plan.head.x && otherPlan.head.y === plan.head.y) {
        dead.add(id); // simultaneous head-to-head kills both
        break;
      }
      if (postBodies.get(other)!.some((cell) => cell.x === plan.head.x && cell.y === plan.head.y)) {
        dead.add(id);
        break;
      }
    }
  }

  // 5) Apply.
  for (const id of aliveIds) {
    const snake = state.snakes[id]!;
    const plan = plans.get(id)!;
    if (dead.has(id)) {
      snake.alive = false;
      snake.deathStep = state.stepIndex;
      snake.diedAt = ctx.now();
      snake.pendingDirection = null;
      outcome.deaths.push(id);
      continue;
    }
    snake.body = postBodies.get(id)!;
    if (plan.eats) {
      snake.score += FOOD_POINTS;
      snake.foodEaten += 1;
      outcome.ate.push(id);
      state.foods = state.foods.filter((food) => !(food.x === plan.head.x && food.y === plan.head.y));
    } else if (snake.growPending > 0) {
      snake.growPending -= 1;
    }
  }
  while (state.foods.length < FOOD_COUNT) spawnFood(state, ctx);

  state.stepIndex += 1;
  if (outcome.deaths.length > 0) state.lastEvent = `death:${outcome.deaths.join('+')}`;
  else if (outcome.ate.length > 0) state.lastEvent = `food:${outcome.ate.join('+')}`;
  return outcome;
}

function aliveCount(state: SnakeBattleState): number {
  return Object.values(state.snakes).filter((snake) => snake.alive).length;
}

/** Timer callback: the match clock expired. Exported for tests. */
export function finishSnakeOnTimeout(state: SnakeBattleState, ctx: GameContext): void {
  if (state.phase !== 'playing') return;
  state.phase = 'finished';
  state.finishReason = 'timeout';
  state.lastEvent = 'timeout';
  ctx.markStateChanged();
  ctx.finish('timeout');
}

function endIfOver(state: SnakeBattleState, ctx: GameContext): void {
  if (state.phase !== 'playing') return;
  if (aliveCount(state) === 0) {
    state.phase = 'finished';
    state.finishReason = 'completed';
    state.lastEvent = 'all-dead';
    ctx.markStateChanged();
    ctx.finish('completed');
  }
}

/* ------------------------------------------------------------------ */
/* AI                                                                  */
/* ------------------------------------------------------------------ */

function cellBlocked(state: SnakeBattleState, x: number, y: number, ignoreTailOf: string): boolean {
  if (x < 0 || y < 0 || x >= state.cols || y >= state.rows) return true;
  for (const [id, snake] of Object.entries(state.snakes)) {
    if (!snake.alive) continue;
    const body = snake.body.slice();
    if (id === ignoreTailOf && snake.growPending === 0) body.pop(); // own tail vacates
    if (body.some((cell) => cell.x === x && cell.y === y)) return true;
  }
  return false;
}

function safeFollowUps(
  state: SnakeBattleState,
  playerId: string,
  from: SnakeSegment,
): number {
  let safe = 0;
  for (const direction of ALL_DIRECTIONS) {
    const delta = DIRECTIONS[direction];
    if (!cellBlocked(state, from.x + delta.dx, from.y + delta.dy, playerId)) safe += 1;
  }
  return safe;
}

/** Greedy-safe AI steering: never immediately fatal, prefers food. */
export function chooseAIDirection(
  state: SnakeBattleState,
  playerId: string,
  difficulty: AIDifficulty,
  rng: () => number,
): SnakeDirection | null {
  const snake = state.snakes[playerId];
  if (!snake || !snake.alive) return null;

  const options = ALL_DIRECTIONS.filter(
    (direction) => direction !== snake.direction && !isReverse(snake.direction, direction),
  );
  const candidates = [snake.direction, ...options].filter((direction) => {
    const delta = DIRECTIONS[direction];
    return !cellBlocked(state, snake.body[0]!.x + delta.dx, snake.body[0]!.y + delta.dy, playerId);
  });
  if (candidates.length === 0) return snake.direction; // doomed — keep sliding

  if (difficulty === 'easy' && rng() < 0.3) {
    return candidates[Math.floor(rng() * candidates.length)]!;
  }

  const head = snake.body[0]!;
  const nearestFood = state.foods.reduce<SnakeFood | null>((best, food) => {
    const distance = Math.abs(food.x - head.x) + Math.abs(food.y - head.y);
    const bestDistance = best ? Math.abs(best.x - head.x) + Math.abs(best.y - head.y) : Infinity;
    return distance < bestDistance ? food : best;
  }, null);

  const score = (direction: SnakeDirection): number => {
    const delta = DIRECTIONS[direction];
    const next = { x: head.x + delta.dx, y: head.y + delta.dy };
    let value = 0;
    if (nearestFood) {
      const current = Math.abs(nearestFood.x - head.x) + Math.abs(nearestFood.y - head.y);
      const after = Math.abs(nearestFood.x - next.x) + Math.abs(nearestFood.y - next.y);
      value += (current - after) * 10;
    }
    if (difficulty !== 'easy') {
      const exits = safeFollowUps(state, playerId, next);
      value += difficulty === 'hard' ? exits * 6 : exits * 3;
    }
    return value + rng() * 2;
  };

  return candidates.reduce((best, current) => (score(current) > score(best) ? current : best))!;
}

/* ------------------------------------------------------------------ */
/* Module                                                              */
/* ------------------------------------------------------------------ */

export const snakeBattleGame: GameModule<SnakeBattleState> = {
  metadata: SNAKE_BATTLE_METADATA,

  initialize(_config: GameConfig): void {
    // Stateless module.
  },

  createInitialState(players, _config): SnakeBattleState {
    return {
      phase: 'idle',
      cols: COLS,
      rows: ROWS,
      snakes: Object.fromEntries(
        players.map((player, index) => {
          const left = index % 2 === 0;
          const y = Math.floor(ROWS / 2);
          return [
            player.id,
            {
              body: left
                ? [{ x: 4, y }, { x: 3, y }, { x: 2, y }]
                : [{ x: COLS - 5, y }, { x: COLS - 4, y }, { x: COLS - 3, y }],
              direction: left ? 'right' : 'left',
              pendingDirection: null,
              alive: false,
              deathStep: null,
              diedAt: null,
              score: 0,
              foodEaten: 0,
              growPending: 0,
              disconnected: false,
              left: false,
            } satisfies SnakePlayerState,
          ];
        }),
      ),
      foods: [],
      stepMs: STEP_MS,
      stepIndex: 0,
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
    if (!state.snakes[player.id]) {
      state.snakes[player.id] = {
        body: [{ x: 1, y: 1 }],
        direction: 'right',
        pendingDirection: null,
        alive: false,
        deathStep: null,
        diedAt: null,
        score: 0,
        foodEaten: 0,
        growPending: 0,
        disconnected: false,
        left: false,
      };
    }
  },

  playerReady(): void {
    // No per-player readiness behaviour.
  },

  playerLeft(playerId, state, ctx, reason): void {
    const snake = state.snakes[playerId];
    if (!snake) return;
    if (reason === 'disconnect') {
      // Keep sliding straight during the grace period (no turns accepted).
      snake.disconnected = true;
      return;
    }
    if (snake.alive) {
      snake.alive = false;
      snake.deathStep = state.stepIndex;
      snake.diedAt = ctx.now();
      snake.left = true;
      state.lastEvent = `left:${playerId}`;
      endIfOver(state, ctx);
    }
    snake.left = true;
  },

  start(state, ctx): void {
    if (state.phase === 'playing') return;
    state.snakes = {};
    ctx.players.forEach((player, index) => {
      const left = index % 2 === 0;
      const y = Math.floor(ROWS / 2);
      state.snakes[player.id] = {
        body: left
          ? [{ x: 4, y }, { x: 3, y }, { x: 2, y }]
          : [{ x: COLS - 5, y }, { x: COLS - 4, y }, { x: COLS - 3, y }],
        direction: left ? 'right' : 'left',
        pendingDirection: null,
        alive: true,
        deathStep: null,
        diedAt: null,
        score: 0,
        foodEaten: 0,
        growPending: 0,
        disconnected: false,
        left: false,
      };
    });

    state.foods = [];
    state.stepIndex = 0;
    state.accumulatorMs = 0;
    state.phase = 'playing';
    state.startedAt = ctx.now();
    state.endsAt = state.startedAt + state.durationMs;
    state.finishReason = null;
    state.lastEvent = 'start';
    state.nextAIRequestAt = {};
    while (state.foods.length < FOOD_COUNT) spawnFood(state, ctx);
    ctx.markStateChanged();

    ctx.schedule(
      state.durationMs,
      () => finishSnakeOnTimeout(state, ctx),
      'gameDuration',
      'match-timeout',
    );
  },

  validateAction(playerId, action, state): ValidationResult {
    if (action.type !== 'turn') return { valid: false, reason: 'Unknown action.' };
    const direction = action.payload?.direction;
    if (!isSnakeDirection(direction)) {
      return { valid: false, reason: 'Invalid direction — use up, down, left or right.' };
    }
    if (state.phase !== 'playing') return { valid: false, reason: 'The match is not running.' };
    const snake = state.snakes[playerId];
    if (!snake) return { valid: false, reason: 'You are not part of this match.' };
    if (!snake.alive) return { valid: false, reason: 'Your snake is out.' };
    // Validated against the QUEUED direction so two quick turns cannot reverse.
    const effective = snake.pendingDirection ?? snake.direction;
    if (isReverse(effective, direction)) {
      return { valid: false, reason: 'A snake cannot reverse into itself.' };
    }
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state, _ctx): ActionResult {
    if (action.type !== 'turn') return actionRejected('Unknown action.');
    const direction = action.payload?.direction;
    if (!isSnakeDirection(direction)) return actionRejected('Invalid direction.');
    const snake = state.snakes[playerId];
    if (!snake) return actionRejected('You are not part of this match.');
    if (!snake.alive) return actionRejected('Your snake is out.');
    const effective = snake.pendingDirection ?? snake.direction;
    if (isReverse(effective, direction)) {
      return actionRejected('A snake cannot reverse into itself.');
    }
    snake.pendingDirection = direction;
    return actionAccepted(false); // applied on the next server step
  },

  /** Fixed-step simulation driven by the platform tick loop. */
  update(state, deltaTimeMs, ctx): void {
    if (state.phase !== 'playing') return;

    // Ask AI seats to steer periodically (same pipeline as humans).
    for (const player of ctx.players) {
      if (!player.isAI) continue;
      const snake = state.snakes[player.id];
      if (!snake?.alive) continue;
      const now = ctx.now();
      if (now >= (state.nextAIRequestAt[player.id] ?? 0)) {
        ctx.requestAI(player.id, 60);
        state.nextAIRequestAt[player.id] = now + AI_REQUEST_INTERVAL_MS;
      }
    }

    state.accumulatorMs += deltaTimeMs;
    let guard = 0;
    while (state.accumulatorMs >= state.stepMs && state.phase === 'playing' && guard < 4) {
      state.accumulatorMs -= state.stepMs;
      guard += 1;
      const outcome = stepSnakes(state, ctx);
      if (outcome.deaths.length > 0 || outcome.ate.length > 0) {
        ctx.markStateChanged();
        endIfOver(state, ctx);
      }
    }
  },

  tick(): void {
    // Handled by update().
  },

  calculateScore(playerId, state): number {
    return state.snakes[playerId]?.score ?? 0;
  },

  checkWinCondition(state): string[] | null {
    if (state.phase !== 'finished') return null;
    return computeSnakeWinners(state);
  },

  checkDrawCondition(state): boolean {
    if (state.phase !== 'finished') return false;
    return computeSnakeWinners(state).length > 1;
  },

  isGameFinished(state): boolean {
    return state.phase === 'finished';
  },

  finish(state): void {
    state.phase = 'finished';
  },

  getResult(state, ctx): GameResultDraft {
    // Ranking: alive beats dead; later death beats earlier death; then score.
    const survivalStep = (id: string): number => {
      const snake = state.snakes[id];
      if (!snake) return -1;
      if (snake.alive) return Number.MAX_SAFE_INTEGER;
      return snake.deathStep ?? -1;
    };
    const ranked = [...ctx.players].sort((a, b) => {
      const survivalDiff = survivalStep(b.id) - survivalStep(a.id);
      if (survivalDiff !== 0) return survivalDiff;
      const scoreDiff = (state.snakes[b.id]?.score ?? 0) - (state.snakes[a.id]?.score ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
      return a.seatIndex - b.seatIndex;
    });

    const bestSurvival = ranked.length > 0 ? survivalStep(ranked[0]!.id) : -1;
    const bestScore = ranked.length > 0 ? (state.snakes[ranked[0]!.id]?.score ?? 0) : 0;
    const winners = ranked
      .filter(
        (player) =>
          survivalStep(player.id) === bestSurvival &&
          (state.snakes[player.id]?.score ?? 0) === bestScore,
      )
      .map((player) => player.id);

    const rankings: RankingDraft[] = ranked.map((player, index) => {
      const snake = state.snakes[player.id];
      return {
        playerId: player.id,
        rank: index + 1,
        score: snake?.score ?? 0,
        isWinner: winners.includes(player.id),
        isDraw: winners.length > 1,
        stats: {
          survivedSteps: snake?.alive ? state.stepIndex : (snake?.deathStep ?? 0),
          food: snake?.foodEaten ?? 0,
          alive: snake?.alive ? 1 : 0,
        },
      };
    });

    return {
      winners,
      isDraw: winners.length > 1,
      rankings,
      reason: state.finishReason ?? 'completed',
    };
  },

  reset(state): SnakeBattleState {
    const seats = Object.keys(state.snakes);
    return {
      ...state,
      phase: 'idle',
      snakes: Object.fromEntries(
        seats.map((playerId) => {
          const snake = state.snakes[playerId]!;
          return [
            playerId,
            {
              ...snake,
              body: [{ x: 1, y: 1 }],
              direction: 'right',
              pendingDirection: null,
              alive: false,
              deathStep: null,
              diedAt: null,
              score: 0,
              foodEaten: 0,
              growPending: 0,
              disconnected: false,
              left: false,
            } satisfies SnakePlayerState,
          ];
        }),
      ),
      foods: [],
      stepIndex: 0,
      accumulatorMs: 0,
      startedAt: null,
      endsAt: null,
      finishReason: null,
      lastEvent: null,
      nextAIRequestAt: {},
    };
  },

  cleanup(state): void {
    state.snakes = {};
    state.foods = [];
    state.phase = 'finished';
  },

  /** Both snakes + food are public — it is an open arena duel. */
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
      foods: state.foods.map((food) => ({ ...food })),
      snakes: Object.fromEntries(
        ctx.players.map((player) => {
          const snake = state.snakes[player.id];
          return [
            player.id,
            snake
              ? {
                  body: snake.body.map((segment) => ({ ...segment })),
                  direction: snake.direction,
                  alive: snake.alive,
                  score: snake.score,
                  foodEaten: snake.foodEaten,
                  disconnected: snake.disconnected,
                }
              : null,
          ];
        }),
      ),
    };
  },

  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'playing') return null;
    const snake = state.snakes[playerId];
    if (!snake?.alive) return null;
    const direction = chooseAIDirection(state, playerId, difficulty, ctx.random);
    if (!direction) return null;
    if (direction === snake.direction && (snake.pendingDirection ?? snake.direction) === direction) {
      return null; // nothing to submit
    }
    return { type: 'turn', payload: { direction } };
  },

  needsUpdateLoop: true,
  maxDurationMs: 8 * 60 * 1000,
};

/** Winner set from raw state (used by checkWin/checkDraw without a context). */
function computeSnakeWinners(state: SnakeBattleState): string[] {
  const entries = Object.entries(state.snakes);
  if (entries.length === 0) return [];
  const survivalStep = (snake: SnakePlayerState): number =>
    snake.alive ? Number.MAX_SAFE_INTEGER : (snake.deathStep ?? -1);
  const bestSurvival = Math.max(...entries.map(([, snake]) => survivalStep(snake)));
  const contenders = entries.filter(([, snake]) => survivalStep(snake) === bestSurvival);
  const bestScore = Math.max(...contenders.map(([, snake]) => snake.score));
  return contenders.filter(([, snake]) => snake.score === bestScore).map(([id]) => id);
}
