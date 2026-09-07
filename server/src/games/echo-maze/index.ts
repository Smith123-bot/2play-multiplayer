import type { AIDifficulty, GameAction, GameFinishReason } from '@2play/shared';
import { ECHO_MAZE_METADATA } from '@2play/shared';
export { ECHO_MAZE_METADATA };
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
 * Echo Maze — preview the labyrinth, then race through fog.
 * Walls stay real on the server. Clients never submit a finish or a path.
 */

export type EchoPhase = 'idle' | 'preview' | 'playing' | 'between' | 'finished';
export type EchoDirection = 'up' | 'down' | 'left' | 'right';

export interface EchoRunner {
  x: number;
  y: number;
  startX: number;
  startY: number;
  score: number;
  checkpoints: number;
  finished: boolean;
  finishMs: number | null;
  trail: Array<{ x: number; y: number }>;
  visited: string[];
  disconnected: boolean;
  left: boolean;
}

export interface EchoState {
  phase: EchoPhase;
  round: number;
  totalRounds: number;
  cols: number;
  rows: number;
  walls: boolean[];
  fog: boolean[];
  layoutId: number;
  goal: { x: number; y: number };
  checkpoints: Array<{ x: number; y: number }>;
  runners: Record<string, EchoRunner>;
  startedAt: number | null;
  endsAt: number | null;
  durationMs: number;
  finishReason: GameFinishReason | null;
  lastEvent: string | null;
  nextAIRequestAt: Record<string, number>;
}

export const ECHO_COLS = 11;
export const ECHO_ROWS = 11;
export const ECHO_LAYOUTS = 10;
export const PREVIEW_MS = 4_000;
export const ROUND_MS = 45_000;
export const ECHO_TRAIL = 8;
export const SCORE_FINISH = 100;
export const SCORE_CHECKPOINT = 50;

const DELTA: Record<EchoDirection, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};
const ALL_DIRS: EchoDirection[] = ['up', 'down', 'left', 'right'];
const AI_INTERVAL: Record<AIDifficulty, number> = { easy: 420, medium: 220, hard: 110 };

export function isEchoDirection(value: unknown): value is EchoDirection {
  return value === 'up' || value === 'down' || value === 'left' || value === 'right';
}

export function createEchoRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateEchoMaze(
  seed: number,
): { walls: boolean[]; fog: boolean[]; goal: { x: number; y: number }; checkpoints: Array<{ x: number; y: number }>; layoutId: number } {
  const cols = ECHO_COLS;
  const rows = ECHO_ROWS;
  const layoutId = Math.abs(seed) % ECHO_LAYOUTS;
  const rng = createEchoRandom(seed);
  const walls = Array<boolean>(cols * rows).fill(true);
  const at = (x: number, y: number) => y * cols + x;
  const cellCols = (cols - 1) / 2;
  const cellRows = (rows - 1) / 2;
  const visited = new Set<string>();
  const stack: Array<{ cx: number; cy: number }> = [{ cx: 0, cy: 0 }];
  visited.add('0,0');
  walls[at(1, 1)] = false;

  while (stack.length > 0) {
    const current = stack[stack.length - 1]!;
    const neighbours = [
      { cx: current.cx, cy: current.cy - 1 },
      { cx: current.cx, cy: current.cy + 1 },
      { cx: current.cx - 1, cy: current.cy },
      { cx: current.cx + 1, cy: current.cy },
    ].filter(
      (candidate) =>
        candidate.cx >= 0 &&
        candidate.cy >= 0 &&
        candidate.cx < cellCols &&
        candidate.cy < cellRows &&
        !visited.has(`${candidate.cx},${candidate.cy}`),
    );
    if (neighbours.length === 0) {
      stack.pop();
      continue;
    }
    const next = neighbours[Math.floor(rng() * neighbours.length)]!;
    walls[at(1 + current.cx * 2 + (next.cx - current.cx), 1 + current.cy * 2 + (next.cy - current.cy))] = false;
    walls[at(1 + next.cx * 2, 1 + next.cy * 2)] = false;
    visited.add(`${next.cx},${next.cy}`);
    stack.push(next);
  }

  const braid = 0.2 + layoutId * 0.05;
  for (let y = 1; y < rows - 1; y += 1) {
    for (let x = 1; x < cols - 1; x += 1) {
      if (walls[at(x, y)] && rng() < braid * 0.15) walls[at(x, y)] = false;
    }
  }

  const goal = { x: cols - 2, y: rows - 2 };
  walls[at(goal.x, goal.y)] = false;
  walls[at(1, 1)] = false;

  const floors: Array<{ x: number; y: number }> = [];
  for (let y = 1; y < rows - 1; y += 1) {
    for (let x = 1; x < cols - 1; x += 1) {
      if (!walls[at(x, y)]) floors.push({ x, y });
    }
  }
  const candidates = floors.filter(
    (pick) => !((pick.x === 1 && pick.y === 1) || (pick.x === goal.x && pick.y === goal.y)),
  );
  for (let i = candidates.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const swap = candidates[i]!;
    candidates[i] = candidates[j]!;
    candidates[j] = swap;
  }
  const checkpoints = candidates.slice(0, 2).map((cell) => ({ ...cell }));

  const fog = walls.map((wall, index) => {
    if (!wall) return false;
    const x = index % cols;
    const y = Math.floor(index / cols);
    if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) return false;
    return rng() < 0.35 + layoutId * 0.02;
  });

  return { walls, fog, goal, checkpoints, layoutId };
}

export function canWalk(state: EchoState, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= state.cols || y >= state.rows) return false;
  return !state.walls[y * state.cols + x];
}

function makeRunner(x: number, y: number): EchoRunner {
  return {
    x,
    y,
    startX: x,
    startY: y,
    score: 0,
    checkpoints: 0,
    finished: false,
    finishMs: null,
    trail: [{ x, y }],
    visited: [`${x},${y}`],
    disconnected: false,
    left: false,
  };
}

function startsFor(count: number): Array<{ x: number; y: number }> {
  const pool = [
    { x: 1, y: 1 },
    { x: 1, y: ECHO_ROWS - 2 },
    { x: ECHO_COLS - 2, y: 1 },
    { x: 3, y: 1 },
  ];
  return pool.slice(0, count);
}

export function finishEcho(state: EchoState, ctx: GameContext, reason: GameFinishReason): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.finishReason = reason;
  state.lastEvent = reason === 'timeout' ? 'timeout' : 'finished';
  ctx.markStateChanged();
  ctx.finish(reason);
}

export function beginEchoRound(state: EchoState, ctx: GameContext, round: number): void {
  const maze = generateEchoMaze(ctx.seed + round * 97);
  state.round = round;
  state.walls = maze.walls;
  state.fog = maze.fog;
  state.layoutId = maze.layoutId;
  state.goal = maze.goal;
  state.checkpoints = maze.checkpoints;
  for (const start of startsFor(4)) {
    state.walls[start.y * state.cols + start.x] = false;
  }
  state.walls[state.goal.y * state.cols + state.goal.x] = false;
  const seats = Object.keys(state.runners);
  const starts = startsFor(seats.length);
  seats.forEach((id, index) => {
    const start = starts[index] ?? { x: 1, y: 1 };
    const previous = state.runners[id]!;
    state.runners[id] = {
      ...makeRunner(start.x, start.y),
      score: previous.score,
      disconnected: previous.disconnected,
      left: previous.left,
    };
  });
  state.phase = 'preview';
  state.durationMs = ROUND_MS;
  state.endsAt = ctx.now() + PREVIEW_MS;
  state.lastEvent = 'preview';
  ctx.markStateChanged();
  ctx.schedule(PREVIEW_MS, () => openEchoRound(state, ctx), 'turn', 'preview');
}

export function openEchoRound(state: EchoState, ctx: GameContext): void {
  if (state.phase !== 'preview') return;
  state.phase = 'playing';
  state.startedAt = ctx.now();
  state.endsAt = state.startedAt + ROUND_MS;
  state.lastEvent = 'round-start';
  ctx.markStateChanged();
  ctx.schedule(ROUND_MS, () => endEchoRound(state, ctx), 'turn', 'round-timeout');
  for (const player of ctx.players) {
    if (player.isAI) ctx.requestAI(player.id, 80);
  }
}

export function endEchoRound(state: EchoState, ctx: GameContext): void {
  if (state.phase !== 'playing' && state.phase !== 'preview') return;
  if (state.round + 1 >= state.totalRounds) {
    finishEcho(state, ctx, 'completed');
    return;
  }
  state.phase = 'between';
  state.lastEvent = 'round-end';
  ctx.markStateChanged();
  ctx.schedule(1_000, () => beginEchoRound(state, ctx, state.round + 1), 'turn', 'next-round');
}

function bfsStep(state: EchoState, from: { x: number; y: number }, target: { x: number; y: number }): EchoDirection | null {
  const key = (x: number, y: number) => `${x},${y}`;
  const dist = new Map<string, number>();
  const queue = [target];
  dist.set(key(target.x, target.y), 0);
  while (queue.length > 0) {
    const cell = queue.shift()!;
    const here = dist.get(key(cell.x, cell.y)) ?? 0;
    for (const direction of ALL_DIRS) {
      const nx = cell.x + DELTA[direction].dx;
      const ny = cell.y + DELTA[direction].dy;
      if (!canWalk(state, nx, ny)) continue;
      const id = key(nx, ny);
      if (dist.has(id)) continue;
      dist.set(id, here + 1);
      queue.push({ x: nx, y: ny });
    }
  }
  const origin = dist.get(key(from.x, from.y));
  if (origin === undefined) return null;
  let best: EchoDirection | null = null;
  let bestDist = origin;
  for (const direction of ALL_DIRS) {
    const nx = from.x + DELTA[direction].dx;
    const ny = from.y + DELTA[direction].dy;
    if (!canWalk(state, nx, ny)) continue;
    const d = dist.get(key(nx, ny));
    if (d !== undefined && d < bestDist) {
      bestDist = d;
      best = direction;
    }
  }
  return best;
}

export const echoMazeGame: GameModule<EchoState> = {
  metadata: ECHO_MAZE_METADATA,

  initialize(): void {
    // Stateless module.
  },

  createInitialState(players, config): EchoState {
    const maze = generateEchoMaze(1);
    const starts = startsFor(players.length);
    return {
      phase: 'idle',
      round: 0,
      totalRounds: typeof config.rounds === 'number' ? Math.min(4, Math.max(1, config.rounds)) : 2,
      cols: ECHO_COLS,
      rows: ECHO_ROWS,
      walls: maze.walls,
      fog: maze.fog,
      layoutId: maze.layoutId,
      goal: maze.goal,
      checkpoints: maze.checkpoints,
      runners: Object.fromEntries(players.map((player, index) => [player.id, makeRunner(starts[index]!.x, starts[index]!.y)])),
      startedAt: null,
      endsAt: null,
      durationMs: ROUND_MS,
      finishReason: null,
      lastEvent: null,
      nextAIRequestAt: {},
    };
  },

  playerJoined(player, state): void {
    const existing = state.runners[player.id];
    if (existing) {
      existing.disconnected = false;
      return;
    }
    state.runners[player.id] = makeRunner(1, 1);
  },

  playerReady(): void {
    // Lobby concern.
  },

  playerLeft(playerId, state, ctx, reason): void {
    const runner = state.runners[playerId];
    if (!runner) return;
    if (reason === 'disconnect') {
      runner.disconnected = true;
      return;
    }
    runner.left = true;
    const remaining = Object.values(state.runners).filter((entry) => !entry.left);
    if (remaining.length <= 1) finishEcho(state, ctx, 'abandoned');
  },

  start(state, ctx): void {
    if (state.phase === 'playing' || state.phase === 'preview') return;
    state.totalRounds = typeof ctx.config.rounds === 'number' ? Math.min(4, Math.max(1, ctx.config.rounds)) : 2;
    ctx.players.forEach((player, index) => {
      const start = startsFor(ctx.players.length)[index] ?? { x: 1, y: 1 };
      state.runners[player.id] = makeRunner(start.x, start.y);
    });
    beginEchoRound(state, ctx, 0);
    ctx.schedule(state.totalRounds * (PREVIEW_MS + ROUND_MS + 2_000), () => finishEcho(state, ctx, 'timeout'), 'gameDuration', 'match-timeout');
  },

  validateAction(playerId, action, state): ValidationResult {
    if (action.type === 'finish' || action.type === 'path' || action.type === 'score') {
      return { valid: false, reason: 'The server owns the maze and the finish.' };
    }
    if (action.type !== 'move') return { valid: false, reason: 'Unknown action.' };
    if (!isEchoDirection(action.payload?.direction)) return { valid: false, reason: 'Use up, down, left or right.' };
    if (state.phase !== 'playing') return { valid: false, reason: 'Wait for the maze to hide.' };
    const runner = state.runners[playerId];
    if (!runner || runner.left || runner.finished) return { valid: false, reason: 'You cannot move.' };
    if (runner.disconnected) return { valid: false, reason: 'Reconnect to keep moving.' };
    const { dx, dy } = DELTA[action.payload.direction];
    if (!canWalk(state, runner.x + dx, runner.y + dy)) return { valid: false, reason: 'A wall blocks that way.' };
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    if (action.type !== 'move') return actionRejected('The server owns the maze and the finish.');
    const direction = action.payload?.direction;
    if (!isEchoDirection(direction)) return actionRejected('Invalid direction.');
    const runner = state.runners[playerId];
    if (!runner || state.phase !== 'playing' || runner.finished || runner.left) return actionRejected('You cannot move.');
    const { dx, dy } = DELTA[direction];
    const nx = runner.x + dx;
    const ny = runner.y + dy;
    if (!canWalk(state, nx, ny)) return actionRejected('A wall blocks that way.');
    runner.x = nx;
    runner.y = ny;
    runner.visited.push(`${nx},${ny}`);
    runner.trail.push({ x: nx, y: ny });
    if (runner.trail.length > ECHO_TRAIL) runner.trail.shift();
    const check = state.checkpoints.find((entry) => entry.x === nx && entry.y === ny);
    const seen = runner.visited.filter((key) => key === `${nx},${ny}`).length;
    if (check && seen === 1) {
      runner.checkpoints += 1;
      runner.score += SCORE_CHECKPOINT;
      state.lastEvent = `checkpoint:${playerId}`;
    } else {
      state.lastEvent = `move:${playerId}`;
    }
    if (nx === state.goal.x && ny === state.goal.y && !runner.finished) {
      runner.finished = true;
      runner.finishMs = ctx.now() - (state.startedAt ?? ctx.now());
      const remain = Math.max(0, (state.endsAt ?? ctx.now()) - ctx.now());
      runner.score += SCORE_FINISH + Math.floor(remain / 200);
      state.lastEvent = `finish:${playerId}`;
    }
    ctx.markStateChanged();
    const active = Object.values(state.runners).filter((entry) => !entry.left);
    if (active.length > 0 && active.every((entry) => entry.finished)) endEchoRound(state, ctx);
    return actionAccepted();
  },

  update(state, _delta, ctx): void {
    if (state.phase !== 'playing') return;
    for (const player of ctx.players) {
      if (!player.isAI) continue;
      const runner = state.runners[player.id];
      if (!runner || runner.left || runner.finished) continue;
      const now = ctx.now();
      const difficulty = player.aiDifficulty ?? 'medium';
      if (now >= (state.nextAIRequestAt[player.id] ?? 0)) {
        ctx.requestAI(player.id, 40);
        state.nextAIRequestAt[player.id] = now + AI_INTERVAL[difficulty];
      }
    }
  },

  tick(): void {
    // Handled by update.
  },

  calculateScore(playerId, state): number {
    return state.runners[playerId]?.score ?? 0;
  },

  checkWinCondition(state): string[] | null {
    if (state.phase !== 'finished') return null;
    const entries = Object.entries(state.runners).filter(([, runner]) => !runner.left);
    if (entries.length === 0) return [];
    const best = Math.max(...entries.map(([, runner]) => runner.score));
    return entries.filter(([, runner]) => runner.score === best).map(([id]) => id);
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
    const best = ranked[0] ? state.runners[ranked[0].id]?.score ?? 0 : 0;
    const winners = ranked.filter((player) => (state.runners[player.id]?.score ?? 0) === best).map((player) => player.id);
    const rankings: RankingDraft[] = ranked.map((player, index) => {
      const runner = state.runners[player.id];
      return {
        playerId: player.id,
        rank: index + 1,
        score: runner?.score ?? 0,
        isWinner: winners.includes(player.id),
        isDraw: winners.length > 1,
        stats: { checkpoints: runner?.checkpoints ?? 0, finishMs: runner?.finishMs ?? -1 },
      };
    });
    return { winners, isDraw: winners.length > 1, rankings, reason: state.finishReason ?? 'completed' };
  },

  reset(state): EchoState {
    const ids = Object.keys(state.runners);
    const starts = startsFor(ids.length);
    return {
      ...state,
      phase: 'idle',
      round: 0,
      runners: Object.fromEntries(ids.map((id, index) => [id, makeRunner(starts[index]!.x, starts[index]!.y)])),
      startedAt: null,
      endsAt: null,
      finishReason: null,
      lastEvent: null,
      nextAIRequestAt: {},
    };
  },

  cleanup(state): void {
    state.runners = {};
    state.phase = 'finished';
  },

  getPublicState(state, viewerId, ctx) {
    const preview = state.phase === 'preview';
    const viewer = viewerId ? state.runners[viewerId] : undefined;
    const visited = new Set(viewer?.visited ?? []);
    return {
      phase: state.phase,
      round: state.round,
      totalRounds: state.totalRounds,
      cols: state.cols,
      rows: state.rows,
      layoutId: state.layoutId,
      goal: { ...state.goal },
      checkpoints: state.checkpoints.map((entry) => ({ ...entry })),
      tiles: state.walls.map((wall, index) => {
        if (!wall) return 'floor';
        if (preview) return 'wall';
        if (!state.fog[index]) return 'wall';
        const x = index % state.cols;
        const y = Math.floor(index / state.cols);
        return visited.has(`${x},${y}`) ? 'wall' : 'fog';
      }),
      startedAt: state.startedAt,
      endsAt: state.endsAt,
      finishReason: state.finishReason,
      lastEvent: state.lastEvent,
      serverTime: ctx.now(),
      runners: Object.fromEntries(
        Object.entries(state.runners).map(([id, runner]) => [
          id,
          {
            x: runner.x,
            y: runner.y,
            score: runner.score,
            checkpoints: runner.checkpoints,
            finished: runner.finished,
            trail: runner.trail.map((cell) => ({ ...cell })),
            disconnected: runner.disconnected,
          },
        ]),
      ),
    };
  },

  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'playing') return null;
    const runner = state.runners[playerId];
    if (!runner || runner.finished || runner.left) return null;
    const target = state.checkpoints.find((entry) => !runner.visited.includes(`${entry.x},${entry.y}`)) ?? state.goal;
    const chosen = bfsStep(state, runner, target);
    if (chosen && difficulty !== 'easy') return { type: 'move', payload: { direction: chosen } };
    const legal = ALL_DIRS.filter((direction) => canWalk(state, runner.x + DELTA[direction].dx, runner.y + DELTA[direction].dy));
    if (legal.length === 0) return null;
    if (chosen && ctx.random() > 0.35) return { type: 'move', payload: { direction: chosen } };
    return { type: 'move', payload: { direction: legal[Math.floor(ctx.random() * legal.length)]! } };
  },

  needsUpdateLoop: true,
  maxDurationMs: 6 * 60 * 1000,
};
