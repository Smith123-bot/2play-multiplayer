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
 * Features: Kill attribution, dynamic neutralisation on death,
 * visual theme palettes, leaderboard tracking, and combat event logs.
 */

export type RushPhase = 'idle' | 'playing' | 'finished';
export type RushDirection = 'up' | 'down' | 'left' | 'right';

export interface RushEvent {
  id: string;
  type: 'kill' | 'cut' | 'capture' | 'suicide' | 'lead_change' | 'stage';
  killerId?: string;
  victimId?: string;
  playerId?: string;
  cellsGained?: number;
  message: string;
  timestamp: number;
}

export interface RushRunner {
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  direction: RushDirection;
  pending: RushDirection | null;
  alive: boolean;
  frozenUntil: number;
  trail: number[];
  home: number[];
  owner: number;
  kills: number;
  killStreak: number;
  captures: number;
  deaths: number;
  largestCapture: number;
  latestInputSeq: number;
  disconnected: boolean;
  left: boolean;
  colorIndex: number;
}

export interface TerritoryRushState {
  phase: RushPhase;
  cols: number;
  rows: number;
  grid: number[];
  walls: number[];
  layout: 'open' | 'crossroads' | 'islands';
  stage: number;
  nextStageAt: number | null;
  runners: Record<string, RushRunner>;
  stepMs: number;
  stepIndex: number;
  accumulatorMs: number;
  startedAt: number | null;
  endsAt: number | null;
  durationMs: number;
  finishReason: GameFinishReason | null;
  lastEvent: string | null;
  events: RushEvent[];
  leaderId: string | null;
  nextAIRequestAt: Record<string, number>;
}

export const RUSH_COLS = 42;
export const RUSH_ROWS = 26;
const STEP_MS = 220;
const MATCH_MS = 3 * 60 * 1000;
const FREEZE_MS = 1200;
const HOME_RADIUS = 1;
const AI_INTERVAL: Record<AIDifficulty, number> = { easy: 380, medium: 220, hard: 120 };

export const PALETTES = [
  { id: 0, name: 'Cyber Red', hex: '#FF4757', trail: '#FF6B81', fill: '#2F3542' },
  { id: 1, name: 'Neon Mint', hex: '#2ED573', trail: '#7BED9F', fill: '#1E272E' },
  { id: 2, name: 'Royal Sky', hex: '#1E90FF', trail: '#70A1FF', fill: '#2F3542' },
  { id: 3, name: 'Amber Gold', hex: '#FFA502', trail: '#ECCC68', fill: '#1E272E' },
  { id: 4, name: 'Electric Purple', hex: '#9B59B6', trail: '#BE2EDD', fill: '#2F3542' },
  { id: 5, name: 'Vibrant Coral', hex: '#FF6348', trail: '#FFA502', fill: '#1E272E' },
];

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
  for (let i = 0; i < grid.length; i += 1) {
    if (grid[i] === owner) n += 1;
  }
  return n;
}

function inBounds(cols: number, rows: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < cols && y < rows;
}

function spawnAnchor(
  seat: number,
  cols: number,
  rows: number,
): { x: number; y: number; direction: RushDirection } {
  const inset = 3;
  const positions: Array<{ x: number; y: number; direction: RushDirection }> = [
    { x: inset, y: inset, direction: 'right' },
    { x: cols - 1 - inset, y: inset, direction: 'left' },
    { x: inset, y: rows - 1 - inset, direction: 'right' },
    { x: cols - 1 - inset, y: rows - 1 - inset, direction: 'left' },
    { x: Math.floor(cols / 2), y: inset, direction: 'down' },
    { x: Math.floor(cols / 2), y: rows - 1 - inset, direction: 'up' },
  ];
  return positions[seat % positions.length]!;
}

export function paintHome(
  grid: number[],
  cols: number,
  rows: number,
  cx: number,
  cy: number,
  owner: number,
): number[] {
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
 * Enclosed area capture using inverse flood fill from outer edges.
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
    if (i < 0 || i >= total || outside[i] === 1 || protectedCells.has(i)) return;
    if (grid[i] !== 0 && grid[i] === owner) return;
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
    grid[i] = owner;
  }
  return Math.max(0, countCells(grid, owner) - before);
}

/**
 * In true Paper.io fashion, eliminating a player wipes out their conquered land,
 * resetting contested areas back to neutral (0) while protecting other players' homes.
 */
function wipePlayerTerritory(
  grid: number[],
  owner: number,
  homeCells: number[],
): void {
  const homeSet = new Set(homeCells);
  for (let i = 0; i < grid.length; i += 1) {
    if (grid[i] === owner && !homeSet.has(i)) {
      grid[i] = 0;
    }
  }
}

function respawn(runner: RushRunner, now: number): void {
  runner.trail = [];
  runner.alive = true;
  runner.killStreak = 0;
  runner.frozenUntil = now + FREEZE_MS;
  runner.deaths += 1;
}

function placeOnHome(runner: RushRunner, cols: number): void {
  const mid = runner.home[Math.floor(runner.home.length / 2)] ?? 0;
  runner.x = mid % cols;
  runner.y = (mid / cols) | 0;
  runner.prevX = runner.x;
  runner.prevY = runner.y;
  runner.trail = [];
}

function pushEvent(state: TerritoryRushState, event: Omit<RushEvent, 'id'>): void {
  const id = `${event.timestamp}-${Math.random().toString(36).substring(2, 7)}`;
  state.events.push({ ...event, id });
  if (state.events.length > 8) {
    state.events.shift();
  }
}

export function stepTerritory(
  state: TerritoryRushState,
  ctx: GameContext,
): { captures: string[]; cuts: string[] } {
  const outcome = { captures: [] as string[], cuts: [] as string[] };
  if (state.phase !== 'playing') return outcome;
  const now = ctx.now();
  const { cols, rows, grid } = state;
  const protectedCells = allHomes(state);
  for (const wall of state.walls) protectedCells.add(wall);

  const ids = Object.keys(state.runners).filter((id) => {
    const runner = state.runners[id]!;
    return !runner.left && runner.alive;
  });

  for (const id of ids) {
    const runner = state.runners[id]!;
    runner.prevX = runner.x;
    runner.prevY = runner.y;
    if (runner.pending) {
      runner.direction = runner.pending;
      runner.pending = null;
    }
  }

  const plans = new Map<string, { x: number; y: number; i: number; stay: boolean }>();
  for (const id of ids) {
    const runner = state.runners[id]!;
    if (now < runner.frozenUntil) {
      plans.set(id, {
        x: runner.x,
        y: runner.y,
        i: cellIndex(cols, runner.x, runner.y),
        stay: true,
      });
      continue;
    }
    const d = DELTA[runner.direction];
    const nx = runner.x + d.dx;
    const ny = runner.y + d.dy;
    if (!inBounds(cols, rows, nx, ny) || state.walls.includes(cellIndex(cols, nx, ny))) {
      plans.set(id, {
        x: runner.x,
        y: runner.y,
        i: cellIndex(cols, runner.x, runner.y),
        stay: true,
      });
      continue;
    }
    plans.set(id, { x: nx, y: ny, i: cellIndex(cols, nx, ny), stay: false });
  }

  const dead = new Set<string>();
  const killMap = new Map<string, string>(); // victimId -> killerId

  for (const id of ids) {
    const runner = state.runners[id]!;
    const plan = plans.get(id)!;
    if (plan.stay) continue;

    // Self-trail intersection
    if (runner.trail.includes(plan.i)) {
      dead.add(id);
      pushEvent(state, {
        type: 'suicide',
        playerId: id,
        message: 'Self-elimination!',
        timestamp: now,
      });
      continue;
    }

    // Slicing opponents' trails
    for (const otherId of ids) {
      if (otherId === id) continue;
      const other = state.runners[otherId]!;
      if (other.trail.includes(plan.i)) {
        dead.add(otherId);
        killMap.set(otherId, id);
        if (!outcome.cuts.includes(otherId)) outcome.cuts.push(otherId);
      }
    }
  }

  // Head-to-head collisions: player outside territory dies
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
      const onLand =
        grid[cellIndex(cols, runner.x, runner.y)] === runner.owner && runner.trail.length === 0;
      if (!onLand) {
        dead.add(id);
      }
    }
  }

  // Process eliminations & rewards
  for (const victimId of dead) {
    const victim = state.runners[victimId]!;
    const killerId = killMap.get(victimId);
    if (killerId) {
      const killer = state.runners[killerId];
      if (killer) {
        killer.kills += 1;
        killer.killStreak += 1;
        pushEvent(state, {
          type: 'kill',
          killerId,
          victimId,
          message: killer.killStreak > 1 ? `Multi-Kill x${killer.killStreak}!` : 'Slashed!',
          timestamp: now,
        });
      }
    }
    wipePlayerTerritory(grid, victim.owner, victim.home);
    respawn(victim, now);
    placeOnHome(victim, cols);
  }

  // Process movement & territory captures
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
      runner.largestCapture = Math.max(runner.largestCapture, gained);
      outcome.captures.push(id);

      const total = cols * rows;
      const pct = Math.round((gained / total) * 100);
      pushEvent(state, {
        type: 'capture',
        playerId: id,
        cellsGained: gained,
        message: gained > 15 ? `Huge Claim (+${pct}%)!` : `+${gained} cells`,
        timestamp: now,
      });
      state.lastEvent = `capture:${id}:${gained}`;
    }
  }

  // Track dynamic leader
  let currentLeader: string | null = null;
  let maxScore = -1;
  for (const [id, runner] of Object.entries(state.runners)) {
    const score = countCells(grid, runner.owner);
    if (score > maxScore) {
      maxScore = score;
      currentLeader = id;
    }
  }
  if (currentLeader && currentLeader !== state.leaderId) {
    state.leaderId = currentLeader;
    pushEvent(state, {
      type: 'lead_change',
      playerId: currentLeader,
      message: 'New Leader crowned!',
      timestamp: now,
    });
  }

  state.stepIndex += 1;
  return outcome;
}

export function finishTerritory(
  state: TerritoryRushState,
  ctx: GameContext,
  reason: GameFinishReason,
): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.finishReason = reason;
  state.lastEvent = reason === 'timeout' ? 'timeout' : 'finished';
  ctx.markStateChanged();
  ctx.finish(reason);
}

function makeRunner(
  seat: number,
  owner: number,
  cols: number,
  rows: number,
  grid: number[],
): RushRunner {
  const spawn = spawnAnchor(seat, cols, rows);
  const home = paintHome(grid, cols, rows, spawn.x, spawn.y, owner);
  return {
    x: spawn.x,
    y: spawn.y,
    prevX: spawn.x,
    prevY: spawn.y,
    direction: spawn.direction,
    pending: null,
    alive: true,
    frozenUntil: 0,
    trail: [],
    home,
    owner,
    kills: 0,
    killStreak: 0,
    captures: 0,
    deaths: 0,
    largestCapture: 0,
    latestInputSeq: -1,
    disconnected: false,
    left: false,
    colorIndex: seat % PALETTES.length,
  };
}

export function buildRushWalls(
  layout: TerritoryRushState['layout'],
  cols: number,
  rows: number,
  protectedCells: Set<number> = new Set(),
): number[] {
  const walls = new Set<number>();
  const add = (x: number, y: number) => {
    const index = cellIndex(cols, x, y);
    if (inBounds(cols, rows, x, y) && !protectedCells.has(index)) walls.add(index);
  };
  if (layout === 'crossroads') {
    for (let y = 5; y < rows - 5; y += 1)
      if (Math.abs(y - rows / 2) > 2) add(Math.floor(cols / 2), y);
    for (let x = 8; x < cols - 8; x += 1)
      if (Math.abs(x - cols / 2) > 3) add(x, Math.floor(rows / 2));
  } else if (layout === 'islands') {
    for (const [cx, cy] of [
      [cols * 0.35, rows * 0.35],
      [cols * 0.65, rows * 0.65],
      [cols * 0.65, rows * 0.35],
      [cols * 0.35, rows * 0.65],
    ]) {
      for (let ox = 0; ox < 2; ox += 1) {
        for (let oy = 0; oy < 2; oy += 1) {
          add(Math.floor(cx) + ox, Math.floor(cy) + oy);
        }
      }
    }
  }
  return [...walls];
}

export const territoryRushGame: GameModule<TerritoryRushState> = {
  metadata: TERRITORY_RUSH_METADATA,

  initialize(): void {},

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
      walls: [],
      layout: 'open',
      stage: 1,
      nextStageAt: null,
      runners,
      stepMs: STEP_MS,
      stepIndex: 0,
      accumulatorMs: 0,
      startedAt: null,
      endsAt: null,
      durationMs: MATCH_MS,
      finishReason: null,
      lastEvent: null,
      events: [],
      leaderId: null,
      nextAIRequestAt: {},
    };
  },

  playerJoined(player, state): void {
    if (state.runners[player.id]) return;
    const seat = Object.keys(state.runners).length;
    state.runners[player.id] = makeRunner(seat, seat + 1, state.cols, state.rows, state.grid);
  },

  playerReady(): void {},

  playerLeft(playerId, state, ctx, reason): void {
    const runner = state.runners[playerId];
    if (!runner) return;
    if (reason === 'disconnect') {
      runner.disconnected = true;
      return;
    }
    runner.left = true;
    runner.trail = [];
    wipePlayerTerritory(state.grid, runner.owner, []);
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
    const layout: TerritoryRushState['layout'] =
      ctx.seed % 3 === 0 ? 'islands' : ctx.seed % 2 === 0 ? 'crossroads' : 'open';
    state.cols = cols;
    state.rows = rows;
    state.grid = grid;
    state.layout = layout;
    state.walls = buildRushWalls(layout, cols, rows, allHomes({ ...state, runners }));
    state.stage = 1;
    state.stepMs = STEP_MS;
    state.nextStageAt = ctx.now() + state.durationMs / 3;
    state.runners = runners;
    state.stepIndex = 0;
    state.accumulatorMs = 0;
    state.phase = 'playing';
    state.startedAt = ctx.now();
    state.endsAt = state.startedAt + state.durationMs;
    state.finishReason = null;
    state.lastEvent = 'start';
    state.events = [];
    state.leaderId = null;
    state.nextAIRequestAt = {};
    ctx.markStateChanged();
    ctx.schedule(
      state.durationMs,
      () => finishTerritory(state, ctx, 'timeout'),
      'gameDuration',
      'match-timeout',
    );
  },

  validateAction(playerId, action, state): ValidationResult {
    if (action.type !== 'turn') return { valid: false, reason: 'Unknown action.' };
    if (state.phase !== 'playing') return { valid: false, reason: 'Match is not active.' };
    const direction = action.payload?.direction;
    if (!isRushDirection(direction)) return { valid: false, reason: 'Invalid direction.' };
    const runner = state.runners[playerId];
    if (!runner || runner.left) return { valid: false, reason: 'Runner not active.' };
    const effective = runner.pending ?? runner.direction;
    if (REVERSE[effective] === direction)
      return { valid: false, reason: 'Cannot reverse directly.' };
    const sequence = action.payload?.sequence;
    if (
      sequence !== undefined &&
      (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 0)
    )
      return { valid: false, reason: 'Invalid input sequence.' };
    if (typeof sequence === 'number' && sequence <= runner.latestInputSeq)
      return { valid: false, reason: 'Stale sequence.' };
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state): ActionResult {
    if (action.type !== 'turn') return actionRejected('Unknown action.');
    const direction = action.payload?.direction;
    if (!isRushDirection(direction)) return actionRejected('Invalid direction.');
    const runner = state.runners[playerId];
    if (!runner || state.phase !== 'playing') return actionRejected('Steering locked.');
    const sequence = action.payload?.sequence;
    if (
      sequence !== undefined &&
      (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 0)
    )
      return actionRejected('Invalid input sequence.');
    if (typeof sequence === 'number' && sequence <= runner.latestInputSeq)
      return actionRejected('Stale input.');
    if (typeof sequence === 'number') runner.latestInputSeq = sequence;
    const effective = runner.pending ?? runner.direction;
    if (REVERSE[effective] === direction) return actionRejected('Cannot reverse directly.');
    if (effective === direction) return actionAccepted(false);
    runner.pending = direction;
    return actionAccepted(false);
  },

  update(state, deltaTimeMs, ctx): void {
    if (state.phase !== 'playing') return;
    const now = ctx.now();
    if (state.nextStageAt !== null && now >= state.nextStageAt && state.stage < 3) {
      state.stage += 1;
      state.stepMs = state.stage === 2 ? 190 : 160;
      state.nextStageAt = state.startedAt! + (state.durationMs * state.stage) / 3;
      state.lastEvent = `stage:${state.stage}`;
      pushEvent(state, {
        type: 'stage',
        message: `Speed Rush Stage ${state.stage}!`,
        timestamp: now,
      });
      ctx.markStateChanged();
    }
    for (const player of ctx.players) {
      if (!player.isAI) continue;
      const runner = state.runners[player.id];
      if (!runner || runner.left) continue;
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
      stepTerritory(state, ctx);
      ctx.markStateChanged();
    }
  },

  tick(): void {},

  calculateScore(playerId, state): number {
    const runner = state.runners[playerId];
    if (!runner) return 0;
    return countCells(state.grid, runner.owner);
  },

  checkWinCondition(state): string[] | null {
    if (state.phase !== 'finished') return null;
    const entries = Object.entries(state.runners).map(
      ([id, runner]) => [id, countCells(state.grid, runner.owner)] as const,
    );
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
      const kills = (state.runners[b.id]?.kills ?? 0) - (state.runners[a.id]?.kills ?? 0);
      if (kills !== 0) return kills;
      return (state.runners[b.id]?.captures ?? 0) - (state.runners[a.id]?.captures ?? 0);
    });
    const top = countCells(state.grid, state.runners[ranked[0]?.id ?? '']?.owner ?? -1);
    const winners = ranked
      .filter((player) => countCells(state.grid, state.runners[player.id]?.owner ?? -1) === top)
      .map((player) => player.id);
    const total = state.cols * state.rows;
    const rankings: RankingDraft[] = ranked.map((player, index) => {
      const runner = state.runners[player.id];
      const cells = countCells(state.grid, runner?.owner ?? -1);
      return {
        playerId: player.id,
        rank: index + 1,
        score: cells,
        isWinner: winners.includes(player.id),
        isDraw: winners.length > 1,
        stats: {
          cells,
          percent: Math.round((cells / Math.max(1, total)) * 100),
          kills: runner?.kills ?? 0,
          captures: runner?.captures ?? 0,
          deaths: runner?.deaths ?? 0,
          largestCapture: runner?.largestCapture ?? 0,
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

  reset(state): TerritoryRushState {
    const seats = Object.keys(state.runners);
    const { cols, rows } = state;
    const grid = new Array<number>(cols * rows).fill(0);
    const runners: Record<string, RushRunner> = {};
    seats.forEach((id, index) => {
      runners[id] = makeRunner(index, index + 1, cols, rows, grid);
    });
    return {
      ...state,
      phase: 'idle',
      grid,
      walls: [],
      layout: 'open',
      stage: 1,
      nextStageAt: null,
      runners,
      stepMs: STEP_MS,
      stepIndex: 0,
      accumulatorMs: 0,
      startedAt: null,
      endsAt: null,
      finishReason: null,
      lastEvent: null,
      events: [],
      leaderId: null,
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
    const runnerEntries = Object.entries(state.runners);

    // Compute live ranked leaderboard
    const leaderboard = runnerEntries
      .map(([id, runner]) => {
        const cells = countCells(state.grid, runner.owner);
        const percent = Math.round((cells / Math.max(1, total)) * 1000) / 10;
        return {
          id,
          cells,
          percent,
          kills: runner.kills,
          alive: runner.alive,
          colorIndex: runner.colorIndex,
          isLeader: state.leaderId === id,
        };
      })
      .sort((a, b) => b.cells - a.cells);

    return {
      phase: state.phase,
      cols: state.cols,
      rows: state.rows,
      grid: encodeGrid(state.grid),
      walls: [...state.walls],
      layout: state.layout,
      stage: state.stage,
      nextStageAt: state.nextStageAt,
      stepMs: state.stepMs,
      stepIndex: state.stepIndex,
      stepProgress: Math.min(1, state.accumulatorMs / state.stepMs),
      startedAt: state.startedAt,
      endsAt: state.endsAt,
      durationMs: state.durationMs,
      finishReason: state.finishReason,
      lastEvent: state.lastEvent,
      events: state.events,
      leaderId: state.leaderId,
      leaderboard,
      palettes: PALETTES,
      serverTime: ctx.now(),
      totalCells: total,
      runners: Object.fromEntries(
        runnerEntries.map(([id, runner]) => {
          const cells = countCells(state.grid, runner.owner);
          return [
            id,
            {
              x: runner.x,
              y: runner.y,
              prevX: runner.prevX,
              prevY: runner.prevY,
              direction: runner.direction,
              owner: runner.owner,
              trail: runner.trail.map((i) => ({ x: i % state.cols, y: (i / state.cols) | 0 })),
              cells,
              percent: Math.round((cells / Math.max(1, total)) * 1000) / 10,
              kills: runner.kills,
              killStreak: runner.killStreak,
              captures: runner.captures,
              deaths: runner.deaths,
              largestCapture: runner.largestCapture,
              latestInputSeq: runner.latestInputSeq,
              frozenUntil: runner.frozenUntil,
              isInvulnerable: ctx.now() < runner.frozenUntil,
              disconnected: runner.disconnected,
              color: PALETTES[runner.colorIndex] ?? PALETTES[0],
              isLeader: state.leaderId === id,
            },
          ];
        }),
      ),
    };
  },

  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'playing') return null;
    const runner = state.runners[playerId];
    if (!runner || runner.left || !runner.alive) return null;
    const { cols, rows, grid } = state;

    const options = ALL_DIRS.filter((dir) => dir !== REVERSE[runner.direction]);
    const safe = options.filter((dir) => {
      const nx = runner.x + DELTA[dir].dx;
      const ny = runner.y + DELTA[dir].dy;
      if (!inBounds(cols, rows, nx, ny)) return false;
      const i = cellIndex(cols, nx, ny);
      return !state.walls.includes(i) && !runner.trail.includes(i);
    });

    const pool = safe.length > 0 ? safe : options;
    const onMap = pool.filter((dir) => inBounds(cols, rows, runner.x + DELTA[dir].dx, runner.y + DELTA[dir].dy));
    const steerPool = onMap.length > 0 ? onMap : pool;

    // Easy AI: random behavior
    if (difficulty === 'easy' && ctx.random() < 0.45) {
      return {
        type: 'turn',
        payload: { direction: steerPool[Math.floor(ctx.random() * steerPool.length)]! },
      };
    }

    // Return to territory when trail is getting risky
    const maxTrailLimit = difficulty === 'hard' ? 8 : 14;
    if (runner.trail.length > maxTrailLimit) {
      const homeward = steerPool.reduce((best, dir) => {
        const nx = runner.x + DELTA[dir].dx;
        const ny = runner.y + DELTA[dir].dy;
        const dist = runner.home.reduce((min, h) => {
          const d = Math.abs(nx - (h % cols)) + Math.abs(ny - ((h / cols) | 0));
          return Math.min(min, d);
        }, 9999);
        const bestNx = runner.x + DELTA[best].dx;
        const bestNy = runner.y + DELTA[best].dy;
        const bestDist = runner.home.reduce((min, h) => {
          const d = Math.abs(bestNx - (h % cols)) + Math.abs(bestNy - ((h / cols) | 0));
          return Math.min(min, d);
        }, 9999);
        return dist < bestDist ? dir : best;
      }, steerPool[0]!);
      return { type: 'turn', payload: { direction: homeward } };
    }

    // Hard AI: hunts opponent trails if nearby
    if (difficulty === 'hard') {
      for (const other of Object.values(state.runners)) {
        if (other.owner === runner.owner || other.trail.length === 0) continue;
        for (const dir of steerPool) {
          const nx = runner.x + DELTA[dir].dx;
          const ny = runner.y + DELTA[dir].dy;
          if (other.trail.includes(cellIndex(cols, nx, ny))) {
            return { type: 'turn', payload: { direction: dir } };
          }
        }
      }
    }

    // Default: Prefer unowned cells to expand territory
    const prefer = steerPool.filter((dir) => {
      const nx = runner.x + DELTA[dir].dx;
      const ny = runner.y + DELTA[dir].dy;
      return grid[cellIndex(cols, nx, ny)] !== runner.owner;
    });

    const chosen = (prefer.length > 0 ? prefer : steerPool)[
      Math.floor(ctx.random() * (prefer.length > 0 ? prefer.length : steerPool.length))
    ]!;
    return { type: 'turn', payload: { direction: chosen } };
  },

  needsUpdateLoop: true,
  maxDurationMs: 6 * 60 * 1000,
};
