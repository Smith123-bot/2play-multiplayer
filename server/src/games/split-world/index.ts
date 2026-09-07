import type { AIDifficulty, GameAction, GameFinishReason } from '@2play/shared';
import { SPLIT_WORLD_METADATA } from '@2play/shared';
export { SPLIT_WORLD_METADATA };
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
 * Split World — one shared true layout, per-player views.
 * Hidden true tiles never leave the server. Clients only send a step.
 */

export type SplitPhase = 'idle' | 'playing' | 'finished';
export type SplitDirection = 'up' | 'down' | 'left' | 'right';
export type TrueTile = 'wall' | 'floor' | 'switch' | 'door' | 'goal' | 'decoy';
export type ViewTile = 'wall' | 'floor' | 'switch' | 'door' | 'goal' | 'unknown';
export type SplitRole = 'alpha' | 'beta';

export interface SplitPlayer {
  x: number;
  y: number;
  score: number;
  role: SplitRole;
  heldSwitch: boolean;
  finished: boolean;
  disconnected: boolean;
  left: boolean;
}

export interface SplitState {
  phase: SplitPhase;
  cols: number;
  rows: number;
  trueTiles: TrueTile[][];
  switches: Array<{ x: number; y: number; held: boolean }>;
  door: { x: number; y: number };
  goal: { x: number; y: number };
  doorOpen: boolean;
  players: Record<string, SplitPlayer>;
  startedAt: number | null;
  endsAt: number | null;
  finishReason: GameFinishReason | null;
  lastEvent: string | null;
  nextAIRequestAt: Record<string, number>;
}

export const SPLIT_COLS = 11;
export const SPLIT_ROWS = 7;
export const MATCH_MS = 90_000;
export const SWITCH_SCORE = 30;
export const GOAL_SCORE = 100;

const DELTA: Record<SplitDirection, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};
const ALL_DIRS: SplitDirection[] = ['up', 'down', 'left', 'right'];
const AI_INTERVAL: Record<AIDifficulty, number> = { easy: 360, medium: 200, hard: 110 };
const STARTS: Array<{ x: number; y: number }> = [
  { x: 1, y: 1 },
  { x: 1, y: 5 },
  { x: 2, y: 1 },
  { x: 2, y: 5 },
];

export function isSplitDirection(value: unknown): value is SplitDirection {
  return value === 'up' || value === 'down' || value === 'left' || value === 'right';
}

export function roleForSeat(seatIndex: number): SplitRole {
  return seatIndex % 2 === 0 ? 'alpha' : 'beta';
}

export function viewTile(trueTile: TrueTile, role: SplitRole): ViewTile {
  if (trueTile === 'wall' || trueTile === 'floor' || trueTile === 'goal') return trueTile;
  if (trueTile === 'switch') return role === 'alpha' ? 'switch' : 'floor';
  if (trueTile === 'door') return role === 'beta' ? 'door' : 'floor';
  if (trueTile === 'decoy') return role === 'alpha' ? 'wall' : 'switch';
  return 'unknown';
}

export function viewTiles(trueTiles: TrueTile[][], role: SplitRole): ViewTile[][] {
  return trueTiles.map((row) => row.map((tile) => viewTile(tile, role)));
}

export function buildWorld(): {
  tiles: TrueTile[][];
  switches: Array<{ x: number; y: number; held: boolean }>;
  door: { x: number; y: number };
  goal: { x: number; y: number };
} {
  const tiles: TrueTile[][] = [];
  for (let y = 0; y < SPLIT_ROWS; y += 1) {
    const row: TrueTile[] = [];
    for (let x = 0; x < SPLIT_COLS; x += 1) {
      if (x === 0 || y === 0 || x === SPLIT_COLS - 1 || y === SPLIT_ROWS - 1) row.push('wall');
      else row.push('floor');
    }
    tiles.push(row);
  }
  tiles[2]![4] = 'wall';
  tiles[4]![4] = 'wall';
  tiles[3]![6] = 'wall';
  const switches = [
    { x: 3, y: 2, held: false },
    { x: 3, y: 4, held: false },
  ];
  for (const entry of switches) tiles[entry.y]![entry.x] = 'switch';
  const door = { x: 8, y: 3 };
  const goal = { x: 9, y: 3 };
  tiles[door.y]![door.x] = 'door';
  tiles[goal.y]![goal.x] = 'goal';
  tiles[1]![5] = 'decoy';
  tiles[5]![5] = 'decoy';
  return { tiles, switches, door, goal };
}

function inBounds(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < SPLIT_COLS && y < SPLIT_ROWS;
}

export function blockedByTruth(state: SplitState, x: number, y: number): boolean {
  if (!inBounds(x, y)) return true;
  const tile = state.trueTiles[y]![x]!;
  if (tile === 'wall') return true;
  if (tile === 'door' && !state.doorOpen) return true;
  return false;
}

export function refreshSwitches(state: SplitState): void {
  for (const entry of state.switches) {
    if (
      Object.values(state.players).some(
        (player) => !player.left && player.x === entry.x && player.y === entry.y,
      )
    ) {
      entry.held = true;
    }
  }
  state.doorOpen = state.switches.length > 0 && state.switches.every((entry) => entry.held);
}

function makePlayer(index: number): SplitPlayer {
  const start = STARTS[index % STARTS.length]!;
  return {
    x: start.x,
    y: start.y,
    score: 0,
    role: roleForSeat(index),
    heldSwitch: false,
    finished: false,
    disconnected: false,
    left: false,
  };
}

export function finishSplit(state: SplitState, ctx: GameContext, reason: GameFinishReason): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.finishReason = reason;
  state.lastEvent = reason === 'timeout' ? 'timeout' : 'finished';
  ctx.markStateChanged();
  ctx.finish(reason);
}

function viewerRole(state: SplitState, viewerId: string | undefined, ctx: GameContext): SplitRole {
  if (viewerId && state.players[viewerId]) return state.players[viewerId]!.role;
  const seat = ctx.players.find((player) => player.id === viewerId)?.seatIndex;
  if (typeof seat === 'number') return roleForSeat(seat);
  return 'alpha';
}

export const splitWorldGame: GameModule<SplitState> = {
  metadata: SPLIT_WORLD_METADATA,

  initialize(): void {
    // Stateless module.
  },

  createInitialState(players): SplitState {
    const world = buildWorld();
    const state: SplitState = {
      phase: 'idle',
      cols: SPLIT_COLS,
      rows: SPLIT_ROWS,
      trueTiles: world.tiles,
      switches: world.switches,
      door: world.door,
      goal: world.goal,
      doorOpen: false,
      players: Object.fromEntries(players.map((player, index) => [player.id, makePlayer(index)])),
      startedAt: null,
      endsAt: null,
      finishReason: null,
      lastEvent: null,
      nextAIRequestAt: {},
    };
    refreshSwitches(state);
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
    refreshSwitches(state);
    const remaining = Object.values(state.players).filter((entry) => !entry.left);
    if (remaining.length <= 1) finishSplit(state, ctx, 'abandoned');
  },

  start(state, ctx): void {
    if (state.phase === 'playing') return;
    const world = buildWorld();
    state.trueTiles = world.tiles;
    state.switches = world.switches;
    state.door = world.door;
    state.goal = world.goal;
    ctx.players.forEach((player, index) => {
      state.players[player.id] = makePlayer(index);
    });
    refreshSwitches(state);
    state.phase = 'playing';
    state.startedAt = ctx.now();
    state.endsAt = ctx.now() + MATCH_MS;
    state.lastEvent = 'start';
    ctx.markStateChanged();
    ctx.schedule(MATCH_MS, () => finishSplit(state, ctx, 'timeout'), 'gameDuration', 'match-timeout');
    for (const player of ctx.players) {
      if (player.isAI) ctx.requestAI(player.id, 160);
    }
  },

  validateAction(playerId, action, state): ValidationResult {
    if (action.type === 'score' || action.type === 'reveal' || action.type === 'open' || action.type === 'world') {
      return { valid: false, reason: 'The server owns the true world.' };
    }
    if (action.type !== 'move') return { valid: false, reason: 'Unknown action.' };
    if (!isSplitDirection(action.payload?.direction)) return { valid: false, reason: 'Use up, down, left or right.' };
    if (state.phase !== 'playing') return { valid: false, reason: 'The world is not live.' };
    const player = state.players[playerId];
    if (!player || player.left || player.finished) return { valid: false, reason: 'You cannot move.' };
    if (player.disconnected) return { valid: false, reason: 'Reconnect to keep moving.' };
    const { dx, dy } = DELTA[action.payload.direction];
    if (blockedByTruth(state, player.x + dx, player.y + dy)) {
      return { valid: false, reason: 'A real wall or a closed door blocks that way.' };
    }
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    if (action.type !== 'move') return actionRejected('The server owns the true world.');
    const direction = action.payload?.direction;
    if (!isSplitDirection(direction)) return actionRejected('Invalid direction.');
    const player = state.players[playerId];
    if (!player || state.phase !== 'playing' || player.left || player.finished) return actionRejected('You cannot move.');
    const { dx, dy } = DELTA[direction];
    const nx = player.x + dx;
    const ny = player.y + dy;
    if (blockedByTruth(state, nx, ny)) return actionRejected('Blocked.');
    player.x = nx;
    player.y = ny;
    const tile = state.trueTiles[ny]![nx]!;
    const doorWasOpen = state.doorOpen;
    refreshSwitches(state);
    if (tile === 'switch' && !player.heldSwitch) {
      player.heldSwitch = true;
      player.score += SWITCH_SCORE;
      state.lastEvent = `switch:${playerId}`;
    } else {
      state.lastEvent = `move:${playerId}`;
    }
    if (tile === 'goal' && (state.doorOpen || doorWasOpen) && !player.finished) {
      player.finished = true;
      player.score += GOAL_SCORE;
      state.lastEvent = `goal:${playerId}`;
    }
    ctx.markStateChanged();
    const living = Object.values(state.players).filter((entry) => !entry.left);
    if (living.length > 0 && living.every((entry) => entry.finished)) finishSplit(state, ctx, 'completed');
    return actionAccepted();
  },

  update(state, _delta, ctx): void {
    if (state.phase !== 'playing') return;
    refreshSwitches(state);
    for (const player of ctx.players) {
      if (!player.isAI) continue;
      const body = state.players[player.id];
      if (!body || body.left || body.finished) continue;
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
      if ((left?.finished ?? false) !== (right?.finished ?? false)) return left?.finished ? -1 : 1;
      return (right?.score ?? 0) - (left?.score ?? 0);
    });
    const best = ranked[0] ? state.players[ranked[0].id]?.score ?? 0 : 0;
    const topFinished = ranked[0] ? Boolean(state.players[ranked[0].id]?.finished) : false;
    const winners = ranked
      .filter((player) => {
        const entry = state.players[player.id];
        return (entry?.score ?? 0) === best && Boolean(entry?.finished) === topFinished;
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
        stats: { finished: entry?.finished ? 1 : 0 },
      };
    });
    return { winners, isDraw: winners.length > 1, rankings, reason: state.finishReason ?? 'completed' };
  },

  reset(state): SplitState {
    const ids = Object.keys(state.players);
    const world = buildWorld();
    const next: SplitState = {
      ...state,
      phase: 'idle',
      trueTiles: world.tiles,
      switches: world.switches,
      door: world.door,
      goal: world.goal,
      doorOpen: false,
      players: Object.fromEntries(ids.map((id, index) => [id, makePlayer(index)])),
      startedAt: null,
      endsAt: null,
      finishReason: null,
      lastEvent: null,
      nextAIRequestAt: {},
    };
    refreshSwitches(next);
    return next;
  },

  cleanup(state): void {
    state.players = {};
    state.trueTiles = [];
    state.phase = 'finished';
  },

  getPublicState(state, viewerId, ctx) {
    const role = viewerRole(state, viewerId, ctx);
    const tiles = viewTiles(state.trueTiles, role);
    return {
      phase: state.phase,
      cols: state.cols,
      rows: state.rows,
      role,
      tiles,
      doorOpen: state.doorOpen,
      goal: { ...state.goal },
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
            score: player.score,
            role: player.role,
            finished: player.finished,
            disconnected: player.disconnected,
          },
        ]),
      ),
    };
  },

  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'playing') return null;
    const player = state.players[playerId];
    if (!player || player.left || player.finished) return null;
    const target = player.role === 'alpha' ? (state.switches.find((entry) => !entry.held) ?? state.switches[0]) : state.doorOpen ? state.goal : state.door;
    if (!target) return null;
    let chosen: SplitDirection | null = null;
    if (player.x < target.x) chosen = 'right';
    else if (player.x > target.x) chosen = 'left';
    else if (player.y < target.y) chosen = 'down';
    else if (player.y > target.y) chosen = 'up';
    if (chosen && !blockedByTruth(state, player.x + DELTA[chosen].dx, player.y + DELTA[chosen].dy) && difficulty !== 'easy') {
      return { type: 'move', payload: { direction: chosen } };
    }
    const legal = ALL_DIRS.filter(
      (direction) => !blockedByTruth(state, player.x + DELTA[direction].dx, player.y + DELTA[direction].dy),
    );
    if (legal.length === 0) return null;
    return { type: 'move', payload: { direction: legal[Math.floor(ctx.random() * legal.length)]! } };
  },

  needsUpdateLoop: true,
  maxDurationMs: 8 * 60 * 1000,
};
