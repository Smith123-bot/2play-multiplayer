import type { AIDifficulty, GameAction, GameFinishReason } from '@2play/shared';
import { MAGNET_MAZE_METADATA } from '@2play/shared';
export { MAGNET_MAZE_METADATA };
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
 * Magnet Maze — seeded 2D maze with magnetic currents.
 *
 * Clients send move / flip. The server owns walls, pull, collection and
 * finish. A client cannot declare “I finished”.
 */

export type MagnetPhase = 'idle' | 'playing' | 'finished';
export type MagnetDirection = 'up' | 'down' | 'left' | 'right';
export type MagnetPolarity = 'north' | 'south';
export type MagnetTile = 'floor' | 'wall' | 'magnetN' | 'magnetS' | 'spike' | 'crystal' | 'finish';

export interface MagnetRunner {
  x: number;
  y: number;
  polarity: MagnetPolarity;
  crystals: number;
  frozenUntil: number;
  finishedAt: number | null;
  disconnected: boolean;
  left: boolean;
}

export interface MagnetState {
  phase: MagnetPhase;
  cols: number;
  rows: number;
  tiles: MagnetTile[];
  runners: Record<string, MagnetRunner>;
  collected: string[];
  startedAt: number | null;
  endsAt: number | null;
  durationMs: number;
  finishReason: GameFinishReason | null;
  lastEvent: string | null;
  nextAIRequestAt: Record<string, number>;
  startCells: Array<{ x: number; y: number }>;
  finishCell: { x: number; y: number };
}

export const MAGNET_COLS = 13;
export const MAGNET_ROWS = 13;
export const MAGNET_MATCH_MS = 120_000;
export const SPIKE_FREEZE_MS = 800;
export const FINISH_BONUS = 50;
const DELTA: Record<MagnetDirection, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};
const ALL_DIRS: MagnetDirection[] = ['up', 'down', 'left', 'right'];
const AI_INTERVAL: Record<AIDifficulty, number> = { easy: 420, medium: 220, hard: 110 };

export function isMagnetDirection(value: unknown): value is MagnetDirection {
  return value === 'up' || value === 'down' || value === 'left' || value === 'right';
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function idx(cols: number, x: number, y: number): number {
  return y * cols + x;
}

function inBounds(cols: number, rows: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < cols && y < rows;
}

export function magnetFinishCell(cols = MAGNET_COLS, rows = MAGNET_ROWS): { x: number; y: number } {
  return { x: cols - 2, y: Math.floor(rows / 2) | 1 };
}

export function generateMagnetMaze(seed: number, cols = MAGNET_COLS, rows = MAGNET_ROWS): MagnetTile[] {
  const rng = mulberry32(seed || 1);
  const tiles: MagnetTile[] = Array.from({ length: cols * rows }, () => 'wall');
  const stack: Array<{ x: number; y: number }> = [{ x: 1, y: 1 }];
  tiles[idx(cols, 1, 1)] = 'floor';
  while (stack.length > 0) {
    const current = stack[stack.length - 1]!;
    const order = ALL_DIRS.slice().sort(() => rng() - 0.5);
    let carved = false;
    for (const dir of order) {
      const nx = current.x + DELTA[dir].dx * 2;
      const ny = current.y + DELTA[dir].dy * 2;
      if (!inBounds(cols, rows, nx, ny)) continue;
      if (tiles[idx(cols, nx, ny)] !== 'wall') continue;
      tiles[idx(cols, current.x + DELTA[dir].dx, current.y + DELTA[dir].dy)] = 'floor';
      tiles[idx(cols, nx, ny)] = 'floor';
      stack.push({ x: nx, y: ny });
      carved = true;
      break;
    }
    if (!carved) stack.pop();
  }
  const reserved = new Set(startCells(cols, rows).map((cell) => `${cell.x},${cell.y}`));
  const finish = magnetFinishCell(cols, rows);
  reserved.add(`${finish.x},${finish.y}`);
  for (let y = 1; y < rows - 1; y += 1) {
    for (let x = 1; x < cols - 1; x += 1) {
      if (tiles[idx(cols, x, y)] !== 'floor') continue;
      if (reserved.has(`${x},${y}`)) continue;
      const roll = rng();
      if (roll < 0.06) tiles[idx(cols, x, y)] = 'magnetN';
      else if (roll < 0.12) tiles[idx(cols, x, y)] = 'magnetS';
      else if (roll < 0.16) tiles[idx(cols, x, y)] = 'spike';
      else if (roll < 0.22) tiles[idx(cols, x, y)] = 'crystal';
    }
  }
  for (const cell of startCells(cols, rows)) tiles[idx(cols, cell.x, cell.y)] = 'floor';
  tiles[idx(cols, finish.x, finish.y)] = 'finish';
  return tiles;
}

function startCells(cols: number, rows: number): Array<{ x: number; y: number }> {
  return [
    { x: 1, y: 1 },
    { x: cols - 2, y: 1 },
    { x: 1, y: rows - 2 },
    { x: cols - 2, y: rows - 2 },
  ];
}

function tileAt(state: MagnetState, x: number, y: number): MagnetTile {
  if (!inBounds(state.cols, state.rows, x, y)) return 'wall';
  return state.tiles[idx(state.cols, x, y)] ?? 'wall';
}

function magnetDelta(tile: MagnetTile, polarity: MagnetPolarity): { dx: number; dy: number } | null {
  if (tile === 'magnetN') return polarity === 'north' ? { dx: 0, dy: -1 } : { dx: 0, dy: 1 };
  if (tile === 'magnetS') return polarity === 'south' ? { dx: 0, dy: 1 } : { dx: 0, dy: -1 };
  return null;
}

function crystalKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function magnetScore(runner: MagnetRunner): number {
  return runner.crystals * 10 + (runner.finishedAt != null ? FINISH_BONUS : 0);
}

export function finishMagnet(state: MagnetState, ctx: GameContext, reason: GameFinishReason): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.finishReason = reason;
  state.lastEvent = reason === 'timeout' ? 'timeout' : 'finished';
  ctx.markStateChanged();
  ctx.finish(reason);
}

function maybeAllFinished(state: MagnetState, ctx: GameContext): void {
  const active = Object.values(state.runners).filter((runner) => !runner.left);
  if (active.length > 0 && active.every((runner) => runner.finishedAt != null)) {
    finishMagnet(state, ctx, 'completed');
  }
}

export function tryStep(
  state: MagnetState,
  playerId: string,
  direction: MagnetDirection,
  now: number,
): { ok: boolean; reason?: string } {
  const runner = state.runners[playerId];
  if (!runner || runner.left || runner.finishedAt != null) return { ok: false, reason: 'You cannot move.' };
  if (now < runner.frozenUntil) return { ok: false, reason: 'You are stunned.' };
  const d = DELTA[direction];
  let nx = runner.x + d.dx;
  let ny = runner.y + d.dy;
  if (tileAt(state, nx, ny) === 'wall') return { ok: false, reason: 'Wall.' };
  const pull = magnetDelta(tileAt(state, nx, ny), runner.polarity);
  if (pull) {
    const px = nx + pull.dx;
    const py = ny + pull.dy;
    if (tileAt(state, px, py) !== 'wall') {
      nx = px;
      ny = py;
    }
  }
  runner.x = nx;
  runner.y = ny;
  const tile = tileAt(state, nx, ny);
  if (tile === 'spike') {
    runner.frozenUntil = now + SPIKE_FREEZE_MS;
    state.lastEvent = `spike:${playerId}`;
  }
  if (tile === 'crystal') {
    const key = crystalKey(nx, ny);
    if (!state.collected.includes(key)) {
      state.collected.push(key);
      runner.crystals += 1;
      state.tiles[idx(state.cols, nx, ny)] = 'floor';
      state.lastEvent = `crystal:${playerId}`;
    }
  }
  if (tile === 'finish') {
    runner.finishedAt = now;
    state.lastEvent = `finish:${playerId}`;
  }
  return { ok: true };
}

export const magnetMazeGame: GameModule<MagnetState> = {
  metadata: MAGNET_MAZE_METADATA,

  initialize(): void {
    // Stateless module.
  },

  createInitialState(players, settings): MagnetState {
    const seed = typeof settings.seed === 'number' ? settings.seed : 1;
    const tiles = generateMagnetMaze(seed, MAGNET_COLS, MAGNET_ROWS);
    const starts = startCells(MAGNET_COLS, MAGNET_ROWS);
    const runners: Record<string, MagnetRunner> = {};
    players.forEach((player, index) => {
      const start = starts[index % starts.length]!;
      runners[player.id] = {
        x: start.x,
        y: start.y,
        polarity: 'north',
        crystals: 0,
        frozenUntil: 0,
        finishedAt: null,
        disconnected: false,
        left: false,
      };
    });
    return {
      phase: 'idle',
      cols: MAGNET_COLS,
      rows: MAGNET_ROWS,
      tiles,
      runners,
      collected: [],
      startedAt: null,
      endsAt: null,
      durationMs: MAGNET_MATCH_MS,
      finishReason: null,
      lastEvent: null,
      nextAIRequestAt: {},
      startCells: starts,
      finishCell: magnetFinishCell(MAGNET_COLS, MAGNET_ROWS),
    };
  },

  playerJoined(player, state): void {
    const existing = state.runners[player.id];
    if (existing) {
      existing.disconnected = false;
      return;
    }
    const start = state.startCells[Object.keys(state.runners).length % state.startCells.length]!;
    state.runners[player.id] = {
      x: start.x,
      y: start.y,
      polarity: 'north',
      crystals: 0,
      frozenUntil: 0,
      finishedAt: null,
      disconnected: false,
      left: false,
    };
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
    if (remaining.length <= 1) finishMagnet(state, ctx, 'abandoned');
  },

  start(state, ctx): void {
    if (state.phase === 'playing') return;
    const tiles = generateMagnetMaze(ctx.seed, state.cols, state.rows);
    const starts = startCells(state.cols, state.rows);
    const runners: Record<string, MagnetRunner> = {};
    ctx.players.forEach((player, index) => {
      const start = starts[index % starts.length]!;
      runners[player.id] = {
        x: start.x,
        y: start.y,
        polarity: 'north',
        crystals: 0,
        frozenUntil: 0,
        finishedAt: null,
        disconnected: false,
        left: false,
      };
    });
    state.tiles = tiles;
    state.runners = runners;
    state.collected = [];
    state.startCells = starts;
    state.finishCell = magnetFinishCell(state.cols, state.rows);
    state.phase = 'playing';
    state.startedAt = ctx.now();
    state.endsAt = state.startedAt + state.durationMs;
    state.finishReason = null;
    state.lastEvent = 'start';
    ctx.markStateChanged();
    ctx.schedule(state.durationMs, () => finishMagnet(state, ctx, 'timeout'), 'gameDuration', 'match-timeout');
  },

  validateAction(playerId, action, state, ctx): ValidationResult {
    if (state.phase !== 'playing') return { valid: false, reason: 'The maze is not running.' };
    const runner = state.runners[playerId];
    if (!runner || runner.left) return { valid: false, reason: 'You are not in this maze.' };
    if (runner.finishedAt != null) return { valid: false, reason: 'You already finished.' };
    if (action.type === 'move') {
      if (!isMagnetDirection(action.payload?.direction)) return { valid: false, reason: 'Use up, down, left or right.' };
      if (ctx.now() < runner.frozenUntil) return { valid: false, reason: 'You are stunned.' };
      const d = DELTA[action.payload.direction as MagnetDirection];
      if (tileAt(state, runner.x + d.dx, runner.y + d.dy) === 'wall') return { valid: false, reason: 'Wall.' };
      return { valid: true };
    }
    if (action.type === 'flip') return { valid: true };
    if (action.type === 'finish') return { valid: false, reason: 'The server decides when you finish.' };
    return { valid: false, reason: 'Unknown action.' };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    const runner = state.runners[playerId];
    if (!runner || state.phase !== 'playing' || runner.left) return actionRejected('You cannot act.');
    if (action.type === 'flip') {
      if (runner.finishedAt != null) return actionRejected('Already finished.');
      runner.polarity = runner.polarity === 'north' ? 'south' : 'north';
      state.lastEvent = `flip:${playerId}`;
      ctx.markStateChanged();
      return actionAccepted();
    }
    if (action.type === 'move') {
      const direction = action.payload?.direction;
      if (!isMagnetDirection(direction)) return actionRejected('Invalid direction.');
      const result = tryStep(state, playerId, direction, ctx.now());
      if (!result.ok) return actionRejected(result.reason ?? 'Cannot move.');
      ctx.markStateChanged();
      maybeAllFinished(state, ctx);
      return actionAccepted();
    }
    if (action.type === 'finish') return actionRejected('The server decides when you finish.');
    return actionRejected('Unknown action.');
  },

  update(state, _deltaTimeMs, ctx): void {
    if (state.phase !== 'playing') return;
    for (const player of ctx.players) {
      if (!player.isAI) continue;
      const runner = state.runners[player.id];
      if (!runner || runner.left || runner.finishedAt != null) continue;
      const now = ctx.now();
      const difficulty = player.aiDifficulty ?? 'medium';
      if (now >= (state.nextAIRequestAt[player.id] ?? 0)) {
        ctx.requestAI(player.id, 40);
        state.nextAIRequestAt[player.id] = now + AI_INTERVAL[difficulty];
      }
    }
  },

  tick(): void {
    // Handled by update().
  },

  calculateScore(playerId, state): number {
    const runner = state.runners[playerId];
    return runner ? magnetScore(runner) : 0;
  },

  checkWinCondition(state): string[] | null {
    if (state.phase !== 'finished') return null;
    const ranked = rankMagnet(state);
    if (ranked.length === 0) return [];
    const best = ranked[0]!;
    return ranked.filter((entry) => entry.key === best.key).map((entry) => entry.id);
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
    const ranked = rankMagnet(state);
    const best = ranked[0];
    const winners = ranked.filter((entry) => entry.key === best?.key).map((entry) => entry.id);
    const rankings: RankingDraft[] = ctx.players.map((player) => {
      const index = ranked.findIndex((entry) => entry.id === player.id);
      const runner = state.runners[player.id];
      return {
        playerId: player.id,
        rank: index >= 0 ? index + 1 : ctx.players.length,
        score: runner ? magnetScore(runner) : 0,
        isWinner: winners.includes(player.id),
        isDraw: winners.length > 1,
        stats: { crystals: runner?.crystals ?? 0, finished: runner?.finishedAt != null ? 1 : 0 },
      };
    });
    rankings.sort((a, b) => a.rank - b.rank);
    return { winners, isDraw: winners.length > 1, rankings, reason: state.finishReason ?? 'completed' };
  },

  reset(state): MagnetState {
    const tiles = generateMagnetMaze(1, state.cols, state.rows);
    const starts = startCells(state.cols, state.rows);
    const runners: Record<string, MagnetRunner> = {};
    Object.keys(state.runners).forEach((id, index) => {
      const start = starts[index % starts.length]!;
      runners[id] = {
        x: start.x,
        y: start.y,
        polarity: 'north',
        crystals: 0,
        frozenUntil: 0,
        finishedAt: null,
        disconnected: false,
        left: false,
      };
    });
    return {
      ...state,
      phase: 'idle',
      tiles,
      runners,
      collected: [],
      startedAt: null,
      endsAt: null,
      finishReason: null,
      lastEvent: null,
      nextAIRequestAt: {},
      startCells: starts,
    };
  },

  cleanup(state): void {
    state.runners = {};
    state.tiles = [];
    state.phase = 'finished';
  },

  getPublicState(state, _viewerId, ctx) {
    return {
      phase: state.phase,
      cols: state.cols,
      rows: state.rows,
      tiles: state.tiles.slice(),
      collected: state.collected.slice(),
      startedAt: state.startedAt,
      endsAt: state.endsAt,
      durationMs: state.durationMs,
      finishReason: state.finishReason,
      lastEvent: state.lastEvent,
      serverTime: ctx.now(),
      finishCell: { ...state.finishCell },
      runners: Object.fromEntries(
        Object.entries(state.runners).map(([id, runner]) => [
          id,
          {
            x: runner.x,
            y: runner.y,
            polarity: runner.polarity,
            crystals: runner.crystals,
            frozen: ctx.now() < runner.frozenUntil,
            finished: runner.finishedAt != null,
            disconnected: runner.disconnected,
            score: magnetScore(runner),
          },
        ]),
      ),
    };
  },

  getAIMove(playerId, difficulty, state): GameAction | null {
    if (state.phase !== 'playing') return null;
    const runner = state.runners[playerId];
    if (!runner || runner.left || runner.finishedAt != null) return null;
    if (difficulty !== 'easy') {
      const pull = magnetDelta(tileAt(state, runner.x, runner.y), runner.polarity);
      if (pull) {
        const ahead = tileAt(state, runner.x + pull.dx, runner.y + pull.dy);
        if (ahead === 'wall' || ahead === 'spike') return { type: 'flip' };
      }
    }
    const options = ALL_DIRS.filter((dir) => tileAt(state, runner.x + DELTA[dir].dx, runner.y + DELTA[dir].dy) !== 'wall');
    if (options.length === 0) return null;
    const scored = options.map((dir) => {
      const n = { x: runner.x + DELTA[dir].dx, y: runner.y + DELTA[dir].dy };
      const dist = Math.abs(n.x - state.finishCell.x) + Math.abs(n.y - state.finishCell.y);
      return { dir, dist };
    });
    scored.sort((a, b) => a.dist - b.dist);
    if (difficulty === 'easy' && scored.length > 1 && Math.random() < 0.35) return { type: 'move', payload: { direction: scored[1]!.dir } };
    return { type: 'move', payload: { direction: scored[0]!.dir } };
  },

  needsUpdateLoop: true,
  maxDurationMs: 5 * 60 * 1000,
};

function rankMagnet(state: MagnetState): Array<{ id: string; key: string }> {
  return Object.entries(state.runners)
    .filter(([, runner]) => !runner.left)
    .map(([id, runner]) => {
      const dist = Math.abs(runner.x - state.finishCell.x) + Math.abs(runner.y - state.finishCell.y);
      const finishRank = runner.finishedAt == null ? 1 : 0;
      const key = `${finishRank}:${(runner.finishedAt ?? 9e15).toString().padStart(16, '0')}:${(999 - runner.crystals).toString().padStart(4, '0')}:${dist.toString().padStart(4, '0')}`;
      return { id, key };
    })
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.id.localeCompare(b.id)));
}
