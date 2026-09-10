import type { AIDifficulty, GameAction, GameConfig, GameFinishReason } from '@2play/shared';
import { SIM_METADATA } from '@2play/shared';
export { SIM_METADATA };
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
 * SIM — the classic Ramsey-theory pencil game on K6.
 *
 * Six nodes, every pair connectable: 15 edges in total. Players alternate
 * claiming an edge in their own colour.
 *
 * THE CRITICAL RULE — this is a MISÈRE game:
 *   A player LOSES the moment three of THEIR OWN edges form a triangle.
 *   You are not trying to build triangles, you are trying to avoid them.
 *
 * By Ramsey's theorem R(3,3) = 6, a two-colouring of K6 always contains a
 * monochromatic triangle, so a completely filled board is impossible without
 * someone having already lost. A draw is therefore unreachable in practice —
 * the code still handles a full board defensively and reports a draw.
 */

export type SimPhase = 'idle' | 'playing' | 'finished';

export const SIM_NODES = 6;

/** An edge between two node indices, `a < b`. */
export interface SimEdge {
  id: string;
  a: number;
  b: number;
  /** Player id that claimed it, or null while free. */
  owner: string | null;
}

export interface SimPlayerSlot {
  seat: number;
  edges: number;
  disconnected: boolean;
  left: boolean;
}

export interface SimState {
  phase: SimPhase;
  nodes: number;
  edges: SimEdge[];
  players: Record<string, SimPlayerSlot>;
  turnOrder: string[];
  currentPlayerId: string | null;
  moves: number;
  lastMove: { edgeId: string; playerId: string } | null;
  /** The three edge ids that ended the game, for the highlight. */
  losingTriangle: string[];
  loserId: string | null;
  winnerId: string | null;
  isDraw: boolean;
  turnEndsAt: number | null;
  turnMs: number;
  finishReason: GameFinishReason | null;
  lastEvent: string | null;
}

export const TURN_MS = 30_000;
export const WIN_SCORE = 100;
export const DRAW_SCORE = 50;

const AI_DELAY: Record<AIDifficulty, number> = { easy: 900, medium: 700, hard: 500 };

/* ------------------------------------------------------------------ */
/* Board                                                               */
/* ------------------------------------------------------------------ */

/** All 15 edges of the complete graph K6, in a stable order. */
export function buildEdges(): SimEdge[] {
  const edges: SimEdge[] = [];
  for (let a = 0; a < SIM_NODES; a += 1) {
    for (let b = a + 1; b < SIM_NODES; b += 1) {
      edges.push({ id: `e${a}${b}`, a, b, owner: null });
    }
  }
  return edges;
}

export function edgeKey(a: number, b: number): string {
  return a < b ? `e${a}${b}` : `e${b}${a}`;
}

export function findEdge(state: SimState, edgeId: string): SimEdge | undefined {
  return state.edges.find((edge) => edge.id === edgeId);
}

export function freeEdges(state: SimState): SimEdge[] {
  return state.edges.filter((edge) => edge.owner === null);
}

export function edgesOf(state: SimState, playerId: string): SimEdge[] {
  return state.edges.filter((edge) => edge.owner === playerId);
}

/**
 * Returns the three edge ids of a monochromatic triangle owned by `playerId`,
 * or null. Checks every unordered node triple — there are only 20.
 */
export function findTriangle(state: SimState, playerId: string): string[] | null {
  const owned = new Set(edgesOf(state, playerId).map((edge) => edge.id));
  for (let a = 0; a < SIM_NODES; a += 1) {
    for (let b = a + 1; b < SIM_NODES; b += 1) {
      if (!owned.has(edgeKey(a, b))) continue;
      for (let c = b + 1; c < SIM_NODES; c += 1) {
        if (owned.has(edgeKey(b, c)) && owned.has(edgeKey(a, c))) {
          return [edgeKey(a, b), edgeKey(b, c), edgeKey(a, c)];
        }
      }
    }
  }
  return null;
}

/**
 * Would claiming `edgeId` complete a triangle for `playerId`?
 * Used by the AI (and only ever with information a human also has).
 */
export function wouldFormTriangle(state: SimState, playerId: string, edgeId: string): boolean {
  const edge = findEdge(state, edgeId);
  if (!edge || edge.owner !== null) return false;
  const owned = new Set(edgesOf(state, playerId).map((entry) => entry.id));
  for (let c = 0; c < SIM_NODES; c += 1) {
    if (c === edge.a || c === edge.b) continue;
    if (owned.has(edgeKey(edge.a, c)) && owned.has(edgeKey(edge.b, c))) return true;
  }
  return false;
}

function activePlayers(state: SimState): Array<[string, SimPlayerSlot]> {
  return Object.entries(state.players).filter(([, slot]) => !slot.left);
}

export function finishSim(state: SimState, ctx: GameContext, reason: GameFinishReason): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.finishReason = reason;
  state.currentPlayerId = null;
  state.turnEndsAt = null;
  ctx.markStateChanged();
  ctx.finish(reason);
}

export function beginTurn(state: SimState, ctx: GameContext, playerId: string): void {
  if (state.phase !== 'playing') return;
  state.currentPlayerId = playerId;
  state.turnEndsAt = ctx.now() + state.turnMs;
  ctx.markStateChanged();

  ctx.schedule(
    state.turnMs,
    () => {
      if (state.phase !== 'playing' || state.currentPlayerId !== playerId) return;
      // Timeout claims a random SAFE edge if one exists, so the game never
      // stalls and a missed turn does not auto-lose.
      const options = freeEdges(state);
      if (options.length === 0) {
        concludeDraw(state, ctx);
        return;
      }
      const safe = options.filter((edge) => !wouldFormTriangle(state, playerId, edge.id));
      const pool = safe.length > 0 ? safe : options;
      const pick = pool[Math.floor(ctx.random() * pool.length)] as SimEdge;
      state.lastEvent = `timeout:${playerId}`;
      applyClaim(state, ctx, playerId, pick.id);
    },
    'turn',
    'turn-timeout',
  );

  const view = ctx.players.find((entry) => entry.id === playerId);
  if (view?.isAI) ctx.requestAI(playerId, AI_DELAY[view.aiDifficulty ?? 'medium']);
}

export function advanceTurn(state: SimState, ctx: GameContext): void {
  if (state.phase !== 'playing') return;
  const seats = state.turnOrder.filter((id) => {
    const slot = state.players[id];
    return Boolean(slot) && !slot!.left && ctx.players.some((entry) => entry.id === id);
  });
  if (seats.length === 0) {
    finishSim(state, ctx, 'abandoned');
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
  finishSim(state, ctx, 'abandoned');
}

function concludeDraw(state: SimState, ctx: GameContext): void {
  // Unreachable for K6 by Ramsey's theorem, but handled defensively.
  state.isDraw = true;
  state.winnerId = null;
  state.loserId = null;
  state.lastEvent = 'draw';
  finishSim(state, ctx, 'draw');
}

/**
 * Applies a validated claim: colours the edge, then checks whether the mover
 * just built their own triangle (and therefore lost).
 */
export function applyClaim(state: SimState, ctx: GameContext, playerId: string, edgeId: string): boolean {
  const edge = findEdge(state, edgeId);
  const slot = state.players[playerId];
  if (!edge || !slot || edge.owner !== null) return false;

  edge.owner = playerId;
  slot.edges += 1;
  state.moves += 1;
  state.lastMove = { edgeId, playerId };
  state.lastEvent = `claim:${playerId}:${edgeId}`;

  // MISÈRE: building your own triangle loses the game.
  const triangle = findTriangle(state, playerId);
  if (triangle) {
    state.losingTriangle = triangle;
    state.loserId = playerId;
    const opponent = activePlayers(state).find(([id]) => id !== playerId);
    state.winnerId = opponent?.[0] ?? null;
    state.isDraw = false;
    state.lastEvent = `triangle:${playerId}`;
    finishSim(state, ctx, 'completed');
    return true;
  }

  if (freeEdges(state).length === 0) {
    concludeDraw(state, ctx);
    return true;
  }

  ctx.markStateChanged();
  advanceTurn(state, ctx);
  return true;
}

function makeSlot(seat: number): SimPlayerSlot {
  return { seat, edges: 0, disconnected: false, left: false };
}

/* ------------------------------------------------------------------ */
/* Module                                                              */
/* ------------------------------------------------------------------ */

export const simGame: GameModule<SimState> = {
  metadata: SIM_METADATA,

  initialize(): void {
    // Stateless module.
  },

  createInitialState(players: readonly GamePlayerView[], _config: GameConfig): SimState {
    const state: SimState = {
      phase: 'idle',
      nodes: SIM_NODES,
      edges: buildEdges(),
      players: {},
      turnOrder: players.map((player) => player.id),
      currentPlayerId: null,
      moves: 0,
      lastMove: null,
      losingTriangle: [],
      loserId: null,
      winnerId: null,
      isDraw: false,
      turnEndsAt: null,
      turnMs: TURN_MS,
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
      const other = activePlayers(state).find(([id]) => id !== playerId);
      state.winnerId = other?.[0] ?? null;
      state.loserId = playerId;
      finishSim(state, ctx, 'forfeit');
    }
  },

  start(state, ctx): void {
    if (state.phase === 'playing') return;
    state.players = {};
    state.turnOrder = ctx.players.map((player) => player.id);
    ctx.players.forEach((player, index) => {
      state.players[player.id] = makeSlot(typeof player.seatIndex === 'number' ? player.seatIndex : index);
    });
    state.edges = buildEdges();
    state.moves = 0;
    state.lastMove = null;
    state.losingTriangle = [];
    state.loserId = null;
    state.winnerId = null;
    state.isDraw = false;
    state.finishReason = null;
    state.phase = 'playing';
    state.lastEvent = 'start';

    const first = state.turnOrder[0];
    if (!first) {
      finishSim(state, ctx, 'abandoned');
      return;
    }
    beginTurn(state, ctx, first);
  },

  validateAction(playerId, action, state): ValidationResult {
    if (['score', 'win', 'finish', 'complete', 'board', 'triangle'].includes(action.type)) {
      return { valid: false, reason: 'The server owns the board.' };
    }
    if (state.phase !== 'playing') return { valid: false, reason: 'The game is not live.' };
    if (action.type !== 'claim') return { valid: false, reason: 'Unknown action.' };

    const slot = state.players[playerId];
    if (!slot || slot.left) return { valid: false, reason: 'You are not in this game.' };
    if (slot.disconnected) return { valid: false, reason: 'Reconnect to keep playing.' };
    if (state.currentPlayerId !== playerId) return { valid: false, reason: 'It is not your turn.' };

    const edgeId = action.payload?.edgeId;
    if (typeof edgeId !== 'string') return { valid: false, reason: 'Pick an edge.' };
    const edge = findEdge(state, edgeId);
    if (!edge) return { valid: false, reason: 'That edge does not exist.' };
    if (edge.owner !== null) return { valid: false, reason: 'That edge is already taken.' };
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    if (state.phase !== 'playing') return actionRejected('The game is not live.');
    if (action.type !== 'claim') return actionRejected('Unknown action.');
    const slot = state.players[playerId];
    if (!slot || slot.left || slot.disconnected) return actionRejected('You cannot play.');
    if (state.currentPlayerId !== playerId) return actionRejected('It is not your turn.');

    const edgeId = action.payload?.edgeId;
    if (typeof edgeId !== 'string') return actionRejected('Pick an edge.');
    const edge = findEdge(state, edgeId);
    if (!edge) return actionRejected('That edge does not exist.');
    if (edge.owner !== null) return actionRejected('That edge is already taken.');

    applyClaim(state, ctx, playerId, edgeId);
    return actionAccepted();
  },

  update(): void {
    // Turn based.
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
        score: simGame.calculateScore(player.id, state),
        isWinner: player.id === state.winnerId,
        isDraw,
        stats: {
          edges: slot?.edges ?? 0,
          moves: state.moves,
          // 1 when this player is the one who built the losing triangle.
          trianglesCaused: state.loserId === player.id ? 1 : 0,
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

  reset(state): SimState {
    const ids = Object.keys(state.players);
    return {
      ...state,
      phase: 'idle',
      edges: buildEdges(),
      // Swap who moves first on the rematch.
      players: Object.fromEntries(ids.map((id, index) => [id, makeSlot(index)])),
      turnOrder: [...ids].reverse(),
      currentPlayerId: null,
      moves: 0,
      lastMove: null,
      losingTriangle: [],
      loserId: null,
      winnerId: null,
      isDraw: false,
      turnEndsAt: null,
      finishReason: null,
      lastEvent: null,
    };
  },

  cleanup(state): void {
    state.players = {};
    state.edges = [];
    state.turnOrder = [];
    state.phase = 'finished';
  },

  /** Sim is perfect information: the whole graph is public. */
  getPublicState(state, viewerId, ctx) {
    const slot = viewerId ? state.players[viewerId] : undefined;
    return {
      phase: state.phase,
      nodes: state.nodes,
      edges: state.edges.map((edge) => ({ id: edge.id, a: edge.a, b: edge.b, owner: edge.owner })),
      currentPlayerId: state.currentPlayerId,
      isMyTurn: Boolean(viewerId) && state.currentPlayerId === viewerId,
      mySeat: slot?.seat ?? null,
      moves: state.moves,
      lastMove: state.lastMove ? { ...state.lastMove } : null,
      losingTriangle: [...state.losingTriangle],
      loserId: state.loserId,
      winnerId: state.winnerId,
      isDraw: state.isDraw,
      turnEndsAt: state.turnEndsAt,
      finishReason: state.finishReason,
      lastEvent: state.lastEvent,
      serverTime: ctx.now(),
      players: Object.fromEntries(
        Object.entries(state.players).map(([id, entry]) => [
          id,
          { seat: entry.seat, edges: entry.edges, disconnected: entry.disconnected },
        ]),
      ),
    };
  },

  /**
   * AI opponent.
   *  - Always avoids completing its own triangle when a safe edge exists.
   *  - Hard additionally prefers edges that leave the OPPONENT with the fewest
   *    safe replies, which is real strategy rather than random play.
   */
  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'playing' || state.currentPlayerId !== playerId) return null;
    const options = freeEdges(state);
    if (options.length === 0) return null;

    const safe = options.filter((edge) => !wouldFormTriangle(state, playerId, edge.id));
    // Every remaining edge loses: pick any, the game is decided.
    if (safe.length === 0) {
      const forced = options[Math.floor(ctx.random() * options.length)] as SimEdge;
      return { type: 'claim', payload: { edgeId: forced.id } };
    }

    if (difficulty === 'easy') {
      // Easy still avoids the immediate loss, but otherwise plays at random.
      const pick = safe[Math.floor(ctx.random() * safe.length)] as SimEdge;
      return { type: 'claim', payload: { edgeId: pick.id } };
    }

    const opponentId = Object.keys(state.players).find((id) => id !== playerId);
    if (!opponentId || difficulty === 'medium') {
      const pick = safe[Math.floor(ctx.random() * safe.length)] as SimEdge;
      return { type: 'claim', payload: { edgeId: pick.id } };
    }

    // Hard: minimise the opponent's safe replies after our move.
    let best = safe[0] as SimEdge;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const edge of safe) {
      edge.owner = playerId; // try it
      const remaining = freeEdges(state);
      const opponentSafe = remaining.filter(
        (candidate) => !wouldFormTriangle(state, opponentId, candidate.id),
      ).length;
      edge.owner = null; // undo
      if (opponentSafe < bestScore) {
        bestScore = opponentSafe;
        best = edge;
      }
    }
    return { type: 'claim', payload: { edgeId: best.id } };
  },

  maxDurationMs: 20 * 60 * 1000,
};
