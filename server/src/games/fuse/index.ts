import type { AIDifficulty, GameAction, GameConfig, GameFinishReason } from '@2play/shared';
import { FUSE_METADATA } from '@2play/shared';
export { FUSE_METADATA };
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
  FUSE_TOTAL_LEVELS,
  distinctRotations,
  evaluateCircuits,
  generateBoard,
  isSolved,
  litBulbs,
  progressOf,
  rotateMask,
  rotateTile,
  type CircuitBoard,
  type Tile,
} from './circuit';

export * from './circuit';

/**
 * Fuse — versus circuit-puzzle race.
 *
 * Every player receives the SAME seeded board and solves their own private
 * copy. The server owns the board, evaluates connectivity with a real graph
 * traversal, and decides completion. A client only ever sends "rotate tile X".
 */

export type FusePhase = 'idle' | 'playing' | 'level-clear' | 'finished';

export interface FusePlayerSlot {
  /** This player's private working copy of the shared board. */
  board: CircuitBoard;
  score: number;
  rotations: number;
  mistakes: number;
  levelsCleared: number;
  solvedAt: number | null;
  finishRank: number;
  disconnected: boolean;
  left: boolean;
}

export interface FuseState {
  phase: FusePhase;
  level: number;
  totalLevels: number;
  seed: number;
  cols: number;
  rows: number;
  circuits: number;
  players: Record<string, FusePlayerSlot>;
  levelStartedAt: number | null;
  levelEndsAt: number | null;
  levelMs: number;
  finishOrder: string[];
  lastEvent: string | null;
  finishReason: GameFinishReason | null;
  nextAIRequestAt: Record<string, number>;
}

export const LEVEL_MS = 150_000;
export const LEVEL_CLEAR_SCORE = 250;
export const SPEED_BONUS_MAX = 150;
export const PLACE_BONUS = [120, 70, 40, 20];
export const ROTATION_COST = 1;
export const BREAK_MS = 3_000;

const AI_INTERVAL: Record<AIDifficulty, number> = { easy: 2_200, medium: 1_200, hard: 650 };
/** Chance an AI rotates a tile that was already correct (a real mistake). */
const AI_ERROR: Record<AIDifficulty, number> = { easy: 0.3, medium: 0.12, hard: 0.02 };

function cloneBoard(board: CircuitBoard): CircuitBoard {
  return { ...board, tiles: board.tiles.map((tile) => ({ ...tile })) };
}

function makeSlot(board: CircuitBoard): FusePlayerSlot {
  return {
    board: cloneBoard(board),
    score: 0,
    rotations: 0,
    mistakes: 0,
    levelsCleared: 0,
    solvedAt: null,
    finishRank: 0,
    disconnected: false,
    left: false,
  };
}

function activePlayers(state: FuseState): Array<[string, FusePlayerSlot]> {
  return Object.entries(state.players).filter(([, slot]) => !slot.left);
}

export function finishFuse(state: FuseState, ctx: GameContext, reason: GameFinishReason): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.finishReason = reason;
  state.levelEndsAt = null;
  state.lastEvent = reason === 'timeout' ? 'timeout' : 'finished';
  ctx.markStateChanged();
  ctx.finish(reason);
}

/** Deals the level: one generated board, copied privately to every player. */
export function beginLevel(state: FuseState, ctx: GameContext): void {
  if (state.phase === 'finished') return;
  const board = generateBoard(state.seed, state.level);
  state.cols = board.cols;
  state.rows = board.rows;
  state.circuits = board.circuits;
  state.finishOrder = [];
  state.phase = 'playing';
  state.levelStartedAt = ctx.now();
  state.levelEndsAt = ctx.now() + state.levelMs;
  state.lastEvent = `level:${state.level}`;

  for (const [, slot] of activePlayers(state)) {
    slot.board = cloneBoard(board);
    slot.solvedAt = null;
    slot.finishRank = 0;
  }
  state.nextAIRequestAt = {};
  ctx.markStateChanged();

  ctx.schedule(
    state.levelMs,
    () => {
      if (state.phase !== 'playing') return;
      state.lastEvent = 'level-timeout';
      endLevel(state, ctx);
    },
    'turn',
    `level-${state.level}`,
  );

  for (const player of ctx.players) {
    if (player.isAI) ctx.requestAI(player.id, 1_000);
  }
}

export function endLevel(state: FuseState, ctx: GameContext): void {
  if (state.phase !== 'playing') return;
  if (state.level + 1 >= state.totalLevels) {
    finishFuse(state, ctx, 'completed');
    return;
  }
  state.level += 1;
  state.phase = 'level-clear';
  state.levelEndsAt = ctx.now() + BREAK_MS;
  ctx.markStateChanged();
  ctx.schedule(
    BREAK_MS,
    () => {
      if (state.phase !== 'level-clear') return;
      beginLevel(state, ctx);
    },
    'turn',
    `break-${state.level}`,
  );
}

function maybeEndLevel(state: FuseState, ctx: GameContext): void {
  const contenders = activePlayers(state).filter(([, slot]) => !slot.disconnected);
  if (contenders.length > 0 && contenders.every(([, slot]) => slot.solvedAt !== null)) {
    endLevel(state, ctx);
  }
}

function resolveLevels(config: GameConfig): number {
  if (typeof config.rounds === 'number' && Number.isFinite(config.rounds)) {
    return Math.min(FUSE_TOTAL_LEVELS, Math.max(1, Math.round(config.rounds)));
  }
  return 4;
}

export const fuseGame: GameModule<FuseState> = {
  metadata: FUSE_METADATA,

  initialize(): void {
    // Stateless module.
  },

  createInitialState(players: readonly GamePlayerView[], config: GameConfig): FuseState {
    const empty: CircuitBoard = { cols: 0, rows: 0, tiles: [], circuits: 0 };
    const state: FuseState = {
      phase: 'idle',
      level: 0,
      totalLevels: resolveLevels(config),
      seed: 1,
      cols: 0,
      rows: 0,
      circuits: 0,
      players: {},
      levelStartedAt: null,
      levelEndsAt: null,
      levelMs: LEVEL_MS,
      finishOrder: [],
      lastEvent: null,
      finishReason: null,
      nextAIRequestAt: {},
    };
    for (const player of players) state.players[player.id] = makeSlot(empty);
    return state;
  },

  playerJoined(player, state): void {
    const existing = state.players[player.id];
    if (existing) {
      existing.disconnected = false;
      return;
    }
    const empty: CircuitBoard = { cols: state.cols, rows: state.rows, tiles: [], circuits: 0 };
    state.players[player.id] = makeSlot(empty);
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
    if (activePlayers(state).length === 0) finishFuse(state, ctx, 'abandoned');
  },

  start(state, ctx): void {
    if (state.phase === 'playing') return;
    const empty: CircuitBoard = { cols: 0, rows: 0, tiles: [], circuits: 0 };
    state.players = {};
    for (const player of ctx.players) state.players[player.id] = makeSlot(empty);
    // Server-generated seed: the same board for everyone, new on a rematch.
    state.seed = Math.floor(ctx.random() * 0x7fffffff) >>> 0 || 1;
    state.level = 0;
    state.finishReason = null;
    beginLevel(state, ctx);
  },

  validateAction(playerId, action, state): ValidationResult {
    if (['score', 'win', 'finish', 'complete', 'solved', 'board'].includes(action.type)) {
      return { valid: false, reason: 'The server validates the circuit.' };
    }
    if (state.phase !== 'playing') return { valid: false, reason: 'No puzzle is live.' };

    const slot = state.players[playerId];
    if (!slot || slot.left) return { valid: false, reason: 'You are not in this match.' };
    if (slot.disconnected) return { valid: false, reason: 'Reconnect to keep playing.' };
    if (slot.solvedAt !== null) return { valid: false, reason: 'You already solved this level.' };

    if (action.type !== 'rotate') return { valid: false, reason: 'Unknown action.' };
    const tileId = action.payload?.tileId;
    if (typeof tileId !== 'string') return { valid: false, reason: 'Pick a tile.' };
    const tile = slot.board.tiles.find((entry) => entry.id === tileId);
    if (!tile) return { valid: false, reason: 'That tile does not exist.' };
    if (tile.fixed) return { valid: false, reason: 'That piece cannot be rotated.' };
    if (tile.kind === 'empty' || tile.kind === 'blocker') {
      return { valid: false, reason: 'There is no wire there.' };
    }
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    if (state.phase !== 'playing') return actionRejected('No puzzle is live.');
    const slot = state.players[playerId];
    if (!slot || slot.left || slot.disconnected) return actionRejected('You cannot act.');
    if (slot.solvedAt !== null) return actionRejected('Already solved.');
    if (action.type !== 'rotate') return actionRejected('Unknown action.');

    const tileId = action.payload?.tileId;
    if (typeof tileId !== 'string') return actionRejected('Pick a tile.');

    // rotateTile enforces ownership of the rule (fixed pieces stay put).
    if (!rotateTile(slot.board, tileId)) return actionRejected('That piece cannot be rotated.');

    slot.rotations += 1;
    slot.score = Math.max(0, slot.score - ROTATION_COST);
    state.lastEvent = `rotate:${playerId}`;

    // The SERVER decides completion by traversing the circuit graph.
    if (isSolved(slot.board)) {
      slot.solvedAt = ctx.now();
      state.finishOrder.push(playerId);
      slot.finishRank = state.finishOrder.length;
      slot.levelsCleared += 1;
      slot.score += LEVEL_CLEAR_SCORE;
      slot.score += PLACE_BONUS[slot.finishRank - 1] ?? 0;
      const remaining = Math.max(0, (state.levelEndsAt ?? ctx.now()) - ctx.now());
      slot.score += Math.round(SPEED_BONUS_MAX * Math.min(1, remaining / state.levelMs));
      state.lastEvent = `solved:${playerId}`;
      ctx.markStateChanged();
      maybeEndLevel(state, ctx);
      return actionAccepted();
    }

    ctx.markStateChanged();
    return actionAccepted();
  },

  update(state, _deltaTimeMs, ctx): void {
    if (state.phase !== 'playing') return;
    const now = ctx.now();
    for (const view of ctx.players) {
      if (!view.isAI) continue;
      const slot = state.players[view.id];
      if (!slot || slot.left || slot.solvedAt !== null) continue;
      const difficulty = view.aiDifficulty ?? 'medium';
      if (now >= (state.nextAIRequestAt[view.id] ?? 0)) {
        ctx.requestAI(view.id, 40);
        state.nextAIRequestAt[view.id] = now + AI_INTERVAL[difficulty];
      }
    }
  },

  tick(): void {
    // Handled by update().
  },

  calculateScore(playerId, state): number {
    return state.players[playerId]?.score ?? 0;
  },

  checkWinCondition(state): string[] | null {
    if (state.phase !== 'finished') return null;
    const entries = activePlayers(state);
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
    state.levelEndsAt = null;
  },

  getResult(state, ctx): GameResultDraft {
    const ranked = [...ctx.players].sort((a, b) => {
      const byScore = (state.players[b.id]?.score ?? 0) - (state.players[a.id]?.score ?? 0);
      if (byScore !== 0) return byScore;
      const left = state.players[a.id]?.solvedAt ?? Number.POSITIVE_INFINITY;
      const right = state.players[b.id]?.solvedAt ?? Number.POSITIVE_INFINITY;
      return left - right;
    });
    const best = ranked.length > 0 ? state.players[ranked[0]?.id ?? '']?.score ?? 0 : 0;
    const winners = ranked
      .filter((player) => (state.players[player.id]?.score ?? 0) === best)
      .map((player) => player.id);
    const isDraw = winners.length > 1;

    const rankings: RankingDraft[] = ranked.map((player, index) => {
      const slot = state.players[player.id];
      return {
        playerId: player.id,
        rank: isDraw ? 1 : index + 1,
        score: slot?.score ?? 0,
        isWinner: winners.includes(player.id),
        isDraw,
        stats: {
          levelsCleared: slot?.levelsCleared ?? 0,
          rotations: slot?.rotations ?? 0,
          circuits: slot ? evaluateCircuits(slot.board).filter((c) => c.connected && !c.crossed).length : 0,
        },
      };
    });
    return { winners, isDraw, rankings, reason: state.finishReason ?? 'completed' };
  },

  reset(state): FuseState {
    const empty: CircuitBoard = { cols: 0, rows: 0, tiles: [], circuits: 0 };
    return {
      ...state,
      phase: 'idle',
      level: 0,
      seed: 1,
      cols: 0,
      rows: 0,
      circuits: 0,
      players: Object.fromEntries(Object.keys(state.players).map((id) => [id, makeSlot(empty)])),
      levelStartedAt: null,
      levelEndsAt: null,
      finishOrder: [],
      lastEvent: null,
      finishReason: null,
      nextAIRequestAt: {},
    };
  },

  cleanup(state): void {
    state.players = {};
    state.phase = 'finished';
  },

  /**
   * A viewer receives only THEIR OWN board. Opponents are a progress
   * percentage, so the race is visible without leaking anyone's solution.
   */
  getPublicState(state, viewerId, ctx) {
    const me = viewerId ? state.players[viewerId] : undefined;
    const lit = me ? new Set(litBulbs(me.board)) : new Set<string>();

    return {
      phase: state.phase,
      level: state.level,
      totalLevels: state.totalLevels,
      cols: state.cols,
      rows: state.rows,
      circuits: state.circuits,
      levelEndsAt: state.levelEndsAt,
      levelMs: state.levelMs,
      finishOrder: [...state.finishOrder],
      lastEvent: state.lastEvent,
      finishReason: state.finishReason,
      serverTime: ctx.now(),
      // The viewer's own board, with derived render hints.
      board: me
        ? me.board.tiles.map((tile: Tile) => ({
            id: tile.id,
            x: tile.x,
            y: tile.y,
            kind: tile.kind,
            mask: tile.mask,
            rotation: tile.rotation,
            circuit: tile.circuit,
            fixed: tile.fixed,
            lit: lit.has(tile.id),
          }))
        : [],
      me: me
        ? {
            score: me.score,
            rotations: me.rotations,
            mistakes: me.mistakes,
            solved: me.solvedAt !== null,
            finishRank: me.finishRank,
            levelsCleared: me.levelsCleared,
            progress: Math.round(progressOf(me.board) * 100),
          }
        : null,
      players: Object.fromEntries(
        Object.entries(state.players).map(([id, slot]) => [
          id,
          {
            // Progress only — never the opponent's tile layout.
            progress: Math.round(progressOf(slot.board) * 100),
            score: slot.score,
            rotations: slot.rotations,
            solved: slot.solvedAt !== null,
            finishRank: slot.finishRank,
            levelsCleared: slot.levelsCleared,
            disconnected: slot.disconnected,
          },
        ]),
      ),
    };
  },

  /**
   * AI opponent. It reasons over its own board exactly as a player would:
   * for each rotatable tile it tries the available orientations and keeps the
   * one that increases connectivity. Weaker bots sometimes disturb a tile that
   * was already right.
   */
  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'playing') return null;
    const slot = state.players[playerId];
    if (!slot || slot.left || slot.solvedAt !== null) return null;

    const rotatable = slot.board.tiles.filter(
      (tile) => !tile.fixed && tile.kind !== 'empty' && tile.kind !== 'blocker' && distinctRotations(tile.mask) > 1,
    );
    if (rotatable.length === 0) return null;

    // A real mistake: rotate a random tile regardless of benefit.
    if (ctx.random() < AI_ERROR[difficulty]) {
      const pick = rotatable[Math.floor(ctx.random() * rotatable.length)] as Tile;
      return { type: 'rotate', payload: { tileId: pick.id } };
    }

    // Score a board by connected circuits, then by total mutual connections.
    const score = (board: CircuitBoard): number => {
      const statuses = evaluateCircuits(board);
      const good = statuses.filter((status) => status.connected && !status.crossed).length;
      let links = 0;
      for (const tile of board.tiles) {
        for (const direction of ['N', 'E', 'S', 'W'] as const) {
          const bit = { N: 1, E: 2, S: 4, W: 8 }[direction];
          if ((tile.mask & bit) === 0) continue;
          const delta = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] }[direction] as [number, number];
          const neighbour = board.tiles.find(
            (other) => other.x === tile.x + delta[0] && other.y === tile.y + delta[1],
          );
          if (!neighbour) continue;
          const opposite = { N: 4, E: 8, S: 1, W: 2 }[direction];
          if ((neighbour.mask & opposite) !== 0) links += 1;
        }
      }
      return good * 10_000 + links;
    };

    const current = score(slot.board);
    let best: { tileId: string; gain: number } | null = null;

    for (const tile of rotatable) {
      const original = tile.mask;
      const options = distinctRotations(tile.mask);
      for (let step = 1; step < options; step += 1) {
        tile.mask = rotateMask(original, step);
        const gain = score(slot.board) - current;
        if (gain > 0 && (!best || gain > best.gain)) best = { tileId: tile.id, gain };
      }
      tile.mask = original; // always restore
    }

    if (best) return { type: 'rotate', payload: { tileId: best.tileId } };
    // Nothing improves things immediately: nudge a random tile to escape.
    const pick = rotatable[Math.floor(ctx.random() * rotatable.length)] as Tile;
    return { type: 'rotate', payload: { tileId: pick.id } };
  },

  needsUpdateLoop: true,
  maxDurationMs: 30 * 60 * 1000,
};
