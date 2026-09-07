import type { AIDifficulty, GameAction, GameFinishReason } from '@2play/shared';
import { REVERSE_RACE_METADATA } from '@2play/shared';
export { REVERSE_RACE_METADATA };
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
 * Reverse Race — each round publishes a different objective. Movement, tokens,
 * finish times and ranks are owned by the server. Clients only send a step.
 */

export type ReversePhase = 'idle' | 'playing' | 'between' | 'finished';
export type ReverseDirection = 'up' | 'down' | 'left' | 'right';
export type ReverseObjectiveKind =
  | 'finish-first'
  | 'second-place'
  | 'exact-time'
  | 'collect-exact'
  | 'stop-zone';
export type ReverseCell = 'wall' | 'floor' | 'finish' | 'coin' | 'zone';

export interface ReverseObjective {
  kind: ReverseObjectiveKind;
  label: string;
  targetMs?: number;
  targetCoins?: number;
}

export interface ReversePlayer {
  x: number;
  y: number;
  score: number;
  roundScore: number;
  coins: number;
  collected: string[];
  finished: boolean;
  finishMs: number | null;
  disconnected: boolean;
  left: boolean;
}

export interface ReverseState {
  phase: ReversePhase;
  round: number;
  totalRounds: number;
  cols: number;
  rows: number;
  grid: ReverseCell[][];
  objective: ReverseObjective;
  players: Record<string, ReversePlayer>;
  finishOrder: string[];
  startedAt: number | null;
  endsAt: number | null;
  roundMs: number;
  finishReason: GameFinishReason | null;
  lastEvent: string | null;
  nextAIRequestAt: Record<string, number>;
}

export const REVERSE_COLS = 12;
export const REVERSE_ROWS = 6;
export const ROUND_MS = 20_000;
export const BETWEEN_MS = 1_600;
export const TARGET_TIME_MS = 6_000;
export const TARGET_COINS = 2;
export const PLACE_POINTS = [100, 60, 40, 20];

export const OBJECTIVES: ReverseObjective[] = [
  { kind: 'finish-first', label: 'Finish FIRST. Fastest across the line wins this round.' },
  {
    kind: 'collect-exact',
    label: 'Collect EXACTLY 2 tokens. Extra tokens do not help.',
    targetCoins: TARGET_COINS,
  },
  { kind: 'stop-zone', label: 'STOP inside the amber zone when the clock ends.' },
  {
    kind: 'exact-time',
    label: 'Finish as close as possible to 6.0 seconds.',
    targetMs: TARGET_TIME_MS,
  },
  { kind: 'second-place', label: 'Finish in 2ND PLACE. First across is a trap.' },
];

const DELTA: Record<ReverseDirection, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};
const ALL_DIRS: ReverseDirection[] = ['up', 'down', 'left', 'right'];
const AI_INTERVAL: Record<AIDifficulty, number> = { easy: 380, medium: 200, hard: 110 };
const STARTS: Array<{ x: number; y: number }> = [
  { x: 1, y: 1 },
  { x: 1, y: 2 },
  { x: 1, y: 3 },
  { x: 1, y: 4 },
];

export function isReverseDirection(value: unknown): value is ReverseDirection {
  return value === 'up' || value === 'down' || value === 'left' || value === 'right';
}

export function buildTrack(): ReverseCell[][] {
  const grid: ReverseCell[][] = [];
  for (let y = 0; y < REVERSE_ROWS; y += 1) {
    const row: ReverseCell[] = [];
    for (let x = 0; x < REVERSE_COLS; x += 1) {
      if (x === 0 || y === 0 || x === REVERSE_COLS - 1 || y === REVERSE_ROWS - 1) row.push('wall');
      else if (x === REVERSE_COLS - 2) row.push('finish');
      else row.push('floor');
    }
    grid.push(row);
  }
  for (const [x, y] of [
    [4, 2],
    [6, 1],
    [6, 4],
    [8, 3],
  ] as Array<[number, number]>) {
    grid[y]![x] = 'coin';
  }
  for (const [x, y] of [
    [7, 2],
    [7, 3],
    [8, 2],
    [8, 3],
  ] as Array<[number, number]>) {
    grid[y]![x] = 'zone';
  }
  return grid;
}

export function isZoneCell(grid: ReverseCell[][], x: number, y: number): boolean {
  return grid[y]?.[x] === 'zone';
}

export function canStep(grid: ReverseCell[][], x: number, y: number): boolean {
  const cell = grid[y]?.[x];
  return Boolean(cell && cell !== 'wall');
}

function makePlayer(index: number): ReversePlayer {
  const start = STARTS[index % STARTS.length]!;
  return {
    x: start.x,
    y: start.y,
    score: 0,
    roundScore: 0,
    coins: 0,
    collected: [],
    finished: false,
    finishMs: null,
    disconnected: false,
    left: false,
  };
}

function resetRoundBodies(state: ReverseState): void {
  Object.values(state.players).forEach((player, index) => {
    const start = STARTS[index % STARTS.length]!;
    player.x = start.x;
    player.y = start.y;
    player.roundScore = 0;
    player.coins = 0;
    player.collected = [];
    player.finished = false;
    player.finishMs = null;
  });
  state.finishOrder = [];
  state.grid = buildTrack();
}

function isFinishObjective(kind: ReverseObjectiveKind): boolean {
  return kind === 'finish-first' || kind === 'second-place' || kind === 'exact-time';
}

export function scoreReverseRound(state: ReverseState): void {
  const obj = state.objective;
  const active = Object.values(state.players).filter((player) => !player.left);
  for (const player of active) player.roundScore = 0;

  if (obj.kind === 'finish-first') {
    state.finishOrder.forEach((id, index) => {
      const player = state.players[id];
      if (!player || player.left) return;
      player.roundScore = PLACE_POINTS[index] ?? 10;
      player.score += player.roundScore;
    });
    return;
  }

  if (obj.kind === 'second-place') {
    const second = state.finishOrder[1];
    for (const [id, player] of Object.entries(state.players)) {
      if (player.left) continue;
      if (id === second) player.roundScore = 100;
      else if (player.finished) player.roundScore = 15;
      player.score += player.roundScore;
    }
    return;
  }

  if (obj.kind === 'exact-time') {
    const target = obj.targetMs ?? TARGET_TIME_MS;
    for (const player of active) {
      if (!player.finished || player.finishMs == null) continue;
      const delta = Math.abs(player.finishMs - target);
      player.roundScore = Math.max(0, 100 - Math.floor(delta / 80));
      player.score += player.roundScore;
    }
    return;
  }

  if (obj.kind === 'collect-exact') {
    const target = obj.targetCoins ?? TARGET_COINS;
    for (const player of active) {
      if (player.coins === target) player.roundScore = 100;
      else if (Math.abs(player.coins - target) === 1) player.roundScore = 40;
      player.score += player.roundScore;
    }
    return;
  }

  if (obj.kind === 'stop-zone') {
    for (const player of active) {
      if (isZoneCell(state.grid, player.x, player.y)) player.roundScore = 100;
      player.score += player.roundScore;
    }
  }
}

export function finishReverse(state: ReverseState, ctx: GameContext, reason: GameFinishReason): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.finishReason = reason;
  state.lastEvent = reason === 'timeout' ? 'timeout' : 'finished';
  ctx.markStateChanged();
  ctx.finish(reason);
}

export function beginReverseRound(state: ReverseState, ctx: GameContext, round: number): void {
  state.round = round;
  state.objective = OBJECTIVES[round % OBJECTIVES.length]!;
  resetRoundBodies(state);
  state.phase = 'playing';
  state.startedAt = ctx.now();
  state.endsAt = ctx.now() + ROUND_MS;
  state.roundMs = ROUND_MS;
  state.lastEvent = `objective:${state.objective.kind}`;
  ctx.markStateChanged();
  ctx.schedule(ROUND_MS, () => closeReverseRound(state, ctx), 'turn', 'round-timeout');
  for (const player of ctx.players) {
    if (player.isAI) ctx.requestAI(player.id, 120);
  }
}

export function closeReverseRound(state: ReverseState, ctx: GameContext): void {
  if (state.phase !== 'playing') return;
  scoreReverseRound(state);
  if (state.round + 1 >= state.totalRounds) {
    finishReverse(state, ctx, 'completed');
    return;
  }
  state.phase = 'between';
  state.lastEvent = 'round-end';
  ctx.markStateChanged();
  ctx.schedule(BETWEEN_MS, () => beginReverseRound(state, ctx, state.round + 1), 'turn', 'next-round');
}

function maybeEndEarly(state: ReverseState, ctx: GameContext): void {
  if (!isFinishObjective(state.objective.kind)) return;
  const active = Object.values(state.players).filter((player) => !player.left);
  if (active.length > 0 && active.every((player) => player.finished)) closeReverseRound(state, ctx);
}

function targetFor(state: ReverseState, player: ReversePlayer): { x: number; y: number } {
  const kind = state.objective.kind;
  if (kind === 'stop-zone') return { x: 7, y: 2 };
  if (kind === 'collect-exact' && player.coins < TARGET_COINS) {
    for (let y = 0; y < state.rows; y += 1) {
      for (let x = 0; x < state.cols; x += 1) {
        if (state.grid[y]![x] === 'coin' && !player.collected.includes(`${x},${y}`)) {
          return { x, y };
        }
      }
    }
  }
  return { x: REVERSE_COLS - 2, y: player.y };
}

export const reverseRaceGame: GameModule<ReverseState> = {
  metadata: REVERSE_RACE_METADATA,

  initialize(): void {
    // Stateless module.
  },

  createInitialState(players, config): ReverseState {
    return {
      phase: 'idle',
      round: 0,
      totalRounds: typeof config.rounds === 'number' ? Math.min(5, Math.max(2, config.rounds)) : 4,
      cols: REVERSE_COLS,
      rows: REVERSE_ROWS,
      grid: buildTrack(),
      objective: OBJECTIVES[0]!,
      players: Object.fromEntries(players.map((player, index) => [player.id, makePlayer(index)])),
      finishOrder: [],
      startedAt: null,
      endsAt: null,
      roundMs: ROUND_MS,
      finishReason: null,
      lastEvent: null,
      nextAIRequestAt: {},
    };
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
    const remaining = Object.values(state.players).filter((entry) => !entry.left);
    if (remaining.length <= 1) finishReverse(state, ctx, 'abandoned');
  },

  start(state, ctx): void {
    if (state.phase === 'playing') return;
    ctx.players.forEach((player, index) => {
      state.players[player.id] = makePlayer(index);
    });
    state.totalRounds = typeof ctx.config.rounds === 'number' ? Math.min(5, Math.max(2, ctx.config.rounds)) : 4;
    beginReverseRound(state, ctx, 0);
    ctx.schedule(
      state.totalRounds * (ROUND_MS + BETWEEN_MS) + 4_000,
      () => finishReverse(state, ctx, 'timeout'),
      'gameDuration',
      'match-timeout',
    );
  },

  validateAction(playerId, action, state): ValidationResult {
    if (action.type === 'score' || action.type === 'finish' || action.type === 'win') {
      return { valid: false, reason: 'The server owns the objective and the score.' };
    }
    if (action.type !== 'move') return { valid: false, reason: 'Unknown action.' };
    if (!isReverseDirection(action.payload?.direction)) return { valid: false, reason: 'Use up, down, left or right.' };
    if (state.phase !== 'playing') return { valid: false, reason: 'Wait for the next objective.' };
    const player = state.players[playerId];
    if (!player || player.left) return { valid: false, reason: 'You are not in this match.' };
    if (player.disconnected) return { valid: false, reason: 'Reconnect to keep moving.' };
    if (player.finished && isFinishObjective(state.objective.kind)) {
      return { valid: false, reason: 'You already finished this round.' };
    }
    const { dx, dy } = DELTA[action.payload.direction];
    if (!canStep(state.grid, player.x + dx, player.y + dy)) return { valid: false, reason: 'A wall blocks that way.' };
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    if (action.type !== 'move') return actionRejected('The server owns the objective and the score.');
    const direction = action.payload?.direction;
    if (!isReverseDirection(direction)) return actionRejected('Invalid direction.');
    const player = state.players[playerId];
    if (!player || state.phase !== 'playing' || player.left) return actionRejected('You cannot move.');
    if (player.finished && isFinishObjective(state.objective.kind)) return actionRejected('You already finished.');
    const { dx, dy } = DELTA[direction];
    const nx = player.x + dx;
    const ny = player.y + dy;
    if (!canStep(state.grid, nx, ny)) return actionRejected('A wall blocks that way.');
    player.x = nx;
    player.y = ny;
    const cell = state.grid[ny]![nx]!;
    const coinId = `${nx},${ny}`;
    if (cell === 'coin' && !player.collected.includes(coinId)) {
      player.collected.push(coinId);
      player.coins = player.collected.length;
      state.lastEvent = `coin:${playerId}`;
    } else {
      state.lastEvent = `move:${playerId}`;
    }
    if (cell === 'finish' && isFinishObjective(state.objective.kind) && !player.finished) {
      player.finished = true;
      player.finishMs = ctx.now() - (state.startedAt ?? ctx.now());
      state.finishOrder.push(playerId);
      state.lastEvent = `finish:${playerId}`;
    }
    ctx.markStateChanged();
    maybeEndEarly(state, ctx);
    return actionAccepted();
  },

  update(state, _delta, ctx): void {
    if (state.phase !== 'playing') return;
    for (const player of ctx.players) {
      if (!player.isAI) continue;
      const body = state.players[player.id];
      if (!body || body.left || (body.finished && isFinishObjective(state.objective.kind))) continue;
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
    const ranked = [...ctx.players].sort(
      (a, b) => (state.players[b.id]?.score ?? 0) - (state.players[a.id]?.score ?? 0),
    );
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
        stats: { coins: entry?.coins ?? 0, finishMs: entry?.finishMs ?? -1 },
      };
    });
    return { winners, isDraw: winners.length > 1, rankings, reason: state.finishReason ?? 'completed' };
  },

  reset(state): ReverseState {
    const ids = Object.keys(state.players);
    return {
      ...state,
      phase: 'idle',
      round: 0,
      grid: buildTrack(),
      objective: OBJECTIVES[0]!,
      players: Object.fromEntries(ids.map((id, index) => [id, makePlayer(index)])),
      finishOrder: [],
      startedAt: null,
      endsAt: null,
      finishReason: null,
      lastEvent: null,
      nextAIRequestAt: {},
    };
  },

  cleanup(state): void {
    state.players = {};
    state.phase = 'finished';
  },

  getPublicState(state, _viewerId, ctx) {
    return {
      phase: state.phase,
      round: state.round,
      totalRounds: state.totalRounds,
      cols: state.cols,
      rows: state.rows,
      grid: state.grid.map((row) => [...row]),
      objective: { ...state.objective },
      finishOrder: [...state.finishOrder],
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
            roundScore: player.roundScore,
            coins: player.coins,
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
    if (!player || player.left) return null;
    if (player.finished && isFinishObjective(state.objective.kind)) return null;
    if (state.objective.kind === 'exact-time' && ctx.now() - (state.startedAt ?? 0) < TARGET_TIME_MS - 800) {
      return null;
    }
    const target = targetFor(state, player);
    let chosen: ReverseDirection | null = null;
    if (player.x < target.x && canStep(state.grid, player.x + 1, player.y)) chosen = 'right';
    else if (player.x > target.x && canStep(state.grid, player.x - 1, player.y)) chosen = 'left';
    else if (player.y < target.y && canStep(state.grid, player.x, player.y + 1)) chosen = 'down';
    else if (player.y > target.y && canStep(state.grid, player.x, player.y - 1)) chosen = 'up';
    if (chosen && difficulty !== 'easy') return { type: 'move', payload: { direction: chosen } };
    const legal = ALL_DIRS.filter((direction) =>
      canStep(state.grid, player.x + DELTA[direction].dx, player.y + DELTA[direction].dy),
    );
    if (legal.length === 0) return null;
    if (chosen && ctx.random() > 0.3) return { type: 'move', payload: { direction: chosen } };
    return { type: 'move', payload: { direction: legal[Math.floor(ctx.random() * legal.length)]! } };
  },

  needsUpdateLoop: true,
  maxDurationMs: 8 * 60 * 1000,
};
