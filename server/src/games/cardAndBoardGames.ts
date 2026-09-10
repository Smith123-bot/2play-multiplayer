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

type Player = { score: number; moves: number; left: boolean; disconnected: boolean };
type Base = {
  kind: 'uno' | 'sim' | 'dominoes';
  phase: 'idle' | 'playing' | 'finished';
  players: Record<string, Player>;
  currentPlayerId: string | null;
  winnerId: string | null;
  reason: GameFinishReason | null;
  endsAt: number | null;
  lastEvent: string | null;
};
export type UnoCard = {
  id: string;
  color: 'red' | 'yellow' | 'green' | 'blue' | 'wild';
  value: number | string;
};
export type UnoState = Base & {
  kind: 'uno';
  hands: Record<string, UnoCard[]>;
  deck: UnoCard[];
  discard: UnoCard[];
  currentColor: 'red' | 'yellow' | 'green' | 'blue';
  direction: 1 | -1;
  unoPending: string | null;
  turns: number;
};
export type SimState = Base & {
  kind: 'sim';
  edges: Record<string, string | null>;
  currentColor: 'red' | 'blue';
  moves: number;
  losingTriangle: number[] | null;
};
export type DominoTile = {
  id: string;
  a: number;
  b: number;
  owner: string | null;
  played: boolean;
  orientation?: 'normal' | 'flipped';
};
export type DominoState = Base & {
  kind: 'dominoes';
  hands: Record<string, DominoTile[]>;
  boneyard: DominoTile[];
  chain: DominoTile[];
  leftEnd: number | null;
  rightEnd: number | null;
  moves: number;
  scores: Record<string, number>;
};
export type CardBoardState = UnoState | SimState | DominoState;
const COLORS = ['red', 'yellow', 'green', 'blue'] as const;
const DURATION = 15 * 60_000;
function ids(s: Base) {
  return Object.keys(s.players).filter((id) => !s.players[id]!.left);
}
function base(players: readonly GamePlayerView[], kind: Base['kind']): Base {
  return {
    kind,
    phase: 'idle',
    players: Object.fromEntries(
      players.map((p) => [p.id, { score: 0, moves: 0, left: false, disconnected: false }]),
    ),
    currentPlayerId: players[0]?.id ?? null,
    winnerId: null,
    reason: null,
    endsAt: null,
    lastEvent: null,
  };
}
function next(s: Base, id: string, step = 1) {
  const a = ids(s),
    i = a.indexOf(id);
  const direction = 'direction' in s ? (s as UnoState).direction : 1;
  return a.length ? (a[(i + step * direction + a.length) % a.length] ?? a[0]!) : null;
}
function shuffle<T>(a: T[], ctx: GameContext) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(ctx.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
function finish(s: Base, ctx: GameContext, reason: GameFinishReason, winner: string | null = null) {
  if (s.phase === 'finished') return;
  s.phase = 'finished';
  s.reason = reason;
  s.winnerId = winner;
  s.endsAt = null;
  ctx.finish(reason);
  ctx.markStateChanged();
}
function makeUnoDeck(seed = 1) {
  const d: UnoCard[] = [];
  let n = 0;
  for (const color of COLORS) {
    for (let v = 0; v <= 9; v++) {
      const copies = v === 0 ? 1 : 2;
      for (let copy = 0; copy < copies; copy++) d.push({ id: `u${n++}`, color, value: v });
    }
    for (let k = 0; k < 2; k++)
      for (const value of ['skip', 'reverse', 'draw2']) d.push({ id: `u${n++}`, color, value });
  }
  for (let k = 0; k < 4; k++) {
    d.push(
      { id: `u${n++}`, color: 'wild', value: 'wild' },
      { id: `u${n++}`, color: 'wild', value: 'wild4' },
    );
  }
  let random = seed >>> 0 || 1;
  for (let i = d.length - 1; i > 0; i--) {
    random = (random * 1664525 + 1013904223) >>> 0;
    const j = random % (i + 1);
    [d[i], d[j]] = [d[j]!, d[i]!];
  }
  return d;
}
function playable(c: UnoCard, top: UnoCard, color: string) {
  return c.color === 'wild' || c.color === color || c.value === top.value;
}
function unoPublic(s: UnoState, viewer: string | undefined, ctx: GameContext) {
  return {
    ...s,
    deck: [],
    hands: Object.fromEntries(
      Object.entries(s.hands).map(([id, h]) => [
        id,
        id === viewer ? h : h.map(() => ({ id: 'hidden', color: 'wild', value: 'hidden' })),
      ]),
    ),
    handCounts: Object.fromEntries(Object.entries(s.hands).map(([id, h]) => [id, h.length])),
    serverTime: ctx.now(),
  };
}
function createUno(players: readonly GamePlayerView[], seed = 1): UnoState {
  const b = base(players, 'uno') as UnoState;
  b.hands = Object.fromEntries(players.map((p) => [p.id, []]));
  b.deck = makeUnoDeck(seed);
  b.discard = [];
  b.direction = 1;
  b.currentColor = 'red';
  b.unoPending = null;
  b.turns = 0;
  for (const p of players) for (let i = 0; i < 7; i++) b.hands[p.id]!.push(b.deck.pop()!);
  let first = b.deck.pop()!;
  while (first.color === 'wild') {
    b.deck.unshift(first);
    first = b.deck.pop()!;
  }
  b.discard = [first];
  b.currentColor = first.color as typeof b.currentColor;
  return b;
}
function unoValidate(id: string, a: GameAction, s: UnoState): ValidationResult {
  if (s.phase !== 'playing' || s.currentPlayerId !== id)
    return { valid: false, reason: 'Not your turn.' };
  if (a.type === 'call-uno')
    return s.unoPending === id
      ? { valid: true }
      : { valid: false, reason: 'UNO is not available.' };
  if (a.type === 'draw') {
    const hand = s.hands[id] ?? [];
    if (hand.some((card) => playable(card, s.discard.at(-1)!, s.currentColor)))
      return { valid: false, reason: 'Play a legal card before drawing.' };
    return { valid: true };
  }
  if (a.type !== 'play') return { valid: false, reason: 'Unknown action.' };
  const card = s.hands[id]?.find((c) => c.id === a.payload?.cardId);
  if (!card) return { valid: false, reason: 'That card is not in your hand.' };
  const top = s.discard.at(-1)!;
  if (!playable(card, top, s.currentColor)) return { valid: false, reason: 'Card does not match.' };
  if (card.value === 'wild4' && s.hands[id]!.some((c) => c.color === s.currentColor))
    return {
      valid: false,
      reason: 'Wild Draw Four is not legal while you have the current color.',
    };
  if (
    card.color === 'wild' &&
    !COLORS.includes(String(a.payload?.color) as (typeof COLORS)[number])
  )
    return { valid: false, reason: 'Choose a valid color.' };
  return { valid: true };
}
function drawUno(s: UnoState, id: string, count: number, ctx: GameContext) {
  for (let i = 0; i < count; i++) {
    if (!s.deck.length) {
      const top = s.discard.pop();
      s.deck = shuffle(s.discard.splice(0), ctx);
      if (top) s.discard.push(top);
    }
    const c = s.deck.pop();
    if (c) s.hands[id]!.push(c);
  }
}
function unoHandle(id: string, a: GameAction, s: UnoState, ctx: GameContext): ActionResult {
  if (a.type === 'call-uno') {
    s.unoPending = null;
    s.lastEvent = 'uno';
    ctx.markStateChanged();
    return actionAccepted();
  }
  if (s.unoPending && s.unoPending !== id) {
    drawUno(s, s.unoPending, 2, ctx);
    s.unoPending = null;
  }
  if (a.type === 'draw') {
    drawUno(s, id, 1, ctx);
    s.currentPlayerId = next(s, id);
    s.lastEvent = 'draw';
    s.players[id]!.moves++;
    ctx.markStateChanged();
    return actionAccepted();
  }
  const i = s.hands[id]!.findIndex((c) => c.id === a.payload?.cardId);
  const card = s.hands[id]!.splice(i, 1)[0]!;
  s.discard.push(card);
  s.currentColor =
    card.color === 'wild' ? (String(a.payload?.color) as typeof s.currentColor) : card.color;
  s.players[id]!.moves++;
  s.turns++;
  s.lastEvent = `play:${card.value}`;
  if (s.hands[id]!.length === 0) {
    s.players[id]!.score = Object.values(s.hands)
      .flat()
      .reduce(
        (n, c) =>
          n +
          (typeof c.value === 'number'
            ? c.value
            : c.value === 'wild' || c.value === 'wild4'
              ? 50
              : 20),
        0,
      );
    finish(s, ctx, 'completed', id);
    return actionAccepted();
  }
  if (s.hands[id]!.length === 1) s.unoPending = id;
  const skip =
    card.value === 'skip' ||
    card.value === 'draw2' ||
    (card.value === 'reverse' && ids(s).length === 2);
  if (card.value === 'reverse' && ids(s).length > 2) s.direction = s.direction === 1 ? -1 : 1;
  if (card.value === 'draw2') {
    const n = next(s, id);
    if (n) {
      drawUno(s, n, 2, ctx);
      s.currentPlayerId = next(s, n!);
    }
  } else {
    const n = next(s, id);
    s.currentPlayerId = skip && n ? next(s, n) : n;
  }
  ctx.markStateChanged();
  return actionAccepted();
}
function makeSim(players: readonly GamePlayerView[]): SimState {
  const b = base(players, 'sim') as SimState;
  b.edges = {};
  for (let a = 0; a < 6; a++) for (let c = a + 1; c < 6; c++) b.edges[`${a}-${c}`] = null;
  b.currentColor = 'red';
  b.moves = 0;
  b.losingTriangle = null;
  return b;
}
function triangles(color: string, s: SimState) {
  const out: number[][] = [];
  for (let a = 0; a < 6; a++)
    for (let b = a + 1; b < 6; b++)
      for (let c = b + 1; c < 6; c++) {
        if ([`${a}-${b}`, `${a}-${c}`, `${b}-${c}`].every((k) => s.edges[k] === color))
          out.push([a, b, c]);
      }
  return out;
}
function simValidate(id: string, a: GameAction, s: SimState): ValidationResult {
  const e = String(a.payload?.edge ?? '');
  return s.phase !== 'playing' || s.currentPlayerId !== id
    ? { valid: false, reason: 'Not your turn.' }
    : a.type !== 'edge' || !(e in s.edges) || s.edges[e] !== null
      ? { valid: false, reason: 'Choose an empty edge.' }
      : { valid: true };
}
function simHandle(id: string, a: GameAction, s: SimState, ctx: GameContext): ActionResult {
  const e = String(a.payload?.edge);
  s.edges[e] = s.currentColor;
  s.moves++;
  s.players[id]!.moves++;
  const t = triangles(s.currentColor, s)[0];
  if (t) {
    s.losingTriangle = t;
    finish(s, ctx, 'completed', ids(s).find((x) => x !== id) ?? null);
  } else if (Object.values(s.edges).every(Boolean)) finish(s, ctx, 'draw');
  else {
    s.currentPlayerId = ids(s)[(ids(s).indexOf(id) + 1) % ids(s).length]!;
    s.currentColor = s.currentColor === 'red' ? 'blue' : 'red';
  }
  s.lastEvent = `edge:${e}`;
  ctx.markStateChanged();
  return actionAccepted();
}
function makeDominoes(players: readonly GamePlayerView[], seed = 1): DominoState {
  const s = base(players, 'dominoes') as DominoState;
  const tiles: DominoTile[] = [];
  let n = 0;
  for (let a = 0; a <= 6; a++)
    for (let b = a; b <= 6; b++) tiles.push({ id: `d${n++}`, a, b, owner: null, played: false });
  let random = seed >>> 0 || 1;
  for (let i = tiles.length - 1; i > 0; i--) {
    random = (random * 1664525 + 1013904223) >>> 0;
    const j = random % (i + 1);
    [tiles[i], tiles[j]] = [tiles[j]!, tiles[i]!];
  }
  s.hands = Object.fromEntries(players.map((p) => [p.id, []]));
  const count = players.length === 2 ? 7 : 5;
  for (const p of players)
    for (let i = 0; i < count; i++) {
      const t = tiles.pop()!;
      t.owner = p.id;
      s.hands[p.id]!.push(t);
    }
  s.boneyard = tiles;
  s.chain = [];
  s.leftEnd = null;
  s.rightEnd = null;
  s.moves = 0;
  s.scores = Object.fromEntries(players.map((p) => [p.id, 0]));
  return s;
}
function fits(t: DominoTile, s: DominoState, side: string) {
  if (!s.chain.length) return true;
  return side === 'left'
    ? t.a === s.leftEnd || t.b === s.leftEnd
    : t.a === s.rightEnd || t.b === s.rightEnd;
}
function domValidate(id: string, a: GameAction, s: DominoState): ValidationResult {
  if (s.phase !== 'playing' || s.currentPlayerId !== id)
    return { valid: false, reason: 'Not your turn.' };
  if (a.type === 'draw') {
    if (s.hands[id]?.some((tile) => fits(tile, s, 'left') || fits(tile, s, 'right')))
      return { valid: false, reason: 'Play a legal tile before drawing.' };
    return s.boneyard.length ? { valid: true } : { valid: false, reason: 'The boneyard is empty.' };
  }
  if (a.type !== 'play') return { valid: false, reason: 'Unknown action.' };
  const t = s.hands[id]?.find((x) => x.id === a.payload?.tileId),
    side = String(a.payload?.side);
  return t && ['left', 'right'].includes(side) && fits(t, s, side)
    ? { valid: true }
    : { valid: false, reason: 'Tile cannot be placed there.' };
}
function domHandle(id: string, a: GameAction, s: DominoState, ctx: GameContext): ActionResult {
  if (a.type === 'draw') {
    while (s.boneyard.length) {
      const t = s.boneyard.pop()!;
      t.owner = id;
      s.hands[id]!.push(t);
      if (fits(t, s, 'left') || fits(t, s, 'right')) break;
    }
    s.currentPlayerId = next(s, id);
    s.lastEvent = 'draw';
    s.players[id]!.moves++;
    ctx.markStateChanged();
    return actionAccepted();
  }
  const i = s.hands[id]!.findIndex((t) => t.id === a.payload?.tileId),
    t = s.hands[id]!.splice(i, 1)[0]!,
    side = String(a.payload?.side);
  t.played = true;
  t.owner = id;
  if (!s.chain.length) {
    s.chain = [t];
    s.leftEnd = t.a;
    s.rightEnd = t.b;
  } else if (side === 'left') {
    if (t.b === s.leftEnd) {
      t.orientation = 'normal';
      s.leftEnd = t.a;
    } else {
      t.orientation = 'flipped';
      s.leftEnd = t.b;
    }
    s.chain.unshift(t);
  } else {
    if (t.a === s.rightEnd) {
      t.orientation = 'normal';
      s.rightEnd = t.b;
    } else {
      t.orientation = 'flipped';
      s.rightEnd = t.a;
    }
    s.chain.push(t);
  }
  s.moves++;
  s.players[id]!.moves++;
  s.lastEvent = `play:${t.id}`;
  if (!s.hands[id]!.length) {
    s.players[id]!.score = Object.values(s.hands)
      .flat()
      .reduce((n, x) => n + x.a + x.b, 0);
    finish(s, ctx, 'completed', id);
  } else {
    s.currentPlayerId = next(s, id);
    const active = s.currentPlayerId;
    if (
      active &&
      s.boneyard.length === 0 &&
      ids(s).every((pid) => !s.hands[pid]!.some((t) => fits(t, s, 'left') || fits(t, s, 'right')))
    ) {
      const ranks = ids(s)
        .map((pid) => [pid, s.hands[pid]!.reduce((n, x) => n + x.a + x.b, 0)] as const)
        .sort((a, b) => a[1] - b[1]);
      finish(
        s,
        ctx,
        ranks[0]![1] === ranks[1]![1] ? 'draw' : 'completed',
        ranks[0]![1] === ranks[1]![1] ? null : ranks[0]![0],
      );
    }
  }
  ctx.markStateChanged();
  return actionAccepted();
}
function publicDom(s: DominoState, viewer: string | undefined, ctx: GameContext) {
  return {
    ...s,
    hands: Object.fromEntries(
      Object.entries(s.hands).map(([id, h]) => [
        id,
        id === viewer ? h : h.map((t) => ({ id: t.id, hidden: true })),
      ]),
    ),
    handCounts: Object.fromEntries(Object.entries(s.hands).map(([id, h]) => [id, h.length])),
    serverTime: ctx.now(),
  };
}
function result(s: CardBoardState, ctx: GameContext): GameResultDraft {
  return {
    winners: s.winnerId ? [s.winnerId] : [],
    isDraw: s.reason === 'draw',
    rankings: ctx.players.map((p) => ({
      playerId: p.id,
      rank: p.id === s.winnerId ? 1 : 2,
      score: s.players[p.id]?.score ?? 0,
      isWinner: p.id === s.winnerId,
      isDraw: s.reason === 'draw',
      stats: { moves: s.players[p.id]?.moves ?? 0 },
    })),
    reason: s.reason ?? 'completed',
  };
}
export function createCardBoardGame(
  metadata: GameMetadata,
  kind: 'uno' | 'sim' | 'dominoes',
): GameModule<CardBoardState> {
  return {
    metadata,
    initialize() {},
    createInitialState(p, c) {
      return kind === 'uno'
        ? createUno(p, c.seed)
        : kind === 'sim'
          ? makeSim(p)
          : makeDominoes(p, c.seed);
    },
    playerJoined(p, s) {
      s.players[p.id] ??= { score: 0, moves: 0, left: false, disconnected: false };
    },
    playerReady() {},
    playerLeft(id, s, ctx, reason) {
      if (reason === 'disconnect') s.players[id]!.disconnected = true;
      else {
        s.players[id]!.left = true;
        if (s.phase === 'playing')
          finish(s, ctx, 'abandoned', ids(s).find((x) => x !== id) ?? null);
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
      return kind === 'uno'
        ? unoValidate(id, a, s as UnoState)
        : kind === 'sim'
          ? simValidate(id, a, s as SimState)
          : domValidate(id, a, s as DominoState);
    },
    handlePlayerAction(id, a, s, ctx) {
      return kind === 'uno'
        ? unoHandle(id, a, s as UnoState, ctx)
        : kind === 'sim'
          ? simHandle(id, a, s as SimState, ctx)
          : domHandle(id, a, s as DominoState, ctx);
    },
    update() {},
    tick() {},
    calculateScore(id, s) {
      return s.players[id]?.score ?? 0;
    },
    checkWinCondition: (s) => (s.winnerId ? [s.winnerId] : null),
    checkDrawCondition: (s) => s.reason === 'draw',
    isGameFinished: (s) => s.phase === 'finished',
    finish(s) {
      s.phase = 'finished';
    },
    getResult: result,
    reset(s) {
      return this.createInitialState(
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
        {
          playerCount: Object.keys(s.players).length,
          humanCount: Object.keys(s.players).length,
          aiOpponents: 0,
          aiDifficulty: 'easy',
          seed: 1,
        },
      );
    },
    cleanup() {},
    getPublicState(s, v, ctx) {
      return kind === 'uno'
        ? unoPublic(s as UnoState, v, ctx)
        : kind === 'dominoes'
          ? publicDom(s as DominoState, v, ctx)
          : { ...s, serverTime: ctx.now() };
    },
    getAIMove(id, _d, s, _ctx) {
      if (s.currentPlayerId !== id) return null;
      if (kind === 'uno') {
        const u = s as UnoState;
        const c = u.hands[id]!.find((c) => playable(c, u.discard.at(-1)!, u.currentColor));
        return c
          ? {
              type: 'play',
              payload: { cardId: c.id, color: c.color === 'wild' ? COLORS[0] : undefined },
            }
          : { type: 'draw' };
      }
      if (kind === 'sim') {
        const e = Object.entries((s as SimState).edges).find(([, v]) => v === null)?.[0];
        return e ? { type: 'edge', payload: { edge: e } } : null;
      }
      const d = s as DominoState;
      const t = d.hands[id]!.find((t) => fits(t, d, 'left') || fits(t, d, 'right'));
      return t
        ? { type: 'play', payload: { tileId: t.id, side: fits(t, d, 'left') ? 'left' : 'right' } }
        : { type: 'draw' };
    },
    maxDurationMs: DURATION,
  };
}
