import type { GameAction, GameFinishReason } from '@2play/shared';
import { INVISIBLE_PATH_METADATA } from '@2play/shared';
export { INVISIBLE_PATH_METADATA };
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
 * Invisible Path — brief safe-path preview, then hidden tiles. Server owns the path.
 */

export type PathPhase = 'idle' | 'preview' | 'playing' | 'finished';

export interface PathPlayer {
  x: number;
  y: number;
  score: number;
  wrongs: number;
  stunUntil: number;
  finished: boolean;
  visited: string[];
  disconnected: boolean;
  left: boolean;
}

export interface PathState {
  phase: PathPhase;
  round: number;
  totalRounds: number;
  cols: number;
  rows: number;
  safe: string[];
  decoys: string[];
  start: { x: number; y: number };
  goal: { x: number; y: number };
  layoutId: number;
  players: Record<string, PathPlayer>;
  startedAt: number | null;
  endsAt: number | null;
  previewUntil: number | null;
  finishReason: GameFinishReason | null;
  lastEvent: string | null;
}

export const PATH_COLS = 9;
export const PATH_ROWS = 7;
export const PATH_LAYOUTS = 8;
export const PREVIEW_MS = 3_000;
export const ROUND_MS = 28_000;
export const WRONG_STUN_MS = 900;
export const SCORE_STEP = 8;
export const SCORE_FINISH = 80;
export const WRONG_PENALTY = 6;

function key(x: number, y: number): string {
  return `${x},${y}`;
}

export function patternedY(col: number, layoutId: number): number {
  const pattern = layoutId % PATH_LAYOUTS;
  let y: number;
  if (pattern === 0) y = 3 + (col % 4 === 1 ? 1 : col % 4 === 3 ? -1 : 0);
  else if (pattern === 1) y = col % 2 === 0 ? 2 : 4;
  else if (pattern === 2) y = 1 + (Math.floor(col / 2) % 4);
  else if (pattern === 3) y = 5 - (col % 5);
  else if (pattern === 4) y = col < 4 ? 1 : 5;
  else if (pattern === 5) y = 3 - (col % 3 === 0 ? 1 : 0) + (col % 3 === 2 ? 1 : 0);
  else if (pattern === 6) y = col % 2 === 0 ? 6 : 0;
  else y = (col + pattern) % PATH_ROWS;
  return Math.max(0, Math.min(PATH_ROWS - 1, y));
}

export function generateSafePath(layoutId: number): {
  safe: string[];
  decoys: string[];
  start: { x: number; y: number };
  goal: { x: number; y: number };
} {
  const start = { x: 0, y: 3 };
  const goal = { x: PATH_COLS - 1, y: layoutId % 2 === 0 ? 3 : 2 };
  const cells: Array<{ x: number; y: number }> = [{ ...start }];
  let x = start.x;
  let y = start.y;
  const waypoints: Array<{ x: number; y: number }> = [];
  for (let col = 1; col < PATH_COLS - 1; col += 1) {
    waypoints.push({ x: col, y: patternedY(col, layoutId) });
  }
  waypoints.push({ ...goal });
  for (const waypoint of waypoints) {
    while (x !== waypoint.x || y !== waypoint.y) {
      if (x < waypoint.x) x += 1;
      else if (x > waypoint.x) x -= 1;
      else if (y < waypoint.y) y += 1;
      else y -= 1;
      cells.push({ x, y });
    }
  }
  const safe = [...new Set(cells.map((cell) => key(cell.x, cell.y)))];
  const decoys: string[] = [];
  for (let col = 1; col < PATH_COLS - 1 && decoys.length < 3; col += 2) {
    const yDecoy = Math.max(0, Math.min(PATH_ROWS - 1, patternedY(col, layoutId) + (layoutId % 2 === 0 ? 2 : -2)));
    const id = key(col, yDecoy);
    if (!safe.includes(id)) decoys.push(id);
  }
  return { safe, decoys, start, goal };
}

function makePlayer(start: { x: number; y: number }): PathPlayer {
  return {
    x: start.x,
    y: start.y,
    score: 0,
    wrongs: 0,
    stunUntil: 0,
    finished: false,
    visited: [key(start.x, start.y)],
    disconnected: false,
    left: false,
  };
}

export function finishPath(state: PathState, ctx: GameContext, reason: GameFinishReason): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.finishReason = reason;
  state.lastEvent = reason === 'timeout' ? 'timeout' : 'finished';
  ctx.markStateChanged();
  ctx.finish(reason);
}

export function beginPathRound(state: PathState, ctx: GameContext): void {
  const built = generateSafePath((state.layoutId + state.round) % PATH_LAYOUTS);
  state.safe = built.safe;
  state.decoys = built.decoys;
  state.start = built.start;
  state.goal = built.goal;
  state.phase = 'preview';
  state.previewUntil = ctx.now() + PREVIEW_MS;
  state.endsAt = ctx.now() + PREVIEW_MS + ROUND_MS;
  for (const player of Object.values(state.players)) {
    player.x = state.start.x;
    player.y = state.start.y;
    player.finished = false;
    player.stunUntil = 0;
    player.visited = [key(state.start.x, state.start.y)];
  }
  state.lastEvent = 'preview';
  ctx.markStateChanged();
  ctx.schedule(PREVIEW_MS, () => openPathRound(state, ctx), 'turn', `preview-${state.round}`);
}

export function openPathRound(state: PathState, ctx: GameContext): void {
  if (state.phase !== 'preview') return;
  state.phase = 'playing';
  state.lastEvent = 'hidden';
  ctx.markStateChanged();
  ctx.schedule(ROUND_MS, () => endPathRound(state, ctx), 'turn', `round-${state.round}`);
  for (const player of ctx.players) {
    if (player.isAI) ctx.requestAI(player.id, 220);
  }
}

export function endPathRound(state: PathState, ctx: GameContext): void {
  if (state.phase !== 'playing') return;
  if (state.round + 1 >= state.totalRounds) {
    finishPath(state, ctx, 'completed');
    return;
  }
  state.round += 1;
  beginPathRound(state, ctx);
}

export function canStep(player: PathPlayer, nx: number, ny: number, now: number, state: PathState): boolean {
  if (player.left || player.finished || state.phase !== 'playing') return false;
  if (now < player.stunUntil) return false;
  if (nx < 0 || ny < 0 || nx >= state.cols || ny >= state.rows) return false;
  if (Math.abs(nx - player.x) + Math.abs(ny - player.y) !== 1) return false;
  return true;
}

export const invisiblePathGame: GameModule<PathState> = {
  metadata: INVISIBLE_PATH_METADATA,

  initialize(): void {
    // Stateless module.
  },

  createInitialState(players, config): PathState {
    const start = { x: 0, y: 3 };
    return {
      phase: 'idle',
      round: 0,
      totalRounds: typeof config.rounds === 'number' ? Math.min(5, Math.max(2, config.rounds)) : 3,
      cols: PATH_COLS,
      rows: PATH_ROWS,
      safe: [],
      decoys: [],
      start,
      goal: { x: PATH_COLS - 1, y: 3 },
      layoutId: 0,
      players: Object.fromEntries(players.map((player) => [player.id, makePlayer(start)])),
      startedAt: null,
      endsAt: null,
      previewUntil: null,
      finishReason: null,
      lastEvent: null,
    };
  },

  playerJoined(player, state): void {
    const existing = state.players[player.id];
    if (existing) {
      existing.disconnected = false;
      return;
    }
    state.players[player.id] = makePlayer(state.start);
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
    const remaining = Object.values(state.players).filter((entry) => !entry.left);
    if (remaining.length <= 1) finishPath(state, ctx, 'abandoned');
  },

  start(state, ctx): void {
    if (state.phase === 'preview' || state.phase === 'playing') return;
    ctx.players.forEach((player) => {
      state.players[player.id] = makePlayer(state.start);
    });
    state.round = 0;
    state.layoutId = Math.abs(ctx.seed) % PATH_LAYOUTS;
    state.startedAt = ctx.now();
    beginPathRound(state, ctx);
    ctx.schedule(
      state.totalRounds * (PREVIEW_MS + ROUND_MS) + 2_000,
      () => finishPath(state, ctx, 'timeout'),
      'gameDuration',
      'match-timeout',
    );
  },

  validateAction(playerId, action, state, ctx): ValidationResult {
    if (action.type === 'score' || action.type === 'path' || action.type === 'finish') {
      return { valid: false, reason: 'The server owns the safe path.' };
    }
    if (action.type !== 'move') return { valid: false, reason: 'Unknown action.' };
    const player = state.players[playerId];
    if (!player) return { valid: false, reason: 'You are not in this match.' };
    const nx = action.payload?.x;
    const ny = action.payload?.y;
    if (typeof nx !== 'number' || typeof ny !== 'number') return { valid: false, reason: 'Need a tile.' };
    if (!canStep(player, nx, ny, ctx.now(), state)) return { valid: false, reason: 'That step is not allowed.' };
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    if (action.type !== 'move') return actionRejected('The server owns the safe path.');
    const player = state.players[playerId];
    if (!player) return actionRejected('You are not in this match.');
    const nx = action.payload?.x;
    const ny = action.payload?.y;
    if (typeof nx !== 'number' || typeof ny !== 'number') return actionRejected('Need a tile.');
    if (!canStep(player, nx, ny, ctx.now(), state)) return actionRejected('That step is not allowed.');
    const tile = key(nx, ny);
    if (!state.safe.includes(tile)) {
      player.wrongs += 1;
      player.score = Math.max(0, player.score - WRONG_PENALTY);
      player.stunUntil = ctx.now() + WRONG_STUN_MS;
      state.lastEvent = `wrong:${playerId}`;
      ctx.markStateChanged();
      return actionAccepted();
    }
    player.x = nx;
    player.y = ny;
    if (!player.visited.includes(tile)) {
      player.visited.push(tile);
      player.score += SCORE_STEP;
    }
    if (nx === state.goal.x && ny === state.goal.y && !player.finished) {
      player.finished = true;
      const remain = Math.max(0, (state.endsAt ?? ctx.now()) - ctx.now());
      player.score += SCORE_FINISH + Math.floor(remain / 400);
      state.lastEvent = `finish:${playerId}`;
      const active = Object.values(state.players).filter((entry) => !entry.left);
      if (active.length > 0 && active.every((entry) => entry.finished)) endPathRound(state, ctx);
    }
    ctx.markStateChanged();
    return actionAccepted();
  },

  update(state, _delta, ctx): void {
    if (state.phase !== 'playing') return;
    for (const player of ctx.players) {
      if (player.isAI && !state.players[player.id]?.finished) ctx.requestAI(player.id, 200);
    }
  },

  tick(): void {
    // Timer driven.
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
    const ranked = [...ctx.players].sort((a, b) => (state.players[b.id]?.score ?? 0) - (state.players[a.id]?.score ?? 0));
    const best = ranked[0] ? state.players[ranked[0].id]?.score ?? 0 : 0;
    const winners = ranked.filter((player) => (state.players[player.id]?.score ?? 0) === best).map((player) => player.id);
    const rankings: RankingDraft[] = ranked.map((player, index) => {
      const entry = state.players[player.id];
      return {
        playerId: player.id,
        rank: index + 1,
        score: entry?.score ?? 0,
        isWinner: winners.includes(player.id),
        isDraw: winners.length > 1,
        stats: { wrongs: entry?.wrongs ?? 0, finished: entry?.finished ? 1 : 0 },
      };
    });
    return { winners, isDraw: winners.length > 1, rankings, reason: state.finishReason ?? 'completed' };
  },

  reset(state): PathState {
    const ids = Object.keys(state.players);
    return {
      ...state,
      phase: 'idle',
      round: 0,
      safe: [],
      decoys: [],
      players: Object.fromEntries(ids.map((id) => [id, makePlayer(state.start)])),
      startedAt: null,
      endsAt: null,
      previewUntil: null,
      finishReason: null,
      lastEvent: null,
    };
  },

  cleanup(state): void {
    state.players = {};
    state.safe = [];
    state.phase = 'finished';
  },

  getPublicState(state, viewerId, ctx) {
    const mine = viewerId ? state.players[viewerId] : undefined;
    const visible =
      state.phase === 'preview'
        ? [...state.safe, ...state.decoys]
        : state.phase === 'finished'
          ? state.safe
          : mine
            ? mine.visited
            : [];
    return {
      phase: state.phase,
      round: state.round,
      totalRounds: state.totalRounds,
      cols: state.cols,
      rows: state.rows,
      start: state.start,
      goal: state.goal,
      safe: visible,
      endsAt: state.endsAt,
      previewUntil: state.previewUntil,
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
            wrongs: player.wrongs,
            stunned: ctx.now() < player.stunUntil,
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
    if (!player || player.finished || player.left) return null;
    if (ctx.now() < player.stunUntil) return null;
    const options = [
      { x: player.x + 1, y: player.y },
      { x: player.x, y: player.y + 1 },
      { x: player.x, y: player.y - 1 },
      { x: player.x - 1, y: player.y },
    ].filter((cell) => canStep(player, cell.x, cell.y, ctx.now(), state));
    if (options.length === 0) return null;
    const safeOptions = options.filter((cell) => state.safe.includes(key(cell.x, cell.y)));
    if (difficulty === 'hard' && safeOptions.length > 0) {
      const toward = safeOptions.find((cell) => cell.x > player.x) ?? safeOptions[0]!;
      return { type: 'move', payload: toward };
    }
    if (difficulty === 'medium' && safeOptions.length > 0 && ctx.random() > 0.25) {
      return { type: 'move', payload: safeOptions[0]! };
    }
    return { type: 'move', payload: options[Math.floor(ctx.random() * options.length)]! };
  },

  needsUpdateLoop: true,
  maxDurationMs: 6 * 60 * 1000,
};
