import { describe, expect, it } from 'vitest';
import {
  applyMove,
  chooseMove,
  describeMove,
  findMove,
  hasInsufficientMaterial,
  initialPosition,
  isInCheck,
  isSquareAttacked,
  legalMoves,
  legalMovesFrom,
  onBoard,
  outcomeOf,
  positionKey,
  squareName,
  toIndex,
  type Board,
  type Piece,
  type PieceColor,
  type PieceType,
  type Position,
} from './engine';

/** Minimal FEN reader so tests can express exact positions. */
function fromFen(fen: string): Position {
  const [placement, turn, castling, ep, half, full] = fen.split(' ');
  const board: Board = new Array(64).fill(null);
  let square = 0;
  for (const char of placement ?? '') {
    if (char === '/') continue;
    if (/\d/.test(char)) {
      square += Number(char);
      continue;
    }
    const color: PieceColor = char === char.toUpperCase() ? 'w' : 'b';
    board[square] = { type: char.toLowerCase() as PieceType, color };
    square += 1;
  }
  let enPassant: number | null = null;
  if (ep && ep !== '-') enPassant = toIndex('abcdefgh'.indexOf(ep[0] as string), 8 - Number(ep[1]));
  return {
    board,
    turn: (turn ?? 'w') as PieceColor,
    castling: {
      wk: (castling ?? '').includes('K'),
      wq: (castling ?? '').includes('Q'),
      bk: (castling ?? '').includes('k'),
      bq: (castling ?? '').includes('q'),
    },
    enPassant,
    halfmove: Number(half ?? 0),
    fullmove: Number(full ?? 1),
  };
}

function perft(position: Position, depth: number): number {
  if (depth === 0) return 1;
  const moves = legalMoves(position);
  if (depth === 1) return moves.length;
  let nodes = 0;
  for (const move of moves) nodes += perft(applyMove(position, move), depth - 1);
  return nodes;
}

const sq = (name: string) => toIndex('abcdefgh'.indexOf(name[0] as string), 8 - Number(name[1]));

describe('chess engine', () => {
  /* ---------------- setup ---------------- */

  it('builds the standard starting position', () => {
    const position = initialPosition();
    expect(position.turn).toBe('w');
    expect(position.board.filter(Boolean)).toHaveLength(32);
    expect(position.board[sq('e1')]).toEqual({ type: 'k', color: 'w' });
    expect(position.board[sq('e8')]).toEqual({ type: 'k', color: 'b' });
    expect(position.board[sq('a1')]).toEqual({ type: 'r', color: 'w' });
    expect(position.board[sq('d8')]).toEqual({ type: 'q', color: 'b' });
    // All eight pawns on each side.
    expect(position.board.filter((p) => p?.type === 'p' && p.color === 'w')).toHaveLength(8);
    expect(position.board.filter((p) => p?.type === 'p' && p.color === 'b')).toHaveLength(8);
    expect(squareName(sq('e4'))).toBe('e4');
    expect(onBoard(0, 0)).toBe(true);
    expect(onBoard(-1, 0)).toBe(false);
  });

  /* ---------------- perft: the definitive correctness test ---------------- */

  it('matches known perft counts from the starting position', () => {
    const position = initialPosition();
    expect(perft(position, 1)).toBe(20);
    expect(perft(position, 2)).toBe(400);
    expect(perft(position, 3)).toBe(8902);
    expect(perft(position, 4)).toBe(197281);
  });

  it('matches perft on the Kiwipete position (castling and en passant heavy)', () => {
    const position = fromFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
    expect(perft(position, 1)).toBe(48);
    expect(perft(position, 2)).toBe(2039);
    expect(perft(position, 3)).toBe(97862);
  });

  it('matches perft on positions exercising pins, promotion and en passant', () => {
    const pins = fromFen('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1');
    expect(perft(pins, 1)).toBe(14);
    expect(perft(pins, 2)).toBe(191);
    expect(perft(pins, 3)).toBe(2812);

    const promo = fromFen('r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1');
    expect(perft(promo, 1)).toBe(6);
    expect(perft(promo, 2)).toBe(264);
    expect(perft(promo, 3)).toBe(9467);
  });

  /* ---------------- piece movement ---------------- */

  it('moves each piece by the classic rules', () => {
    // Knight from b1 has exactly two squares at the start.
    const start = initialPosition();
    expect(legalMovesFrom(start, sq('b1')).map((m) => squareName(m.to)).sort()).toEqual(['a3', 'c3']);
    // Rook and bishop are blocked in by their own pawns.
    expect(legalMovesFrom(start, sq('a1'))).toHaveLength(0);
    expect(legalMovesFrom(start, sq('c1'))).toHaveLength(0);

    // A lone rook on an open board sweeps its file and rank: 14 squares.
    const rook = fromFen('8/8/8/3R4/8/8/8/K6k w - - 0 1');
    expect(legalMovesFrom(rook, sq('d5'))).toHaveLength(14);
    // A lone bishop on d5 reaches 13 squares.
    const bishop = fromFen('8/8/8/3B4/8/8/8/K6k w - - 0 1');
    expect(legalMovesFrom(bishop, sq('d5'))).toHaveLength(13);
    // Queen = rook + bishop.
    const queen = fromFen('8/8/8/3Q4/8/8/8/K6k w - - 0 1');
    expect(legalMovesFrom(queen, sq('d5'))).toHaveLength(27);
    // A central knight has eight moves.
    const knight = fromFen('8/8/8/3N4/8/8/8/K6k w - - 0 1');
    expect(legalMovesFrom(knight, sq('d5'))).toHaveLength(8);
  });

  it('allows a pawn one or two squares from the start, then only one', () => {
    const start = initialPosition();
    expect(legalMovesFrom(start, sq('e2')).map((m) => squareName(m.to)).sort()).toEqual(['e3', 'e4']);
    const advanced = fromFen('8/8/8/8/8/4P3/8/K6k w - - 0 1');
    expect(legalMovesFrom(advanced, sq('e3')).map((m) => squareName(m.to))).toEqual(['e4']);
  });

  it('blocks a pawn that is obstructed and allows diagonal captures only', () => {
    const blocked = fromFen('8/8/8/8/4p3/4P3/8/K6k w - - 0 1');
    expect(legalMovesFrom(blocked, sq('e3'))).toHaveLength(0);
    // A black piece on d4 can be taken diagonally.
    const capture = fromFen('8/8/8/8/3p4/4P3/8/K6k w - - 0 1');
    const targets = legalMovesFrom(capture, sq('e3')).map((m) => squareName(m.to)).sort();
    expect(targets).toEqual(['d4', 'e4']);
  });

  it('rejects moving through a blocking piece', () => {
    const position = fromFen('8/8/8/8/8/8/3pR3/K6k w - - 0 1');
    // The rook on e2 cannot jump the pawn... it is on d2, so check a real block.
    const blocked = fromFen('8/8/8/8/8/4p3/4R3/K6k w - - 0 1');
    const reach = legalMovesFrom(blocked, sq('e2')).map((m) => squareName(m.to));
    // It can capture on e3 but not continue past it.
    expect(reach).toContain('e3');
    expect(reach).not.toContain('e4');
    expect(position.board[sq('e2')]?.type).toBe('r');
  });

  /* ---------------- king safety ---------------- */

  it('rejects any move that leaves your own king in check', () => {
    // The white bishop on e2 is pinned by the black rook on e8.
    const pinned = fromFen('4r3/8/8/8/8/8/4B3/4K3 w - - 0 1');
    const bishopMoves = legalMovesFrom(pinned, sq('e2'));
    // It may only move along the pin line (there is none here), so zero moves.
    expect(bishopMoves).toHaveLength(0);
    // The king itself must step off the file.
    const kingMoves = legalMovesFrom(pinned, sq('e1')).map((m) => squareName(m.to)).sort();
    expect(kingMoves).toEqual(['d1', 'd2', 'f1', 'f2']);
    expect(kingMoves).not.toContain('e2');
  });

  it('detects check and forces a response', () => {
    const position = fromFen('4r3/8/8/8/8/8/8/4K3 w - - 0 1');
    expect(isInCheck(position, 'w')).toBe(true);
    expect(isInCheck(position, 'b')).toBe(false);
    // Every legal move must resolve the check.
    for (const move of legalMoves(position)) {
      const after = applyMove(position, move);
      expect(isInCheck({ ...after, turn: 'w' }, 'w')).toBe(false);
    }
  });

  it('detects attacked squares for both colours', () => {
    const position = fromFen('8/8/8/3r4/8/8/8/K6k b - - 0 1');
    expect(isSquareAttacked(position.board, sq('d1'), 'b')).toBe(true);
    expect(isSquareAttacked(position.board, sq('a5'), 'b')).toBe(true);
    expect(isSquareAttacked(position.board, sq('c4'), 'b')).toBe(false);
  });

  /* ---------------- checkmate and stalemate ---------------- */

  it('detects fool\u2019s mate as checkmate', () => {
    // 1. f3 e5 2. g4 Qh4#
    const position = fromFen('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3');
    expect(isInCheck(position, 'w')).toBe(true);
    expect(legalMoves(position)).toHaveLength(0);
    const outcome = outcomeOf(position);
    expect(outcome.over).toBe(true);
    if (outcome.over && outcome.result === 'checkmate') expect(outcome.winner).toBe('b');
    else throw new Error('expected checkmate');
  });

  it('detects back rank mate', () => {
    const position = fromFen('6k1/5ppp/8/8/8/8/8/R5K1 b - - 0 1');
    // Black to move is fine here; make it mate instead.
    const mate = fromFen('R5k1/5ppp/8/8/8/8/8/6K1 b - - 0 1');
    expect(isInCheck(mate, 'b')).toBe(true);
    expect(legalMoves(mate)).toHaveLength(0);
    expect(position.turn).toBe('b');
  });

  it('detects stalemate as a draw, not a loss', () => {
    // Classic stalemate: black king on h8, white queen g6, white king f7... use
    // the standard k/K/Q stalemate position.
    const position = fromFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    expect(isInCheck(position, 'b')).toBe(false);
    expect(legalMoves(position)).toHaveLength(0);
    const outcome = outcomeOf(position);
    expect(outcome.over).toBe(true);
    if (outcome.over) expect(outcome.result).toBe('stalemate');
  });

  /* ---------------- castling ---------------- */

  it('allows kingside and queenside castling and moves the rook', () => {
    const position = fromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    const kingMoves = legalMovesFrom(position, sq('e1'));
    const kingside = kingMoves.find((move) => move.isCastle === 'k');
    const queenside = kingMoves.find((move) => move.isCastle === 'q');
    expect(kingside).toBeDefined();
    expect(queenside).toBeDefined();

    const afterShort = applyMove(position, kingside!);
    expect(afterShort.board[sq('g1')]).toEqual({ type: 'k', color: 'w' });
    expect(afterShort.board[sq('f1')]).toEqual({ type: 'r', color: 'w' });
    expect(afterShort.board[sq('h1')]).toBeNull();
    // Rights are gone afterwards.
    expect(afterShort.castling.wk).toBe(false);
    expect(afterShort.castling.wq).toBe(false);

    const afterLong = applyMove(position, queenside!);
    expect(afterLong.board[sq('c1')]).toEqual({ type: 'k', color: 'w' });
    expect(afterLong.board[sq('d1')]).toEqual({ type: 'r', color: 'w' });
    expect(afterLong.board[sq('a1')]).toBeNull();
  });

  it('rejects castling through, out of, or into check', () => {
    // Rook on e8 attacks e1: the king is in check, so no castling.
    const inCheck = fromFen('4r3/8/8/8/8/8/8/R3K2R w KQ - 0 1');
    expect(legalMovesFrom(inCheck, sq('e1')).some((m) => m.isCastle)).toBe(false);

    // Rook on f8 attacks f1, the square the king crosses.
    const through = fromFen('5r2/8/8/8/8/8/8/R3K2R w KQ - 0 1');
    expect(legalMovesFrom(through, sq('e1')).some((m) => m.isCastle === 'k')).toBe(false);

    // Rook on g8 attacks g1, the square the king lands on.
    const into = fromFen('6r1/8/8/8/8/8/8/R3K2R w KQ - 0 1');
    expect(legalMovesFrom(into, sq('e1')).some((m) => m.isCastle === 'k')).toBe(false);
  });

  it('rejects castling when a piece is in the way or rights are lost', () => {
    const blocked = fromFen('r3k2r/8/8/8/8/8/8/R3KB1R w KQkq - 0 1');
    expect(legalMovesFrom(blocked, sq('e1')).some((m) => m.isCastle === 'k')).toBe(false);

    const noRights = fromFen('r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1');
    expect(legalMovesFrom(noRights, sq('e1')).some((m) => m.isCastle)).toBe(false);
  });

  it('loses castling rights when the king or a rook moves', () => {
    const position = fromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    const rookMove = findMove(position, sq('h1'), sq('h2'))!;
    const after = applyMove(position, rookMove);
    expect(after.castling.wk).toBe(false);
    expect(after.castling.wq).toBe(true); // queenside rook untouched
  });

  /* ---------------- en passant ---------------- */

  it('allows en passant and removes the passed pawn', () => {
    // Black has just played d7-d5; white pawn on e5 can take en passant.
    const position = fromFen('8/8/8/3pP3/8/8/8/K6k w - d6 0 1');
    const move = findMove(position, sq('e5'), sq('d6'));
    expect(move).toBeDefined();
    expect(move!.isEnPassant).toBe(true);

    const after = applyMove(position, move!);
    expect(after.board[sq('d6')]).toEqual({ type: 'p', color: 'w' });
    // The captured pawn sat on d5, NOT on the destination square.
    expect(after.board[sq('d5')]).toBeNull();
    expect(after.board[sq('e5')]).toBeNull();
  });

  it('offers en passant only on the very next move', () => {
    const stale = fromFen('8/8/8/3pP3/8/8/8/K6k w - - 0 1');
    expect(findMove(stale, sq('e5'), sq('d6'))).toBeUndefined();
  });

  it('sets the en passant square after a two square pawn push', () => {
    const position = initialPosition();
    const after = applyMove(position, findMove(position, sq('e2'), sq('e4'))!);
    expect(after.enPassant).toBe(sq('e3'));
    // A single step does not.
    const single = applyMove(position, findMove(position, sq('d2'), sq('d3'))!);
    expect(single.enPassant).toBeNull();
  });

  /* ---------------- promotion ---------------- */

  it('offers all four promotion pieces and applies the chosen one', () => {
    const position = fromFen('8/4P3/8/8/8/8/8/K6k w - - 0 1');
    const moves = legalMovesFrom(position, sq('e7'));
    expect(moves).toHaveLength(4);
    expect(moves.map((m) => m.promotion).sort()).toEqual(['b', 'n', 'q', 'r']);

    const knight = findMove(position, sq('e7'), sq('e8'), 'n')!;
    expect(knight.promotion).toBe('n');
    const after = applyMove(position, knight);
    expect(after.board[sq('e8')]).toEqual({ type: 'n', color: 'w' });
  });

  it('promotes on a capture too', () => {
    const position = fromFen('5r2/4P3/8/8/8/8/8/K6k w - - 0 1');
    const capture = legalMovesFrom(position, sq('e7')).filter((m) => m.to === sq('f8'));
    expect(capture).toHaveLength(4);
    expect(capture.every((m) => m.captured === 'r')).toBe(true);
  });

  /* ---------------- draws ---------------- */

  it('detects insufficient material', () => {
    expect(hasInsufficientMaterial(fromFen('8/8/8/8/8/8/8/K6k w - - 0 1').board)).toBe(true); // K v K
    expect(hasInsufficientMaterial(fromFen('8/8/8/8/8/8/8/KB5k w - - 0 1').board)).toBe(true); // K+B v K
    expect(hasInsufficientMaterial(fromFen('8/8/8/8/8/8/8/KN5k w - - 0 1').board)).toBe(true); // K+N v K
    // A single pawn or rook is enough material.
    expect(hasInsufficientMaterial(fromFen('8/8/8/8/8/8/P7/K6k w - - 0 1').board)).toBe(false);
    expect(hasInsufficientMaterial(fromFen('8/8/8/8/8/8/8/KR5k w - - 0 1').board)).toBe(false);
  });

  it('detects the fifty-move rule', () => {
    const position = fromFen('8/8/4k3/8/8/4K3/8/7R w - - 100 80');
    const outcome = outcomeOf(position);
    expect(outcome.over).toBe(true);
    if (outcome.over) expect(outcome.result).toBe('fifty-move');
  });

  it('detects threefold repetition', () => {
    const position = fromFen('8/8/4k3/8/8/4K3/8/7R w - - 10 40');
    const key = positionKey(position);
    const outcome = outcomeOf(position, [key, key, key]);
    expect(outcome.over).toBe(true);
    if (outcome.over) expect(outcome.result).toBe('threefold');
  });

  it('reports an ongoing game as not over', () => {
    expect(outcomeOf(initialPosition()).over).toBe(false);
  });

  /* ---------------- notation ---------------- */

  it('writes readable algebraic notation', () => {
    const start = initialPosition();
    expect(describeMove(start, findMove(start, sq('e2'), sq('e4'))!)).toBe('e4');
    expect(describeMove(start, findMove(start, sq('g1'), sq('f3'))!)).toBe('Nf3');

    const castle = fromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    expect(describeMove(castle, findMove(castle, sq('e1'), sq('g1'))!)).toBe('O-O');
    expect(describeMove(castle, findMove(castle, sq('e1'), sq('c1'))!)).toBe('O-O-O');

    const capture = fromFen('8/8/8/3p4/4P3/8/8/K6k w - - 0 1');
    expect(describeMove(capture, findMove(capture, sq('e4'), sq('d5'))!)).toBe('exd5');

    const promote = fromFen('8/4P3/8/8/8/8/8/K6k w - - 0 1');
    expect(describeMove(promote, findMove(promote, sq('e7'), sq('e8'), 'q')!)).toBe('e8=Q');
  });

  it('marks check and checkmate in notation', () => {
    // Rf1-f8 is only CHECK here: the black king escapes to d7/e7.
    const check = fromFen('4k3/8/8/8/8/8/8/4KR2 w - - 0 1');
    expect(describeMove(check, findMove(check, sq('f1'), sq('f8'))!)).toBe('Rf8+');

    // Rb1-b8 is a genuine back rank mate (Ra7 covers the escape rank).
    const mate = fromFen('7k/R7/8/8/8/8/8/1R5K w - - 0 1');
    expect(describeMove(mate, findMove(mate, sq('b1'), sq('b8'))!)).toBe('Rb8#');
  });

  /* ---------------- AI ---------------- */

  it('the AI only ever returns legal moves', () => {
    let position = initialPosition();
    const random = () => 0.5;
    for (let ply = 0; ply < 20; ply += 1) {
      const move = chooseMove(position, 2, random);
      if (!move) break;
      // Whatever it picks must be in the legal list.
      expect(legalMoves(position).some((m) => m.from === move.from && m.to === move.to)).toBe(true);
      position = applyMove(position, move);
    }
    expect(position.fullmove).toBeGreaterThan(1);
  });

  it('the AI takes a free queen', () => {
    // White to move; the black queen on d5 is hanging to the pawn on e4.
    const position = fromFen('4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1');
    const move = chooseMove(position, 2, () => 0.5);
    expect(move).not.toBeNull();
    expect(squareName(move!.to)).toBe('d5');
    expect(move!.captured).toBe('q');
  });

  it('the AI finds mate in one', () => {
    // Rb8# is the unique mate in this position.
    const position = fromFen('7k/R7/8/8/8/8/8/1R5K w - - 0 1');
    const move = chooseMove(position, 3, () => 0.5);
    expect(move).not.toBeNull();
    const after = applyMove(position, move!);
    expect(isInCheck(after, 'b')).toBe(true);
    expect(legalMoves(after)).toHaveLength(0);
  });

  it('the AI never walks into an illegal position over a long game', () => {
    let position = initialPosition();
    let plies = 0;
    while (plies < 60) {
      const outcome = outcomeOf(position);
      if (outcome.over) break;
      const move = chooseMove(position, 1, () => 0.42);
      if (!move) break;
      position = applyMove(position, move);
      plies += 1;
      // Neither king may ever be left in check by the side that just moved.
      const justMoved: PieceColor = position.turn === 'w' ? 'b' : 'w';
      expect(isInCheck(position, justMoved)).toBe(false);
      // Both kings must still exist.
      expect(position.board.some((p: Piece | null) => p?.type === 'k' && p.color === 'w')).toBe(true);
      expect(position.board.some((p: Piece | null) => p?.type === 'k' && p.color === 'b')).toBe(true);
    }
    expect(plies).toBeGreaterThan(0);
  });
});
