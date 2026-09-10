import type { AIDifficulty, GameAction, GameConfig, GameFinishReason } from '@2play/shared';
import { CONNECT_FOUR_METADATA } from '@2play/shared';
export { CONNECT_FOUR_METADATA };
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
 * Connect Four — authentic 7x6 rules, server authoritative.
 *
 * Gravity, turn order, four-in-a-row detection (all four directions) and the
 * draw are all decided here. The client only ever sends a column index.
 */

export type ConnectPhase = 'idle' | 'playing' | 'finished';
/** 0 = empty, otherwise the seat index (1 or 2) that owns the disc. */
export type Disc = 0 | 1 | 2;

export interface ConnectPlayerSlot {
  seat: 1 | 2;
  discs: number;
  disconnected: boolean;
  left: boolean;
}

export interface ConnectFourState {
  phase: ConnectPhase;
  cols: number;
  rows: number;
  /** Row-major, index = row * cols + col. Row 0 is the TOP of the board. */
  board: Disc[];
  turnOrder: string[];
  currentPlayerId: string | null;
  players: Record<string, ConnectPlayerSlot>;
  moves: number;
  lastMove: { col: number; row: number; playerId: string } | null;
  /** Board indices of the winning four, for the highlight. */
  winningLine: number[];
  winnerId: string | null;
  isDraw: boolean;
  turnEndsAt: number | null;
  turnMs: number;
  finishReason: GameFinishReason | null;
  lastEvent: string | null;
}

export const COLS = 7;
export const ROWS = 6;
export const CONNECT_N = 4;
export const TURN_MS = 30_000;
export const WIN_SCORE = 100;
export const DRAW_SCORE = 40;

const AI_DELAY: Record<AIDifficulty, number> = { easy: 800, medium: 600, hard: 450 };

export function indexOf(col: number, row: number): number {
  return row * COLS + col;
}

export function discAt(state: ConnectFourState, col: number, row: number): Disc {
  if (col < 0 || row < 0 || col >= state.cols || row >= state.rows) return 0;
  return state.board[indexOf(col, row)] ?? 0;
}

/** Lowest empty row in a column (gravity), or -1 when the column is full. */
export function dropRow(state: ConnectFourState, col: number): number {
  if (col < 0 || col >= state.cols) return -1;
  for (let row = state.rows - 1; row >= 0; row -= 1) {
    if (discAt(state, col, row) === 0) return row;
  }
  return -1;
}

export function isColumnFull(state: ConnectFourState, col: number): boolean {
  return dropRow(state, col) < 0;
}

export function legalColumns(state: ConnectFourState): number[] {
  const columns: number[] = [];
  for (let col = 0; col < state.cols; col += 1) if (!isColumnFull(state, col)) columns.push(col);
  return columns;
}

const DIRECTIONS: Array<[number, number]> = [
  [1, 0], // horizontal
  [0, 1], // vertical
  [1, 1], // diagonal down-right
  [1, -1], // diagonal up-right
];

/**
 * Returns the four (or more) connected indices through (col,row), or null.
 * Checks all four directions from the last placed disc.
 */
export function findWinningLine(state: ConnectFourState, col: number, row: number): number[] | null {
  const seat = discAt(state, col, row);
  if (seat === 0) return null;

  for (const [dc, dr] of DIRECTIONS) {
    const line = [indexOf(col, row)];
    // Walk forwards then backwards along the direction.
    for (const sign of [1, -1]) {
      let c = col + dc * sign;
      let r = row + dr * sign;
      while (discAt(state, c, r) === seat) {
        line.push(indexOf(c, r));
        c += dc * sign;
        r += dr * sign;
      }
    }
    if (line.length >= CONNECT_N) return line;
  }
  return null;
}

export function isBoardFull(state: ConnectFourState): boolean {
  return state.board.every((disc) => disc !== 0);
}

export function finishConnect(state: ConnectFourState, ctx: GameContext, reason: GameFinishReason): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.finishReason = reason;
  state.currentPlayerId = null;
  state.turnEndsAt = null;
  ctx.markStateChanged();
  ctx.finish(reason);
}

function activeSeats(state: ConnectFourState, ctx: GameContext): string[] {
  return state.turnOrder.filter((id) => {
    const slot = state.players[id];
    if (!slot || slot.left) return false;
    const view = ctx.players.find((entry) => entry.id === id);
    return Boolean(view);
  });
}

/** Hands the turn over and arms the server-authoritative turn timer. */
export function beginTurn(state: ConnectFourState, ctx: GameContext, playerId: string): void {
  if (state.phase !== 'playing') return;
  state.currentPlayerId = playerId;
  state.turnEndsAt = ctx.now() + state.turnMs;
  ctx.markStateChanged();

  ctx.schedule(
    state.turnMs,
    () => {
      if (state.phase !== 'playing' || state.currentPlayerId !== playerId) return;
      // Timeout drops a disc in a random legal column so the game cannot stall.
      const options = legalColumns(state);
      if (options.length === 0) {
        finishConnect(state, ctx, 'draw');
        return;
      }
      const col = options[Math.floor(ctx.random() * options.length)] as number;
      state.lastEvent = `timeout:${playerId}`;
      applyDrop(state, ctx, playerId, col);
    },
    'turn',
    'turn-timeout',
  );

  const view = ctx.players.find((entry) => entry.id === playerId);
  if (view?.isAI) ctx.requestAI(playerId, AI_DELAY[view.aiDifficulty ?? 'medium']);
}

export function advanceTurn(state: ConnectFourState, ctx: GameContext): void {
  if (state.phase !== 'playing') return;
  const seats = activeSeats(state, ctx);
  if (seats.length === 0) {
    finishConnect(state, ctx, 'abandoned');
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
  finishConnect(state, ctx, 'abandoned');
}

/**
 * Applies a validated drop: gravity, win check, draw check, turn handover.
 * This is the only place the board is ever mutated.
 */
export function applyDrop(
  state: ConnectFourState,
  ctx: GameContext,
  playerId: string,
  col: number,
): boolean {
  const slot = state.players[playerId];
  if (!slot) return false;
  const row = dropRow(state, col);
  if (row < 0) return false;

  state.board[indexOf(col, row)] = slot.seat;
  slot.discs += 1;
  state.moves += 1;
  state.lastMove = { col, row, playerId };
  state.lastEvent = `drop:${playerId}`;

  const line = findWinningLine(state, col, row);
  if (line) {
    state.winningLine = line;
    state.winnerId = playerId;
    state.lastEvent = `win:${playerId}`;
    finishConnect(state, ctx, 'completed');
    return true;
  }

  if (isBoardFull(state)) {
    state.isDraw = true;
    state.lastEvent = 'draw';
    finishConnect(state, ctx, 'draw');
    return true;
  }

  ctx.markStateChanged();
  advanceTurn(state, ctx);
  return true;
}

function makeSlot(seat: 1 | 2): ConnectPlayerSlot {
  return { seat, discs: 0, disconnected: false, left: false };
}

/* ------------------------------------------------------------------ */
/* AI                                                                  */
/* ------------------------------------------------------------------ */

/** Simulates a drop on a scratch copy so the AI can look ahead safely. */
function simulate(state: ConnectFourState, col: number, seat: Disc): ConnectFourState | null {
  const row = dropRow(state, col);
  if (row < 0) return null;
  const next: ConnectFourState = { ...state, board: [...state.board] };
  next.board[indexOf(col, row)] = seat;
  return next;
}

function winsWith(state: ConnectFourState, col: number, seat: Disc): boolean {
  const next = simulate(state, col, seat);
  if (!next) return false;
  const row = dropRow(state, col);
  return findWinningLine(next, col, row) !== null;
}

export const connectFourGame: GameModule<ConnectFourState> = {
  metadata: CONNECT_FOUR_METADATA,

  initialize(): void {
    // Stateless module.
  },

  createInitialState(players: readonly GamePlayerView[], _config: GameConfig): ConnectFourState {
    const state: ConnectFourState = {
      phase: 'idle',
      cols: COLS,
      rows: ROWS,
      board: new Array(COLS * ROWS).fill(0) as Disc[],
      turnOrder: players.map((player) => player.id),
      currentPlayerId: null,
      players: {},
      moves: 0,
      lastMove: null,
      winningLine: [],
      winnerId: null,
      isDraw: false,
      turnEndsAt: null,
      turnMs: TURN_MS,
      finishReason: null,
      lastEvent: null,
    };
    players.forEach((player, index) => {
      const seat = typeof player.seatIndex === 'number' ? player.seatIndex : index;
      state.players[player.id] = makeSlot(seat === 0 ? 1 : 2);
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
    state.players[player.id] = makeSlot(seat === 0 ? 1 : 2);
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
      // The remaining player wins by forfeit.
      const other = Object.keys(state.players).find((id) => id !== playerId && !state.players[id]?.left);
      state.winnerId = other ?? null;
      finishConnect(state, ctx, 'forfeit');
    }
  },

  start(state, ctx): void {
    if (state.phase === 'playing') return;
    state.players = {};
    state.turnOrder = ctx.players.map((player) => player.id);
    ctx.players.forEach((player, index) => {
      const seat = typeof player.seatIndex === 'number' ? player.seatIndex : index;
      state.players[player.id] = makeSlot(seat === 0 ? 1 : 2);
    });
    state.board = new Array(COLS * ROWS).fill(0) as Disc[];
    state.moves = 0;
    state.lastMove = null;
    state.winningLine = [];
    state.winnerId = null;
    state.isDraw = false;
    state.finishReason = null;
    state.phase = 'playing';
    state.lastEvent = 'start';
    const first = state.turnOrder[0];
    if (!first) {
      finishConnect(state, ctx, 'abandoned');
      return;
    }
    beginTurn(state, ctx, first);
  },

  validateAction(playerId, action, state): ValidationResult {
    if (['score', 'win', 'finish', 'complete', 'board'].includes(action.type)) {
      return { valid: false, reason: 'The server owns the board.' };
    }
    if (state.phase !== 'playing') return { valid: false, reason: 'The game is not live.' };
    if (action.type !== 'drop') return { valid: false, reason: 'Unknown action.' };

    const slot = state.players[playerId];
    if (!slot || slot.left) return { valid: false, reason: 'You are not in this game.' };
    if (slot.disconnected) return { valid: false, reason: 'Reconnect to keep playing.' };
    if (state.currentPlayerId !== playerId) return { valid: false, reason: 'It is not your turn.' };

    const col = action.payload?.col;
    if (typeof col !== 'number' || !Number.isInteger(col)) return { valid: false, reason: 'Pick a column.' };
    if (col < 0 || col >= state.cols) return { valid: false, reason: 'That column does not exist.' };
    if (isColumnFull(state, col)) return { valid: false, reason: 'That column is full.' };
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    if (state.phase !== 'playing') return actionRejected('The game is not live.');
    if (action.type !== 'drop') return actionRejected('Unknown action.');
    const slot = state.players[playerId];
    if (!slot || slot.left || slot.disconnected) return actionRejected('You cannot play.');
    if (state.currentPlayerId !== playerId) return actionRejected('It is not your turn.');

    const col = action.payload?.col;
    if (typeof col !== 'number' || !Number.isInteger(col)) return actionRejected('Pick a column.');
    if (col < 0 || col >= state.cols) return actionRejected('That column does not exist.');
    if (isColumnFull(state, col)) return actionRejected('That column is full.');

    applyDrop(state, ctx, playerId, col);
    return actionAccepted();
  },

  update(): void {
    // Turn based; driven by actions and the turn timer.
  },

  tick(): void {
    // Not used.
  },

  calculateScore(playerId, state): number {
    if (state.phase !== 'finished') return 0;
    if (state.isDraw) return DRAW_SCORE;
    return state.winnerId === playerId ? WIN_SCORE : 0;
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
    const ranked = [...ctx.players].sort((a, b) => {
      if (a.id === state.winnerId) return -1;
      if (b.id === state.winnerId) return 1;
      return 0;
    });
    const rankings: RankingDraft[] = ranked.map((player, index) => {
      const slot = state.players[player.id];
      return {
        playerId: player.id,
        rank: isDraw ? 1 : index + 1,
        score: connectFourGame.calculateScore(player.id, state),
        isWinner: player.id === state.winnerId,
        isDraw,
        stats: { discs: slot?.discs ?? 0, moves: state.moves },
      };
    });
    return {
      winners: state.winnerId ? [state.winnerId] : [],
      isDraw,
      rankings,
      reason: state.finishReason ?? 'completed',
    };
  },

  reset(state): ConnectFourState {
    // Rematch: swap who moves first, which is the usual courtesy.
    const ids = Object.keys(state.players);
    const swapped = Object.fromEntries(
      ids.map((id) => [id, makeSlot(state.players[id]?.seat === 1 ? 2 : 1)]),
    );
    return {
      ...state,
      phase: 'idle',
      board: new Array(COLS * ROWS).fill(0) as Disc[],
      currentPlayerId: null,
      players: swapped,
      turnOrder: [...ids].reverse(),
      moves: 0,
      lastMove: null,
      winningLine: [],
      winnerId: null,
      isDraw: false,
      turnEndsAt: null,
      finishReason: null,
      lastEvent: null,
    };
  },

  cleanup(state): void {
    state.players = {};
    state.turnOrder = [];
    state.board = [];
    state.phase = 'finished';
  },

  /** Connect Four is perfect information — the board is fully public. */
  getPublicState(state, viewerId, ctx) {
    const slot = viewerId ? state.players[viewerId] : undefined;
    return {
      phase: state.phase,
      cols: state.cols,
      rows: state.rows,
      board: [...state.board],
      currentPlayerId: state.currentPlayerId,
      isMyTurn: Boolean(viewerId) && state.currentPlayerId === viewerId,
      mySeat: slot?.seat ?? null,
      legalColumns: state.phase === 'playing' ? legalColumns(state) : [],
      moves: state.moves,
      lastMove: state.lastMove ? { ...state.lastMove } : null,
      winningLine: [...state.winningLine],
      winnerId: state.winnerId,
      isDraw: state.isDraw,
      turnEndsAt: state.turnEndsAt,
      finishReason: state.finishReason,
      lastEvent: state.lastEvent,
      serverTime: ctx.now(),
      players: Object.fromEntries(
        Object.entries(state.players).map(([id, entry]) => [
          id,
          { seat: entry.seat, discs: entry.discs, disconnected: entry.disconnected },
        ]),
      ),
    };
  },

  /**
   * AI: always takes an immediate win, always blocks an immediate loss, then
   * prefers the centre. Harder bots also avoid handing the opponent a win.
   */
  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'playing' || state.currentPlayerId !== playerId) return null;
    const slot = state.players[playerId];
    if (!slot) return null;
    const options = legalColumns(state);
    if (options.length === 0) return null;

    const me = slot.seat as Disc;
    const them: Disc = me === 1 ? 2 : 1;

    // Easy bots frequently just play at random.
    if (difficulty === 'easy' && ctx.random() < 0.5) {
      const pick = options[Math.floor(ctx.random() * options.length)] as number;
      return { type: 'drop', payload: { col: pick } };
    }

    // 1. Win now.
    for (const col of options) if (winsWith(state, col, me)) return { type: 'drop', payload: { col } };
    // 2. Block their win.
    for (const col of options) if (winsWith(state, col, them)) return { type: 'drop', payload: { col } };

    // 3. Hard bots avoid moves that let the opponent win immediately after.
    let candidates = options;
    if (difficulty === 'hard') {
      const safe = options.filter((col) => {
        const next = simulate(state, col, me);
        if (!next) return false;
        return !legalColumns(next).some((reply) => winsWith(next, reply, them));
      });
      if (safe.length > 0) candidates = safe;
    }

    // 4. Prefer the centre — the strongest Connect Four heuristic.
    const centre = (state.cols - 1) / 2;
    candidates = [...candidates].sort((a, b) => Math.abs(a - centre) - Math.abs(b - centre));
    const best = candidates[0];
    return best === undefined ? null : { type: 'drop', payload: { col: best } };
  },

  maxDurationMs: 30 * 60 * 1000,
};
