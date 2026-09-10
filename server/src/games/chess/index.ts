import type { GameFinishReason } from '@2play/shared';
import type { GameContext, GameModule, GameResultDraft } from '../GameModule';
import { actionAccepted } from '../GameModule';
import { CHESS_METADATA } from '@2play/shared';
type Color = 'w' | 'b';
type Piece = string;
interface ChessState {
  kind: 'chess';
  phase: 'idle' | 'playing' | 'finished';
  board: Piece[];
  turn: Color;
  players: Record<string, Color>;
  winnerId: string | null;
  reason: GameFinishReason | null;
  castling: string;
  ep: number | null;
  halfmove: number;
  fullmove: number;
  history: string[];
  lastMove: string | null;
}
const start = [
  'r',
  'n',
  'b',
  'q',
  'k',
  'b',
  'n',
  'r',
  ...Array(8).fill('p'),
  ...Array(32).fill(''),
  ...Array(8).fill('P'),
  'R',
  'N',
  'B',
  'Q',
  'K',
  'B',
  'N',
  'R',
];
const col = (p: string): Color => (p === p.toUpperCase() ? 'w' : 'b');
const enemy = (p: string, c: Color) => p && col(p) !== c;
const file = (x: number) => x % 8,
  rank = (x: number) => Math.floor(x / 8);
function attacked(b: Piece[], sq: number, by: Color): boolean {
  for (let i = 0; i < 64; i++) {
    const p = b[i];
    if (!p || col(p) !== by) continue;
    const dr = rank(sq) - rank(i),
      dc = file(sq) - file(i),
      P = p.toLowerCase();
    if (P === 'p' && dr === (by === 'w' ? -1 : 1) && Math.abs(dc) === 1) return true;
    if (
      P === 'n' &&
      [
        [1, 2],
        [2, 1],
        [-1, 2],
        [-2, 1],
        [1, -2],
        [2, -1],
        [-1, -2],
        [-2, -1],
      ].some(([a, d]) => a === dr && d === dc)
    )
      return true;
    if (P === 'k' && Math.max(Math.abs(dr), Math.abs(dc)) === 1) return true;
    if ('brq'.includes(P)) {
      const ok =
        P === 'q' ||
        (P === 'b' && Math.abs(dr) === Math.abs(dc)) ||
        (P === 'r' && (dr === 0 || dc === 0));
      if (ok) {
        const sr = Math.sign(dr),
          sc = Math.sign(dc);
        let y = rank(i) + sr,
          x = file(i) + sc,
          clear = true;
        while (y !== rank(sq) || x !== file(sq)) {
          if (b[y * 8 + x]) clear = false;
          y += sr;
          x += sc;
        }
        if (clear) return true;
      }
    }
  }
  return false;
}
function king(b: Piece[], c: Color) {
  return b.findIndex((p) => p === (c === 'w' ? 'K' : 'k'));
}
function checked(b: Piece[], c: Color) {
  const k = king(b, c);
  return k < 0 || attacked(b, k, c === 'w' ? 'b' : 'w');
}
function pseudo(
  b: Piece[],
  from: number,
  to: number,
  c: Color,
  s: ChessState,
  prom?: string,
): Piece[] {
  const p = b[from],
    P = p.toLowerCase(),
    dr = rank(to) - rank(from),
    dc = file(to) - file(from),
    out: Piece[] = [];
  if (!p || col(p) !== c || (b[to] && col(b[to]) === c)) return out;
  if (P === 'p') {
    const d = c === 'w' ? -1 : 1;
    if (
      dc === 0 &&
      !b[to] &&
      (dr === d || (dr === 2 * d && rank(from) === (c === 'w' ? 6 : 1) && !b[from + d * 8]))
    )
      out.push(prom ?? p);
    if (Math.abs(dc) === 1 && dr === d && (enemy(b[to], c) || to === s.ep)) out.push(prom ?? p);
  } else if (P === 'n') {
    if (
      [
        [1, 2],
        [2, 1],
        [-1, 2],
        [-2, 1],
        [1, -2],
        [2, -1],
        [-1, -2],
        [-2, -1],
      ].some(([a, d]) => a === dr && d === dc)
    )
      out.push(p);
  } else if (P === 'k') {
    if (Math.max(Math.abs(dr), Math.abs(dc)) === 1) out.push(p);
    if (
      dr === 0 &&
      Math.abs(dc) === 2 &&
      ((c === 'w' && from === 60) || (c === 'b' && from === 4)) &&
      !checked(b, c)
    ) {
      const side = dc > 0,
        rook = side ? from + 3 : from - 4,
        step = side ? 1 : -1;
      if (
        s.castling.includes(c + (side ? 'K' : 'Q')) &&
        b[rook].toLowerCase() === 'r' &&
        !b[from + step] &&
        !b[from + 2 * step] &&
        !attacked(b, from + step, c === 'w' ? 'b' : 'w') &&
        !attacked(b, from + 2 * step, c === 'w' ? 'b' : 'w')
      )
        out.push(p);
    }
  } else {
    const ok =
      P === 'q' ||
      (P === 'b' && Math.abs(dr) === Math.abs(dc)) ||
      (P === 'r' && (dr === 0 || dc === 0));
    if (ok) {
      const sr = Math.sign(dr),
        sc = Math.sign(dc);
      let y = rank(from) + sr,
        x = file(from) + sc,
        clear = true;
      while (y !== rank(to) || x !== file(to)) {
        if (b[y * 8 + x]) clear = false;
        y += sr;
        x += sc;
      }
      if (clear) out.push(p);
    }
  }
  return out;
}
function apply(s: ChessState, from: number, to: number, prom?: string): ChessState | null {
  const c = s.turn,
    p = s.board[from],
    valid = pseudo(s.board, from, to, c, s, prom);
  if (!valid.length) return null;
  const b = [...s.board];
  b[to] = prom ? (c === 'w' ? prom.toUpperCase() : prom.toLowerCase()) : p;
  b[from] = '';
  if (p.toLowerCase() === 'p' && to === s.ep) b[to + (c === 'w' ? 8 : -8)] = '';
  if (p.toLowerCase() === 'k' && Math.abs(file(to) - file(from)) === 2) {
    const rf = file(to) > file(from) ? from + 3 : from - 4,
      rt = file(to) > file(from) ? from - 1 : from + 1;
    b[rt] = b[rf];
    b[rf] = '';
  }
  const ns = {
    ...s,
    board: b,
    turn: (c === 'w' ? 'b' : 'w') as Color,
    ep: p.toLowerCase() === 'p' && Math.abs(to - from) === 16 ? from + (to - from) / 2 : null,
    halfmove: p.toLowerCase() === 'p' || s.board[to] ? 0 : s.halfmove + 1,
    fullmove: c === 'b' ? s.fullmove + 1 : s.fullmove,
    history: [...s.history, `${from}-${to}`],
    lastMove: `${from}-${to}`,
  };
  if (checked(b, c)) return null;
  return ns;
}
function legal(s: ChessState, c: Color) {
  const out: [number, number, string?][] = [];
  for (let f = 0; f < 64; f++)
    if (s.board[f] && col(s.board[f]) === c)
      for (let t = 0; t < 64; t++) {
        if (s.board[f].toLowerCase() === 'p' && rank(t) === (c === 'w' ? 0 : 7)) {
          for (const x of ['q', 'r', 'b', 'n']) if (apply(s, f, t, x)) out.push([f, t, x]);
        } else if (apply(s, f, t)) out.push([f, t]);
      }
  return out;
}
function done(s: ChessState, ctx: GameContext) {
  if (s.halfmove >= 100) {
    s.phase = 'finished';
    s.reason = 'draw';
    ctx.finish('draw');
    return;
  }
  const moves = legal(s, s.turn);
  if (!moves.length) {
    s.phase = 'finished';
    s.reason = checked(s.board, s.turn) ? 'completed' : 'draw';
    s.winnerId = checked(s.board, s.turn)
      ? (Object.entries(s.players).find(([, c]) => c !== s.turn)?.[0] ?? null)
      : null;
    ctx.finish(s.reason ?? 'completed');
  }
}
const finishReason = (r: GameFinishReason | null) => r === 'draw';
export const chessGame: GameModule<ChessState> = {
  metadata: CHESS_METADATA,
  initialize() {},
  createInitialState(players) {
    return {
      kind: 'chess',
      phase: 'idle',
      board: [...start],
      turn: 'w',
      players: Object.fromEntries(players.slice(0, 2).map((p, i) => [p.id, i ? 'b' : 'w'])),
      winnerId: null,
      reason: null,
      castling: 'wKwQbKbQ',
      ep: null,
      halfmove: 0,
      fullmove: 1,
      history: [],
      lastMove: null,
    };
  },
  playerJoined() {},
  playerReady() {},
  playerLeft(id, s, ctx, reason) {
    if (s.phase === 'playing' && reason !== 'disconnect') {
      s.phase = 'finished';
      s.reason = 'abandoned';
      s.winnerId = Object.keys(s.players).find((x) => x !== id) ?? null;
      ctx.finish('abandoned');
    }
  },
  start(s, ctx) {
    s.phase = 'playing';
    ctx.schedule(
      15 * 60_000,
      () => {
        if (s.phase === 'playing') {
          s.phase = 'finished';
          s.reason = 'timeout';
          ctx.finish('timeout');
        }
      },
      'gameDuration',
      'chess-duration',
    );
    ctx.markStateChanged();
  },
  validateAction(id, a, s) {
    const c = s.players[id];
    if (s.phase !== 'playing' || !c || c !== s.turn)
      return { valid: false, reason: 'Not your turn.' };
    const f = Number(a.payload?.from),
      t = Number(a.payload?.to);
    if (
      a.type !== 'move' ||
      !Number.isInteger(f) ||
      !Number.isInteger(t) ||
      f < 0 ||
      f > 63 ||
      t < 0 ||
      t > 63 ||
      !legal(s, c).some(
        (x) => x[0] === f && x[1] === t && (!x[2] || x[2] === String(a.payload?.promotion ?? '')),
      )
    )
      return { valid: false, reason: 'Illegal move.' };
    return { valid: true };
  },
  handlePlayerAction(id, a, s, ctx) {
    const n = apply(
      s,
      Number(a.payload?.from),
      Number(a.payload?.to),
      String(a.payload?.promotion ?? ''),
    );
    if (!n) return { accepted: false, stateChanged: false, reason: 'Illegal move.' };
    Object.assign(s, n);
    done(s, ctx);
    ctx.markStateChanged();
    return actionAccepted();
  },
  update() {},
  tick() {},
  calculateScore(id, s) {
    return s.winnerId === id ? 1 : 0;
  },
  checkWinCondition: (s) => (s.winnerId ? [s.winnerId] : null),
  checkDrawCondition: (s) => finishReason(s.reason),
  isGameFinished: (s) => s.phase === 'finished',
  finish(s) {
    s.phase = 'finished';
  },
  getResult(s, ctx): GameResultDraft {
    return {
      winners: s.winnerId ? [s.winnerId] : [],
      isDraw: finishReason(s.reason),
      rankings: ctx.players.map((p) => ({
        playerId: p.id,
        rank: p.id === s.winnerId ? 1 : 2,
        score: p.id === s.winnerId ? 1 : 0,
        isWinner: p.id === s.winnerId,
        isDraw: finishReason(s.reason),
        stats: { moves: s.history.length },
      })),
      reason: s.reason ?? 'completed',
    };
  },
  reset(s) {
    return {
      kind: 'chess',
      phase: 'idle',
      board: [...start],
      turn: 'w',
      players: { ...s.players },
      winnerId: null,
      reason: null,
      castling: 'wKwQbKbQ',
      ep: null,
      halfmove: 0,
      fullmove: 1,
      history: [],
      lastMove: null,
    };
  },
  cleanup() {},
  getPublicState(s) {
    return s;
  },
  getAIMove(id, _d, s) {
    const m = legal(s, s.players[id]!).find((x) => x);
    return m
      ? { type: 'move', payload: { from: m[0], to: m[1], ...(m[2] ? { promotion: m[2] } : {}) } }
      : null;
  },
  maxDurationMs: 15 * 60_000,
};
