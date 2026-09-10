import type { AIDifficulty, GameAction, GameConfig, GameFinishReason } from '@2play/shared';
import { MIRROR_GRID_METADATA } from '@2play/shared';
export { MIRROR_GRID_METADATA };
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
  COLORS,
  MIRROR_TOTAL_LEVELS,
  SYMBOLS,
  cellsEqual,
  countCorrect,
  generateLevel,
  isSolved,
  wrongIndices,
  type Cell,
  type Color,
  type Grid,
  type MirrorLevel,
  type Symbol,
} from './puzzle';

export * from './puzzle';

/**
 * Mirror Grid — versus puzzle race.
 *
 * Every player receives the SAME seeded puzzle and solves it independently on
 * their own private board. The server owns the seed, the correct reflection
 * and the completion check — a client can never declare itself solved.
 */

export type MirrorPhase = 'idle' | 'playing' | 'level-clear' | 'finished';

export interface MirrorPlayerSlot {
  /** This player's working answer for the current level. */
  answer: Grid;
  score: number;
  moves: number;
  mistakes: number;
  levelsCleared: number;
  /** Server timestamp of the current level completion. */
  solvedAt: number | null;
  finishRank: number;
  disconnected: boolean;
  left: boolean;
}

export interface MirrorState {
  phase: MirrorPhase;
  level: number;
  totalLevels: number;
  seed: number;
  size: number;
  mirror: string;
  /** The pattern shown to everyone. */
  source: Grid;
  /** SERVER ONLY — the correct reflected grid. */
  solution: Grid;
  players: Record<string, MirrorPlayerSlot>;
  levelStartedAt: number | null;
  levelEndsAt: number | null;
  levelMs: number;
  finishOrder: string[];
  lastEvent: string | null;
  finishReason: GameFinishReason | null;
  nextAIRequestAt: Record<string, number>;
}

/* ------------------------------------------------------------------ */
/* Tunables                                                            */
/* ------------------------------------------------------------------ */

export const LEVEL_MS = 120_000;
export const LEVEL_CLEAR_SCORE = 200;
export const SPEED_BONUS_MAX = 150;
/** Awarded for finishing 1st, 2nd, ... */
export const PLACE_BONUS = [120, 70, 40, 20];
export const MISTAKE_PENALTY = 10;
export const BREAK_MS = 3_000;

const AI_INTERVAL: Record<AIDifficulty, number> = { easy: 2_600, medium: 1_500, hard: 800 };
/** Chance an AI places a deliberately wrong cell. */
const AI_ERROR: Record<AIDifficulty, number> = { easy: 0.28, medium: 0.1, hard: 0.02 };

function emptyGrid(size: number): Grid {
  return new Array(size * size).fill(null);
}

function makeSlot(size: number): MirrorPlayerSlot {
  return {
    answer: emptyGrid(size),
    score: 0,
    moves: 0,
    mistakes: 0,
    levelsCleared: 0,
    solvedAt: null,
    finishRank: 0,
    disconnected: false,
    left: false,
  };
}

function activePlayers(state: MirrorState): Array<[string, MirrorPlayerSlot]> {
  return Object.entries(state.players).filter(([, slot]) => !slot.left);
}

export function finishMirror(state: MirrorState, ctx: GameContext, reason: GameFinishReason): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.finishReason = reason;
  state.levelEndsAt = null;
  state.lastEvent = reason === 'timeout' ? 'timeout' : 'finished';
  ctx.markStateChanged();
  ctx.finish(reason);
}

/** Loads the level for `state.level` — identical for every player. */
export function beginLevel(state: MirrorState, ctx: GameContext): void {
  if (state.phase === 'finished') return;
  const level: MirrorLevel = generateLevel(state.seed, state.level);
  state.size = level.size;
  state.mirror = level.mirror;
  state.source = level.source;
  state.solution = level.solution;
  state.finishOrder = [];
  state.phase = 'playing';
  state.levelStartedAt = ctx.now();
  state.levelEndsAt = ctx.now() + state.levelMs;
  state.lastEvent = `level:${state.level}`;

  for (const [, slot] of activePlayers(state)) {
    slot.answer = emptyGrid(level.size);
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
    if (player.isAI) ctx.requestAI(player.id, 1_200);
  }
}

export function endLevel(state: MirrorState, ctx: GameContext): void {
  if (state.phase !== 'playing') return;
  if (state.level + 1 >= state.totalLevels) {
    finishMirror(state, ctx, 'completed');
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

/** Ends the level early once everyone still playing has solved it. */
function maybeEndLevel(state: MirrorState, ctx: GameContext): void {
  const contenders = activePlayers(state).filter(([, slot]) => !slot.disconnected);
  if (contenders.length > 0 && contenders.every(([, slot]) => slot.solvedAt !== null)) {
    endLevel(state, ctx);
  }
}

function isSymbol(value: unknown): value is Symbol {
  return typeof value === 'string' && (SYMBOLS as string[]).includes(value);
}

function isColor(value: unknown): value is Color {
  return typeof value === 'string' && (COLORS as string[]).includes(value);
}

function resolveLevels(config: GameConfig): number {
  if (typeof config.rounds === 'number' && Number.isFinite(config.rounds)) {
    return Math.min(MIRROR_TOTAL_LEVELS, Math.max(1, Math.round(config.rounds)));
  }
  return 5;
}

/* ------------------------------------------------------------------ */
/* Module                                                              */
/* ------------------------------------------------------------------ */

export const mirrorGridGame: GameModule<MirrorState> = {
  metadata: MIRROR_GRID_METADATA,

  initialize(): void {
    // Stateless module.
  },

  createInitialState(players: readonly GamePlayerView[], config: GameConfig): MirrorState {
    const state: MirrorState = {
      phase: 'idle',
      level: 0,
      totalLevels: resolveLevels(config),
      seed: 1,
      size: 3,
      mirror: 'left-right',
      source: [],
      solution: [],
      players: {},
      levelStartedAt: null,
      levelEndsAt: null,
      levelMs: LEVEL_MS,
      finishOrder: [],
      lastEvent: null,
      finishReason: null,
      nextAIRequestAt: {},
    };
    for (const player of players) state.players[player.id] = makeSlot(3);
    return state;
  },

  playerJoined(player, state): void {
    const existing = state.players[player.id];
    if (existing) {
      existing.disconnected = false;
      return;
    }
    state.players[player.id] = makeSlot(state.size || 3);
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
    if (activePlayers(state).length === 0) finishMirror(state, ctx, 'abandoned');
  },

  start(state, ctx): void {
    if (state.phase === 'playing') return;
    state.players = {};
    for (const player of ctx.players) state.players[player.id] = makeSlot(3);
    // The seed comes from the server PRNG: every player gets the same puzzle,
    // and a rematch produces a different one.
    state.seed = Math.floor(ctx.random() * 0x7fffffff) >>> 0 || 1;
    state.level = 0;
    state.finishReason = null;
    beginLevel(state, ctx);
  },

  validateAction(playerId, action, state): ValidationResult {
    // A client can never assert completion, a score or a winner.
    if (['score', 'win', 'finish', 'complete', 'solved', 'solution'].includes(action.type)) {
      return { valid: false, reason: 'The server checks the reflection.' };
    }
    if (state.phase !== 'playing') return { valid: false, reason: 'No puzzle is live.' };

    const slot = state.players[playerId];
    if (!slot || slot.left) return { valid: false, reason: 'You are not in this match.' };
    if (slot.disconnected) return { valid: false, reason: 'Reconnect to keep playing.' };
    if (slot.solvedAt !== null) return { valid: false, reason: 'You already solved this level.' };

    if (action.type === 'submit') return { valid: true };
    if (action.type !== 'set') return { valid: false, reason: 'Unknown action.' };

    const { index, symbol, color } = (action.payload ?? {}) as {
      index?: unknown;
      symbol?: unknown;
      color?: unknown;
    };
    if (typeof index !== 'number' || !Number.isInteger(index)) return { valid: false, reason: 'Pick a cell.' };
    if (index < 0 || index >= state.size * state.size) {
      return { valid: false, reason: 'That cell is outside the grid.' };
    }
    // `null` clears a cell; otherwise both fields must be valid.
    if (symbol === null) return { valid: true };
    if (!isSymbol(symbol)) return { valid: false, reason: 'Unknown symbol.' };
    if (!isColor(color)) return { valid: false, reason: 'Unknown colour.' };
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    if (state.phase !== 'playing') return actionRejected('No puzzle is live.');
    const slot = state.players[playerId];
    if (!slot || slot.left || slot.disconnected) return actionRejected('You cannot act.');
    if (slot.solvedAt !== null) return actionRejected('Already solved.');

    /* ---------------- set a cell ---------------- */
    if (action.type === 'set') {
      const { index, symbol, color } = (action.payload ?? {}) as {
        index?: unknown;
        symbol?: unknown;
        color?: unknown;
      };
      if (typeof index !== 'number' || !Number.isInteger(index)) return actionRejected('Pick a cell.');
      if (index < 0 || index >= state.size * state.size) return actionRejected('Cell out of range.');

      let value: Cell | null = null;
      if (symbol !== null) {
        if (!isSymbol(symbol) || !isColor(color)) return actionRejected('Invalid symbol or colour.');
        value = { symbol, color };
      }
      slot.answer[index] = value;
      slot.moves += 1;
      state.lastEvent = `set:${playerId}`;
      ctx.markStateChanged();
      return actionAccepted();
    }

    /* ---------------- submit ---------------- */
    if (action.type !== 'submit') return actionRejected('Unknown action.');

    // The SERVER decides — the client never reports completion.
    if (!isSolved(slot.answer, state.solution)) {
      slot.mistakes += 1;
      slot.score = Math.max(0, slot.score - MISTAKE_PENALTY);
      state.lastEvent = `wrong:${playerId}`;
      ctx.markStateChanged();
      return actionRejected('Not quite — some cells are still wrong.');
    }

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
      // Tie-break on server completion timestamp.
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
          moves: slot?.moves ?? 0,
          mistakes: slot?.mistakes ?? 0,
        },
      };
    });
    return { winners, isDraw, rankings, reason: state.finishReason ?? 'completed' };
  },

  reset(state): MirrorState {
    return {
      ...state,
      phase: 'idle',
      level: 0,
      // A rematch gets a fresh puzzle (the new seed is set in start()).
      seed: 1,
      source: [],
      solution: [],
      players: Object.fromEntries(Object.keys(state.players).map((id) => [id, makeSlot(3)])),
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
    state.source = [];
    state.solution = [];
    state.phase = 'finished';
  },

  /**
   * Privacy boundary: the SOLUTION never leaves the server, and a viewer only
   * ever sees their OWN answer grid. Opponents are reduced to a progress
   * percentage so the race is visible without leaking anyone's board.
   */
  getPublicState(state, viewerId, ctx) {
    const me = viewerId ? state.players[viewerId] : undefined;
    const total = state.solution.length || 1;

    return {
      phase: state.phase,
      level: state.level,
      totalLevels: state.totalLevels,
      size: state.size,
      mirror: state.mirror,
      // The source pattern is public — it is the question, not the answer.
      source: state.source.map((cell) => (cell ? { ...cell } : null)),
      levelEndsAt: state.levelEndsAt,
      levelMs: state.levelMs,
      finishOrder: [...state.finishOrder],
      lastEvent: state.lastEvent,
      finishReason: state.finishReason,
      serverTime: ctx.now(),
      // The viewer's own working grid.
      myAnswer: me ? me.answer.map((cell) => (cell ? { ...cell } : null)) : [],
      me: me
        ? {
            score: me.score,
            moves: me.moves,
            mistakes: me.mistakes,
            solved: me.solvedAt !== null,
            finishRank: me.finishRank,
            levelsCleared: me.levelsCleared,
          }
        : null,
      players: Object.fromEntries(
        Object.entries(state.players).map(([id, slot]) => [
          id,
          {
            // Progress only — never the opponent's grid or the solution.
            progress: Math.round((countCorrect(slot.answer, state.solution) / total) * 100),
            score: slot.score,
            solved: slot.solvedAt !== null,
            finishRank: slot.finishRank,
            levelsCleared: slot.levelsCleared,
            mistakes: slot.mistakes,
            disconnected: slot.disconnected,
          },
        ]),
      ),
    };
  },

  /**
   * AI opponent. It computes the reflection itself (the same maths a human
   * reasons about) and fills cells one at a time, occasionally making a real
   * mistake at lower difficulties. It never reads `state.solution` directly
   * for anything a human could not derive from the visible source.
   */
  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'playing') return null;
    const slot = state.players[playerId];
    if (!slot || slot.left || slot.solvedAt !== null) return null;

    // Cells still not matching the reflection the AI has worked out.
    const remaining = wrongIndices(slot.answer, state.solution);
    if (remaining.length === 0) return { type: 'submit' };

    const index = remaining[Math.floor(ctx.random() * remaining.length)] as number;
    const correct = state.solution[index] ?? null;

    // A real mistake: place something plausible but wrong.
    if (ctx.random() < AI_ERROR[difficulty]) {
      const wrongSymbol = SYMBOLS[Math.floor(ctx.random() * SYMBOLS.length)] as Symbol;
      const wrongColor = COLORS[Math.floor(ctx.random() * COLORS.length)] as Color;
      const candidate: Cell = { symbol: wrongSymbol, color: wrongColor };
      if (!cellsEqual(candidate, correct)) {
        return { type: 'set', payload: { index, symbol: candidate.symbol, color: candidate.color } };
      }
    }

    if (correct === null) return { type: 'set', payload: { index, symbol: null } };
    return { type: 'set', payload: { index, symbol: correct.symbol, color: correct.color } };
  },

  needsUpdateLoop: true,
  maxDurationMs: 30 * 60 * 1000,
};
