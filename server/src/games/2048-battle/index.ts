import type { AIDifficulty, GameAction, GameConfig, GameFinishReason } from '@2play/shared';
import { BATTLE_2048_METADATA } from '@2play/shared';
export { BATTLE_2048_METADATA };
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
 * 2048 Battle — two players, two private 4x4 boards, one shared clock.
 *
 * Standard 2048 mechanics per board (slide, merge-once, spawn, lock), but the
 * WINNER is decided by total score when both boards lock or the match timer
 * expires. The server owns boards, spawns, scores and the clock; clients only
 * send move intents.
 */

export type Battle2048Phase = 'idle' | 'playing' | 'finished';
export type MoveDirection = 'up' | 'down' | 'left' | 'right';

export interface Battle2048Board {
  /** Row-major 4x4 grid; 0 = empty cell. */
  tiles: number[];
  score: number;
  moves: number;
  merges: number;
  bestTile: number;
  /** True when no legal move remains for this board. */
  locked: boolean;
  lockedAt: number | null;
}

export interface Battle2048State {
  phase: Battle2048Phase;
  boards: Record<string, Battle2048Board>;
  scores: Record<string, number>;
  startedAt: number | null;
  endsAt: number | null;
  durationMs: number;
  finishReason: GameFinishReason | null;
  lastEvent: string | null;
}

const SIZE = 4;
const MATCH_MS = 3 * 60 * 1000;
const MOVE_DIRECTIONS: MoveDirection[] = ['up', 'down', 'left', 'right'];

/** AI thinking pace per difficulty (base delay + jitter). */
const AI_MOVE_DELAY: Record<AIDifficulty, number> = { easy: 1100, medium: 650, hard: 340 };
const AI_MOVE_JITTER: Record<AIDifficulty, number> = { easy: 800, medium: 380, hard: 230 };

export function isMoveDirection(value: unknown): value is MoveDirection {
  return value === 'up' || value === 'down' || value === 'left' || value === 'right';
}

export function emptyBoard(): Battle2048Board {
  return {
    tiles: Array<number>(SIZE * SIZE).fill(0),
    score: 0,
    moves: 0,
    merges: 0,
    bestTile: 0,
    locked: false,
    lockedAt: null,
  };
}

/** Spawns one tile (2 with 90%, 4 with 10%) on a random empty cell. */
export function spawnTile(board: Battle2048Board, rng: () => number): void {
  const empty: number[] = [];
  board.tiles.forEach((value, index) => {
    if (value === 0) empty.push(index);
  });
  if (empty.length === 0) return;
  const index = empty[Math.floor(rng() * empty.length)] ?? 0;
  const value = rng() < 0.9 ? 2 : 4;
  board.tiles[index] = value;
  board.bestTile = Math.max(board.bestTile, value);
}

/** Cell indices of one line, ordered from the wall the tiles move towards. */
function lineIndices(direction: MoveDirection, line: number): number[] {
  const at = (row: number, col: number) => row * SIZE + col;
  switch (direction) {
    case 'left':
      return [0, 1, 2, 3].map((col) => at(line, col));
    case 'right':
      return [3, 2, 1, 0].map((col) => at(line, col));
    case 'up':
      return [0, 1, 2, 3].map((row) => at(row, line));
    case 'down':
      return [3, 2, 1, 0].map((row) => at(row, line));
  }
}

export interface MoveResult {
  moved: boolean;
  mergePoints: number;
  merges: number;
}

/**
 * Applies one slide + merge pass. Mutates the board only when the move
 * changes it. Each tile merges at most once per move (standard 2048).
 */
export function applyMove(board: Battle2048Board, direction: MoveDirection): MoveResult {
  const tiles = board.tiles;
  let mergePoints = 0;
  let merges = 0;
  let moved = false;

  for (let line = 0; line < SIZE; line += 1) {
    const cells = lineIndices(direction, line);
    const values = cells.map((index) => tiles[index]!).filter((value) => value !== 0);
    const merged: number[] = [];
    for (let i = 0; i < values.length; i += 1) {
      const current = values[i]!;
      const next = values[i + 1];
      if (next !== undefined && current === next) {
        // Equal neighbours fuse once — skip the consumed tile.
        const sum = current * 2;
        merged.push(sum);
        mergePoints += sum;
        merges += 1;
        i += 1;
      } else {
        merged.push(current);
      }
    }
    while (merged.length < SIZE) merged.push(0);
    for (let slot = 0; slot < SIZE; slot += 1) {
      const cell = cells[slot]!;
      if (tiles[cell] !== merged[slot]) moved = true;
      tiles[cell] = merged[slot]!;
    }
  }

  if (moved) {
    board.score += mergePoints;
    board.merges += merges;
    board.moves += 1;
    board.bestTile = Math.max(board.bestTile, ...tiles);
  }
  return { moved, mergePoints, merges };
}

/** True while at least one legal move exists (empty cell or fusable pair). */
export function hasLegalMove(board: Battle2048Board): boolean {
  const tiles = board.tiles;
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      const value = tiles[row * SIZE + col]!;
      if (value === 0) return true;
      if (col < SIZE - 1 && value === tiles[row * SIZE + col + 1]!) return true;
      if (row < SIZE - 1 && value === tiles[(row + 1) * SIZE + col]!) return true;
    }
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* AI helpers                                                          */
/* ------------------------------------------------------------------ */

interface SimulatedMove {
  direction: MoveDirection;
  moved: boolean;
  mergePoints: number;
  tiles: number[];
}

function simulateMove(board: Battle2048Board, direction: MoveDirection): SimulatedMove {
  const clone: Battle2048Board = { ...board, tiles: [...board.tiles] };
  const { moved, mergePoints } = applyMove(clone, direction);
  return { direction, moved, mergePoints, tiles: clone.tiles };
}

/** Positional heuristic: empty cells, smoothness, monotonicity, corner bonus. */
function boardQuality(tiles: number[]): number {
  const at = (row: number, col: number) => tiles[row * SIZE + col]!;
  const lg = (value: number) => (value === 0 ? 0 : Math.log2(value));

  let quality = tiles.filter((value) => value === 0).length * 270;

  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      const value = lg(at(row, col));
      if (col < SIZE - 1) quality -= Math.abs(value - lg(at(row, col + 1))) * 14;
      if (row < SIZE - 1) quality -= Math.abs(value - lg(at(row + 1, col))) * 14;
    }
  }

  for (let row = 0; row < SIZE; row += 1) {
    let increasing = 0;
    let decreasing = 0;
    for (let col = 0; col < SIZE - 1; col += 1) {
      const delta = lg(at(row, col)) - lg(at(row, col + 1));
      if (delta > 0) decreasing += delta;
      else increasing -= delta;
    }
    quality += Math.max(increasing, decreasing) * 18;
  }
  for (let col = 0; col < SIZE; col += 1) {
    let increasing = 0;
    let decreasing = 0;
    for (let row = 0; row < SIZE - 1; row += 1) {
      const delta = lg(at(row, col)) - lg(at(row + 1, col));
      if (delta > 0) decreasing += delta;
      else increasing -= delta;
    }
    quality += Math.max(increasing, decreasing) * 18;
  }

  const max = Math.max(...tiles);
  if (max > 0) {
    const corners = [at(0, 0), at(0, SIZE - 1), at(SIZE - 1, 0), at(SIZE - 1, SIZE - 1)];
    if (corners.includes(max)) quality += lg(max) * 120;
  }
  return quality;
}

/**
 * Picks an AI direction. Easy is mostly random, medium greedily favours
 * merges + empty cells, hard adds a positional board-quality heuristic.
 */
export function chooseAIDirection(
  board: Battle2048Board,
  difficulty: AIDifficulty,
  rng: () => number,
): MoveDirection | null {
  const legal = MOVE_DIRECTIONS.map((direction) => simulateMove(board, direction)).filter(
    (move) => move.moved,
  );
  if (legal.length === 0) return null;

  if (difficulty === 'easy') {
    if (rng() < 0.75) return legal[Math.floor(rng() * legal.length)]!.direction;
    return legal.reduce((best, current) =>
      current.mergePoints > best.mergePoints ? current : best,
    )!.direction;
  }

  if (difficulty === 'medium') {
    const value = (move: SimulatedMove) => move.mergePoints * 2 + move.tiles.filter((v) => v === 0).length * 20;
    return legal.reduce((best, current) => (value(current) > value(best) ? current : best))!.direction;
  }

  const hardValue = (move: SimulatedMove) => boardQuality(move.tiles) + move.mergePoints;
  return legal.reduce((best, current) => (hardValue(current) > hardValue(best) ? current : best))!.direction;
}

function allActiveBoardsLocked(state: Battle2048State): boolean {
  const boards = Object.values(state.boards);
  return boards.length > 0 && boards.every((board) => board.locked);
}

/** Timer callback: the shared clock ran out. Exported for tests. */
export function finishBattleOnTimeout(state: Battle2048State, ctx: GameContext): void {
  if (state.phase !== 'playing') return;
  state.phase = 'finished';
  state.finishReason = 'timeout';
  state.lastEvent = 'timeout';
  ctx.markStateChanged();
  ctx.finish('timeout');
}

/* ------------------------------------------------------------------ */
/* Module                                                              */
/* ------------------------------------------------------------------ */

export const battle2048Game: GameModule<Battle2048State> = {
  metadata: BATTLE_2048_METADATA,

  initialize(_config: GameConfig): void {
    // Stateless module — per-room state lives in the state object.
  },

  createInitialState(players, _config): Battle2048State {
    return {
      phase: 'idle',
      boards: Object.fromEntries(players.map((player) => [player.id, emptyBoard()])),
      scores: Object.fromEntries(players.map((player) => [player.id, 0])),
      startedAt: null,
      endsAt: null,
      durationMs: MATCH_MS,
      finishReason: null,
      lastEvent: null,
    };
  },

  playerJoined(player, state): void {
    if (!state.boards[player.id]) state.boards[player.id] = emptyBoard();
    if (state.scores[player.id] === undefined) state.scores[player.id] = 0;
  },

  playerReady(): void {
    // No per-player readiness behaviour.
  },

  playerLeft(playerId, state, ctx, reason): void {
    const board = state.boards[playerId];
    if (!board) return;
    if (reason !== 'disconnect' && !board.locked) {
      // A departed player stops playing; a disconnected player keeps their
      // seat and board alive during the reconnection grace period.
      board.locked = true;
      board.lockedAt = ctx.now();
      state.lastEvent = `locked:${playerId}:left`;
    }
    if (state.phase === 'playing' && allActiveBoardsLocked(state)) {
      state.phase = 'finished';
      state.finishReason = 'completed';
      state.lastEvent = 'all-locked';
      ctx.markStateChanged();
      ctx.finish('completed');
    }
  },

  start(state, ctx): void {
    if (state.phase === 'playing') return;

    // Fresh boards for the actual seats (covers late joins and rematches).
    for (const player of ctx.players) {
      if (!state.boards[player.id]) state.boards[player.id] = emptyBoard();
    }
    for (const [playerId, board] of Object.entries(state.boards)) {
      board.tiles.fill(0);
      board.score = 0;
      board.moves = 0;
      board.merges = 0;
      board.bestTile = 0;
      board.locked = false;
      board.lockedAt = null;
      spawnTile(board, ctx.random);
      spawnTile(board, ctx.random);
      state.scores[playerId] = 0;
    }

    state.phase = 'playing';
    state.startedAt = ctx.now();
    state.endsAt = state.startedAt + state.durationMs;
    state.finishReason = null;
    state.lastEvent = 'start';
    ctx.markStateChanged();

    ctx.schedule(
      state.durationMs,
      () => finishBattleOnTimeout(state, ctx),
      'gameDuration',
      'match-timeout',
    );
    // AI turns are booted by the platform (GameManager.requestAITurns).
  },

  validateAction(playerId, action, state): ValidationResult {
    if (action.type !== 'move') return { valid: false, reason: 'Unknown action.' };
    const direction = action.payload?.direction;
    if (!isMoveDirection(direction)) {
      return { valid: false, reason: 'Invalid direction — use up, down, left or right.' };
    }
    if (state.phase !== 'playing') return { valid: false, reason: 'The match is not running.' };
    const board = state.boards[playerId];
    if (!board) return { valid: false, reason: 'You do not have a board in this match.' };
    if (board.locked) return { valid: false, reason: 'Your board is locked — no moves left.' };
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    if (action.type !== 'move') return actionRejected('Unknown action.');
    const direction = action.payload?.direction;
    if (!isMoveDirection(direction)) return actionRejected('Invalid direction.');
    const board = state.boards[playerId];
    if (!board) return actionRejected('You do not have a board in this match.');
    if (board.locked) return actionRejected('Your board is locked — no moves left.');

    const { moved, mergePoints } = applyMove(board, direction);
    if (!moved) return actionRejected('That move does not change your board.');

    spawnTile(board, ctx.random);
    state.scores[playerId] = board.score;
    state.lastEvent = mergePoints > 0 ? `merge:${playerId}:${mergePoints}` : `move:${playerId}`;

    if (!hasLegalMove(board)) {
      board.locked = true;
      board.lockedAt = ctx.now();
      state.lastEvent = `locked:${playerId}`;
    }
    ctx.markStateChanged();

    // Chain the next AI move through the shared AI pipeline.
    const player = ctx.players.find((candidate) => candidate.id === playerId);
    if (player?.isAI && !board.locked && state.phase === 'playing') {
      const difficulty = player.aiDifficulty ?? 'medium';
      const delay = AI_MOVE_DELAY[difficulty] + Math.floor(ctx.random() * AI_MOVE_JITTER[difficulty]);
      ctx.requestAI(playerId, delay);
    }

    if (state.phase === 'playing' && allActiveBoardsLocked(state)) {
      state.phase = 'finished';
      state.finishReason = 'completed';
      state.lastEvent = 'all-locked';
      ctx.markStateChanged();
      ctx.finish('completed');
    }

    return actionAccepted();
  },

  update(): void {
    // Event driven: no simulation loop needed.
  },

  tick(): void {
    // Event driven.
  },

  calculateScore(playerId, state): number {
    return state.scores[playerId] ?? 0;
  },

  checkWinCondition(state): string[] | null {
    if (state.phase !== 'finished') return null;
    const entries = Object.entries(state.scores);
    if (entries.length === 0) return null;
    const best = Math.max(...entries.map(([, value]) => value));
    return entries.filter(([, value]) => value === best).map(([id]) => id);
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
      const diff = (state.scores[b.id] ?? 0) - (state.scores[a.id] ?? 0);
      if (diff !== 0) return diff;
      // Efficiency tie-breaks: fewer moves, then the bigger best tile.
      const movesDiff = (state.boards[a.id]?.moves ?? 0) - (state.boards[b.id]?.moves ?? 0);
      if (movesDiff !== 0) return movesDiff;
      return (state.boards[b.id]?.bestTile ?? 0) - (state.boards[a.id]?.bestTile ?? 0);
    });
    const topScore = state.scores[ranked[0]?.id ?? ''] ?? 0;
    const winners = ranked
      .filter((player) => (state.scores[player.id] ?? 0) === topScore)
      .map((player) => player.id);

    const rankings: RankingDraft[] = ranked.map((player) => {
      const score = state.scores[player.id] ?? 0;
      const rank = ranked.filter((other) => (state.scores[other.id] ?? 0) > score).length + 1;
      return {
        playerId: player.id,
        rank,
        score,
        isWinner: winners.includes(player.id),
        isDraw: winners.length > 1,
        stats: {
          bestTile: state.boards[player.id]?.bestTile ?? 0,
          merges: state.boards[player.id]?.merges ?? 0,
          moves: state.boards[player.id]?.moves ?? 0,
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

  reset(state): Battle2048State {
    return {
      ...state,
      phase: 'idle',
      boards: Object.fromEntries(
        Object.keys(state.boards).map((playerId) => [playerId, emptyBoard()]),
      ),
      scores: Object.fromEntries(Object.keys(state.scores).map((playerId) => [playerId, 0])),
      startedAt: null,
      endsAt: null,
      finishReason: null,
      lastEvent: null,
    };
  },

  cleanup(state): void {
    state.boards = {};
    state.phase = 'finished';
  },

  /**
   * Both boards are public (it is a score race), but only through this
   * projection: current seats only, no internal flags, server clock included.
   */
  getPublicState(state, _viewerId, ctx) {
    return {
      phase: state.phase,
      scores: { ...state.scores },
      startedAt: state.startedAt,
      endsAt: state.endsAt,
      durationMs: state.durationMs,
      finishReason: state.finishReason,
      lastEvent: state.lastEvent,
      serverTime: ctx.now(),
      boards: Object.fromEntries(
        ctx.players.map((player) => {
          const board = state.boards[player.id];
          return [
            player.id,
            board
              ? {
                  tiles: [...board.tiles],
                  score: board.score,
                  moves: board.moves,
                  bestTile: board.bestTile,
                  locked: board.locked,
                }
              : null,
          ];
        }),
      ),
    };
  },

  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'playing') return null;
    const board = state.boards[playerId];
    if (!board || board.locked) return null;
    const direction = chooseAIDirection(board, difficulty, ctx.random);
    if (!direction) return null;
    return { type: 'move', payload: { direction } };
  },

  maxDurationMs: 8 * 60 * 1000,
};
