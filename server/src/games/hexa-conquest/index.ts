import type { GameAction, GameFinishReason } from '@2play/shared';
import { HEXA_CONQUEST_METADATA } from '@2play/shared';
export { HEXA_CONQUEST_METADATA };
import type {
  ActionResult,
  GameContext,
  GameModule,
  GameResultDraft,
  RankingDraft,
  ValidationResult,
} from '../GameModule';
import { actionAccepted, actionRejected } from '../GameModule';

/**
 * Hexa Conquest — turn-based hex territory.
 *
 * Clients send `capture` (adjacent) or `bridge` (special, non-adjacent).
 * The server owns adjacency, tile types, turn order, special charges and scores.
 */

export type HexPhase = 'idle' | 'playing' | 'finished';
export type HexTileKind = 'normal' | 'bonus' | 'energy' | 'blocked';

export interface HexTile {
  col: number;
  row: number;
  kind: HexTileKind;
  owner: string | null;
  value: number;
  startOf: string | null;
}

export interface HexPlayer {
  score: number;
  specials: number;
  captured: number;
  skipped: number;
}

export interface HexaConquestState {
  phase: HexPhase;
  cols: number;
  rows: number;
  tiles: HexTile[];
  players: Record<string, HexPlayer>;
  turnOrder: string[];
  currentPlayerId: string | null;
  turnEndsAt: number | null;
  turnMs: number;
  startedAt: number | null;
  endsAt: number | null;
  durationMs: number;
  finishReason: GameFinishReason | null;
  lastEvent: string | null;
  lastCapture: { playerId: string; col: number; row: number; kind: string } | null;
}

export const HEX_COLS = 15;
export const HEX_ROWS = 11;
const TURN_MS = 12_000;
const MATCH_MS = 4 * 60 * 1000;
const START_SPECIALS = 1;
const MAX_SPECIALS = 2;
const VALUE: Record<HexTileKind, number> = { normal: 1, bonus: 2, energy: 1, blocked: 0 };

export function hexIndex(cols: number, col: number, row: number): number {
  return row * cols + col;
}

/** Odd-r offset neighbours (pointy-top). */
export function hexNeighbors(col: number, row: number): Array<{ col: number; row: number }> {
  const odd = row & 1;
  // odd-r (pointy-top) offset neighbours — even rows unshifted, odd rows +½.
  const deltas = odd
    ? [
        [1, 0],
        [1, -1],
        [0, -1],
        [-1, 0],
        [0, 1],
        [1, 1],
      ]
    : [
        [1, 0],
        [0, -1],
        [-1, -1],
        [-1, 0],
        [-1, 1],
        [0, 1],
      ];
  return deltas.map(([dc, dr]) => ({ col: col + dc!, row: row + dr! }));
}

export function inHex(cols: number, rows: number, col: number, row: number): boolean {
  return col >= 0 && row >= 0 && col < cols && row < rows;
}

export function isAdjacentToOwner(state: HexaConquestState, playerId: string, col: number, row: number): boolean {
  for (const n of hexNeighbors(col, row)) {
    if (!inHex(state.cols, state.rows, n.col, n.row)) continue;
    const tile = state.tiles[hexIndex(state.cols, n.col, n.row)];
    if (tile?.owner === playerId) return true;
  }
  return false;
}

function tileAt(state: HexaConquestState, col: number, row: number): HexTile | null {
  if (!inHex(state.cols, state.rows, col, row)) return null;
  return state.tiles[hexIndex(state.cols, col, row)] ?? null;
}

function startAnchors(cols: number, rows: number): Array<{ col: number; row: number }> {
  return [
    { col: 1, row: 1 },
    { col: cols - 2, row: 1 },
    { col: 1, row: rows - 2 },
    { col: cols - 2, row: rows - 2 },
  ];
}

function buildBoard(cols: number, rows: number, rng: () => number): HexTile[] {
  const tiles: HexTile[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const roll = rng();
      let kind: HexTileKind = 'normal';
      if (roll < 0.08) kind = 'blocked';
      else if (roll < 0.18) kind = 'bonus';
      else if (roll < 0.24) kind = 'energy';
      tiles.push({ col, row, kind, owner: null, value: VALUE[kind], startOf: null });
    }
  }
  return tiles;
}

function occupiedCount(state: HexaConquestState): { claimed: number; claimable: number } {
  let claimed = 0;
  let claimable = 0;
  for (const tile of state.tiles) {
    if (tile.kind === 'blocked') continue;
    claimable += 1;
    if (tile.owner) claimed += 1;
  }
  return { claimed, claimable };
}

export function legalCaptures(state: HexaConquestState, playerId: string): HexTile[] {
  return state.tiles.filter(
    (tile) =>
      tile.kind !== 'blocked' &&
      tile.owner === null &&
      tile.startOf === null &&
      isAdjacentToOwner(state, playerId, tile.col, tile.row),
  );
}

export function legalBridges(state: HexaConquestState, playerId: string): HexTile[] {
  return state.tiles.filter(
    (tile) =>
      tile.kind !== 'blocked' &&
      tile.owner === null &&
      tile.startOf === null &&
      !isAdjacentToOwner(state, playerId, tile.col, tile.row),
  );
}

function applyOwner(state: HexaConquestState, playerId: string, tile: HexTile): void {
  tile.owner = playerId;
  const slot = state.players[playerId];
  if (!slot) return;
  slot.score += tile.value;
  slot.captured += 1;
  if (tile.kind === 'energy') slot.specials = Math.min(MAX_SPECIALS, slot.specials + 1);
}

export function finishHexa(state: HexaConquestState, ctx: GameContext, reason: GameFinishReason): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.finishReason = reason;
  state.currentPlayerId = null;
  state.turnEndsAt = null;
  state.lastEvent = reason === 'timeout' ? 'timeout' : 'finished';
  ctx.markStateChanged();
  ctx.finish(reason);
}

function maybeComplete(state: HexaConquestState, ctx: GameContext): boolean {
  const { claimed, claimable } = occupiedCount(state);
  if (claimed >= claimable) {
    finishHexa(state, ctx, 'completed');
    return true;
  }
  return false;
}

function scheduleTurn(state: HexaConquestState, ctx: GameContext): void {
  const current = state.currentPlayerId;
  if (!current || state.phase !== 'playing') return;
  state.turnEndsAt = ctx.now() + state.turnMs;
  ctx.schedule(
    state.turnMs,
    () => {
      if (state.phase !== 'playing' || state.currentPlayerId !== current) return;
      const slot = state.players[current];
      if (slot) slot.skipped += 1;
      state.lastEvent = `timeout:${current}`;
      advanceTurn(state, ctx);
    },
    'turn',
    'turn-timeout',
  );
  const player = ctx.players.find((entry) => entry.id === current);
  if (player?.isAI) {
    const difficulty = player.aiDifficulty ?? 'medium';
    const delay = difficulty === 'easy' ? 900 : difficulty === 'hard' ? 280 : 520;
    ctx.requestAI(current, delay);
  }
}

export function advanceTurn(state: HexaConquestState, ctx: GameContext): void {
  if (state.phase !== 'playing') return;
  const order = state.turnOrder.filter((id) => {
    const player = ctx.players.find((entry) => entry.id === id);
    const slot = state.players[id];
    return Boolean(slot) && player && (player.isAI || player.isConnected);
  });
  if (order.length === 0) {
    finishHexa(state, ctx, 'abandoned');
    return;
  }
  const index = state.currentPlayerId ? order.indexOf(state.currentPlayerId) : -1;
  let next = order[(index + 1) % order.length]!;
  let hops = 0;
  while (hops < order.length) {
    const canCapture = legalCaptures(state, next).length > 0;
    const canBridge = (state.players[next]?.specials ?? 0) > 0 && legalBridges(state, next).length > 0;
    if (canCapture || canBridge) break;
    hops += 1;
    next = order[(order.indexOf(next) + 1) % order.length]!;
  }
  if (hops >= order.length) {
    finishHexa(state, ctx, 'completed');
    return;
  }
  state.turnOrder = order;
  state.currentPlayerId = next;
  ctx.markStateChanged();
  scheduleTurn(state, ctx);
}

export const hexaConquestGame: GameModule<HexaConquestState> = {
  metadata: HEXA_CONQUEST_METADATA,

  initialize(): void {
    // Stateless module.
  },

  createInitialState(players): HexaConquestState {
    return {
      phase: 'idle',
      cols: HEX_COLS,
      rows: HEX_ROWS,
      tiles: [],
      players: Object.fromEntries(players.map((player) => [player.id, { score: 0, specials: START_SPECIALS, captured: 0, skipped: 0 }])),
      turnOrder: players.map((player) => player.id),
      currentPlayerId: players[0]?.id ?? null,
      turnEndsAt: null,
      turnMs: TURN_MS,
      startedAt: null,
      endsAt: null,
      durationMs: MATCH_MS,
      finishReason: null,
      lastEvent: null,
      lastCapture: null,
    };
  },

  playerJoined(player, state): void {
    if (!state.players[player.id]) {
      state.players[player.id] = { score: 0, specials: START_SPECIALS, captured: 0, skipped: 0 };
    }
    if (!state.turnOrder.includes(player.id)) state.turnOrder.push(player.id);
  },

  playerReady(): void {
    // Lobby concern.
  },

  playerLeft(playerId, state, ctx, reason): void {
    if (reason === 'disconnect') return;
    state.turnOrder = state.turnOrder.filter((id) => id !== playerId);
    if (state.phase === 'playing' && state.currentPlayerId === playerId) advanceTurn(state, ctx);
    const remaining = ctx.players.filter((player) => player.isAI || player.isConnected);
    if (state.phase === 'playing' && remaining.filter((player) => player.id !== playerId).length < 1) {
      finishHexa(state, ctx, 'abandoned');
    }
  },

  start(state, ctx): void {
    if (state.phase === 'playing') return;
    const cols = HEX_COLS;
    const rows = HEX_ROWS;
    const tiles = buildBoard(cols, rows, ctx.random);
    const anchors = startAnchors(cols, rows);
    ctx.players.forEach((player, index) => {
      const anchor = anchors[index % anchors.length]!;
      const tile = tiles[hexIndex(cols, anchor.col, anchor.row)]!;
      tile.kind = 'normal';
      tile.value = 1;
      tile.owner = player.id;
      tile.startOf = player.id;
      if (!state.players[player.id]) {
        state.players[player.id] = { score: 0, specials: START_SPECIALS, captured: 0, skipped: 0 };
      }
      state.players[player.id]!.score = 1;
      state.players[player.id]!.captured = 1;
      state.players[player.id]!.specials = START_SPECIALS;
    });
    state.cols = cols;
    state.rows = rows;
    state.tiles = tiles;
    state.turnOrder = ctx.players.map((player) => player.id);
    state.currentPlayerId = state.turnOrder[0] ?? null;
    state.phase = 'playing';
    state.startedAt = ctx.now();
    state.endsAt = state.startedAt + state.durationMs;
    state.finishReason = null;
    state.lastEvent = 'start';
    ctx.markStateChanged();
    ctx.schedule(state.durationMs, () => finishHexa(state, ctx, 'timeout'), 'gameDuration', 'match-timeout');
    scheduleTurn(state, ctx);
  },

  validateAction(playerId, action, state): ValidationResult {
    if (action.type !== 'capture' && action.type !== 'bridge') return { valid: false, reason: 'Unknown action.' };
    if (state.phase !== 'playing') return { valid: false, reason: 'The match is not running.' };
    if (state.currentPlayerId !== playerId) return { valid: false, reason: 'It is not your turn.' };
    const col = action.payload?.col;
    const row = action.payload?.row;
    if (typeof col !== 'number' || typeof row !== 'number' || !Number.isInteger(col) || !Number.isInteger(row)) {
      return { valid: false, reason: 'Pick a hex on the board.' };
    }
    const tile = tileAt(state, col, row);
    if (!tile) return { valid: false, reason: 'That hex is off the board.' };
    if (tile.kind === 'blocked') return { valid: false, reason: 'That hex is blocked.' };
    if (tile.owner !== null) return { valid: false, reason: 'That hex is already claimed.' };
    if (tile.startOf && tile.startOf !== playerId) return { valid: false, reason: 'Starting hexes cannot be taken.' };
    if (action.type === 'capture') {
      if (!isAdjacentToOwner(state, playerId, col, row)) return { valid: false, reason: 'You may only expand to an adjacent hex.' };
      return { valid: true };
    }
    if ((state.players[playerId]?.specials ?? 0) <= 0) return { valid: false, reason: 'No Bridge charges left.' };
    if (isAdjacentToOwner(state, playerId, col, row)) return { valid: false, reason: 'Bridge is for a hex that is not adjacent.' };
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    const col = Number(action.payload?.col);
    const row = Number(action.payload?.row);
    const tile = tileAt(state, col, row);
    if (!tile) return actionRejected('That hex is off the board.');
    if (action.type === 'bridge') {
      const slot = state.players[playerId];
      if (!slot || slot.specials <= 0) return actionRejected('No Bridge charges left.');
      slot.specials -= 1;
    }
    applyOwner(state, playerId, tile);
    state.lastCapture = { playerId, col, row, kind: tile.kind };
    state.lastEvent = `${action.type}:${playerId}:${col},${row}`;
    ctx.markStateChanged();
    if (maybeComplete(state, ctx)) return actionAccepted();
    advanceTurn(state, ctx);
    return actionAccepted();
  },

  update(): void {
    // Turn based.
  },

  tick(): void {
    // Turn based.
  },

  calculateScore(playerId, state): number {
    return state.players[playerId]?.score ?? 0;
  },

  checkWinCondition(state): string[] | null {
    if (state.phase !== 'finished') return null;
    const entries = Object.entries(state.players);
    if (entries.length === 0) return [];
    const best = Math.max(...entries.map(([, slot]) => slot.score));
    return entries.filter(([, slot]) => slot.score === best).map(([id]) => id);
  },

  checkDrawCondition(state): boolean {
    return (this.checkWinCondition(state)?.length ?? 0) > 1;
  },

  isGameFinished(state): boolean {
    return state.phase === 'finished';
  },

  finish(state): void {
    state.phase = 'finished';
  },

  getResult(state, ctx): GameResultDraft {
    const ranked = [...ctx.players].sort((a, b) => (state.players[b.id]?.score ?? 0) - (state.players[a.id]?.score ?? 0));
    const top = state.players[ranked[0]?.id ?? '']?.score ?? 0;
    const winners = ranked.filter((player) => (state.players[player.id]?.score ?? 0) === top).map((player) => player.id);
    const rankings: RankingDraft[] = ranked.map((player, index) => ({
      playerId: player.id,
      rank: index + 1,
      score: state.players[player.id]?.score ?? 0,
      isWinner: winners.includes(player.id),
      isDraw: winners.length > 1,
      stats: {
        captured: state.players[player.id]?.captured ?? 0,
        specials: state.players[player.id]?.specials ?? 0,
      },
    }));
    return { winners, isDraw: winners.length > 1, rankings, reason: state.finishReason ?? 'completed' };
  },

  reset(state): HexaConquestState {
    const seats = Object.keys(state.players);
    return {
      ...state,
      phase: 'idle',
      tiles: [],
      players: Object.fromEntries(seats.map((id) => [id, { score: 0, specials: START_SPECIALS, captured: 0, skipped: 0 }])),
      currentPlayerId: seats[0] ?? null,
      turnEndsAt: null,
      startedAt: null,
      endsAt: null,
      finishReason: null,
      lastEvent: null,
      lastCapture: null,
    };
  },

  cleanup(state): void {
    state.tiles = [];
    state.phase = 'finished';
  },

  getPublicState(state, _viewerId, ctx) {
    return {
      phase: state.phase,
      cols: state.cols,
      rows: state.rows,
      tiles: state.tiles.map((tile) => ({
        col: tile.col,
        row: tile.row,
        kind: tile.kind,
        owner: tile.owner,
        value: tile.value,
        start: Boolean(tile.startOf),
      })),
      scores: Object.fromEntries(Object.entries(state.players).map(([id, slot]) => [id, slot.score])),
      specials: Object.fromEntries(Object.entries(state.players).map(([id, slot]) => [id, slot.specials])),
      captured: Object.fromEntries(Object.entries(state.players).map(([id, slot]) => [id, slot.captured])),
      currentPlayerId: state.currentPlayerId,
      turnOrder: [...state.turnOrder],
      turnEndsAt: state.turnEndsAt,
      endsAt: state.endsAt,
      lastEvent: state.lastEvent,
      lastCapture: state.lastCapture,
      serverTime: ctx.now(),
    };
  },

  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'playing' || state.currentPlayerId !== playerId) return null;
    const adjacent = legalCaptures(state, playerId);
    const bridges = (state.players[playerId]?.specials ?? 0) > 0 ? legalBridges(state, playerId) : [];
    if (adjacent.length === 0 && bridges.length === 0) return null;
    const pick = (list: HexTile[]): HexTile => {
      if (difficulty === 'easy') return list[Math.floor(ctx.random() * list.length)]!;
      const scored = [...list].sort((a, b) => b.value - a.value || ctx.random() - 0.5);
      return scored[0]!;
    };
    if (difficulty === 'hard' && bridges.length > 0 && ctx.random() < 0.2) {
      const tile = pick(bridges);
      return { type: 'bridge', payload: { col: tile.col, row: tile.row } };
    }
    if (adjacent.length > 0) {
      const tile = pick(adjacent);
      return { type: 'capture', payload: { col: tile.col, row: tile.row } };
    }
    const tile = pick(bridges);
    return { type: 'bridge', payload: { col: tile.col, row: tile.row } };
  },

  maxDurationMs: 10 * 60 * 1000,
};
