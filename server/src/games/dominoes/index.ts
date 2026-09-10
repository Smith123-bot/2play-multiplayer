import type { AIDifficulty, GameAction, GameConfig, GameFinishReason } from '@2play/shared';
import { DOMINOES_METADATA } from '@2play/shared';
export { DOMINOES_METADATA };
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
 * DOMINOES — standard double-six draw dominoes.
 *
 * THE RULESET (one consistent set, documented in How To Play):
 *  - 28 unique tiles, 0|0 through 6|6.
 *  - Starting hands: 7 tiles for 2 players, 5 tiles for 3-4 players.
 *    Everything left over forms the boneyard.
 *  - The player holding the highest double opens with it. If nobody holds a
 *    double, the player with the heaviest tile opens.
 *  - On your turn, place a tile whose value matches an open end of the chain.
 *    The server rotates the tile automatically to fit.
 *  - No playable tile? Draw from the boneyard until you can play, or until the
 *    boneyard is empty — then your turn passes.
 *  - A hand ends when someone plays their last tile ("domino"), or when the
 *    game is BLOCKED (nobody can move and the boneyard is empty).
 *  - Scoring: the winner scores the total pip count left in every opponent's
 *    hand. When blocked, the lowest pip total wins and scores the difference;
 *    an exact tie is a draw worth no points.
 */

export type DominoPhase = 'idle' | 'playing' | 'finished';
export type ChainEnd = 'left' | 'right';

export interface DominoTile {
  /** Server-assigned unique id. Clients may only reference these. */
  id: string;
  /** The two halves, as dealt. Orientation on the board is separate. */
  a: number;
  b: number;
}

/** A tile as laid on the chain, already oriented left-to-right. */
export interface PlacedTile {
  id: string;
  left: number;
  right: number;
  playedBy: string;
  /** True when the tile was flipped from its canonical a|b order. */
  flipped: boolean;
}

export interface DominoPlayerSlot {
  hand: DominoTile[];
  score: number;
  tilesPlayed: number;
  handsWon: number;
  passes: number;
  disconnected: boolean;
  left: boolean;
}

export interface DominoState {
  phase: DominoPhase;
  /** SERVER ONLY — face-down boneyard, never projected. */
  boneyard: DominoTile[];
  /** The played chain, left end first. */
  chain: PlacedTile[];
  players: Record<string, DominoPlayerSlot>;
  turnOrder: string[];
  currentPlayerId: string | null;
  /** Consecutive passes; equal to the seat count means the game is blocked. */
  consecutivePasses: number;
  moves: number;
  lastMove: { tileId: string; playerId: string; end: ChainEnd } | null;
  winnerId: string | null;
  isDraw: boolean;
  blocked: boolean;
  turnEndsAt: number | null;
  turnMs: number;
  finishReason: GameFinishReason | null;
  lastEvent: string | null;
}

export const MAX_PIP = 6;
export const TURN_MS = 30_000;

const AI_DELAY: Record<AIDifficulty, number> = { easy: 1_000, medium: 750, hard: 500 };

/* ------------------------------------------------------------------ */
/* Tile set                                                            */
/* ------------------------------------------------------------------ */

/** The complete double-six set: 28 unique tiles. */
export function buildTileSet(): DominoTile[] {
  const tiles: DominoTile[] = [];
  for (let a = 0; a <= MAX_PIP; a += 1) {
    for (let b = a; b <= MAX_PIP; b += 1) {
      tiles.push({ id: `t${a}${b}`, a, b });
    }
  }
  return tiles;
}

export function shuffle<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return out;
}

export function pipsOf(tile: DominoTile): number {
  return tile.a + tile.b;
}

export function handPips(hand: DominoTile[]): number {
  return hand.reduce((total, tile) => total + pipsOf(tile), 0);
}

export function isDouble(tile: DominoTile): boolean {
  return tile.a === tile.b;
}

/** Starting hand size: 7 for two players, 5 for three or four. */
export function handSizeFor(playerCount: number): number {
  return playerCount <= 2 ? 7 : 5;
}

/* ------------------------------------------------------------------ */
/* Chain                                                               */
/* ------------------------------------------------------------------ */

/** The two open values, or null while the chain is empty. */
export function openEnds(state: DominoState): { left: number; right: number } | null {
  if (state.chain.length === 0) return null;
  const first = state.chain[0] as PlacedTile;
  const last = state.chain[state.chain.length - 1] as PlacedTile;
  return { left: first.left, right: last.right };
}

/** Can this tile legally go on the given end? */
export function canPlace(state: DominoState, tile: DominoTile, end: ChainEnd): boolean {
  const ends = openEnds(state);
  if (!ends) return true; // an empty chain accepts anything
  const target = end === 'left' ? ends.left : ends.right;
  return tile.a === target || tile.b === target;
}

export function hasPlayableTile(state: DominoState, playerId: string): boolean {
  const slot = state.players[playerId];
  if (!slot) return false;
  return slot.hand.some((tile) => canPlace(state, tile, 'left') || canPlace(state, tile, 'right'));
}

/**
 * Orients a tile for the requested end so the matching half touches the chain.
 * Returns null when the tile does not actually fit — the server never guesses.
 */
export function orientFor(
  state: DominoState,
  tile: DominoTile,
  end: ChainEnd,
): { left: number; right: number; flipped: boolean } | null {
  const ends = openEnds(state);
  if (!ends) return { left: tile.a, right: tile.b, flipped: false };

  if (end === 'left') {
    // The tile's RIGHT half must match the chain's left value.
    if (tile.b === ends.left) return { left: tile.a, right: tile.b, flipped: false };
    if (tile.a === ends.left) return { left: tile.b, right: tile.a, flipped: true };
    return null;
  }
  // The tile's LEFT half must match the chain's right value.
  if (tile.a === ends.right) return { left: tile.a, right: tile.b, flipped: false };
  if (tile.b === ends.right) return { left: tile.b, right: tile.a, flipped: true };
  return null;
}

function activePlayers(state: DominoState): Array<[string, DominoPlayerSlot]> {
  return Object.entries(state.players).filter(([, slot]) => !slot.left);
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

export function finishDominoes(state: DominoState, ctx: GameContext, reason: GameFinishReason): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.finishReason = reason;
  state.currentPlayerId = null;
  state.turnEndsAt = null;
  ctx.markStateChanged();
  ctx.finish(reason);
}

/** A player emptied their hand: they score every opponent's remaining pips. */
function concludeDomino(state: DominoState, ctx: GameContext, winnerId: string): void {
  const winner = state.players[winnerId];
  if (!winner) return;
  let gained = 0;
  for (const [id, slot] of activePlayers(state)) {
    if (id === winnerId) continue;
    gained += handPips(slot.hand);
  }
  winner.score += gained;
  winner.handsWon += 1;
  state.winnerId = winnerId;
  state.isDraw = false;
  state.lastEvent = `domino:${winnerId}:${gained}`;
  finishDominoes(state, ctx, 'completed');
}

/** Nobody can move: the lowest pip total wins the blocked hand. */
function concludeBlocked(state: DominoState, ctx: GameContext): void {
  state.blocked = true;
  const entries = activePlayers(state);
  if (entries.length === 0) {
    finishDominoes(state, ctx, 'abandoned');
    return;
  }
  const totals = entries.map(([id, slot]) => ({ id, pips: handPips(slot.hand) }));
  const lowest = Math.min(...totals.map((entry) => entry.pips));
  const leaders = totals.filter((entry) => entry.pips === lowest);

  if (leaders.length === 1) {
    const winnerId = leaders[0]!.id;
    const winner = state.players[winnerId];
    // The winner scores the difference between the others' pips and their own.
    const gained = totals
      .filter((entry) => entry.id !== winnerId)
      .reduce((total, entry) => total + (entry.pips - lowest), 0);
    if (winner) {
      winner.score += gained;
      winner.handsWon += 1;
    }
    state.winnerId = winnerId;
    state.isDraw = false;
    state.lastEvent = `blocked-win:${winnerId}:${gained}`;
    finishDominoes(state, ctx, 'completed');
    return;
  }

  // An exact tie on the lowest total is a draw worth no points.
  state.winnerId = null;
  state.isDraw = true;
  state.lastEvent = 'blocked-draw';
  finishDominoes(state, ctx, 'draw');
}

export function beginTurn(state: DominoState, ctx: GameContext, playerId: string): void {
  if (state.phase !== 'playing') return;
  state.currentPlayerId = playerId;
  state.turnEndsAt = ctx.now() + state.turnMs;
  ctx.markStateChanged();

  ctx.schedule(
    state.turnMs,
    () => {
      if (state.phase !== 'playing' || state.currentPlayerId !== playerId) return;
      // Timeout: draw what is needed and play if possible, otherwise pass.
      autoPlay(state, ctx, playerId);
    },
    'turn',
    'turn-timeout',
  );

  const view = ctx.players.find((entry) => entry.id === playerId);
  if (view?.isAI) ctx.requestAI(playerId, AI_DELAY[view.aiDifficulty ?? 'medium']);
}

/** Plays a legal tile for a player who ran out of time, or passes them. */
function autoPlay(state: DominoState, ctx: GameContext, playerId: string): void {
  drawUntilPlayable(state, playerId);
  const slot = state.players[playerId];
  if (!slot) return;
  for (const tile of slot.hand) {
    for (const end of ['right', 'left'] as ChainEnd[]) {
      if (canPlace(state, tile, end)) {
        state.lastEvent = `timeout:${playerId}`;
        applyPlacement(state, ctx, playerId, tile.id, end);
        return;
      }
    }
  }
  state.lastEvent = `timeout-pass:${playerId}`;
  passTurn(state, ctx, playerId);
}

export function advanceTurn(state: DominoState, ctx: GameContext): void {
  if (state.phase !== 'playing') return;
  const seats = state.turnOrder.filter((id) => {
    const slot = state.players[id];
    return Boolean(slot) && !slot!.left && ctx.players.some((entry) => entry.id === id);
  });
  if (seats.length === 0) {
    finishDominoes(state, ctx, 'abandoned');
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
  finishDominoes(state, ctx, 'abandoned');
}

/** Draws until the player has a playable tile or the boneyard is empty. */
export function drawUntilPlayable(state: DominoState, playerId: string): DominoTile[] {
  const slot = state.players[playerId];
  if (!slot) return [];
  const drawn: DominoTile[] = [];
  while (!hasPlayableTile(state, playerId) && state.boneyard.length > 0) {
    const tile = state.boneyard.pop();
    if (!tile) break;
    slot.hand.push(tile);
    drawn.push(tile);
  }
  return drawn;
}

/** Records a pass and ends the hand when everyone has passed in a row. */
export function passTurn(state: DominoState, ctx: GameContext, playerId: string): void {
  const slot = state.players[playerId];
  if (slot) slot.passes += 1;
  state.consecutivePasses += 1;
  ctx.markStateChanged();

  if (state.consecutivePasses >= activePlayers(state).length) {
    concludeBlocked(state, ctx);
    return;
  }
  advanceTurn(state, ctx);
}

/** Applies a validated placement to the chain. */
export function applyPlacement(
  state: DominoState,
  ctx: GameContext,
  playerId: string,
  tileId: string,
  end: ChainEnd,
): boolean {
  const slot = state.players[playerId];
  if (!slot) return false;
  const index = slot.hand.findIndex((tile) => tile.id === tileId);
  if (index < 0) return false;
  const tile = slot.hand[index] as DominoTile;

  const oriented = orientFor(state, tile, end);
  if (!oriented) return false;

  slot.hand.splice(index, 1);
  slot.tilesPlayed += 1;
  const placed: PlacedTile = {
    id: tile.id,
    left: oriented.left,
    right: oriented.right,
    playedBy: playerId,
    flipped: oriented.flipped,
  };
  if (state.chain.length === 0 || end === 'right') state.chain.push(placed);
  else state.chain.unshift(placed);

  state.moves += 1;
  state.consecutivePasses = 0;
  state.lastMove = { tileId, playerId, end };
  state.lastEvent = `place:${playerId}:${tileId}`;
  ctx.markStateChanged();

  if (slot.hand.length === 0) {
    concludeDomino(state, ctx, playerId);
    return true;
  }
  advanceTurn(state, ctx);
  return true;
}

function makeSlot(): DominoPlayerSlot {
  return {
    hand: [],
    score: 0,
    tilesPlayed: 0,
    handsWon: 0,
    passes: 0,
    disconnected: false,
    left: false,
  };
}

/**
 * Deals a fresh hand and decides who opens: the highest double, or failing
 * that the heaviest tile.
 */
export function dealHand(state: DominoState, ctx: GameContext): void {
  const seats = state.turnOrder.filter((id) => !state.players[id]?.left);
  const deck = shuffle(buildTileSet(), ctx.random);
  const size = handSizeFor(seats.length);

  for (const id of seats) {
    const slot = state.players[id];
    if (slot) slot.hand = [];
  }
  for (let i = 0; i < size; i += 1) {
    for (const id of seats) {
      const tile = deck.pop();
      if (tile) state.players[id]?.hand.push(tile);
    }
  }
  state.boneyard = deck;
  state.chain = [];
  state.moves = 0;
  state.consecutivePasses = 0;
  state.lastMove = null;
  state.blocked = false;
  state.winnerId = null;
  state.isDraw = false;
  state.phase = 'playing';
  state.lastEvent = 'deal';

  // Opener: highest double, else heaviest tile.
  let openerId = seats[0] ?? null;
  let bestDouble = -1;
  let bestPips = -1;
  for (const id of seats) {
    for (const tile of state.players[id]?.hand ?? []) {
      if (isDouble(tile) && tile.a > bestDouble) {
        bestDouble = tile.a;
        openerId = id;
      }
    }
  }
  if (bestDouble < 0) {
    for (const id of seats) {
      for (const tile of state.players[id]?.hand ?? []) {
        if (pipsOf(tile) > bestPips) {
          bestPips = pipsOf(tile);
          openerId = id;
        }
      }
    }
  }

  ctx.markStateChanged();
  if (!openerId) {
    finishDominoes(state, ctx, 'abandoned');
    return;
  }
  beginTurn(state, ctx, openerId);
}

/* ------------------------------------------------------------------ */
/* Module                                                              */
/* ------------------------------------------------------------------ */

export const dominoesGame: GameModule<DominoState> = {
  metadata: DOMINOES_METADATA,

  initialize(): void {
    // Stateless module.
  },

  createInitialState(players: readonly GamePlayerView[], _config: GameConfig): DominoState {
    const state: DominoState = {
      phase: 'idle',
      boneyard: [],
      chain: [],
      players: {},
      turnOrder: players.map((player) => player.id),
      currentPlayerId: null,
      consecutivePasses: 0,
      moves: 0,
      lastMove: null,
      winnerId: null,
      isDraw: false,
      blocked: false,
      turnEndsAt: null,
      turnMs: TURN_MS,
      finishReason: null,
      lastEvent: null,
    };
    for (const player of players) state.players[player.id] = makeSlot();
    return state;
  },

  playerJoined(player, state): void {
    const existing = state.players[player.id];
    if (existing) {
      // Reconnection keeps the same hand and score.
      existing.disconnected = false;
      return;
    }
    state.players[player.id] = makeSlot();
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
      if (state.currentPlayerId === playerId && state.phase === 'playing') advanceTurn(state, ctx);
      return;
    }
    slot.left = true;
    if (activePlayers(state).length < 2) {
      const remaining = activePlayers(state)[0];
      state.winnerId = remaining?.[0] ?? null;
      finishDominoes(state, ctx, 'abandoned');
      return;
    }
    if (state.currentPlayerId === playerId && state.phase === 'playing') advanceTurn(state, ctx);
  },

  start(state, ctx): void {
    if (state.phase === 'playing') return;
    state.players = {};
    state.turnOrder = ctx.players.map((player) => player.id);
    for (const player of ctx.players) state.players[player.id] = makeSlot();
    state.finishReason = null;
    dealHand(state, ctx);
  },

  validateAction(playerId, action, state): ValidationResult {
    if (['score', 'win', 'finish', 'complete', 'boneyard', 'setHand', 'draw-tile'].includes(action.type)) {
      return { valid: false, reason: 'The server owns the tiles and the score.' };
    }
    if (state.phase !== 'playing') return { valid: false, reason: 'No hand is live.' };

    const slot = state.players[playerId];
    if (!slot || slot.left) return { valid: false, reason: 'You are not in this game.' };
    if (slot.disconnected) return { valid: false, reason: 'Reconnect to keep playing.' };
    if (state.currentPlayerId !== playerId) return { valid: false, reason: 'It is not your turn.' };

    if (action.type === 'draw') {
      if (hasPlayableTile(state, playerId)) return { valid: false, reason: 'You already have a legal tile.' };
      if (state.boneyard.length === 0) return { valid: false, reason: 'The boneyard is empty.' };
      return { valid: true };
    }
    if (action.type === 'pass') {
      // Passing is only legal with no playable tile and an empty boneyard.
      if (hasPlayableTile(state, playerId)) return { valid: false, reason: 'You have a legal tile to play.' };
      if (state.boneyard.length > 0) return { valid: false, reason: 'Draw from the boneyard first.' };
      return { valid: true };
    }
    if (action.type !== 'place') return { valid: false, reason: 'Unknown action.' };

    const tileId = action.payload?.tileId;
    const end = action.payload?.end;
    if (typeof tileId !== 'string') return { valid: false, reason: 'Pick a tile.' };
    if (end !== 'left' && end !== 'right') return { valid: false, reason: 'Pick an end of the chain.' };
    // Ownership: the tile must be in THIS player's hand.
    const tile = slot.hand.find((entry) => entry.id === tileId);
    if (!tile) return { valid: false, reason: 'That tile is not in your hand.' };
    if (!orientFor(state, tile, end)) return { valid: false, reason: 'That tile does not match that end.' };
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    if (state.phase !== 'playing') return actionRejected('No hand is live.');
    const slot = state.players[playerId];
    if (!slot || slot.left || slot.disconnected) return actionRejected('You cannot act.');
    if (state.currentPlayerId !== playerId) return actionRejected('It is not your turn.');

    /* ---------------- draw ---------------- */
    if (action.type === 'draw') {
      if (hasPlayableTile(state, playerId)) return actionRejected('You already have a legal tile.');
      if (state.boneyard.length === 0) return actionRejected('The boneyard is empty.');
      const drawn = drawUntilPlayable(state, playerId);
      state.lastEvent = `draw:${playerId}:${drawn.length}`;
      ctx.markStateChanged();
      // Still nothing playable and nothing left to draw: the turn passes.
      if (!hasPlayableTile(state, playerId) && state.boneyard.length === 0) {
        passTurn(state, ctx, playerId);
      }
      return actionAccepted();
    }

    /* ---------------- pass ---------------- */
    if (action.type === 'pass') {
      if (hasPlayableTile(state, playerId)) return actionRejected('You have a legal tile to play.');
      if (state.boneyard.length > 0) return actionRejected('Draw from the boneyard first.');
      state.lastEvent = `pass:${playerId}`;
      passTurn(state, ctx, playerId);
      return actionAccepted();
    }

    /* ---------------- place ---------------- */
    if (action.type !== 'place') return actionRejected('Unknown action.');
    const tileId = action.payload?.tileId;
    const end = action.payload?.end;
    if (typeof tileId !== 'string') return actionRejected('Pick a tile.');
    if (end !== 'left' && end !== 'right') return actionRejected('Pick an end of the chain.');

    const tile = slot.hand.find((entry) => entry.id === tileId);
    if (!tile) return actionRejected('That tile is not in your hand.');
    if (!orientFor(state, tile, end)) return actionRejected('That tile does not match that end.');

    applyPlacement(state, ctx, playerId, tileId, end);
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
    const ranked = [...ctx.players].sort((a, b) => {
      if (a.id === state.winnerId) return -1;
      if (b.id === state.winnerId) return 1;
      return (state.players[a.id]?.hand.length ?? 0) - (state.players[b.id]?.hand.length ?? 0);
    });
    const rankings: RankingDraft[] = ranked.map((player, index) => {
      const slot = state.players[player.id];
      return {
        playerId: player.id,
        rank: isDraw ? 1 : index + 1,
        score: slot?.score ?? 0,
        isWinner: player.id === state.winnerId,
        isDraw,
        stats: {
          tilesPlayed: slot?.tilesPlayed ?? 0,
          pipsLeft: handPips(slot?.hand ?? []),
          handsWon: slot?.handsWon ?? 0,
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

  reset(state): DominoState {
    const ids = Object.keys(state.players);
    return {
      ...state,
      phase: 'idle',
      boneyard: [],
      chain: [],
      players: Object.fromEntries(ids.map((id) => [id, makeSlot()])),
      // Rotate who is dealt first on a rematch.
      turnOrder: [...ids].reverse(),
      currentPlayerId: null,
      consecutivePasses: 0,
      moves: 0,
      lastMove: null,
      winnerId: null,
      isDraw: false,
      blocked: false,
      turnEndsAt: null,
      finishReason: null,
      lastEvent: null,
    };
  },

  cleanup(state): void {
    state.players = {};
    state.boneyard = [];
    state.chain = [];
    state.turnOrder = [];
    state.phase = 'finished';
  },

  /**
   * Privacy boundary. A viewer receives ONLY their own hand; opponents are
   * reduced to a tile COUNT, and the boneyard is exposed as a size only, so
   * neither the hidden tiles nor the draw order can be read off the wire.
   */
  getPublicState(state, viewerId, ctx) {
    const me = viewerId ? state.players[viewerId] : undefined;
    const ends = openEnds(state);
    const myTurn = Boolean(viewerId) && state.currentPlayerId === viewerId && state.phase === 'playing';

    // Which of the viewer's tiles fit which end — hints for the UI only.
    const playable = me && myTurn
      ? me.hand
          .filter((tile) => canPlace(state, tile, 'left') || canPlace(state, tile, 'right'))
          .map((tile) => ({
            tileId: tile.id,
            left: canPlace(state, tile, 'left'),
            right: canPlace(state, tile, 'right'),
          }))
      : [];

    return {
      phase: state.phase,
      chain: state.chain.map((tile) => ({ ...tile })),
      openEnds: ends,
      // Size only — never the contents or the order.
      boneyardCount: state.boneyard.length,
      currentPlayerId: state.currentPlayerId,
      isMyTurn: myTurn,
      canDraw: myTurn && !hasPlayableTile(state, viewerId as string) && state.boneyard.length > 0,
      canPass: myTurn && !hasPlayableTile(state, viewerId as string) && state.boneyard.length === 0,
      moves: state.moves,
      lastMove: state.lastMove ? { ...state.lastMove } : null,
      winnerId: state.winnerId,
      isDraw: state.isDraw,
      blocked: state.blocked,
      turnEndsAt: state.turnEndsAt,
      finishReason: state.finishReason,
      lastEvent: state.lastEvent,
      serverTime: ctx.now(),
      // The viewer's own hand, plus legality hints.
      myHand: me ? me.hand.map((tile) => ({ ...tile })) : [],
      playable,
      players: Object.fromEntries(
        Object.entries(state.players).map(([id, slot]) => [
          id,
          {
            // Opponents expose a COUNT, never tile faces.
            tileCount: slot.hand.length,
            score: slot.score,
            tilesPlayed: slot.tilesPlayed,
            handsWon: slot.handsWon,
            disconnected: slot.disconnected,
          },
        ]),
      ),
    };
  },

  /**
   * AI opponent. It sees only its own hand and the public chain — never the
   * boneyard or another hand — and always produces a legal action.
   */
  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'playing' || state.currentPlayerId !== playerId) return null;
    const slot = state.players[playerId];
    if (!slot || slot.left) return null;

    const options: Array<{ tileId: string; end: ChainEnd; pips: number; double: boolean }> = [];
    for (const tile of slot.hand) {
      for (const end of ['left', 'right'] as ChainEnd[]) {
        if (orientFor(state, tile, end)) {
          options.push({ tileId: tile.id, end, pips: pipsOf(tile), double: isDouble(tile) });
        }
      }
    }

    if (options.length === 0) {
      if (state.boneyard.length > 0) return { type: 'draw' };
      return { type: 'pass' };
    }

    if (difficulty === 'easy') {
      const pick = options[Math.floor(ctx.random() * options.length)] as (typeof options)[number];
      return { type: 'place', payload: { tileId: pick.tileId, end: pick.end } };
    }

    // Medium/hard: shed the heaviest tile first (standard dominoes heuristic),
    // preferring doubles which are hardest to place later.
    const ranked = [...options].sort((a, b) => {
      if (a.double !== b.double) return a.double ? -1 : 1;
      return b.pips - a.pips;
    });
    if (difficulty === 'medium' && ctx.random() < 0.25) {
      const pick = options[Math.floor(ctx.random() * options.length)] as (typeof options)[number];
      return { type: 'place', payload: { tileId: pick.tileId, end: pick.end } };
    }
    const best = ranked[0] as (typeof options)[number];
    return { type: 'place', payload: { tileId: best.tileId, end: best.end } };
  },

  maxDurationMs: 45 * 60 * 1000,
};
