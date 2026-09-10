import type { AIDifficulty, GameAction, GameConfig, GameFinishReason } from '@2play/shared';
import { CHESS_METADATA } from '@2play/shared';
export { CHESS_METADATA };
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
import {
  applyMove,
  chooseMove,
  describeMove,
  findMove,
  initialPosition,
  isInCheck,
  legalMoves,
  legalMovesFrom,
  opposite,
  outcomeOf,
  positionKey,
  PROMOTION_PIECES,
  squareName,
  type Move,
  type PieceColor,
  type PieceType,
  type Position,
} from './engine';

export * from './engine';

/**
 * Chess — full legal rules, server authoritative.
 *
 * The engine owns the board; this module owns the match: seats, colours, the
 * chess clock, move history and the result. A client can only ever send a
 * from/to (plus promotion choice) — legality is decided here.
 */

export type ChessPhase = 'idle' | 'playing' | 'finished';

export type ChessResultType =
  | 'checkmate'
  | 'stalemate'
  | 'insufficient-material'
  | 'fifty-move'
  | 'threefold'
  | 'timeout'
  | 'resignation'
  | 'abandoned';

export interface ChessPlayerSlot {
  color: PieceColor;
  /** Remaining clock in milliseconds. */
  timeLeftMs: number;
  moves: number;
  captures: number;
  disconnected: boolean;
  left: boolean;
}

export interface HistoryEntry {
  san: string;
  from: string;
  to: string;
  color: PieceColor;
  fullmove: number;
}

export interface ChessState {
  phase: ChessPhase;
  position: Position;
  players: Record<string, ChessPlayerSlot>;
  /** Position keys seen so far, for threefold repetition. */
  history: string[];
  moveHistory: HistoryEntry[];
  /** Pieces taken, by the colour that LOST them. */
  captured: { w: PieceType[]; b: PieceType[] };
  lastMove: { from: number; to: number } | null;
  inCheck: PieceColor | null;
  /** Server time the current player's clock was last started. */
  turnStartedAt: number | null;
  baseTimeMs: number;
  startedAt: number | null;
  resultType: ChessResultType | null;
  winnerColor: PieceColor | null;
  finishReason: GameFinishReason | null;
  lastEvent: string | null;
}

/* ------------------------------------------------------------------ */
/* Tunables                                                            */
/* ------------------------------------------------------------------ */

/** Clock presets, selected through the existing lobby `gridSize` option. */
export const TIME_CONTROLS: Record<string, number> = {
  '3min': 3 * 60_000,
  '5min': 5 * 60_000,
  '10min': 10 * 60_000,
};
export const DEFAULT_TIME_MS = TIME_CONTROLS['10min'] as number;

export const WIN_SCORE = 1000;
export const DRAW_SCORE = 500;
export const CAPTURE_SCORE = 10;

const AI_DEPTH: Record<AIDifficulty, number> = { easy: 1, medium: 2, hard: 3 };
const AI_DELAY: Record<AIDifficulty, number> = { easy: 700, medium: 900, hard: 1_200 };

function isPromotionPiece(value: unknown): value is PieceType {
  return typeof value === 'string' && (PROMOTION_PIECES as string[]).includes(value);
}

function isSquare(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 64;
}

export function colorOf(state: ChessState, playerId: string): PieceColor | null {
  return state.players[playerId]?.color ?? null;
}

export function playerWithColor(state: ChessState, color: PieceColor): string | null {
  const entry = Object.entries(state.players).find(([, slot]) => slot.color === color);
  return entry?.[0] ?? null;
}

/** Remaining clock for `color`, accounting for the time ticking right now. */
export function timeLeftFor(state: ChessState, color: PieceColor, now: number): number {
  const id = playerWithColor(state, color);
  const slot = id ? state.players[id] : undefined;
  if (!slot) return 0;
  if (state.phase !== 'playing' || state.position.turn !== color || state.turnStartedAt === null) {
    return slot.timeLeftMs;
  }
  return Math.max(0, slot.timeLeftMs - (now - state.turnStartedAt));
}

/* ------------------------------------------------------------------ */
/* Clock                                                               */
/* ------------------------------------------------------------------ */

/** Commits the elapsed time to the player who just moved. */
function chargeClock(state: ChessState, color: PieceColor, now: number): void {
  const id = playerWithColor(state, color);
  const slot = id ? state.players[id] : undefined;
  if (!slot || state.turnStartedAt === null) return;
  slot.timeLeftMs = Math.max(0, slot.timeLeftMs - (now - state.turnStartedAt));
}

/**
 * Arms the flag-fall timer for whoever is to move. Uses the platform
 * TimerManager only — never a bare setTimeout.
 */
function scheduleFlag(state: ChessState, ctx: GameContext): void {
  if (state.phase !== 'playing') return;
  const color = state.position.turn;
  const remaining = timeLeftFor(state, color, ctx.now());
  ctx.schedule(
    Math.max(50, remaining),
    () => {
      if (state.phase !== 'playing') return;
      if (state.position.turn !== color) return;
      if (timeLeftFor(state, color, ctx.now()) > 0) return;
      flagFall(state, ctx, color);
    },
    'turn',
    'chess-clock',
  );

  const id = playerWithColor(state, color);
  const view = id ? ctx.players.find((entry) => entry.id === id) : undefined;
  if (view?.isAI) ctx.requestAI(view.id, AI_DELAY[view.aiDifficulty ?? 'medium']);
}

/**
 * A player ran out of time. Classic rule: if the opponent cannot possibly
 * deliver mate, it is a draw rather than a loss on time.
 */
export function flagFall(state: ChessState, ctx: GameContext, loser: PieceColor): void {
  const id = playerWithColor(state, loser);
  const slot = id ? state.players[id] : undefined;
  if (slot) slot.timeLeftMs = 0;

  const opponentCanMate = !hasOnlyKingLike(state, opposite(loser));
  if (!opponentCanMate) {
    finishChess(state, ctx, 'timeout', null, 'draw');
    return;
  }
  finishChess(state, ctx, 'timeout', opposite(loser), 'timeout');
}

/** True when `color` has nothing but a king (or king + single minor). */
function hasOnlyKingLike(state: ChessState, color: PieceColor): boolean {
  const pieces = state.position.board.filter((piece) => piece && piece.color === color);
  if (pieces.length <= 1) return true;
  if (pieces.length === 2) {
    return pieces.some((piece) => piece && (piece.type === 'b' || piece.type === 'n'));
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

export function finishChess(
  state: ChessState,
  ctx: GameContext,
  resultType: ChessResultType,
  winnerColor: PieceColor | null,
  reason: GameFinishReason,
): void {
  if (state.phase === 'finished') return;
  // Bank the time of whoever was on move.
  if (state.turnStartedAt !== null) chargeClock(state, state.position.turn, ctx.now());
  state.phase = 'finished';
  state.resultType = resultType;
  state.winnerColor = winnerColor;
  state.finishReason = reason;
  state.turnStartedAt = null;
  state.lastEvent = `finished:${resultType}`;
  ctx.markStateChanged();
  ctx.finish(reason);
}

/** Checks every terminal condition after a move and ends the game if needed. */
function evaluateOutcome(state: ChessState, ctx: GameContext): boolean {
  const outcome = outcomeOf(state.position, state.history);
  if (!outcome.over) return false;
  switch (outcome.result) {
    case 'checkmate':
      finishChess(state, ctx, 'checkmate', outcome.winner, 'completed');
      return true;
    case 'stalemate':
      finishChess(state, ctx, 'stalemate', null, 'draw');
      return true;
    case 'insufficient-material':
      finishChess(state, ctx, 'insufficient-material', null, 'draw');
      return true;
    case 'fifty-move':
      finishChess(state, ctx, 'fifty-move', null, 'draw');
      return true;
    case 'threefold':
      finishChess(state, ctx, 'threefold', null, 'draw');
      return true;
    default:
      return false;
  }
}

function makeSlot(color: PieceColor, timeMs: number): ChessPlayerSlot {
  return { color, timeLeftMs: timeMs, moves: 0, captures: 0, disconnected: false, left: false };
}

function resolveTimeControl(config: GameConfig): number {
  const key = config.gridSize;
  if (key && TIME_CONTROLS[key] !== undefined) return TIME_CONTROLS[key] as number;
  return DEFAULT_TIME_MS;
}

export const chessGame: GameModule<ChessState> = {
  metadata: CHESS_METADATA,

  initialize(): void {
    // Stateless module.
  },

  createInitialState(players: readonly GamePlayerView[], config: GameConfig): ChessState {
    const timeMs = resolveTimeControl(config);
    const state: ChessState = {
      phase: 'idle',
      position: initialPosition(),
      players: {},
      history: [],
      moveHistory: [],
      captured: { w: [], b: [] },
      lastMove: null,
      inCheck: null,
      turnStartedAt: null,
      baseTimeMs: timeMs,
      startedAt: null,
      resultType: null,
      winnerColor: null,
      finishReason: null,
      lastEvent: null,
    };
    players.forEach((player, index) => {
      const seat = typeof player.seatIndex === 'number' ? player.seatIndex : index;
      state.players[player.id] = makeSlot(seat === 0 ? 'w' : 'b', timeMs);
    });
    return state;
  },

  playerJoined(player, state): void {
    const existing = state.players[player.id];
    if (existing) {
      // Reconnection: colour, clock and position are all preserved.
      existing.disconnected = false;
      return;
    }
    const seat = typeof player.seatIndex === 'number' ? player.seatIndex : Object.keys(state.players).length;
    state.players[player.id] = makeSlot(seat === 0 ? 'w' : 'b', state.baseTimeMs);
  },

  playerReady(): void {
    // Lobby concern.
  },

  playerLeft(playerId, state, ctx, reason): void {
    const slot = state.players[playerId];
    if (!slot) return;
    if (reason === 'disconnect') {
      // The 120s grace window applies; the clock keeps running, as in OTB play.
      slot.disconnected = true;
      ctx.markStateChanged();
      return;
    }
    slot.left = true;
    // Leaving a chess game is a resignation.
    if (state.phase === 'playing') {
      finishChess(state, ctx, 'resignation', opposite(slot.color), 'forfeit');
      return;
    }
    ctx.markStateChanged();
  },

  start(state, ctx): void {
    if (state.phase === 'playing') return;
    state.players = {};
    ctx.players.forEach((player, index) => {
      const seat = typeof player.seatIndex === 'number' ? player.seatIndex : index;
      state.players[player.id] = makeSlot(seat === 0 ? 'w' : 'b', state.baseTimeMs);
    });
    state.position = initialPosition();
    state.history = [positionKey(state.position)];
    state.moveHistory = [];
    state.captured = { w: [], b: [] };
    state.lastMove = null;
    state.inCheck = null;
    state.resultType = null;
    state.winnerColor = null;
    state.finishReason = null;
    state.phase = 'playing';
    state.startedAt = ctx.now();
    state.turnStartedAt = ctx.now();
    state.lastEvent = 'start';
    ctx.markStateChanged();
    scheduleFlag(state, ctx);
  },

  validateAction(playerId, action, state, ctx): ValidationResult {
    // The client may never assert an outcome.
    if (['score', 'win', 'checkmate', 'finish', 'complete', 'board', 'setState'].includes(action.type)) {
      return { valid: false, reason: 'The server owns the board.' };
    }
    if (state.phase !== 'playing') return { valid: false, reason: 'The game is not live.' };

    const slot = state.players[playerId];
    if (!slot || slot.left) return { valid: false, reason: 'You are not in this game.' };
    if (slot.disconnected) return { valid: false, reason: 'Reconnect to keep playing.' };

    if (action.type === 'resign') return { valid: true };

    if (action.type !== 'move') return { valid: false, reason: 'Unknown action.' };
    // Turn ownership.
    if (state.position.turn !== slot.color) return { valid: false, reason: 'It is not your turn.' };

    const { from, to, promotion } = (action.payload ?? {}) as {
      from?: unknown;
      to?: unknown;
      promotion?: unknown;
    };
    if (!isSquare(from) || !isSquare(to)) return { valid: false, reason: 'Pick a square.' };
    if (promotion !== undefined && !isPromotionPiece(promotion)) {
      return { valid: false, reason: 'Promote to a queen, rook, bishop or knight.' };
    }

    // Piece ownership.
    const piece = state.position.board[from];
    if (!piece) return { valid: false, reason: 'There is no piece there.' };
    if (piece.color !== slot.color) return { valid: false, reason: 'That is not your piece.' };

    // Full legality, including king safety — decided by the engine.
    const move = findMove(state.position, from, to, promotion as PieceType | undefined);
    if (!move) {
      const wouldExposeKing = legalMovesFrom(state.position, from).length === 0 && isInCheck(state.position, slot.color);
      return {
        valid: false,
        reason: wouldExposeKing ? 'That would leave your king in check.' : 'That is not a legal move.',
      };
    }
    void ctx;
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    if (state.phase !== 'playing') return actionRejected('The game is not live.');
    const slot = state.players[playerId];
    if (!slot || slot.left || slot.disconnected) return actionRejected('You cannot move.');

    /* ---------------- resign ---------------- */
    if (action.type === 'resign') {
      finishChess(state, ctx, 'resignation', opposite(slot.color), 'forfeit');
      return actionAccepted();
    }

    if (action.type !== 'move') return actionRejected('Unknown action.');
    if (state.position.turn !== slot.color) return actionRejected('It is not your turn.');

    const { from, to, promotion } = (action.payload ?? {}) as {
      from?: unknown;
      to?: unknown;
      promotion?: unknown;
    };
    if (!isSquare(from) || !isSquare(to)) return actionRejected('Pick a square.');
    if (promotion !== undefined && !isPromotionPiece(promotion)) return actionRejected('Invalid promotion.');

    const piece = state.position.board[from];
    if (!piece || piece.color !== slot.color) return actionRejected('That is not your piece.');

    const move = findMove(state.position, from, to, promotion as PieceType | undefined);
    if (!move) return actionRejected('Illegal move.');

    // Record notation from the position BEFORE the move.
    const san = describeMove(state.position, move);
    const fullmove = state.position.fullmove;

    // Charge the clock for the time this player just used.
    const now = ctx.now();
    chargeClock(state, slot.color, now);
    if (slot.timeLeftMs <= 0) {
      flagFall(state, ctx, slot.color);
      return actionAccepted();
    }

    if (move.captured) {
      // Track the captured piece against the colour that lost it.
      state.captured[opposite(slot.color)].push(move.captured);
      slot.captures += 1;
    }

    state.position = applyMove(state.position, move);
    state.history.push(positionKey(state.position));
    state.moveHistory.push({
      san,
      from: squareName(move.from),
      to: squareName(move.to),
      color: slot.color,
      fullmove,
    });
    state.lastMove = { from: move.from, to: move.to };
    slot.moves += 1;
    state.turnStartedAt = now;

    const checked = isInCheck(state.position, state.position.turn);
    state.inCheck = checked ? state.position.turn : null;
    state.lastEvent = move.captured
      ? `capture:${playerId}`
      : move.isCastle
        ? `castle:${playerId}`
        : move.promotion
          ? `promote:${playerId}`
          : `move:${playerId}`;
    if (checked) state.lastEvent = `check:${state.position.turn}`;

    ctx.markStateChanged();

    if (evaluateOutcome(state, ctx)) return actionAccepted();
    scheduleFlag(state, ctx);
    return actionAccepted();
  },

  update(state, _deltaTimeMs, ctx): void {
    if (state.phase !== 'playing') return;
    // Safety net: flag fall is primarily driven by the scheduled timer.
    const color = state.position.turn;
    if (timeLeftFor(state, color, ctx.now()) <= 0) flagFall(state, ctx, color);
  },

  tick(): void {
    // Handled by update().
  },

  calculateScore(playerId, state): number {
    const slot = state.players[playerId];
    if (!slot) return 0;
    if (state.phase !== 'finished') return slot.captures * CAPTURE_SCORE;
    if (state.winnerColor === null) return DRAW_SCORE + slot.captures * CAPTURE_SCORE;
    return (state.winnerColor === slot.color ? WIN_SCORE : 0) + slot.captures * CAPTURE_SCORE;
  },

  checkWinCondition(state): string[] | null {
    if (state.phase !== 'finished') return null;
    if (state.winnerColor === null) return [];
    const id = playerWithColor(state, state.winnerColor);
    return id ? [id] : [];
  },

  checkDrawCondition(state): boolean {
    return state.phase === 'finished' && state.winnerColor === null;
  },

  isGameFinished(state): boolean {
    return state.phase === 'finished';
  },

  finish(state): void {
    state.phase = 'finished';
    state.turnStartedAt = null;
  },

  getResult(state, ctx): GameResultDraft {
    const isDraw = state.winnerColor === null;
    const winners = isDraw
      ? []
      : ctx.players.filter((player) => state.players[player.id]?.color === state.winnerColor).map((p) => p.id);

    const ranked = [...ctx.players].sort((a, b) => {
      const aWin = winners.includes(a.id) ? 1 : 0;
      const bWin = winners.includes(b.id) ? 1 : 0;
      if (aWin !== bWin) return bWin - aWin;
      return (state.players[b.id]?.captures ?? 0) - (state.players[a.id]?.captures ?? 0);
    });

    const rankings: RankingDraft[] = ranked.map((player, index) => {
      const slot = state.players[player.id];
      return {
        playerId: player.id,
        rank: isDraw ? 1 : index + 1,
        score: chessGame.calculateScore(player.id, state),
        isWinner: winners.includes(player.id),
        isDraw,
        stats: {
          moves: slot?.moves ?? 0,
          captures: slot?.captures ?? 0,
          checkmate: state.resultType === 'checkmate' && winners.includes(player.id) ? 1 : 0,
          color: slot?.color === 'w' ? 1 : 0,
        },
      };
    });

    return { winners, isDraw, rankings, reason: state.finishReason ?? 'completed' };
  },

  reset(state): ChessState {
    // Rematch: colours swap, which is the normal courtesy in chess.
    const swapped = Object.fromEntries(
      Object.entries(state.players).map(([id, slot]) => [
        id,
        makeSlot(opposite(slot.color), state.baseTimeMs),
      ]),
    );
    return {
      ...state,
      phase: 'idle',
      position: initialPosition(),
      players: swapped,
      history: [],
      moveHistory: [],
      captured: { w: [], b: [] },
      lastMove: null,
      inCheck: null,
      turnStartedAt: null,
      startedAt: null,
      resultType: null,
      winnerColor: null,
      finishReason: null,
      lastEvent: null,
    };
  },

  cleanup(state): void {
    state.players = {};
    state.history = [];
    state.moveHistory = [];
    state.phase = 'finished';
  },

  /**
   * Chess is a perfect information game, so the board is public. Legal moves
   * are only computed for the player to move — the client may render them as
   * hints, but the server re-validates every move regardless.
   */
  getPublicState(state, viewerId, ctx) {
    const now = ctx.now();
    const slot = viewerId ? state.players[viewerId] : undefined;
    const myColor = slot?.color ?? null;
    const myTurn = myColor !== null && state.position.turn === myColor && state.phase === 'playing';

    const moves = myTurn ? legalMoves(state.position) : [];

    return {
      phase: state.phase,
      board: state.position.board.map((piece) => (piece ? { type: piece.type, color: piece.color } : null)),
      turn: state.position.turn,
      myColor,
      isMyTurn: myTurn,
      // Hints for the side to move only.
      legalMoves: moves.map((move: Move) => ({
        from: move.from,
        to: move.to,
        ...(move.captured ? { captured: move.captured } : {}),
        ...(move.promotion ? { promotion: move.promotion } : {}),
        ...(move.isCastle ? { castle: move.isCastle } : {}),
        ...(move.isEnPassant ? { enPassant: true } : {}),
      })),
      lastMove: state.lastMove ? { ...state.lastMove } : null,
      inCheck: state.inCheck,
      castling: { ...state.position.castling },
      enPassant: state.position.enPassant,
      halfmove: state.position.halfmove,
      fullmove: state.position.fullmove,
      moveHistory: state.moveHistory.map((entry) => ({ ...entry })),
      captured: { w: [...state.captured.w], b: [...state.captured.b] },
      clocks: {
        w: timeLeftFor(state, 'w', now),
        b: timeLeftFor(state, 'b', now),
      },
      baseTimeMs: state.baseTimeMs,
      turnStartedAt: state.turnStartedAt,
      resultType: state.resultType,
      winnerColor: state.winnerColor,
      finishReason: state.finishReason,
      lastEvent: state.lastEvent,
      serverTime: now,
      players: Object.fromEntries(
        Object.entries(state.players).map(([id, entry]) => [
          id,
          {
            color: entry.color,
            timeLeftMs: timeLeftFor(state, entry.color, now),
            moves: entry.moves,
            captures: entry.captures,
            disconnected: entry.disconnected,
          },
        ]),
      ),
    };
  },

  /**
   * AI opponent: negamax with alpha-beta over the same legal move generator a
   * human is held to. It cannot see anything a human cannot, and can never
   * produce an illegal move.
   */
  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'playing') return null;
    const slot = state.players[playerId];
    if (!slot || slot.left) return null;
    if (state.position.turn !== slot.color) return null;

    const move = chooseMove(state.position, AI_DEPTH[difficulty], ctx.random);
    if (!move) return null;
    return {
      type: 'move',
      payload: {
        from: move.from,
        to: move.to,
        ...(move.promotion ? { promotion: move.promotion } : {}),
      },
    };
  },

  needsUpdateLoop: true,
  maxDurationMs: 60 * 60 * 1000,
};
