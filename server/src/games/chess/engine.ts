/**
 * Chess rules engine.
 *
 * A dependency-free, fully legal implementation:
 *  - correct movement for every piece
 *  - path blocking and captures
 *  - king safety (a move that leaves your own king in check is illegal)
 *  - castling (both sides, with all the classic preconditions)
 *  - en passant
 *  - promotion (queen / rook / bishop / knight)
 *  - check, checkmate, stalemate
 *  - insufficient material, threefold repetition, fifty-move rule
 *
 * The board is a flat 64 entry array, index 0 = a8 ... index 63 = h1, which
 * matches how FEN reads and keeps the renderer trivial.
 */

export type PieceColor = 'w' | 'b';
export type PieceType = 'k' | 'q' | 'r' | 'b' | 'n' | 'p';

export interface Piece {
  type: PieceType;
  color: PieceColor;
}

/** null = empty square. */
export type Board = Array<Piece | null>;

export interface CastlingRights {
  wk: boolean;
  wq: boolean;
  bk: boolean;
  bq: boolean;
}

export interface Position {
  board: Board;
  turn: PieceColor;
  castling: CastlingRights;
  /** Index of the square a pawn may capture onto, or null. */
  enPassant: number | null;
  /** Plies since the last capture or pawn move (fifty-move rule). */
  halfmove: number;
  /** Increments after every black move. */
  fullmove: number;
}

export interface Move {
  from: number;
  to: number;
  piece: PieceType;
  color: PieceColor;
  captured?: PieceType;
  promotion?: PieceType;
  isEnPassant?: boolean;
  isCastle?: 'k' | 'q';
  /** Standard algebraic notation, filled in by `describeMove`. */
  san?: string;
}

export const PROMOTION_PIECES: PieceType[] = ['q', 'r', 'b', 'n'];

/* ------------------------------------------------------------------ */
/* Coordinates                                                         */
/* ------------------------------------------------------------------ */

export function fileOf(square: number): number {
  return square % 8;
}

export function rankOf(square: number): number {
  return Math.floor(square / 8);
}

export function squareName(square: number): string {
  return `${'abcdefgh'[fileOf(square)]}${8 - rankOf(square)}`;
}

export function onBoard(file: number, rank: number): boolean {
  return file >= 0 && file < 8 && rank >= 0 && rank < 8;
}

export function toIndex(file: number, rank: number): number {
  return rank * 8 + file;
}

/* ------------------------------------------------------------------ */
/* Setup                                                               */
/* ------------------------------------------------------------------ */

const BACK_RANK: PieceType[] = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];

export function initialPosition(): Position {
  const board: Board = new Array(64).fill(null);
  for (let file = 0; file < 8; file += 1) {
    board[toIndex(file, 0)] = { type: BACK_RANK[file] as PieceType, color: 'b' };
    board[toIndex(file, 1)] = { type: 'p', color: 'b' };
    board[toIndex(file, 6)] = { type: 'p', color: 'w' };
    board[toIndex(file, 7)] = { type: BACK_RANK[file] as PieceType, color: 'w' };
  }
  return {
    board,
    turn: 'w',
    castling: { wk: true, wq: true, bk: true, bq: true },
    enPassant: null,
    halfmove: 0,
    fullmove: 1,
  };
}

export function clonePosition(position: Position): Position {
  return {
    board: position.board.map((piece) => (piece ? { ...piece } : null)),
    turn: position.turn,
    castling: { ...position.castling },
    enPassant: position.enPassant,
    halfmove: position.halfmove,
    fullmove: position.fullmove,
  };
}

export function opposite(color: PieceColor): PieceColor {
  return color === 'w' ? 'b' : 'w';
}

/* ------------------------------------------------------------------ */
/* Attack detection                                                    */
/* ------------------------------------------------------------------ */

const KNIGHT_DELTAS = [
  [1, 2], [2, 1], [2, -1], [1, -2],
  [-1, -2], [-2, -1], [-2, 1], [-1, 2],
];
const KING_DELTAS = [
  [0, 1], [1, 1], [1, 0], [1, -1],
  [0, -1], [-1, -1], [-1, 0], [-1, 1],
];
const ROOK_DIRS = [[0, 1], [0, -1], [1, 0], [-1, 0]];
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

/**
 * True when `color` attacks `square`. Used for check detection and for the
 * castling "king may not cross an attacked square" rule.
 */
export function isSquareAttacked(board: Board, square: number, color: PieceColor): boolean {
  const targetFile = fileOf(square);
  const targetRank = rankOf(square);

  // Pawns. White pawns capture toward decreasing rank index (up the board).
  const pawnRankDelta = color === 'w' ? 1 : -1;
  for (const fileDelta of [-1, 1]) {
    const file = targetFile + fileDelta;
    const rank = targetRank + pawnRankDelta;
    if (!onBoard(file, rank)) continue;
    const piece = board[toIndex(file, rank)];
    if (piece && piece.color === color && piece.type === 'p') return true;
  }

  // Knights.
  for (const [df, dr] of KNIGHT_DELTAS) {
    const file = targetFile + (df as number);
    const rank = targetRank + (dr as number);
    if (!onBoard(file, rank)) continue;
    const piece = board[toIndex(file, rank)];
    if (piece && piece.color === color && piece.type === 'n') return true;
  }

  // King (adjacent).
  for (const [df, dr] of KING_DELTAS) {
    const file = targetFile + (df as number);
    const rank = targetRank + (dr as number);
    if (!onBoard(file, rank)) continue;
    const piece = board[toIndex(file, rank)];
    if (piece && piece.color === color && piece.type === 'k') return true;
  }

  // Sliding pieces: rook/queen orthogonally, bishop/queen diagonally.
  const slide = (dirs: number[][], types: PieceType[]) => {
    for (const [df, dr] of dirs) {
      let file = targetFile + (df as number);
      let rank = targetRank + (dr as number);
      while (onBoard(file, rank)) {
        const piece = board[toIndex(file, rank)];
        if (piece) {
          if (piece.color === color && types.includes(piece.type)) return true;
          break;
        }
        file += df as number;
        rank += dr as number;
      }
    }
    return false;
  };

  if (slide(ROOK_DIRS, ['r', 'q'])) return true;
  if (slide(BISHOP_DIRS, ['b', 'q'])) return true;
  return false;
}

export function findKing(board: Board, color: PieceColor): number {
  for (let square = 0; square < 64; square += 1) {
    const piece = board[square];
    if (piece && piece.type === 'k' && piece.color === color) return square;
  }
  return -1;
}

export function isInCheck(position: Position, color: PieceColor): boolean {
  const king = findKing(position.board, color);
  if (king < 0) return false;
  return isSquareAttacked(position.board, king, opposite(color));
}

/* ------------------------------------------------------------------ */
/* Move generation                                                     */
/* ------------------------------------------------------------------ */

/**
 * Pseudo-legal moves for the side to move: correct piece movement, path
 * blocking and captures, but WITHOUT the king-safety filter.
 */
export function pseudoLegalMoves(position: Position): Move[] {
  const moves: Move[] = [];
  const { board, turn } = position;

  const push = (from: number, to: number, extra: Partial<Move> = {}) => {
    const piece = board[from] as Piece;
    const target = board[to];
    moves.push({
      from,
      to,
      piece: piece.type,
      color: piece.color,
      ...(target ? { captured: target.type } : {}),
      ...extra,
    });
  };

  for (let from = 0; from < 64; from += 1) {
    const piece = board[from];
    if (!piece || piece.color !== turn) continue;
    const file = fileOf(from);
    const rank = rankOf(from);

    /* ---- pawn ---- */
    if (piece.type === 'p') {
      // White moves toward rank index 0, black toward 7.
      const forward = turn === 'w' ? -1 : 1;
      const startRank = turn === 'w' ? 6 : 1;
      const promotionRank = turn === 'w' ? 0 : 7;

      const oneRank = rank + forward;
      if (onBoard(file, oneRank) && !board[toIndex(file, oneRank)]) {
        const to = toIndex(file, oneRank);
        if (oneRank === promotionRank) {
          for (const promotion of PROMOTION_PIECES) push(from, to, { promotion });
        } else {
          push(from, to);
          // Two square opening move, only from the start rank and over an
          // empty intermediate square.
          const twoRank = rank + forward * 2;
          if (rank === startRank && onBoard(file, twoRank) && !board[toIndex(file, twoRank)]) {
            push(from, toIndex(file, twoRank));
          }
        }
      }

      // Diagonal captures, including en passant.
      for (const fileDelta of [-1, 1]) {
        const captureFile = file + fileDelta;
        if (!onBoard(captureFile, oneRank)) continue;
        const to = toIndex(captureFile, oneRank);
        const target = board[to];
        if (target && target.color !== turn) {
          if (oneRank === promotionRank) {
            for (const promotion of PROMOTION_PIECES) push(from, to, { promotion });
          } else {
            push(from, to);
          }
        } else if (!target && position.enPassant === to) {
          moves.push({ from, to, piece: 'p', color: turn, captured: 'p', isEnPassant: true });
        }
      }
      continue;
    }

    /* ---- knight ---- */
    if (piece.type === 'n') {
      for (const [df, dr] of KNIGHT_DELTAS) {
        const nf = file + (df as number);
        const nr = rank + (dr as number);
        if (!onBoard(nf, nr)) continue;
        const to = toIndex(nf, nr);
        const target = board[to];
        if (target && target.color === turn) continue;
        push(from, to);
      }
      continue;
    }

    /* ---- king ---- */
    if (piece.type === 'k') {
      for (const [df, dr] of KING_DELTAS) {
        const nf = file + (df as number);
        const nr = rank + (dr as number);
        if (!onBoard(nf, nr)) continue;
        const to = toIndex(nf, nr);
        const target = board[to];
        if (target && target.color === turn) continue;
        push(from, to);
      }
      // Castling. All preconditions are checked here; king safety across the
      // path is verified below because it needs attack detection.
      const enemy = opposite(turn);
      const homeRank = turn === 'w' ? 7 : 0;
      if (rank === homeRank && file === 4 && !isSquareAttacked(board, from, enemy)) {
        const kingSide = turn === 'w' ? position.castling.wk : position.castling.bk;
        const queenSide = turn === 'w' ? position.castling.wq : position.castling.bq;

        if (kingSide) {
          const f1 = toIndex(5, homeRank);
          const g1 = toIndex(6, homeRank);
          const rookSquare = toIndex(7, homeRank);
          const rook = board[rookSquare];
          if (
            !board[f1] &&
            !board[g1] &&
            rook &&
            rook.type === 'r' &&
            rook.color === turn &&
            // The king may not cross or land on an attacked square.
            !isSquareAttacked(board, f1, enemy) &&
            !isSquareAttacked(board, g1, enemy)
          ) {
            moves.push({ from, to: g1, piece: 'k', color: turn, isCastle: 'k' });
          }
        }

        if (queenSide) {
          const d1 = toIndex(3, homeRank);
          const c1 = toIndex(2, homeRank);
          const b1 = toIndex(1, homeRank);
          const rookSquare = toIndex(0, homeRank);
          const rook = board[rookSquare];
          if (
            !board[d1] &&
            !board[c1] &&
            !board[b1] &&
            rook &&
            rook.type === 'r' &&
            rook.color === turn &&
            !isSquareAttacked(board, d1, enemy) &&
            !isSquareAttacked(board, c1, enemy)
          ) {
            moves.push({ from, to: c1, piece: 'k', color: turn, isCastle: 'q' });
          }
        }
      }
      continue;
    }

    /* ---- sliding pieces ---- */
    const dirs =
      piece.type === 'r' ? ROOK_DIRS : piece.type === 'b' ? BISHOP_DIRS : [...ROOK_DIRS, ...BISHOP_DIRS];
    for (const [df, dr] of dirs) {
      let nf = file + (df as number);
      let nr = rank + (dr as number);
      while (onBoard(nf, nr)) {
        const to = toIndex(nf, nr);
        const target = board[to];
        if (target) {
          if (target.color !== turn) push(from, to);
          break; // blocked either way
        }
        push(from, to);
        nf += df as number;
        nr += dr as number;
      }
    }
  }

  return moves;
}

/**
 * Applies a move to a COPY of the position. Handles captures, en passant,
 * castling rook movement, promotion, castling-right loss and the clocks.
 */
export function applyMove(position: Position, move: Move): Position {
  const next = clonePosition(position);
  const { board } = next;
  const piece = board[move.from];
  if (!piece) return next;

  const isPawn = piece.type === 'p';
  const isCapture = Boolean(board[move.to]) || Boolean(move.isEnPassant);

  // En passant removes a pawn that is NOT on the destination square.
  if (move.isEnPassant) {
    const captureRank = rankOf(move.to) + (piece.color === 'w' ? 1 : -1);
    board[toIndex(fileOf(move.to), captureRank)] = null;
  }

  board[move.to] = move.promotion ? { type: move.promotion, color: piece.color } : piece;
  board[move.from] = null;

  // Move the rook when castling.
  if (move.isCastle) {
    const homeRank = piece.color === 'w' ? 7 : 0;
    if (move.isCastle === 'k') {
      board[toIndex(5, homeRank)] = board[toIndex(7, homeRank)];
      board[toIndex(7, homeRank)] = null;
    } else {
      board[toIndex(3, homeRank)] = board[toIndex(0, homeRank)];
      board[toIndex(0, homeRank)] = null;
    }
  }

  // A two square pawn push creates an en passant target.
  next.enPassant = null;
  if (isPawn && Math.abs(rankOf(move.to) - rankOf(move.from)) === 2) {
    next.enPassant = toIndex(fileOf(move.from), (rankOf(move.from) + rankOf(move.to)) / 2);
  }

  // Castling rights are lost when the king or a rook moves, or a rook is taken.
  if (piece.type === 'k') {
    if (piece.color === 'w') {
      next.castling.wk = false;
      next.castling.wq = false;
    } else {
      next.castling.bk = false;
      next.castling.bq = false;
    }
  }
  const clearRookRight = (square: number) => {
    if (square === toIndex(0, 7)) next.castling.wq = false;
    if (square === toIndex(7, 7)) next.castling.wk = false;
    if (square === toIndex(0, 0)) next.castling.bq = false;
    if (square === toIndex(7, 0)) next.castling.bk = false;
  };
  clearRookRight(move.from);
  clearRookRight(move.to);

  next.halfmove = isPawn || isCapture ? 0 : next.halfmove + 1;
  if (next.turn === 'b') next.fullmove += 1;
  next.turn = opposite(next.turn);
  return next;
}

/**
 * Fully legal moves: pseudo-legal moves filtered so the mover's own king is
 * never left in check. This is the single source of truth for legality.
 */
export function legalMoves(position: Position): Move[] {
  const mover = position.turn;
  return pseudoLegalMoves(position).filter((move) => {
    const after = applyMove(position, move);
    return !isInCheck({ ...after, turn: mover }, mover);
  });
}

export function legalMovesFrom(position: Position, from: number): Move[] {
  return legalMoves(position).filter((move) => move.from === from);
}

/** Finds the legal move matching a from/to (and optional promotion) request. */
export function findMove(
  position: Position,
  from: number,
  to: number,
  promotion?: PieceType,
): Move | undefined {
  const candidates = legalMoves(position).filter((move) => move.from === from && move.to === to);
  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];
  // Several candidates means a promotion: pick the requested piece.
  return candidates.find((move) => move.promotion === (promotion ?? 'q')) ?? candidates[0];
}

/* ------------------------------------------------------------------ */
/* Terminal states                                                     */
/* ------------------------------------------------------------------ */

export type GameOutcome =
  | { over: false }
  | { over: true; result: 'checkmate'; winner: PieceColor }
  | { over: true; result: 'stalemate' }
  | { over: true; result: 'insufficient-material' }
  | { over: true; result: 'fifty-move' }
  | { over: true; result: 'threefold' };

/**
 * Neither side can force mate. Covers the classic cases:
 * K vs K, K+B vs K, K+N vs K, and K+B vs K+B with bishops on one colour.
 */
export function hasInsufficientMaterial(board: Board): boolean {
  const pieces: Array<{ piece: Piece; square: number }> = [];
  for (let square = 0; square < 64; square += 1) {
    const piece = board[square];
    if (piece) pieces.push({ piece, square });
  }
  // Any pawn, rook or queen means mate is still possible.
  if (pieces.some(({ piece }) => piece.type === 'p' || piece.type === 'r' || piece.type === 'q')) {
    return false;
  }
  const minor = pieces.filter(({ piece }) => piece.type === 'b' || piece.type === 'n');
  if (minor.length === 0) return true; // bare kings
  if (minor.length === 1) return true; // K+B or K+N vs K

  // Two bishops on the same colour complex cannot mate.
  if (minor.length === 2 && minor.every(({ piece }) => piece.type === 'b')) {
    const [first, second] = minor;
    const colourOf = (square: number) => (fileOf(square) + rankOf(square)) % 2;
    if (first && second && colourOf(first.square) === colourOf(second.square)) return true;
  }
  return false;
}

/** A compact key for repetition detection (board + turn + rights + ep). */
export function positionKey(position: Position): string {
  const board = position.board
    .map((piece) => (piece ? `${piece.color}${piece.type}` : '.'))
    .join('');
  const castling = `${position.castling.wk ? 'K' : ''}${position.castling.wq ? 'Q' : ''}${
    position.castling.bk ? 'k' : ''
  }${position.castling.bq ? 'q' : ''}`;
  return `${board}|${position.turn}|${castling || '-'}|${position.enPassant ?? '-'}`;
}

/**
 * Decides whether the game has ended.
 * `history` is the list of position keys seen so far (for threefold).
 */
export function outcomeOf(position: Position, history: string[] = []): GameOutcome {
  const moves = legalMoves(position);
  if (moves.length === 0) {
    if (isInCheck(position, position.turn)) {
      return { over: true, result: 'checkmate', winner: opposite(position.turn) };
    }
    return { over: true, result: 'stalemate' };
  }
  if (hasInsufficientMaterial(position.board)) {
    return { over: true, result: 'insufficient-material' };
  }
  // Fifty moves by each side = 100 plies without a capture or pawn move.
  if (position.halfmove >= 100) return { over: true, result: 'fifty-move' };

  const key = positionKey(position);
  const repeats = history.filter((entry) => entry === key).length;
  if (repeats >= 3) return { over: true, result: 'threefold' };

  return { over: false };
}

/* ------------------------------------------------------------------ */
/* Notation                                                            */
/* ------------------------------------------------------------------ */

const SAN_LETTER: Record<PieceType, string> = { k: 'K', q: 'Q', r: 'R', b: 'B', n: 'N', p: '' };

/**
 * Standard algebraic notation for `move` in `position` (the position BEFORE
 * the move), including disambiguation and check/mate suffixes.
 */
export function describeMove(position: Position, move: Move): string {
  if (move.isCastle) {
    const base = move.isCastle === 'k' ? 'O-O' : 'O-O-O';
    return base + checkSuffix(position, move);
  }

  const piece = move.piece;
  let text = '';

  if (piece === 'p') {
    if (move.captured) text += `${'abcdefgh'[fileOf(move.from)]}x`;
    text += squareName(move.to);
    if (move.promotion) text += `=${SAN_LETTER[move.promotion]}`;
  } else {
    text += SAN_LETTER[piece];
    // Disambiguate when another identical piece could also reach the square.
    const rivals = legalMoves(position).filter(
      (other) => other.piece === piece && other.to === move.to && other.from !== move.from,
    );
    if (rivals.length > 0) {
      const sameFile = rivals.some((other) => fileOf(other.from) === fileOf(move.from));
      const sameRank = rivals.some((other) => rankOf(other.from) === rankOf(move.from));
      if (!sameFile) text += 'abcdefgh'[fileOf(move.from)];
      else if (!sameRank) text += String(8 - rankOf(move.from));
      else text += squareName(move.from);
    }
    if (move.captured) text += 'x';
    text += squareName(move.to);
  }

  return text + checkSuffix(position, move);
}

function checkSuffix(position: Position, move: Move): string {
  const after = applyMove(position, move);
  if (!isInCheck(after, after.turn)) return '';
  return legalMoves(after).length === 0 ? '#' : '+';
}

/* ------------------------------------------------------------------ */
/* Evaluation + search (AI)                                            */
/* ------------------------------------------------------------------ */

const PIECE_VALUE: Record<PieceType, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

/** Small positional nudges so the AI develops instead of shuffling. */
const PAWN_TABLE = [
  0, 0, 0, 0, 0, 0, 0, 0,
  50, 50, 50, 50, 50, 50, 50, 50,
  10, 10, 20, 30, 30, 20, 10, 10,
  5, 5, 10, 25, 25, 10, 5, 5,
  0, 0, 0, 20, 20, 0, 0, 0,
  5, -5, -10, 0, 0, -10, -5, 5,
  5, 10, 10, -20, -20, 10, 10, 5,
  0, 0, 0, 0, 0, 0, 0, 0,
];
const KNIGHT_TABLE = [
  -50, -40, -30, -30, -30, -30, -40, -50,
  -40, -20, 0, 0, 0, 0, -20, -40,
  -30, 0, 10, 15, 15, 10, 0, -30,
  -30, 5, 15, 20, 20, 15, 5, -30,
  -30, 0, 15, 20, 20, 15, 0, -30,
  -30, 5, 10, 15, 15, 10, 5, -30,
  -40, -20, 0, 5, 5, 0, -20, -40,
  -50, -40, -30, -30, -30, -30, -40, -50,
];

/** Material + simple placement, from `color`'s point of view. */
export function evaluate(position: Position, color: PieceColor): number {
  let score = 0;
  for (let square = 0; square < 64; square += 1) {
    const piece = position.board[square];
    if (!piece) continue;
    let value = PIECE_VALUE[piece.type];
    // Tables are written from white's perspective; mirror them for black.
    const index = piece.color === 'w' ? square : 63 - square;
    if (piece.type === 'p') value += PAWN_TABLE[index] ?? 0;
    if (piece.type === 'n') value += KNIGHT_TABLE[index] ?? 0;
    score += piece.color === color ? value : -value;
  }
  return score;
}

/** Negamax with alpha-beta pruning. */
function search(position: Position, depth: number, alpha: number, beta: number, root: PieceColor): number {
  if (depth === 0) return evaluate(position, root);
  const moves = legalMoves(position);
  if (moves.length === 0) {
    // Mate is worth more the sooner it arrives.
    if (isInCheck(position, position.turn)) {
      return position.turn === root ? -100_000 - depth : 100_000 + depth;
    }
    return 0; // stalemate
  }
  // Search captures first — it prunes far more.
  moves.sort((a, b) => (b.captured ? PIECE_VALUE[b.captured] : 0) - (a.captured ? PIECE_VALUE[a.captured] : 0));

  if (position.turn === root) {
    let best = -Infinity;
    for (const move of moves) {
      best = Math.max(best, search(applyMove(position, move), depth - 1, alpha, beta, root));
      alpha = Math.max(alpha, best);
      if (alpha >= beta) break;
    }
    return best;
  }
  let best = Infinity;
  for (const move of moves) {
    best = Math.min(best, search(applyMove(position, move), depth - 1, alpha, beta, root));
    beta = Math.min(beta, best);
    if (alpha >= beta) break;
  }
  return best;
}

/**
 * Picks a move for the side to move.
 *  - depth 1 plays greedily (easy)
 *  - depth 2-3 actually look ahead (medium / hard)
 * `random` breaks ties so the bot is not perfectly predictable.
 */
export function chooseMove(position: Position, depth: number, random: () => number): Move | null {
  const moves = legalMoves(position);
  if (moves.length === 0) return null;
  const root = position.turn;

  let best: Move[] = [];
  let bestScore = -Infinity;
  for (const move of moves) {
    const score = search(applyMove(position, move), Math.max(0, depth - 1), -Infinity, Infinity, root);
    if (score > bestScore + 0.001) {
      bestScore = score;
      best = [move];
    } else if (Math.abs(score - bestScore) <= 0.001) {
      best.push(move);
    }
  }
  if (best.length === 0) return moves[Math.floor(random() * moves.length)] ?? null;
  return best[Math.floor(random() * best.length)] ?? best[0] ?? null;
}
