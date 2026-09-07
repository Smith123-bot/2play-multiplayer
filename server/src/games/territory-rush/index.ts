import type { AIDifficulty, GameAction, GameFinishReason } from '@2play/shared';
import { TERRITORY_RUSH_METADATA } from '@2play/shared';
export { TERRITORY_RUSH_METADATA };
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
 * Territory Rush — real-time grid capture.
 *
 * Clients send only `turn` intents. The server steps every player one cell,
 * validates trails, flood-fills enclosed regions and owns the percentages.
 */

export type RushPhase = 'idle' | 'playing' | 'finished';
export type RushDirection = 'up' | 'down' | 'left' | 'right';

export interface RushRunner {
  x: number;
  y: number;
  direction: RushDirection;
  pending: RushDirection | null;
  alive: boolean;
  frozenUntil: number;
  trail: number[];
  home: number[];
  owner: number;
  captures: number;
  deaths: number;
  disconnected: boolean;
  left: boolean;
}

export interface TerritoryRushState {
  phase: RushPhase;
  cols: number;
  rows: number;
  grid: number[];
  runners: Record<string, RushRunner>;
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

export const RUSH_COLS = 40;
export const RUSH_ROWS = 24;
const STEP_MS = 250;
const MATCH_MS = 3 * 60 * 1000;
const FREEZE_MS = 900;
const HOME_RADIUS = 1;
const AI_INTERVAL: Record<AIDifficulty, number> = { easy: 420, medium: 260, hard: 140 };

const DELTA: Record<RushDirection, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};
const ALL_DIRS: RushDirection[] = ['up', 'down', 'left', 'right'];
const REVERSE: Record<RushDirection, RushDirection> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
};

export function isRushDirection(value: unknown): value is RushDirection {
  return value === 'up' || value === 'down' || value === 'left' || value === 'right';
}

export function cellIndex(cols: number, x: number, y: number): number {
  return y * cols + x;
}

export function encodeGrid(grid: number[]): string {
  return grid.join('');
}

export function countCells(grid: number[], owner: number): number {
  let n = 0;
  for (const cell of grid) if (cell === owner) n += 1;
  return n;
}

function inBounds(cols: number, rows: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < cols && y < rows;
}

function spawnAnchor(seat: number, cols: number, rows: number): { x: number; y: number; direction: RushDirection } {
  const inset = 2;
  if (seat === 0) return { x: inset, y: inset, direction: 'right' };
  if (seat === 1) return { x: cols - 1 - inset, y: inset, direction: 'left' };
  if (seat === 2) return { x: inset, y: rows - 1 - inset, direction: 'right' };
  return { x: cols - 1 - inset, y: rows - 1 - inset, direction: 'left' };
}

export function paintHome(grid: number[], cols: number, rows: number, cx: number, cy: number, owner: number): number[] {
  const home: number[] = [];
  for (let dy = -HOME_RADIUS; dy <= HOME_RADIUS; dy += 1) {
    for (let dx = -HOME_RADIUS; dx <= HOME_RADIUS; dx += 1) {
      const x = cx + dx;
      const y = cy + dy;
      if (!inBounds(cols, rows, x, y)) continue;
      const i = cellIndex(cols, x, y);
      grid[i] = owner;
      home.push(i);
    }
  }
  return home;
}

function allHomes(state: TerritoryRushState): Set<number> {
  const set = new Set<number>();
  for (const runner of Object.values(state.runners)) {
    for (const i of runner.home) set.add(i);
  }
  return set;
}

/**
 * Paint the trail as `owner`, then flood-fill empty space from the map border.
 * Anything empty (or stealable) that the border flood cannot reach is enclosed.
 */
export function captureEnclosed(
  grid: number[],
  cols: number,
  rows: number,
  owner: number,
  trail: number[],
  protectedCells: Set<number>,
): number {
  const before = countCells(grid, owner);
  for (const idx of trail) {
    if (!protectedCells.has(idx) || grid[idx] === owner) grid[idx] = owner;
  }
  const total = cols * rows;
  const outside = new Uint8Array(total);
  const queue: number[] = [];
  const tryPush = (i: number) => {
    if (i < 0 || i >= total || outside[i] === 1) return;
    if (grid[i] !== 0) return;
    outside[i] = 1;
    queue.push(i);
  };
  for (let x = 0; x < cols; x += 1) {
    tryPush(x);
    tryPush(x + (rows - 1) * cols);
  }
  for (let y = 0; y < rows; y += 1) {
    tryPush(y * cols);
    tryPush(y * cols + cols - 1);
  }
  while (queue.length > 0) {
    const i = queue.pop()!;
    const x = i % cols;
    const y = (i / cols) | 0;
    if (x > 0) tryPush(i - 1);
    if (x + 1 < cols) tryPush(i + 1);
    if (y > 0) tryPush(i - cols);
    if (y + 1 < rows) tryPush(i + cols);
  }
  for (let i = 0; i < total; i += 1) {
    if (protectedCells.has(i) && grid[i] !== owner) continue;
    if (outside[i] === 1) continue;
    if (grid[i] === 0 || grid[i] !== owner) grid[i] = owner;
  }
  return Math.max(0, countCells(grid, owner) - before);
}

function respawn(runner: RushRunner, now: number): void {
  runner.trail = [];
  runner.alive = true;
  runner.frozenUntil = now + FREEZE_MS;
  runner.deaths += 1;
}

function placeOnHome(runner: RushRunner, cols: number): void {
  const mid = runner.home[Math.floor(runner.home.length / 2)] ?? 0;
  runner.x = mid % cols;
  runner.y = (mid / cols) | 0;
  runner.trail = [];
}

function trailSet(runner: RushRunner): Set<number> {
  return new Set(runner.trail);
}

export function stepTerritory(state: TerritoryRushState, ctx: GameContext): { captures: string[]; cuts: string[] } {
  const outcome = { captures: [] as string[], cuts: [] as string[] };
  if (state.phase !== 'playing') return outcome;
  const now = ctx.now();
  const { cols, rows, grid } = state;
  const protectedCells = allHomes(state);

  const ids = Object.keys(state.runners).filter((id) => {
    const runner = state.runners[id]!;
    return !runner.left && runner.alive;
  });

  for (const id of ids) {
    const runner = state.runners[id]!;
    if (runner.pending) {
      runner.direction = runner.pending;
      runner.pending = null;
    }
  }

  const plans = new Map<string, { x: number; y: number; i: number; stay: boolean }>();
  for (const id of ids) {
    const runner = state.runners[id]!;
    if (now < runner.frozenUntil) {
      plans.set(id, { x: runner.x, y: runner.y, i: cellIndex(cols, runner.x, runner.y), stay: true });
      continue;
    }
    const d = DELTA[runner.direction];
    const nx = runner.x + d.dx;
    const ny = runner.y + d.dy;
    if (!inBounds(cols, rows, nx, ny)) {
      plans.set(id, { x: runner.x, y: runner.y, i: cellIndex(cols, runner.x, runner.y), stay: true });
      continue;
    }
    plans.set(id, { x: nx, y: ny, i: cellIndex(cols, nx, ny), stay: false });
  }

  const dead = new Set<string>();
  for (const id of ids) {
    const runner = state.runners[id]!;
    const plan = plans.get(id)!;
    if (plan.stay) continue;
    const ownTrail = trailSet(runner);
    if (ownTrail.has(plan.i)) {
      dead.add(id);
      continue;
    }
    for (const otherId of ids) {
      if (otherId === id) continue;
      const other = state.runners[otherId]!;
      if (other.trail.includes(plan.i)) {
        dead.add(otherId);
        outcome.cuts.push(otherId);
      }
    }
  }

  // Head-to-head on the same destination: trailing players die.
  const dest = new Map<number, string[]>();
  for (const id of ids) {
    if (dead.has(id)) continue;
    const plan = plans.get(id)!;
    if (plan.stay) continue;
    const list = dest.get(plan.i) ?? [];
    list.push(id);
    dest.set(plan.i, list);
  }
  for (const occupiers of dest.values()) {
    if (occupiers.length < 2) continue;
    for (const id of occupiers) {
      const runner = state.runners[id]!;
      const onLand = grid[cellIndex(cols, runner.x, runner.y)] === runner.owner && runner.trail.length === 0;
      if (!onLand) dead.add(id);
    }
  }

  for (const id of dead) {
    const runner = state.runners[id]!;
    respawn(runner, now);
    placeOnHome(runner, cols);
  }

  for (const id of ids) {
    if (dead.has(id)) continue;
    const runner = state.runners[id]!;
    const plan = plans.get(id)!;
    if (plan.stay) continue;
    const fromOwned = grid[cellIndex(cols, runner.x, runner.y)] === runner.owner;
    const toOwned = grid[plan.i] === runner.owner;
    runner.x = plan.x;
    runner.y = plan.y;
    if (!toOwned) {
      if (fromOwned && runner.trail.length === 0) runner.trail = [plan.i];
      else runner.trail.push(plan.i);
      if (runner.trail.length > cols * rows) runner.trail = runner.trail.slice(-cols);
    } else if (runner.trail.length > 0) {
      const gained = captureEnclosed(grid, cols, rows, runner.owner, runner.trail, protectedCells);
      runner.trail = [];
      runner.captures += 1;
      outcome.captures.push(id);
      state.lastEvent = `capture:${id}:${gained}`;
    }
  }

  state.stepIndex += 1;
  if (outcome.cuts.length > 0 && !state.lastEvent?.startsWith('capture:')) {
    state.lastEvent = `cut:${outcome.cuts.join('+')}`;
  }
  return outcome;
}

export function finishTerritory(state: TerritoryRushState, ctx: GameContext, reason: GameFinishReason): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.finishReason = reason;
  state.lastEvent = reason === 'timeout' ? 'timeout' : 'finished';
  ctx.markStateChanged();
  ctx.finish(reason);
}

function makeRunner(seat: number, owner: number, cols: number, rows: number, grid: number[]): RushRunner {
  const spawn = spawnAnchor(seat, cols, rows);
  const home = paintHome(grid, cols, rows, spawn.x, spawn.y, owner);
  return {
    x: spawn.x,
    y: spawn.y,
    direction: spawn.direction,
    pending: null,
    alive: true,
    frozenUntil: 0,
    trail: [],
    home,
    owner,
    captures: 0,
    deaths: 0,
    disconnected: false,
    left: false,
  };
}

export const territoryRushGame: GameModule<TerritoryRushState> = {
  metadata: TERRITORY_RUSH_METADATA,

  initialize(): void {
    // Stateless module.
  },

  createInitialState(players): TerritoryRushState {
    const cols = RUSH_COLS;
    const rows = RUSH_ROWS;
    const grid = new Array<number>(cols * rows).fill(0);
    const runners: Record<string, RushRunner> = {};
    players.forEach((player, index) => {
      runners[player.id] = makeRunner(index, index + 1, cols, rows, grid);
    });
    return {
      phase: 'idle',
      cols,
      rows,
      grid,
      runners,
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
    if (state.runners[player.id]) return;
    const seat = Object.keys(state.runners).length;
    state.runners[player.id] = makeRunner(seat, seat + 1, state.cols, state.rows, state.grid);
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
    const remaining = Object.values(state.runners).filter((entry) => !entry.left);
    if (remaining.length === 0) finishTerritory(state, ctx, 'abandoned');
  },

  start(state, ctx): void {
    if (state.phase === 'playing') return;
    const cols = RUSH_COLS;
    const rows = RUSH_ROWS;
    const grid = new Array<number>(cols * rows).fill(0);
    const runners: Record<string, RushRunner> = {};
    ctx.players.forEach((player, index) => {
      runners[player.id] = makeRunner(index, index + 1, cols, rows, grid);
    });
    state.cols = cols;
    state.rows = rows;
    state.grid = grid;
    state.runners = runners;
    state.stepIndex = 0;
    state.accumulatorMs = 0;
    state.phase = 'playing';
    state.startedAt = ctx.now();
    state.endsAt = state.startedAt + state.durationMs;
    state.finishReason = null;
    state.lastEvent = 'start';
    state.nextAIRequestAt = {};
    ctx.markStateChanged();
    ctx.schedule(state.durationMs, () => finishTerritory(state, ctx, 'timeout'), 'gameDuration', 'match-timeout');
  },

  validateAction(playerId, action, state): ValidationResult {
    if (action.type !== 'turn') return { valid: false, reason: 'Unknown action.' };
    if (state.phase !== 'playing') return { valid: false, reason: 'The match is not running.' };
    const direction = action.payload?.direction;
    if (!isRushDirection(direction)) return { valid: false, reason: 'Use up, down, left or right.' };
    const runner = state.runners[playerId];
    if (!runner || runner.left) return { valid: false, reason: 'You are not in this match.' };
    const effective = runner.pending ?? runner.direction;
    if (REVERSE[effective] === direction) return { valid: false, reason: 'You cannot reverse instantly.' };
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state): ActionResult {
    if (action.type !== 'turn') return actionRejected('Unknown action.');
    const direction = action.payload?.direction;
    if (!isRushDirection(direction)) return actionRejected('Invalid direction.');
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
      const outcome = stepTerritory(state, ctx);
      if (outcome.captures.length > 0 || outcome.cuts.length > 0) ctx.markStateChanged();
    }
  },

  tick(): void {
    // Handled by update().
  },

  calculateScore(playerId, state): number {
    const runner = state.runners[playerId];
    if (!runner) return 0;
    return countCells(state.grid, runner.owner);
  },

  checkWinCondition(state): string[] | null {
    if (state.phase !== 'finished') return null;
    const entries = Object.entries(state.runners).map(([id, runner]) => [id, countCells(state.grid, runner.owner)] as const);
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
    const ranked = [...ctx.players].sort((a, b) => {
      const cellsA = countCells(state.grid, state.runners[a.id]?.owner ?? -1);
      const cellsB = countCells(state.grid, state.runners[b.id]?.owner ?? -1);
      if (cellsB !== cellsA) return cellsB - cellsA;
      const cap = (state.runners[b.id]?.captures ?? 0) - (state.runners[a.id]?.captures ?? 0);
      if (cap !== 0) return cap;
      return (state.runners[a.id]?.deaths ?? 0) - (state.runners[b.id]?.deaths ?? 0);
    });
    const top = countCells(state.grid, state.runners[ranked[0]?.id ?? '']?.owner ?? -1);
    const winners = ranked
      .filter((player) => countCells(state.grid, state.runners[player.id]?.owner ?? -1) === top)
      .map((player) => player.id);
    const total = state.cols * state.rows;
    const rankings: RankingDraft[] = ranked.map((player, index) => {
      const cells = countCells(state.grid, state.runners[player.id]?.owner ?? -1);
      return {
        playerId: player.id,
        rank: index + 1,
        score: cells,
        isWinner: winners.includes(player.id),
        isDraw: winners.length > 1,
        stats: {
          cells,
          percent: Math.round((cells / Math.max(1, total)) * 100),
          captures: state.runners[player.id]?.captures ?? 0,
          deaths: state.runners[player.id]?.deaths ?? 0,
        },
      };
    });
    return { winners, isDraw: winners.length > 1, rankings, reason: state.finishReason ?? 'completed' };
  },

  reset(state): TerritoryRushState {
    const seats = Object.keys(state.runners);
    const cols = state.cols;
    const rows = state.rows;
    const grid = new Array<number>(cols * rows).fill(0);
    const runners: Record<string, RushRunner> = {};
    seats.forEach((id, index) => {
      runners[id] = makeRunner(index, index + 1, cols, rows, grid);
    });
    return {
      ...state,
      phase: 'idle',
      grid,
      runners,
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
    state.runners = {};
    state.grid = [];
    state.phase = 'finished';
  },

  getPublicState(state, _viewerId, ctx) {
    const total = state.cols * state.rows;
    return {
      phase: state.phase,
      cols: state.cols,
      rows: state.rows,
      grid: encodeGrid(state.grid),
      stepMs: state.stepMs,
      stepIndex: state.stepIndex,
      startedAt: state.startedAt,
      endsAt: state.endsAt,
      durationMs: state.durationMs,
      finishReason: state.finishReason,
      lastEvent: state.lastEvent,
      serverTime: ctx.now(),
      totalCells: total,
      runners: Object.fromEntries(
        Object.entries(state.runners).map(([id, runner]) => {
          const cells = countCells(state.grid, runner.owner);
          return [
            id,
            {
              x: runner.x,
              y: runner.y,
              direction: runner.direction,
              owner: runner.owner,
              trail: runner.trail.map((i) => ({ x: i % state.cols, y: (i / state.cols) | 0 })),
              cells,
              percent: Math.round((cells / Math.max(1, total)) * 1000) / 10,
              captures: runner.captures,
              deaths: runner.deaths,
              frozenUntil: runner.frozenUntil,
              disconnected: runner.disconnected,
            },
          ];
        }),
      ),
    };
  },

  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'playing') return null;
    const runner = state.runners[playerId];
    if (!runner || runner.left) return null;
    const { cols, rows, grid } = state;
    const options = ALL_DIRS.filter((dir) => dir !== REVERSE[runner.direction]);
    const safe = options.filter((dir) => {
      const n = { x: runner.x + DELTA[dir].dx, y: runner.y + DELTA[dir].dy };
      if (!inBounds(cols, rows, n.x, n.y)) return false;
      const i = cellIndex(cols, n.x, n.y);
      if (runner.trail.includes(i)) return false;
      return true;
    });
    const pool = safe.length > 0 ? safe : options;
    if (difficulty === 'easy' && ctx.random() < 0.45) {
      return { type: 'turn', payload: { direction: pool[Math.floor(ctx.random() * pool.length)]! } };
    }
    if (runner.trail.length > (difficulty === 'hard' ? 14 : 22)) {
      const homeward = pool.reduce((best, dir) => {
        const n = { x: runner.x + DELTA[dir].dx, y: runner.y + DELTA[dir].dy };
        const home = runner.home[0] ?? 0;
        const hx = home % cols;
        const hy = (home / cols) | 0;
        const dist = Math.abs(n.x - hx) + Math.abs(n.y - hy);
        const bestN = { x: runner.x + DELTA[best].dx, y: runner.y + DELTA[best].dy };
        const bestD = Math.abs(bestN.x - hx) + Math.abs(bestN.y - hy);
        return dist < bestD ? dir : best;
      }, pool[0]!);
      return { type: 'turn', payload: { direction: homeward } };
    }
    const prefer = pool.filter((dir) => {
      const n = { x: runner.x + DELTA[dir].dx, y: runner.y + DELTA[dir].dy };
      return grid[cellIndex(cols, n.x, n.y)] !== runner.owner;
    });
    const chosen = (prefer.length > 0 ? prefer : pool)[Math.floor(ctx.random() * (prefer.length > 0 ? prefer.length : pool.length))]!;
    return { type: 'turn', payload: { direction: chosen } };
  },

  needsUpdateLoop: true,
  maxDurationMs: 6 * 60 * 1000,
};
