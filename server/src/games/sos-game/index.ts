import type { AIDifficulty, GameAction, GameConfig, GameFinishReason } from '@2play/shared';
import { SOS_GAME_METADATA } from '@2play/shared';
export { SOS_GAME_METADATA };
import type {
  ActionResult,
  GameContext,
  GameModule,
  GamePlayerView,
  GameResultDraft,
  RankingDraft,
  ValidationResult,
} from '../GameModule';
import { actionAccepted, actionRejected } from '../GameModule';

/**
 * SOS — the classic pencil-and-paper game, server authoritative.
 *
 * ONE ruleset, documented in How To Play and enforced here:
 *  - players alternate placing a single `S` or `O` on any empty cell
 *  - every NEW `S-O-S` line created by that placement scores 1 point each
 *  - creating at least one SOS earns another turn
 *  - the game ends when the board is full; most SOS wins, equal is a draw
 */

export type SosPhase = 'idle' | 'playing' | 'finished';
export type SosLetter = 'S' | 'O';
/** null = empty cell. */
export type SosCell = SosLetter | null;

export interface SosLine {
  /** The three board indices forming S-O-S. */
  cells: [number, number, number];
  playerId: string;
}

export interface SosPlayerSlot {
  seat: number;
  score: number;
  moves: number;
  extraTurns: number;
  disconnected: boolean;
  left: boolean;
}

export interface SosState {
  phase: SosPhase;
  size: number;
  board: SosCell[];
  turnOrder: string[];
  currentPlayerId: string | null;
  players: Record<string, SosPlayerSlot>;
  lines: SosLine[];
  moves: number;
  lastMove: { index: number; letter: SosLetter; playerId: string; scored: number } | null;
  /** True when the current player earned their turn by scoring. */
  extraTurn: boolean;
  turnEndsAt: number | null;
  turnMs: number;
  winnerId: string | null;
  isDraw: boolean;
  finishReason: GameFinishReason | null;
  lastEvent: string | null;
}

export const DEFAULT_SIZE = 5;
export const BOARD_SIZES: Record<string, number> = { '4x4': 4, '5x5': 5, '6x6': 6, '8x8': 8 };
export const TURN_MS = 30_000;
export const SOS_SCORE = 1;

const AI_DELAY: Record<AIDifficulty, number> = { easy: 800, medium: 600, hard: 450 };

/** All eight directions; SOS lines are direction-agnostic. */
const DIRECTIONS: Array<[number, number]> = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

export function idx(state: { size: number }, col: number, row: number): number {
  return row * state.size + col;
}

export function cellAt(state: SosState, col: number, row: number): SosCell {
  if (col < 0 || row < 0 || col >= state.size || row >= state.size) return null;
  return state.board[idx(state, col, row)] ?? null;
}

export function isBoardFull(state: SosState): boolean {
  return state.board.every((cell) => cell !== null);
}

export function emptyCells(state: SosState): number[] {
  const cells: number[] = [];
  state.board.forEach((cell, index) => {
    if (cell === null) cells.push(index);
  });
  return cells;
}

/**
 * Every S-O-S line that passes through the cell just played.
 *
 * Only lines containing `(col,row)` can be new, so this both finds all new
 * SOS patterns and guarantees the same line is never counted twice.
 */
export function findNewLines(state: SosState, col: number, row: number): Array<[number, number, number]> {
  const found: Array<[number, number, number]> = [];
  const letter = cellAt(state, col, row);
  if (!letter) return found;

  for (const [dc, dr] of DIRECTIONS) {
    // A line through this cell can start at offset -2, -1 or 0 along it.
    for (let offset = -2; offset <= 0; offset += 1) {
      const c0 = col + dc * offset;
      const r0 = row + dr * offset;
      const c1 = c0 + dc;
      const r1 = r0 + dr;
      const c2 = c0 + dc * 2;
      const r2 = r0 + dr * 2;
      if (c2 < 0 || r2 < 0 || c2 >= state.size || r2 >= state.size) continue;
      if (c0 < 0 || r0 < 0 || c0 >= state.size || r0 >= state.size) continue;

      if (cellAt(state, c0, r0) === 'S' && cellAt(state, c1, r1) === 'O' && cellAt(state, c2, r2) === 'S') {
        const line: [number, number, number] = [idx(state, c0, r0), idx(state, c1, r1), idx(state, c2, r2)];
        // Guard against listing the same three cells twice.
        const key = [...line].sort((a, b) => a - b).join(',');
        const seen = found.some((entry) => [...entry].sort((a, b) => a - b).join(',') === key);
        if (!seen) found.push(line);
      }
    }
  }
  return found;
}

export function finishSos(state: SosState, ctx: GameContext, reason: GameFinishReason): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.finishReason = reason;
  state.currentPlayerId = null;
  state.turnEndsAt = null;
  ctx.markStateChanged();
  ctx.finish(reason);
}

/** Decides the winner from the authoritative scores. */
function concludeGame(state: SosState, ctx: GameContext): void {
  const entries = Object.entries(state.players).filter(([, slot]) => !slot.left);
  if (entries.length === 0) {
    finishSos(state, ctx, 'abandoned');
    return;
  }
  const best = Math.max(...entries.map(([, slot]) => slot.score));
  const leaders = entries.filter(([, slot]) => slot.score === best);
  if (leaders.length === 1) {
    state.winnerId = leaders[0]?.[0] ?? null;
    state.isDraw = false;
    state.lastEvent = `win:${state.winnerId}`;
    finishSos(state, ctx, 'completed');
    return;
  }
  state.winnerId = null;
  state.isDraw = true;
  state.lastEvent = 'draw';
  finishSos(state, ctx, 'draw');
}

function activeSeats(state: SosState, ctx: GameContext): string[] {
  return state.turnOrder.filter((id) => {
    const slot = state.players[id];
    if (!slot || slot.left) return false;
    return ctx.players.some((entry) => entry.id === id);
  });
}

export function beginTurn(state: SosState, ctx: GameContext, playerId: string, extra = false): void {
  if (state.phase !== 'playing') return;
  state.currentPlayerId = playerId;
  state.extraTurn = extra;
  state.turnEndsAt = ctx.now() + state.turnMs;
  ctx.markStateChanged();

  ctx.schedule(
    state.turnMs,
    () => {
      if (state.phase !== 'playing' || state.currentPlayerId !== playerId) return;
      // Timeout plays a random legal cell so the board always progresses.
      const options = emptyCells(state);
      if (options.length === 0) {
        concludeGame(state, ctx);
        return;
      }
      const index = options[Math.floor(ctx.random() * options.length)] as number;
      state.lastEvent = `timeout:${playerId}`;
      applyPlacement(state, ctx, playerId, index, ctx.random() < 0.5 ? 'S' : 'O');
    },
    'turn',
    'turn-timeout',
  );

  const view = ctx.players.find((entry) => entry.id === playerId);
  if (view?.isAI) ctx.requestAI(playerId, AI_DELAY[view.aiDifficulty ?? 'medium']);
}

export function advanceTurn(state: SosState, ctx: GameContext): void {
  if (state.phase !== 'playing') return;
  const seats = activeSeats(state, ctx);
  if (seats.length === 0) {
    finishSos(state, ctx, 'abandoned');
    return;
  }
  const index = state.currentPlayerId ? state.turnOrder.indexOf(state.currentPlayerId) : -1;
  for (let hop = 1; hop <= state.turnOrder.length; hop += 1) {
    const candidate = state.turnOrder[(index + hop) % state.turnOrder.length];
    if (candidate && seats.includes(candidate)) {
      beginTurn(state, ctx, candidate);
      return;
    }
  }
  finishSos(state, ctx, 'abandoned');
}

/**
 * Applies a validated placement: writes the letter, counts every NEW SOS,
 * awards points and either grants another turn or passes play on.
 */
export function applyPlacement(
  state: SosState,
  ctx: GameContext,
  playerId: string,
  index: number,
  letter: SosLetter,
): boolean {
  const slot = state.players[playerId];
  if (!slot) return false;
  if (state.board[index] !== null) return false;

  state.board[index] = letter;
  slot.moves += 1;
  state.moves += 1;

  const col = index % state.size;
  const row = Math.floor(index / state.size);
  const newLines = findNewLines(state, col, row);

  for (const cells of newLines) {
    state.lines.push({ cells, playerId });
    slot.score += SOS_SCORE;
  }

  state.lastMove = { index, letter, playerId, scored: newLines.length };
  state.lastEvent = newLines.length > 0 ? `sos:${playerId}:${newLines.length}` : `place:${playerId}`;
  ctx.markStateChanged();

  if (isBoardFull(state)) {
    concludeGame(state, ctx);
    return true;
  }

  // Scoring an SOS earns another turn.
  if (newLines.length > 0) {
    slot.extraTurns += 1;
    beginTurn(state, ctx, playerId, true);
  } else {
    advanceTurn(state, ctx);
  }
  return true;
}

function makeSlot(seat: number): SosPlayerSlot {
  return { seat, score: 0, moves: 0, extraTurns: 0, disconnected: false, left: false };
}

function resolveSize(config: GameConfig): number {
  const key = config.gridSize;
  if (key && BOARD_SIZES[key] !== undefined) return BOARD_SIZES[key] as number;
  return DEFAULT_SIZE;
}

function isLetter(value: unknown): value is SosLetter {
  return value === 'S' || value === 'O';
}

/* ------------------------------------------------------------------ */
/* AI                                                                  */
/* ------------------------------------------------------------------ */

/** How many SOS lines placing `letter` at `index` would create right now. */
export function scoreOfPlacement(state: SosState, index: number, letter: SosLetter): number {
  if (state.board[index] !== null) return 0;
  const scratch: SosState = { ...state, board: [...state.board] };
  scratch.board[index] = letter;
  return findNewLines(scratch, index % state.size, Math.floor(index / state.size)).length;
}

export const sosGame: GameModule<SosState> = {
  metadata: SOS_GAME_METADATA,

  initialize(): void {
    // Stateless module.
  },

  createInitialState(players: readonly GamePlayerView[], config: GameConfig): SosState {
    const size = resolveSize(config);
    const state: SosState = {
      phase: 'idle',
      size,
      board: new Array(size * size).fill(null) as SosCell[],
      turnOrder: players.map((player) => player.id),
      currentPlayerId: null,
      players: {},
      lines: [],
      moves: 0,
      lastMove: null,
      extraTurn: false,
      turnEndsAt: null,
      turnMs: TURN_MS,
      winnerId: null,
      isDraw: false,
      finishReason: null,
      lastEvent: null,
    };
    players.forEach((player, index) => {
      state.players[player.id] = makeSlot(typeof player.seatIndex === 'number' ? player.seatIndex : index);
    });
    return state;
  },

  playerJoined(player, state): void {
    const existing = state.players[player.id];
    if (existing) {
      existing.disconnected = false;
      return;
    }
    const seat = typeof player.seatIndex === 'number' ? player.seatIndex : Object.keys(state.players).length;
    state.players[player.id] = makeSlot(seat);
    if (!state.turnOrder.includes(player.id)) state.turnOrder.push(player.id);
  },

  playerReady(): void {
    // Lobby concern.
  },

  playerLeft(playerId, state, ctx, reason): void {
    const slot = state.players[playerId];
    if (!slot) return;
    if (reason === 'disconnect') {
      slot.disconnected = true;
      ctx.markStateChanged();
      return;
    }
    slot.left = true;
    if (state.phase === 'playing') {
      const other = Object.keys(state.players).find((id) => id !== playerId && !state.players[id]?.left);
      state.winnerId = other ?? null;
      state.isDraw = false;
      finishSos(state, ctx, 'forfeit');
    }
  },

  start(state, ctx): void {
    if (state.phase === 'playing') return;
    state.players = {};
    state.turnOrder = ctx.players.map((player) => player.id);
    ctx.players.forEach((player, index) => {
      state.players[player.id] = makeSlot(typeof player.seatIndex === 'number' ? player.seatIndex : index);
    });
    state.board = new Array(state.size * state.size).fill(null) as SosCell[];
    state.lines = [];
    state.moves = 0;
    state.lastMove = null;
    state.winnerId = null;
    state.isDraw = false;
    state.finishReason = null;
    state.phase = 'playing';
    state.lastEvent = 'start';
    const first = state.turnOrder[0];
    if (!first) {
      finishSos(state, ctx, 'abandoned');
      return;
    }
    beginTurn(state, ctx, first);
  },

  validateAction(playerId, action, state): ValidationResult {
    if (['score', 'win', 'finish', 'complete', 'board'].includes(action.type)) {
      return { valid: false, reason: 'The server owns the board.' };
    }
    if (state.phase !== 'playing') return { valid: false, reason: 'The game is not live.' };
    if (action.type !== 'place') return { valid: false, reason: 'Unknown action.' };

    const slot = state.players[playerId];
    if (!slot || slot.left) return { valid: false, reason: 'You are not in this game.' };
    if (slot.disconnected) return { valid: false, reason: 'Reconnect to keep playing.' };
    if (state.currentPlayerId !== playerId) return { valid: false, reason: 'It is not your turn.' };

    const { index, letter } = (action.payload ?? {}) as { index?: unknown; letter?: unknown };
    if (typeof index !== 'number' || !Number.isInteger(index)) return { valid: false, reason: 'Pick a cell.' };
    if (index < 0 || index >= state.board.length) return { valid: false, reason: 'That cell does not exist.' };
    if (!isLetter(letter)) return { valid: false, reason: 'Choose S or O.' };
    if (state.board[index] !== null) return { valid: false, reason: 'That cell is already taken.' };
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    if (state.phase !== 'playing') return actionRejected('The game is not live.');
    if (action.type !== 'place') return actionRejected('Unknown action.');
    const slot = state.players[playerId];
    if (!slot || slot.left || slot.disconnected) return actionRejected('You cannot play.');
    if (state.currentPlayerId !== playerId) return actionRejected('It is not your turn.');

    const { index, letter } = (action.payload ?? {}) as { index?: unknown; letter?: unknown };
    if (typeof index !== 'number' || !Number.isInteger(index)) return actionRejected('Pick a cell.');
    if (index < 0 || index >= state.board.length) return actionRejected('That cell does not exist.');
    if (!isLetter(letter)) return actionRejected('Choose S or O.');
    if (state.board[index] !== null) return actionRejected('That cell is already taken.');

    applyPlacement(state, ctx, playerId, index, letter);
    return actionAccepted();
  },

  update(): void {
    // Turn based.
  },

  tick(): void {
    // Not used.
  },

  calculateScore(playerId, state): number {
    return state.players[playerId]?.score ?? 0;
  },

  checkWinCondition(state): string[] | null {
    if (state.phase !== 'finished') return null;
    return state.winnerId ? [state.winnerId] : [];
  },

  checkDrawCondition(state): boolean {
    return state.phase === 'finished' && state.winnerId === null;
  },

  isGameFinished(state): boolean {
    return state.phase === 'finished';
  },

  finish(state): void {
    state.phase = 'finished';
    state.currentPlayerId = null;
    state.turnEndsAt = null;
  },

  getResult(state, ctx): GameResultDraft {
    const isDraw = state.winnerId === null;
    const ranked = [...ctx.players].sort(
      (a, b) => (state.players[b.id]?.score ?? 0) - (state.players[a.id]?.score ?? 0),
    );
    const rankings: RankingDraft[] = ranked.map((player, index) => {
      const slot = state.players[player.id];
      return {
        playerId: player.id,
        rank: isDraw ? 1 : index + 1,
        score: slot?.score ?? 0,
        isWinner: player.id === state.winnerId,
        isDraw,
        stats: {
          sosCreated: slot?.score ?? 0,
          moves: slot?.moves ?? 0,
          extraTurns: slot?.extraTurns ?? 0,
        },
      };
    });
    return {
      winners: state.winnerId ? [state.winnerId] : [],
      isDraw,
      rankings,
      reason: state.finishReason ?? 'completed',
    };
  },

  reset(state): SosState {
    const ids = Object.keys(state.players);
    return {
      ...state,
      phase: 'idle',
      board: new Array(state.size * state.size).fill(null) as SosCell[],
      currentPlayerId: null,
      players: Object.fromEntries(ids.map((id, index) => [id, makeSlot(index)])),
      turnOrder: [...ids].reverse(),
      lines: [],
      moves: 0,
      lastMove: null,
      extraTurn: false,
      turnEndsAt: null,
      winnerId: null,
      isDraw: false,
      finishReason: null,
      lastEvent: null,
    };
  },

  cleanup(state): void {
    state.players = {};
    state.turnOrder = [];
    state.board = [];
    state.lines = [];
    state.phase = 'finished';
  },

  /** SOS is perfect information — the whole board is public. */
  getPublicState(state, viewerId, ctx) {
    return {
      phase: state.phase,
      size: state.size,
      board: [...state.board],
      currentPlayerId: state.currentPlayerId,
      isMyTurn: Boolean(viewerId) && state.currentPlayerId === viewerId,
      lines: state.lines.map((line) => ({ cells: [...line.cells], playerId: line.playerId })),
      moves: state.moves,
      lastMove: state.lastMove ? { ...state.lastMove } : null,
      extraTurn: state.extraTurn,
      turnEndsAt: state.turnEndsAt,
      winnerId: state.winnerId,
      isDraw: state.isDraw,
      finishReason: state.finishReason,
      lastEvent: state.lastEvent,
      serverTime: ctx.now(),
      players: Object.fromEntries(
        Object.entries(state.players).map(([id, slot]) => [
          id,
          {
            seat: slot.seat,
            score: slot.score,
            moves: slot.moves,
            extraTurns: slot.extraTurns,
            disconnected: slot.disconnected,
          },
        ]),
      ),
    };
  },

  /**
   * AI: takes the highest scoring placement, and on hard also avoids handing
   * the opponent an immediate SOS.
   */
  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'playing' || state.currentPlayerId !== playerId) return null;
    const options = emptyCells(state);
    if (options.length === 0) return null;

    if (difficulty === 'easy' && ctx.random() < 0.45) {
      const index = options[Math.floor(ctx.random() * options.length)] as number;
      return { type: 'place', payload: { index, letter: ctx.random() < 0.5 ? 'S' : 'O' } };
    }

    type Candidate = { index: number; letter: SosLetter; gain: number; risk: number };
    const candidates: Candidate[] = [];

    for (const index of options) {
      for (const letter of ['S', 'O'] as SosLetter[]) {
        const gain = scoreOfPlacement(state, index, letter);
        let risk = 0;
        if (difficulty === 'hard' && gain === 0) {
          // How much could the opponent score right after this move?
          const scratch: SosState = { ...state, board: [...state.board] };
          scratch.board[index] = letter;
          for (const reply of emptyCells(scratch)) {
            for (const replyLetter of ['S', 'O'] as SosLetter[]) {
              risk = Math.max(risk, scoreOfPlacement(scratch, reply, replyLetter));
            }
          }
        }
        candidates.push({ index, letter, gain, risk });
      }
    }

    candidates.sort((a, b) => (b.gain - a.gain) || (a.risk - b.risk) || (ctx.random() - 0.5));
    const best = candidates[0];
    if (!best) return null;
    return { type: 'place', payload: { index: best.index, letter: best.letter } };
  },

  maxDurationMs: 30 * 60 * 1000,
};
