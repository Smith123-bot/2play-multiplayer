import type { GameAction, GameFinishReason, GameMetadata } from '@2play/shared';
import type {
  ActionResult,
  GameContext,
  GameModule,
  GamePlayerView,
  GameResultDraft,
  ValidationResult,
} from './GameModule';
import { actionAccepted } from './GameModule';

type ClassicKind = 'connect-four' | 'hangman' | 'sos-game';
interface Player {
  score: number;
  moves: number;
  wins: number;
  disconnected: boolean;
  left: boolean;
}
export interface ClassicState {
  kind: ClassicKind;
  phase: 'idle' | 'playing' | 'finished';
  players: Record<string, Player>;
  currentPlayerId: string | null;
  endsAt: number | null;
  winnerId: string | null;
  finishReason: GameFinishReason | null;
  lastEvent: string | null;
  board: Array<number | string>;
  moves: number;
  winningLine: number[];
  scores: Record<string, number>;
  guessed: string[];
  word: string;
  round: number;
  totalRounds: number;
  attemptsLeft: number;
  maxAttempts: number;
  words: string[];
  patterns: string[];
}
const WORDS = [
  'PLANET',
  'RIVER',
  'PUZZLE',
  'GARDEN',
  'KITTEN',
  'ROCKET',
  'CASTLE',
  'ORANGE',
  'BREEZE',
  'MUSICAL',
];
const DURATION = 5 * 60_000;
function ids(s: ClassicState) {
  return Object.keys(s.players).filter((id) => !s.players[id]!.left);
}
function finish(
  s: ClassicState,
  ctx: GameContext,
  reason: GameFinishReason,
  winner: string | null = null,
) {
  if (s.phase === 'finished') return;
  s.phase = 'finished';
  s.endsAt = null;
  s.winnerId = winner;
  s.finishReason = reason;
  s.lastEvent = winner ? `winner:${winner}` : reason;
  ctx.markStateChanged();
  ctx.finish(reason);
}
function next(s: ClassicState, id: string) {
  const a = ids(s),
    i = a.indexOf(id);
  return a.length ? a[(i + 1) % a.length]! : null;
}
function initial(players: readonly GamePlayerView[], kind: ClassicKind, seed = 1): ClassicState {
  const p = Object.fromEntries(
    players.map((x) => [x.id, { score: 0, moves: 0, wins: 0, disconnected: false, left: false }]),
  );
  const words = WORDS.slice();
  const n = seed >>> 0 || 1;
  for (let i = words.length - 1; i > 0; i--) {
    const j = (n + i * 17) % (i + 1);
    [words[i], words[j]] = [words[j]!, words[i]!];
  }
  return {
    kind,
    phase: 'idle',
    players: p,
    currentPlayerId: players[0]?.id ?? null,
    endsAt: null,
    winnerId: null,
    finishReason: null,
    lastEvent: null,
    board:
      kind === 'connect-four' ? Array(42).fill(0) : kind === 'sos-game' ? Array(25).fill('') : [],
    moves: 0,
    winningLine: [],
    scores: Object.fromEntries(players.map((x) => [x.id, 0])),
    guessed: [],
    word: words[0]!,
    round: 1,
    totalRounds: kind === 'hangman' ? 5 : 1,
    attemptsLeft: 6,
    maxAttempts: 6,
    words,
    patterns: [],
  };
}
function c4Win(board: number[], at: number, value: number): number[] {
  const r = Math.floor(at / 7),
    c = at % 7;
  for (const [dr, dc] of [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ]) {
    const line = [at];
    for (const sign of [-1, 1]) {
      let y = r + dr * sign,
        x = c + dc * sign;
      while (y >= 0 && y < 6 && x >= 0 && x < 7 && board[y * 7 + x] === value) {
        line.push(y * 7 + x);
        y += dr * sign;
        x += dc * sign;
      }
    }
    if (line.length >= 4) return line.sort((a, b) => a - b).slice(0, 4);
  }
  return [];
}
function sosPatterns(board: Array<string>, at: number): string[] {
  const r = Math.floor(at / 5),
    c = at % 5,
    out: string[] = [];
  for (const [dr, dc] of [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ]) {
    for (let k = -2; k <= 0; k++) {
      const cells = [0, 1, 2].map((i) => {
        const y = r + (k + i) * dr,
          x = c + (k + i) * dc;
        return y >= 0 && y < 5 && x >= 0 && x < 5 ? y * 5 + x : -1;
      });
      if (
        cells.every((x) => x >= 0) &&
        board[cells[0]!] === 'S' &&
        board[cells[1]!] === 'O' &&
        board[cells[2]!] === 'S'
      ) {
        const key = cells.join(',');
        if (!out.includes(key)) out.push(key);
      }
    }
  }
  return out;
}
function publicState(s: ClassicState, _viewerId: string | undefined, ctx: GameContext) {
  const out = {
    ...s,
    players: Object.fromEntries(Object.entries(s.players).map(([id, p]) => [id, { ...p }])),
    serverTime: ctx.now(),
  };
  if (s.kind === 'hangman') {
    return {
      ...out,
      word: s.word
        .split('')
        .map((ch) => (s.guessed.includes(ch) ? ch : '_'))
        .join(''),
      words: [],
      secretWordLength: s.word.length,
    };
  }
  return out;
}
function validate(id: string, a: GameAction, s: ClassicState): ValidationResult {
  const p = s.players[id];
  if (s.phase !== 'playing' || !p || p.left || p.disconnected)
    return { valid: false, reason: 'Match is not accepting actions.' };
  if (s.currentPlayerId !== id) return { valid: false, reason: 'It is not your turn.' };
  if (s.kind === 'connect-four') {
    const c = a.payload?.column;
    if (
      a.type !== 'drop' ||
      typeof c !== 'number' ||
      !Number.isInteger(c) ||
      c < 0 ||
      c > 6 ||
      s.board[c] !== 0
    )
      return { valid: false, reason: 'Choose a non-full column.' };
    if (s.board[c] !== 0) return { valid: false, reason: 'Column is full.' };
    return { valid: true };
  }
  if (s.kind === 'sos-game') {
    const i = a.payload?.index,
      l = a.payload?.letter;
    if (
      a.type !== 'place' ||
      typeof i !== 'number' ||
      !Number.isInteger(i) ||
      i < 0 ||
      i >= 25 ||
      s.board[i] !== ''
    )
      return { valid: false, reason: 'Choose an empty cell.' };
    return typeof l === 'string' && ['S', 'O'].includes(l.toUpperCase())
      ? { valid: true }
      : { valid: false, reason: 'Place S or O.' };
  }
  if (
    a.type !== 'guess' ||
    typeof a.payload?.letter !== 'string' ||
    !/^[a-zA-Z]$/.test(a.payload.letter)
  )
    return { valid: false, reason: 'Guess one letter.' };
  const l = String(a.payload.letter).toUpperCase();
  return s.guessed.includes(l)
    ? { valid: false, reason: 'That letter was already guessed.' }
    : { valid: true };
}
function handle(id: string, a: GameAction, s: ClassicState, ctx: GameContext): ActionResult {
  const p = s.players[id]!;
  p.moves++;
  if (s.kind === 'connect-four') {
    const c = Number(a.payload?.column);
    let row = 5;
    while (row >= 0 && s.board[row * 7 + c] !== 0) row--;
    const token = ids(s)[0] === id ? 1 : 2;
    s.board[row * 7 + c] = token;
    s.moves++;
    const line = c4Win(s.board as number[], row * 7 + c, token);
    if (line.length) {
      s.winningLine = line;
      p.score += 100;
      finish(s, ctx, 'completed', id);
    } else if (s.moves === 42) finish(s, ctx, 'draw');
    else s.currentPlayerId = next(s, id);
    s.lastEvent = `drop:${c}`;
  } else if (s.kind === 'sos-game') {
    const i = Number(a.payload?.index),
      l = String(a.payload?.letter).toUpperCase();
    s.board[i] = l;
    s.moves++;
    const found = sosPatterns(s.board as string[], i).filter((x) => !s.patterns.includes(x));
    s.patterns.push(...found);
    p.score += found.length;
    s.scores[id] = p.score;
    s.lastEvent = found.length ? `sos:${found.length}` : `place:${i}`;
    if (s.moves === 25) {
      const ranked = Object.entries(s.scores).sort((x, y) => y[1] - x[1]);
      finish(
        s,
        ctx,
        'completed',
        ranked[0] && ranked[0][1] !== ranked[1]?.[1] ? ranked[0][0] : null,
      );
    } else if (!found.length) s.currentPlayerId = next(s, id);
  } else {
    const l = String(a.payload?.letter).toUpperCase();
    s.guessed.push(l);
    if (!s.word.includes(l)) s.attemptsLeft--;
    else p.score += 10;
    s.lastEvent = `guess:${l}`;
    const done = [...s.word].every((x) => s.guessed.includes(x));
    if (done || s.attemptsLeft <= 0) {
      if (done) p.score += s.attemptsLeft * 5;
      if (s.round >= s.totalRounds) {
        const ranks = Object.entries(s.players).sort((x, y) => y[1].score - x[1].score);
        finish(
          s,
          ctx,
          'completed',
          ranks[0] && ranks[0][1].score !== ranks[1]?.[1].score ? ranks[0][0] : null,
        );
      } else {
        s.round++;
        s.word = s.words[s.round - 1] ?? WORDS[(s.round - 1) % WORDS.length]!;
        s.guessed = [];
        s.attemptsLeft = s.maxAttempts;
        s.currentPlayerId = next(s, id);
      }
    } else s.currentPlayerId = next(s, id);
  }
  ctx.markStateChanged();
  return actionAccepted();
}
export function createClassicGame(
  metadata: GameMetadata,
  kind: ClassicKind,
): GameModule<ClassicState> {
  return {
    metadata,
    initialize() {},
    createInitialState(p, c) {
      return initial(p, kind, c.seed);
    },
    playerJoined(p, s) {
      s.players[p.id] ??= { score: 0, moves: 0, wins: 0, disconnected: false, left: false };
    },
    playerReady() {},
    playerLeft(id, s, ctx, reason) {
      if (reason === 'disconnect') {
        s.players[id]!.disconnected = true;
      } else {
        s.players[id]!.left = true;
        if (s.phase === 'playing') finish(s, ctx, 'abandoned');
      }
    },
    start(s, ctx) {
      s.phase = 'playing';
      s.endsAt = ctx.now() + DURATION;
      s.currentPlayerId = ids(s)[0] ?? null;
      ctx.schedule(DURATION, () => finish(s, ctx, 'timeout'), 'gameDuration', `${kind}-duration`);
      ctx.markStateChanged();
    },
    validateAction(id, a, s) {
      return validate(id, a, s);
    },
    handlePlayerAction: handle,
    update() {},
    tick() {},
    calculateScore(id, s) {
      return s.players[id]?.score ?? 0;
    },
    checkWinCondition(s) {
      return s.winnerId ? [s.winnerId] : null;
    },
    checkDrawCondition(s) {
      return s.finishReason === 'draw';
    },
    isGameFinished(s) {
      return s.phase === 'finished';
    },
    finish(s) {
      s.phase = 'finished';
    },
    getResult(s, ctx): GameResultDraft {
      const ranks = ctx.players
        .map((p) => ({
          playerId: p.id,
          rank: 0,
          score: s.players[p.id]?.score ?? 0,
          isWinner: p.id === s.winnerId,
          isDraw: s.finishReason === 'draw',
          stats: {
            moves: s.players[p.id]?.moves ?? 0,
            score: s.players[p.id]?.score ?? 0,
            patterns: s.patterns.length,
          },
        }))
        .sort((a, b) => b.score - a.score)
        .map((x, i) => ({ ...x, rank: i + 1 }));
      return {
        winners: s.winnerId ? [s.winnerId] : [],
        isDraw: s.finishReason === 'draw',
        rankings: ranks,
        reason: s.finishReason ?? 'completed',
      };
    },
    reset(s) {
      return initial(
        Object.keys(s.players).map((id, i) => ({
          id,
          nickname: '',
          avatar: '',
          isAI: false,
          aiDifficulty: null,
          isConnected: true,
          seatIndex: i,
          isHost: i === 0,
        })),
        kind,
      );
    },
    cleanup(s) {
      s.board = [];
    },
    getPublicState: publicState,
    getAIMove(id, _d, s) {
      if (s.currentPlayerId !== id) return null;
      if (kind === 'connect-four') {
        const c = [3, 2, 4, 1, 5, 0, 6].find((x) => s.board[x] === 0);
        return c === undefined ? null : { type: 'drop', payload: { column: c } };
      }
      if (kind === 'sos-game') {
        const i = s.board.findIndex((x) => x === '');
        return i < 0 ? null : { type: 'place', payload: { index: i, letter: 'S' } };
      }
      const l =
        [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].find(
          (x) => !s.guessed.includes(x) && s.word.includes(x),
        ) ?? 'E';
      return { type: 'guess', payload: { letter: l } };
    },
    maxDurationMs: DURATION,
  };
}
