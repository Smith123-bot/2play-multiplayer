import type { AIDifficulty, GameAction, GameFinishReason } from '@2play/shared';
import { MIRROR_ARENA_METADATA } from '@2play/shared';
export { MIRROR_ARENA_METADATA };
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
 * Mirror Arena — every step is mirrored across the vertical axis.
 * Plates, gates, crystals and hazards are resolved on the server.
 */

export type MirrorPhase = 'idle' | 'playing' | 'finished';
export type MirrorDirection = 'up' | 'down' | 'left' | 'right';
export type MirrorCell = 'wall' | 'floor' | 'plate' | 'gate' | 'crystal' | 'hazard' | 'exit';

export interface MirrorPlayer {
  x: number;
  y: number;
  mx: number;
  my: number;
  score: number;
  crystals: number;
  frozenUntil: number;
  exited: boolean;
  disconnected: boolean;
  left: boolean;
}

export interface MirrorPlate {
  x: number;
  y: number;
  held: boolean;
}

export interface MirrorState {
  phase: MirrorPhase;
  cols: number;
  rows: number;
  grid: MirrorCell[][];
  plates: MirrorPlate[];
  gatesOpen: boolean;
  players: Record<string, MirrorPlayer>;
  startedAt: number | null;
  endsAt: number | null;
  finishReason: GameFinishReason | null;
  lastEvent: string | null;
  nextAIRequestAt: Record<string, number>;
}

export const MIRROR_COLS = 11;
export const MIRROR_ROWS = 7;
export const MATCH_MS = 90_000;
export const FREEZE_MS = 1_400;
export const CRYSTAL_SCORE = 20;
export const EXIT_SCORE = 80;

const DELTA: Record<MirrorDirection, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};
const ALL_DIRS: MirrorDirection[] = ['up', 'down', 'left', 'right'];
const AI_INTERVAL: Record<AIDifficulty, number> = { easy: 360, medium: 200, hard: 110 };
const STARTS: Array<{ x: number; y: number }> = [
  { x: 1, y: 1 },
  { x: 1, y: 5 },
  { x: 2, y: 1 },
  { x: 2, y: 5 },
];

export function isMirrorDirection(value: unknown): value is MirrorDirection {
  return value === 'up' || value === 'down' || value === 'left' || value === 'right';
}

export function mirrorX(x: number, cols: number = MIRROR_COLS): number {
  return cols - 1 - x;
}

export function buildArena(): { grid: MirrorCell[][]; plates: MirrorPlate[] } {
  const grid: MirrorCell[][] = [];
  for (let y = 0; y < MIRROR_ROWS; y += 1) {
    const row: MirrorCell[] = [];
    for (let x = 0; x < MIRROR_COLS; x += 1) {
      if (x === 0 || y === 0 || x === MIRROR_COLS - 1 || y === MIRROR_ROWS - 1) row.push('wall');
      else row.push('floor');
    }
    grid.push(row);
  }
  for (const [x, y] of [
    [3, 2],
    [7, 2],
    [3, 4],
    [7, 4],
  ] as Array<[number, number]>) {
    grid[y]![x] = 'wall';
  }
  const plates: MirrorPlate[] = [
    { x: 2, y: 3, held: false },
    { x: 8, y: 3, held: false },
  ];
  for (const plate of plates) grid[plate.y]![plate.x] = 'plate';
  grid[3]![4] = 'gate';
  grid[3]![6] = 'gate';
  grid[1]![2] = 'crystal';
  grid[1]![8] = 'crystal';
  grid[5]![2] = 'crystal';
  grid[5]![8] = 'crystal';
  grid[5]![4] = 'hazard';
  grid[5]![6] = 'hazard';
  grid[3]![1] = 'exit';
  grid[3]![9] = 'exit';
  return { grid, plates };
}

function inBounds(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < MIRROR_COLS && y < MIRROR_ROWS;
}

export function refreshPlates(state: MirrorState): void {
  for (const plate of state.plates) {
    plate.held = Object.values(state.players).some(
      (player) =>
        !player.left &&
        ((player.x === plate.x && player.y === plate.y) || (player.mx === plate.x && player.my === plate.y)),
    );
  }
  state.gatesOpen = state.plates.length > 0 && state.plates.every((plate) => plate.held);
}

function blocked(state: MirrorState, x: number, y: number): boolean {
  if (!inBounds(x, y)) return true;
  const cell = state.grid[y]![x]!;
  if (cell === 'wall') return true;
  if (cell === 'gate' && !state.gatesOpen) return true;
  return false;
}

function occupied(state: MirrorState, x: number, y: number, ignoreId: string): boolean {
  return Object.entries(state.players).some(([id, player]) => {
    if (id === ignoreId || player.left) return false;
    return (player.x === x && player.y === y) || (player.mx === x && player.my === y);
  });
}

function makePlayer(index: number): MirrorPlayer {
  const start = STARTS[index % STARTS.length]!;
  return {
    x: start.x,
    y: start.y,
    mx: mirrorX(start.x),
    my: start.y,
    score: 0,
    crystals: 0,
    frozenUntil: 0,
    exited: false,
    disconnected: false,
    left: false,
  };
}

export function finishMirror(state: MirrorState, ctx: GameContext, reason: GameFinishReason): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.finishReason = reason;
  state.lastEvent = reason === 'timeout' ? 'timeout' : 'finished';
  ctx.markStateChanged();
  ctx.finish(reason);
}

function collectAt(state: MirrorState, player: MirrorPlayer, x: number, y: number): boolean {
  if (state.grid[y]![x] !== 'crystal') return false;
  state.grid[y]![x] = 'floor';
  player.crystals += 1;
  player.score += CRYSTAL_SCORE;
  return true;
}

function tryExit(state: MirrorState, playerId: string, player: MirrorPlayer): void {
  if (player.exited || !state.gatesOpen) return;
  const onExit = state.grid[player.y]![player.x] === 'exit' || state.grid[player.my]![player.mx] === 'exit';
  if (!onExit) return;
  player.exited = true;
  player.score += EXIT_SCORE;
  state.lastEvent = `exit:${playerId}`;
}

export const mirrorArenaGame: GameModule<MirrorState> = {
  metadata: MIRROR_ARENA_METADATA,

  initialize(): void {
    // Stateless module.
  },

  createInitialState(players): MirrorState {
    const { grid, plates } = buildArena();
    const state: MirrorState = {
      phase: 'idle',
      cols: MIRROR_COLS,
      rows: MIRROR_ROWS,
      grid,
      plates,
      gatesOpen: false,
      players: Object.fromEntries(players.map((player, index) => [player.id, makePlayer(index)])),
      startedAt: null,
      endsAt: null,
      finishReason: null,
      lastEvent: null,
      nextAIRequestAt: {},
    };
    refreshPlates(state);
    return state;
  },

  playerJoined(player, state): void {
    const existing = state.players[player.id];
    if (existing) {
      existing.disconnected = false;
      return;
    }
    state.players[player.id] = makePlayer(Object.keys(state.players).length);
  },

  playerReady(): void {
    // Lobby concern.
  },

  playerLeft(playerId, state, ctx, reason): void {
    const player = state.players[playerId];
    if (!player) return;
    if (reason === 'disconnect') {
      player.disconnected = true;
      return;
    }
    player.left = true;
    refreshPlates(state);
    const remaining = Object.values(state.players).filter((entry) => !entry.left);
    if (remaining.length <= 1) finishMirror(state, ctx, 'abandoned');
  },

  start(state, ctx): void {
    if (state.phase === 'playing') return;
    const built = buildArena();
    state.grid = built.grid;
    state.plates = built.plates;
    ctx.players.forEach((player, index) => {
      state.players[player.id] = makePlayer(index);
    });
    refreshPlates(state);
    state.phase = 'playing';
    state.startedAt = ctx.now();
    state.endsAt = ctx.now() + MATCH_MS;
    state.lastEvent = 'start';
    ctx.markStateChanged();
    ctx.schedule(MATCH_MS, () => finishMirror(state, ctx, 'timeout'), 'gameDuration', 'match-timeout');
    for (const player of ctx.players) {
      if (player.isAI) ctx.requestAI(player.id, 160);
    }
  },

  validateAction(playerId, action, state, ctx): ValidationResult {
    if (action.type === 'score' || action.type === 'mirror' || action.type === 'open') {
      return { valid: false, reason: 'The server owns the mirror and the gates.' };
    }
    if (action.type !== 'move') return { valid: false, reason: 'Unknown action.' };
    if (!isMirrorDirection(action.payload?.direction)) return { valid: false, reason: 'Use up, down, left or right.' };
    if (state.phase !== 'playing') return { valid: false, reason: 'The arena is not live.' };
    const player = state.players[playerId];
    if (!player || player.left || player.exited) return { valid: false, reason: 'You cannot move.' };
    if (player.disconnected) return { valid: false, reason: 'Reconnect to keep moving.' };
    if (ctx.now() < player.frozenUntil) return { valid: false, reason: 'A hazard froze you.' };
    const { dx, dy } = DELTA[action.payload.direction];
    const nx = player.x + dx;
    const ny = player.y + dy;
    const mx = mirrorX(nx);
    const my = ny;
    if (nx === mx && ny === my) return { valid: false, reason: 'You would collide with your mirror.' };
    if (blocked(state, nx, ny) || blocked(state, mx, my)) return { valid: false, reason: 'Blocked by a wall or a closed gate.' };
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    if (action.type !== 'move') return actionRejected('The server owns the mirror and the gates.');
    const direction = action.payload?.direction;
    if (!isMirrorDirection(direction)) return actionRejected('Invalid direction.');
    const player = state.players[playerId];
    if (!player || state.phase !== 'playing' || player.left || player.exited) return actionRejected('You cannot move.');
    if (ctx.now() < player.frozenUntil) return actionRejected('A hazard froze you.');
    const { dx, dy } = DELTA[direction];
    const nx = player.x + dx;
    const ny = player.y + dy;
    const mx = mirrorX(nx);
    const my = ny;
    if (nx === mx && ny === my) return actionRejected('You would collide with your mirror.');
    if (blocked(state, nx, ny) || blocked(state, mx, my)) return actionRejected('Blocked.');
    if (occupied(state, nx, ny, playerId) || occupied(state, mx, my, playerId)) {
      return actionRejected('Someone already occupies that cell.');
    }
    player.x = nx;
    player.y = ny;
    player.mx = mx;
    player.my = my;
    const grabbed = collectAt(state, player, nx, ny) || collectAt(state, player, mx, my);
    if (state.grid[ny]![nx] === 'hazard' || state.grid[my]![mx] === 'hazard') {
      player.frozenUntil = ctx.now() + FREEZE_MS;
      state.lastEvent = `hazard:${playerId}`;
    } else if (grabbed) {
      state.lastEvent = `crystal:${playerId}`;
    } else {
      state.lastEvent = `move:${playerId}`;
    }
    refreshPlates(state);
    tryExit(state, playerId, player);
    ctx.markStateChanged();
    const living = Object.values(state.players).filter((entry) => !entry.left);
    if (living.length > 0 && living.every((entry) => entry.exited)) finishMirror(state, ctx, 'completed');
    return actionAccepted();
  },

  update(state, _delta, ctx): void {
    if (state.phase !== 'playing') return;
    refreshPlates(state);
    for (const player of ctx.players) {
      if (!player.isAI) continue;
      const body = state.players[player.id];
      if (!body || body.left || body.exited) continue;
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
    return state.players[playerId]?.score ?? 0;
  },

  checkWinCondition(state): string[] | null {
    if (state.phase !== 'finished') return null;
    const entries = Object.entries(state.players).filter(([, player]) => !player.left);
    if (entries.length === 0) return [];
    const best = Math.max(...entries.map(([, player]) => player.score));
    return entries.filter(([, player]) => player.score === best).map(([id]) => id);
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
      const left = state.players[a.id];
      const right = state.players[b.id];
      if ((left?.exited ?? false) !== (right?.exited ?? false)) return left?.exited ? -1 : 1;
      return (right?.score ?? 0) - (left?.score ?? 0);
    });
    const best = ranked[0] ? state.players[ranked[0].id]?.score ?? 0 : 0;
    const topExited = ranked[0] ? Boolean(state.players[ranked[0].id]?.exited) : false;
    const winners = ranked
      .filter((player) => {
        const entry = state.players[player.id];
        return (entry?.score ?? 0) === best && Boolean(entry?.exited) === topExited;
      })
      .map((player) => player.id);
    const rankings: RankingDraft[] = ranked.map((player, index) => {
      const entry = state.players[player.id];
      return {
        playerId: player.id,
        rank: index + 1,
        score: entry?.score ?? 0,
        isWinner: winners.includes(player.id),
        isDraw: winners.length > 1,
        stats: { crystals: entry?.crystals ?? 0, exited: entry?.exited ? 1 : 0 },
      };
    });
    return { winners, isDraw: winners.length > 1, rankings, reason: state.finishReason ?? 'completed' };
  },

  reset(state): MirrorState {
    const ids = Object.keys(state.players);
    const built = buildArena();
    const next: MirrorState = {
      ...state,
      phase: 'idle',
      grid: built.grid,
      plates: built.plates,
      gatesOpen: false,
      players: Object.fromEntries(ids.map((id, index) => [id, makePlayer(index)])),
      startedAt: null,
      endsAt: null,
      finishReason: null,
      lastEvent: null,
      nextAIRequestAt: {},
    };
    refreshPlates(next);
    return next;
  },

  cleanup(state): void {
    state.players = {};
    state.phase = 'finished';
  },

  getPublicState(state, _viewerId, ctx) {
    return {
      phase: state.phase,
      cols: state.cols,
      rows: state.rows,
      grid: state.grid.map((row) => [...row]),
      plates: state.plates.map((plate) => ({ ...plate })),
      gatesOpen: state.gatesOpen,
      endsAt: state.endsAt,
      finishReason: state.finishReason,
      lastEvent: state.lastEvent,
      serverTime: ctx.now(),
      players: Object.fromEntries(
        Object.entries(state.players).map(([id, player]) => [
          id,
          {
            x: player.x,
            y: player.y,
            mx: player.mx,
            my: player.my,
            score: player.score,
            crystals: player.crystals,
            frozen: ctx.now() < player.frozenUntil,
            exited: player.exited,
            disconnected: player.disconnected,
          },
        ]),
      ),
    };
  },

  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'playing') return null;
    const player = state.players[playerId];
    if (!player || player.left || player.exited) return null;
    const plate = state.plates.find((entry) => !entry.held) ?? state.plates[0];
    const tx = plate?.x ?? 2;
    const ty = plate?.y ?? 3;
    let chosen: MirrorDirection | null = null;
    if (player.x < tx) chosen = 'right';
    else if (player.x > tx) chosen = 'left';
    else if (player.y < ty) chosen = 'down';
    else if (player.y > ty) chosen = 'up';
    if (chosen) {
      const probe = { type: 'move', payload: { direction: chosen } } satisfies GameAction;
      if (this.validateAction(playerId, probe, state, ctx).valid && difficulty !== 'easy') return probe;
    }
    const legal = ALL_DIRS.filter((direction) => {
      return this.validateAction(playerId, { type: 'move', payload: { direction } }, state, ctx).valid;
    });
    if (legal.length === 0) return null;
    return { type: 'move', payload: { direction: legal[Math.floor(ctx.random() * legal.length)]! } };
  },

  needsUpdateLoop: true,
  maxDurationMs: 8 * 60 * 1000,
};
