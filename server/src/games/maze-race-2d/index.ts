import type { AIDifficulty, GameAction, GameConfig, GameFinishReason } from '@2play/shared';
import { MAZE_RACE_METADATA } from '@2play/shared';
export { MAZE_RACE_METADATA };
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
 * Maze Race 2D — a competitive race through a server-generated maze.
 *
 * The maze (a perfect maze carved by a seeded recursive-backtracker) is
 * generated deterministically from the match seed, so every client renders the
 * exact same labyrinth. Players only send movement intents; the server owns
 * positions, wall collisions, goal detection, timing and ranking.
 */

export type MazePhase = 'idle' | 'playing' | 'finished';
export type MazeDirection = 'up' | 'down' | 'left' | 'right';

export interface MazeRunner {
  x: number;
  y: number;
  startX: number;
  startY: number;
  steps: number;
  finished: boolean;
  /** Time from match start to the goal in ms (server clock). */
  finishMs: number | null;
  disconnected: boolean;
  /** True once the player actually left the match (not just dropped). */
  left: boolean;
  checkpointIndex: number;
  penaltyMs: number;
  hazardHits: string[];
  latestInputSeq: number;
}

export interface MazeRaceState {
  phase: MazePhase;
  cols: number;
  rows: number;
  /** true = wall, false = floor. Public — everyone sees the same maze. */
  walls: boolean[];
  goal: { x: number; y: number };
  runners: Record<string, MazeRunner>;
  /** Arrival order at the goal (rank 1 first). */
  finishOrder: string[];
  startedAt: number | null;
  endsAt: number | null;
  durationMs: number;
  /** Seed used to carve this maze (kept server side). */
  seed: number;
  finishReason: GameFinishReason | null;
  lastEvent: string | null;
  checkpoints: Array<{ x: number; y: number }>;
  hazards: Array<{ x: number; y: number; penaltyMs: number }>;
  courseLevel: number;
  eventCounter: number;
}

const GRIDS: Record<string, { cols: number; rows: number; durationMs: number }> = {
  '11x11': { cols: 11, rows: 11, durationMs: 90 * 1000 },
  '15x15': { cols: 15, rows: 15, durationMs: 120 * 1000 },
  '19x19': { cols: 19, rows: 19, durationMs: 180 * 1000 },
};
const DEFAULT_GRID = '15x15';

function stateLevel(cols: number): number {
  return cols <= 11 ? 1 : cols <= 15 ? 2 : 3;
}

const DELTAS: Record<MazeDirection, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

/** AI pace per difficulty: delay between steps + odds of taking the optimal step. */
const AI_STEP_DELAY: Record<AIDifficulty, number> = { easy: 780, medium: 430, hard: 210 };
const AI_STEP_JITTER: Record<AIDifficulty, number> = { easy: 420, medium: 210, hard: 90 };
const AI_OPTIMAL_CHANCE: Record<AIDifficulty, number> = { easy: 0.3, medium: 0.85, hard: 1 };

export function isMazeDirection(value: unknown): value is MazeDirection {
  return value === 'up' || value === 'down' || value === 'left' || value === 'right';
}

export function gridFor(requested?: string): { cols: number; rows: number; durationMs: number } {
  if (requested && GRIDS[requested]) return GRIDS[requested]!;
  return GRIDS[DEFAULT_GRID]!;
}

/**
 * Deterministic seeded PRNG (mulberry32) — the maze is a pure function of the
 * match seed, so it can be regenerated and verified.
 */
export function createMazeRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Carves a braided maze (recursive backtracker + opened dead ends) on an odd-sized grid. */
export function generateMaze(
  cols: number,
  rows: number,
  rng: () => number,
): { walls: boolean[]; goal: { x: number; y: number } } {
  const walls = Array<boolean>(cols * rows).fill(true);
  const at = (x: number, y: number) => y * cols + x;
  const carve = (x: number, y: number) => {
    walls[at(x, y)] = false;
  };

  const cellCols = (cols - 1) / 2;
  const cellRows = (rows - 1) / 2;
  const visited = new Set<string>();
  const stack: Array<{ cx: number; cy: number }> = [{ cx: 0, cy: 0 }];
  visited.add('0,0');
  carve(1, 1);

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
    // Knock down the wall between the two cells, then floor the destination.
    carve(1 + current.cx * 2 + (next.cx - current.cx), 1 + current.cy * 2 + (next.cy - current.cy));
    carve(1 + next.cx * 2, 1 + next.cy * 2);
    visited.add(`${next.cx},${next.cy}`);
    stack.push(next);
  }

  // Braid: open a second exit through ~35% of the dead ends (never the border).
  // This adds loops and route choice — better for racing, and it widens the
  // BFS distance classes so fair same-distance starts exist.
  for (let y = 1; y < rows - 1; y += 1) {
    for (let x = 1; x < cols - 1; x += 1) {
      if (walls[at(x, y)]) continue;
      const openNeighbours = [
        { x, y: y - 1 },
        { x, y: y + 1 },
        { x: x - 1, y },
        { x: x + 1, y },
      ].filter((cell) => !walls[at(cell.x, cell.y)]);
      if (openNeighbours.length !== 1) continue; // not a dead end
      if (rng() >= 0.35) continue;
      const candidates = [
        { x, y: y - 1 },
        { x, y: y + 1 },
        { x: x - 1, y },
        { x: x + 1, y },
      ].filter(
        (cell) =>
          cell.x > 0 &&
          cell.y > 0 &&
          cell.x < cols - 1 &&
          cell.y < rows - 1 &&
          walls[at(cell.x, cell.y)],
      );
      if (candidates.length === 0) continue;
      const pick = candidates[Math.floor(rng() * candidates.length)]!;
      walls[at(pick.x, pick.y)] = false;
    }
  }

  return { walls, goal: { x: cols - 2, y: rows - 2 } };
}

/** Breadth-first distances from any floor cell to the goal. -1 = unreachable. */
export function distancesToGoal(
  cols: number,
  rows: number,
  walls: boolean[],
  goal: { x: number; y: number },
): number[] {
  const distance = Array<number>(cols * rows).fill(-1);
  const at = (x: number, y: number) => y * cols + x;
  const queue: Array<{ x: number; y: number }> = [goal];
  distance[at(goal.x, goal.y)] = 0;

  while (queue.length > 0) {
    const cell = queue.shift()!;
    const next = [
      { x: cell.x, y: cell.y - 1 },
      { x: cell.x, y: cell.y + 1 },
      { x: cell.x - 1, y: cell.y },
      { x: cell.x + 1, y: cell.y },
    ];
    for (const candidate of next) {
      if (candidate.x < 0 || candidate.y < 0 || candidate.x >= cols || candidate.y >= rows)
        continue;
      const index = at(candidate.x, candidate.y);
      if (walls[index]) continue;
      if (distance[index] !== -1) continue;
      distance[index] = distance[at(cell.x, cell.y)]! + 1;
      queue.push(candidate);
    }
  }
  return distance;
}

/**
 * Picks fair start cells: distinct cells as close to the same distance from
 * the goal as the maze allows (minimal distance spread, preferring the
 * longest race), spread apart from each other so nobody gets a head start.
 */
export function pickStartCells(
  cols: number,
  rows: number,
  walls: boolean[],
  goal: { x: number; y: number },
  distances: number[],
  count: number,
  rng: () => number,
): Array<{ x: number; y: number }> {
  const byDistance = new Map<number, Array<{ x: number; y: number }>>();
  for (let y = 1; y < rows - 1; y += 1) {
    for (let x = 1; x < cols - 1; x += 1) {
      const d = distances[y * cols + x]!;
      if (walls[y * cols + x] || d <= 0) continue;
      const bucket = byDistance.get(d) ?? [];
      bucket.push({ x, y });
      byDistance.set(d, bucket);
    }
  }
  if (byDistance.size === 0) return Array.from({ length: count }, () => ({ x: 1, y: 1 }));

  const classes = [...byDistance.entries()].sort((a, b) => b[0] - a[0]);
  const values = classes.map(([d]) => d);

  // Find the furthest contiguous band of distance classes (spread capped at
  // MAX_START_SPREAD steps) that still holds `count` cells — the longest fair
  // race available. Falls back to the globally smallest spread for tiny mazes.
  const MAX_START_SPREAD = 3;
  let bestPool: Array<{ x: number; y: number }> | null = null;
  for (let top = 0; top < classes.length && !bestPool; top += 1) {
    const pool: Array<{ x: number; y: number }> = [];
    for (let bottom = top; bottom < classes.length; bottom += 1) {
      if (values[top]! - values[bottom]! > MAX_START_SPREAD) break;
      pool.push(...classes[bottom]![1]!);
      if (pool.length >= count) {
        bestPool = [...pool];
        break;
      }
    }
  }
  if (!bestPool) {
    // Relaxation for tiny mazes: any contiguous band, furthest first.
    for (let top = 0; top < classes.length && !bestPool; top += 1) {
      const pool: Array<{ x: number; y: number }> = [];
      for (let bottom = top; bottom < classes.length; bottom += 1) {
        pool.push(...classes[bottom]![1]!);
        if (pool.length >= count) {
          bestPool = [...pool];
          break;
        }
      }
    }
  }
  const pool = bestPool ?? classes.flatMap(([, cells]) => cells);

  // Greedy spread: first random, then always the candidate farthest from the
  // already chosen cells.
  const chosen: Array<{ x: number; y: number }> = [];
  const candidates = [...pool];
  const first = candidates.splice(Math.floor(rng() * candidates.length), 1)[0]!;
  chosen.push(first);

  while (chosen.length < count && candidates.length > 0) {
    let bestIndex = 0;
    let bestScore = -Infinity;
    candidates.forEach((candidate, index) => {
      const minDistance = Math.min(
        ...chosen.map((cell) => Math.abs(cell.x - candidate.x) + Math.abs(cell.y - candidate.y)),
      );
      if (minDistance > bestScore) {
        bestScore = minDistance;
        bestIndex = index;
      }
    });
    chosen.push(candidates.splice(bestIndex, 1)[0]!);
  }

  while (chosen.length < count) chosen.push({ ...chosen[chosen.length - 1]! });
  return chosen;
}

/** Timer callback: the race clock expired. Exported for tests. */
export function buildCourseFeatures(
  cols: number,
  rows: number,
  walls: boolean[],
  goal: { x: number; y: number },
  starts: Array<{ x: number; y: number }>,
  rng: () => number,
): {
  checkpoints: Array<{ x: number; y: number }>;
  hazards: Array<{ x: number; y: number; penaltyMs: number }>;
} {
  const distances = distancesToGoal(cols, rows, walls, goal);
  const maxStartDistance = Math.max(
    ...starts.map((cell) => distances[cell.y * cols + cell.x] ?? 0),
    3,
  );
  const occupied = new Set(starts.map((cell) => `${cell.x},${cell.y}`));
  occupied.add(`${goal.x},${goal.y}`);
  const checkpoints: Array<{ x: number; y: number }> = [];
  for (const ratio of [0.66, 0.33]) {
    const target = Math.round(maxStartDistance * ratio);
    const candidates: Array<{ x: number; y: number }> = [];
    for (let y = 1; y < rows - 1; y += 1)
      for (let x = 1; x < cols - 1; x += 1) {
        const d = distances[y * cols + x] ?? -1;
        if (!walls[y * cols + x] && !occupied.has(`${x},${y}`) && Math.abs(d - target) <= 1)
          candidates.push({ x, y });
      }
    if (candidates.length) {
      const cell = candidates[Math.floor(rng() * candidates.length)]!;
      checkpoints.push(cell);
      occupied.add(`${cell.x},${cell.y}`);
    }
  }
  const floors: Array<{ x: number; y: number }> = [];
  for (let y = 1; y < rows - 1; y += 1)
    for (let x = 1; x < cols - 1; x += 1) {
      if (!walls[y * cols + x] && !occupied.has(`${x},${y}`)) floors.push({ x, y });
    }
  const hazards: Array<{ x: number; y: number; penaltyMs: number }> = [];
  const hazardCount = Math.min(Math.max(2, Math.floor(cols / 5)), floors.length);
  while (hazards.length < hazardCount && floors.length) {
    const [cell] = floors.splice(Math.floor(rng() * floors.length), 1);
    if (cell) hazards.push({ ...cell, penaltyMs: 1_500 });
  }
  return { checkpoints, hazards };
}

export function finishMazeOnTimeout(state: MazeRaceState, ctx: GameContext): void {
  if (state.phase !== 'playing') return;
  state.phase = 'finished';
  state.finishReason = 'timeout';
  state.lastEvent = 'timeout';
  ctx.markStateChanged();
  ctx.finish('timeout');
}

/** True when everyone still in the match has reached the goal. */
export function allActiveRunnersFinished(state: MazeRaceState): boolean {
  const active = Object.entries(state.runners).filter(([, runner]) => !runner.left);
  return active.length > 0 && active.every(([, runner]) => runner.finished);
}

/** Time-bonus score: faster finishers earn more, unfinished players earn 0. */
export function finisherScore(state: MazeRaceState, playerId: string): number {
  const runner = state.runners[playerId];
  if (!runner || !runner.finished || runner.finishMs === null) return 0;
  return Math.round(Math.max(0, state.durationMs - runner.finishMs) / 100) + 1;
}

/** Next step towards the goal along the shortest path (greedy on BFS dist). */
function optimalDirection(state: MazeRaceState, runner: MazeRunner): MazeDirection | null {
  const target = state.checkpoints[runner.checkpointIndex] ?? state.goal;
  const distances = distancesToGoal(state.cols, state.rows, state.walls, target);
  const here = distances[runner.y * state.cols + runner.x] ?? -1;
  let best: MazeDirection | null = null;
  let bestDistance = here;
  for (const direction of Object.keys(DELTAS) as MazeDirection[]) {
    const { dx, dy } = DELTAS[direction]!;
    const nx = runner.x + dx;
    const ny = runner.y + dy;
    if (nx < 0 || ny < 0 || nx >= state.cols || ny >= state.rows) continue;
    if (state.walls[ny * state.cols + nx]) continue;
    const distance = distances[ny * state.cols + nx] ?? -1;
    if (distance >= 0 && distance < bestDistance) {
      bestDistance = distance;
      best = direction;
    }
  }
  return best;
}

function legalDirections(state: MazeRaceState, runner: MazeRunner): MazeDirection[] {
  return (Object.keys(DELTAS) as MazeDirection[]).filter((direction) => {
    const { dx, dy } = DELTAS[direction]!;
    const nx = runner.x + dx;
    const ny = runner.y + dy;
    return (
      nx >= 0 && ny >= 0 && nx < state.cols && ny < state.rows && !state.walls[ny * state.cols + nx]
    );
  });
}

function canMoveTo(state: MazeRaceState, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= state.cols || y >= state.rows) return false;
  return !state.walls[y * state.cols + x];
}

export const mazeRaceGame: GameModule<MazeRaceState> = {
  metadata: MAZE_RACE_METADATA,

  initialize(_config: GameConfig): void {
    // Stateless module.
  },

  createInitialState(players, config): MazeRaceState {
    const { cols, rows, durationMs } = gridFor(config.gridSize);
    return {
      phase: 'idle',
      cols,
      rows,
      walls: Array<boolean>(cols * rows).fill(true),
      goal: { x: cols - 2, y: rows - 2 },
      runners: Object.fromEntries(
        players.map((player) => [
          player.id,
          {
            x: 1,
            y: 1,
            startX: 1,
            startY: 1,
            steps: 0,
            finished: false,
            finishMs: null,
            disconnected: false,
            left: false,
            checkpointIndex: 0,
            penaltyMs: 0,
            hazardHits: [],
            latestInputSeq: -1,
          },
        ]),
      ),
      finishOrder: [],
      startedAt: null,
      endsAt: null,
      durationMs,
      seed: 0,
      finishReason: null,
      lastEvent: null,
      checkpoints: [],
      hazards: [],
      courseLevel: stateLevel(cols),
      eventCounter: 0,
    };
  },

  playerJoined(player, state): void {
    if (!state.runners[player.id]) {
      // Late joiners enter at the first floor cell; they never win by joining.
      state.runners[player.id] = {
        x: 1,
        y: 1,
        startX: 1,
        startY: 1,
        steps: 0,
        finished: false,
        finishMs: null,
        disconnected: false,
        left: false,
        checkpointIndex: 0,
        penaltyMs: 0,
        hazardHits: [],
        latestInputSeq: -1,
      };
    }
  },

  playerReady(): void {
    // No per-player readiness behaviour.
  },

  playerLeft(playerId, state, ctx, reason): void {
    const runner = state.runners[playerId];
    if (!runner) return;
    if (reason === 'disconnect') {
      // Keep the seat during the grace period.
      runner.disconnected = true;
      return;
    }
    runner.left = true;
    runner.disconnected = false;
    state.lastEvent = `left:${playerId}`;

    const activeLeft = Object.values(state.runners).filter((entry) => !entry.left).length;
    if (state.phase === 'playing' && (allActiveRunnersFinished(state) || activeLeft === 0)) {
      state.phase = 'finished';
      state.finishReason = 'completed';
      ctx.markStateChanged();
      ctx.finish('completed');
    }
  },

  start(state, ctx): void {
    if (state.phase === 'playing') return;

    // Deterministic maze for this match, seeded by the server.
    const seed = ctx.seed;
    const rng = createMazeRandom(seed);
    const { walls, goal } = generateMaze(state.cols, state.rows, rng);
    state.walls = walls;
    state.goal = goal;
    state.seed = seed;

    const distances = distancesToGoal(state.cols, state.rows, walls, goal);
    const seats = ctx.players;
    const starts = pickStartCells(
      state.cols,
      state.rows,
      walls,
      goal,
      distances,
      seats.length,
      rng,
    );
    const features = buildCourseFeatures(state.cols, state.rows, walls, goal, starts, rng);
    state.checkpoints = features.checkpoints;
    state.hazards = features.hazards;
    state.eventCounter = 0;

    state.runners = {};
    seats.forEach((player, index) => {
      const start = starts[index] ?? { x: 1, y: 1 };
      state.runners[player.id] = {
        x: start.x,
        y: start.y,
        startX: start.x,
        startY: start.y,
        steps: 0,
        finished: false,
        finishMs: null,
        disconnected: false,
        left: false,
        checkpointIndex: 0,
        penaltyMs: 0,
        hazardHits: [],
        latestInputSeq: -1,
      };
    });

    state.finishOrder = [];
    state.phase = 'playing';
    state.startedAt = ctx.now();
    state.endsAt = state.startedAt + state.durationMs;
    state.finishReason = null;
    state.lastEvent = 'start';
    ctx.markStateChanged();

    ctx.schedule(
      state.durationMs,
      () => finishMazeOnTimeout(state, ctx),
      'gameDuration',
      'match-timeout',
    );
  },

  validateAction(playerId, action, state): ValidationResult {
    if (action.type !== 'move') return { valid: false, reason: 'Unknown action.' };
    const direction = action.payload?.direction;
    if (!isMazeDirection(direction)) {
      return { valid: false, reason: 'Invalid direction — use up, down, left or right.' };
    }
    if (state.phase !== 'playing') return { valid: false, reason: 'The race is not running.' };
    const runner = state.runners[playerId];
    if (!runner) return { valid: false, reason: 'You are not part of this race.' };
    if (runner.left) return { valid: false, reason: 'You left this race.' };
    if (runner.finished) return { valid: false, reason: 'You already reached the goal.' };
    const sequence = action.payload?.sequence;
    if (
      sequence !== undefined &&
      (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 0)
    )
      return { valid: false, reason: 'Invalid input sequence.' };
    if (typeof sequence === 'number' && sequence <= runner.latestInputSeq)
      return { valid: false, reason: 'Stale input.' };
    const { dx, dy } = DELTAS[direction];
    if (!canMoveTo(state, runner.x + dx, runner.y + dy)) {
      return { valid: false, reason: 'A wall blocks that way.' };
    }
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    if (action.type !== 'move') return actionRejected('Unknown action.');
    const direction = action.payload?.direction;
    if (!isMazeDirection(direction)) return actionRejected('Invalid direction.');
    const runner = state.runners[playerId];
    if (!runner) return actionRejected('You are not part of this race.');
    if (runner.finished) return actionRejected('You already reached the goal.');
    const sequence = action.payload?.sequence;
    if (
      sequence !== undefined &&
      (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 0)
    )
      return actionRejected('Invalid input sequence.');
    if (typeof sequence === 'number' && sequence <= runner.latestInputSeq)
      return actionRejected('Stale input.');

    const { dx, dy } = DELTAS[direction];
    if (!canMoveTo(state, runner.x + dx, runner.y + dy)) {
      return actionRejected('A wall blocks that way.');
    }

    if (typeof sequence === 'number') runner.latestInputSeq = sequence;
    runner.x += dx;
    runner.y += dy;
    runner.steps += 1;
    state.eventCounter += 1;
    state.lastEvent = `move:${playerId}:${state.eventCounter}`;
    const checkpoint = state.checkpoints[runner.checkpointIndex];
    if (checkpoint && runner.x === checkpoint.x && runner.y === checkpoint.y) {
      runner.checkpointIndex += 1;
      state.eventCounter += 1;
      state.lastEvent = `checkpoint:${playerId}:${runner.checkpointIndex}:${state.eventCounter}`;
    }
    const hazard = state.hazards.find((cell) => cell.x === runner.x && cell.y === runner.y);
    const hazardKey = `${runner.x},${runner.y}`;
    if (hazard && !runner.hazardHits.includes(hazardKey)) {
      runner.hazardHits.push(hazardKey);
      runner.penaltyMs += hazard.penaltyMs;
      state.eventCounter += 1;
      state.lastEvent = `hazard:${playerId}:${hazard.penaltyMs}:${state.eventCounter}`;
    }
    if (
      runner.x === state.goal.x &&
      runner.y === state.goal.y &&
      runner.checkpointIndex >= state.checkpoints.length
    ) {
      runner.finished = true;
      runner.finishMs = ctx.now() - (state.startedAt ?? ctx.now()) + runner.penaltyMs;
      state.finishOrder.push(playerId);
      state.eventCounter += 1;
      state.lastEvent = `finish:${playerId}:${state.eventCounter}`;
    } else if (runner.x === state.goal.x && runner.y === state.goal.y) {
      state.lastEvent = `goal-locked:${playerId}:${state.eventCounter}`;
    }
    ctx.markStateChanged();

    const player = ctx.players.find((candidate) => candidate.id === playerId);
    if (player?.isAI && !runner.finished && state.phase === 'playing') {
      const difficulty = player.aiDifficulty ?? 'medium';
      const delay =
        AI_STEP_DELAY[difficulty] + Math.floor(ctx.random() * AI_STEP_JITTER[difficulty]);
      ctx.requestAI(playerId, delay);
    }

    if (state.phase === 'playing' && allActiveRunnersFinished(state)) {
      state.phase = 'finished';
      state.finishReason = 'completed';
      state.lastEvent = 'all-finished';
      ctx.markStateChanged();
      ctx.finish('completed');
    }

    return actionAccepted();
  },

  update(): void {
    // Event driven movement — no simulation loop.
  },

  tick(): void {
    // Event driven.
  },

  calculateScore(playerId, state): number {
    return finisherScore(state, playerId);
  },

  checkWinCondition(state): string[] | null {
    if (state.phase !== 'finished') return null;
    return state.finishOrder.length > 0 ? [state.finishOrder[0]!] : null;
  },

  checkDrawCondition(): boolean {
    // A race always has a deterministic order of arrival — no draws.
    return false;
  },

  isGameFinished(state): boolean {
    return state.phase === 'finished';
  },

  finish(state): void {
    state.phase = 'finished';
  },

  getResult(state, ctx): GameResultDraft {
    const remaining = (playerId: string): number => {
      const runner = state.runners[playerId];
      if (!runner) return Number.MAX_SAFE_INTEGER;
      if (runner.finished) return 0;
      const target = state.checkpoints[runner.checkpointIndex] ?? state.goal;
      const distances = distancesToGoal(state.cols, state.rows, state.walls, target);
      const distance = distances[runner.y * state.cols + runner.x] ?? Number.MAX_SAFE_INTEGER;
      // Each unvisited checkpoint is a whole course segment, so a runner who
      // skipped checkpoints cannot rank above one who progressed legitimately.
      return (
        distance + (state.checkpoints.length - runner.checkpointIndex) * state.cols * state.rows
      );
    };

    // Finishers first (by arrival), then closeness to the goal, then steps.
    const ranked = [...ctx.players].sort((a, b) => {
      const rankOf = (playerId: string): number => {
        const order = state.finishOrder.indexOf(playerId);
        return order === -1 ? Number.MAX_SAFE_INTEGER : order;
      };
      const aRank = rankOf(a.id);
      const bRank = rankOf(b.id);
      if (aRank !== bRank) return aRank - bRank;
      const remainingDiff = remaining(a.id) - remaining(b.id);
      if (remainingDiff !== 0) return remainingDiff;
      const aSteps = state.runners[a.id]?.steps ?? 0;
      const bSteps = state.runners[b.id]?.steps ?? 0;
      if (aSteps !== bSteps) return bSteps - aSteps;
      return a.seatIndex - b.seatIndex;
    });

    const winners = ranked.length > 0 && state.finishOrder.length > 0 ? [ranked[0]!.id] : [];

    const rankings: RankingDraft[] = ranked.map((player, index) => {
      const runner = state.runners[player.id];
      const score = finisherScore(state, player.id);
      return {
        playerId: player.id,
        rank: index + 1,
        score,
        isWinner: winners.includes(player.id),
        isDraw: false,
        stats: {
          steps: runner?.steps ?? 0,
          finishMs: runner?.finishMs ?? -1,
          checkpoints: runner?.checkpointIndex ?? 0,
          penaltyMs: runner?.penaltyMs ?? 0,
          distanceLeft:
            remaining(player.id) === Number.MAX_SAFE_INTEGER ? -1 : remaining(player.id),
        },
      };
    });

    return { winners, isDraw: false, rankings, reason: state.finishReason ?? 'completed' };
  },

  reset(state): MazeRaceState {
    const seats = Object.keys(state.runners);
    return {
      ...state,
      phase: 'idle',
      walls: Array<boolean>(state.cols * state.rows).fill(true),
      runners: Object.fromEntries(
        seats.map((playerId) => [
          playerId,
          {
            x: 1,
            y: 1,
            startX: 1,
            startY: 1,
            steps: 0,
            finished: false,
            finishMs: null,
            disconnected: false,
            left: false,
            checkpointIndex: 0,
            penaltyMs: 0,
            hazardHits: [],
            latestInputSeq: -1,
          },
        ]),
      ),
      finishOrder: [],
      startedAt: null,
      endsAt: null,
      finishReason: null,
      lastEvent: null,
      checkpoints: [],
      hazards: [],
      eventCounter: 0,
      courseLevel: state.courseLevel,
    };
  },

  cleanup(state): void {
    state.runners = {};
    state.phase = 'finished';
  },

  /**
   * The maze itself is public (everyone races in the same labyrinth), but the
   * generation seed and internal flags stay server side.
   */
  getPublicState(state, _viewerId, ctx) {
    return {
      phase: state.phase,
      cols: state.cols,
      rows: state.rows,
      walls: [...state.walls],
      goal: { ...state.goal },
      checkpoints: state.checkpoints.map((cell) => ({ ...cell })),
      hazards: state.hazards.map((cell) => ({ ...cell })),
      courseLevel: state.courseLevel,
      finishOrder: [...state.finishOrder],
      startedAt: state.startedAt,
      endsAt: state.endsAt,
      durationMs: state.durationMs,
      finishReason: state.finishReason,
      lastEvent: state.lastEvent,
      serverTime: ctx.now(),
      runners: Object.fromEntries(
        ctx.players.map((player) => {
          const runner = state.runners[player.id];
          return [
            player.id,
            runner
              ? {
                  x: runner.x,
                  y: runner.y,
                  steps: runner.steps,
                  finished: runner.finished,
                  finishMs: runner.finishMs,
                  disconnected: runner.disconnected,
                  checkpointIndex: runner.checkpointIndex,
                  penaltyMs: runner.penaltyMs,
                  latestInputSeq: runner.latestInputSeq,
                }
              : null,
          ];
        }),
      ),
    };
  },

  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'playing') return null;
    const runner = state.runners[playerId];
    if (!runner || runner.finished || runner.left) return null;

    const optimal = optimalDirection(state, runner);
    if (optimal && ctx.random() < AI_OPTIMAL_CHANCE[difficulty]) {
      return { type: 'move', payload: { direction: optimal } };
    }
    const legal = legalDirections(state, runner);
    if (legal.length === 0) return null;
    return {
      type: 'move',
      payload: { direction: legal[Math.floor(ctx.random() * legal.length)]! },
    };
  },

  maxDurationMs: 10 * 60 * 1000,
};
