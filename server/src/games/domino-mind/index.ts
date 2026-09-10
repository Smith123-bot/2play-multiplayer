import type { AIDifficulty, GameAction, GameConfig, GameFinishReason } from '@2play/shared';
import { DOMINO_MIND_METADATA } from '@2play/shared';
export { DOMINO_MIND_METADATA };
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
  DOMINO_TOTAL_LEVELS,
  FACINGS,
  clonePieces,
  inBounds,
  levelAt,
  pieceAt,
  simulate,
  startPieceOf,
  type DominoLevel,
  type Facing,
  type Piece,
  type SimulationResult,
} from './simulation';

export * from './simulation';

/**
 * Domino Mind — versus chain-reaction puzzle race.
 *
 * Every player gets the SAME level and builds their own private layout. The
 * chain reaction is a deterministic 2D simulation run ON THE SERVER: the same
 * board always produces the same cascade, and changing the layout changes the
 * result. Nothing is pre-recorded and the client never decides success.
 */

export type DominoMindPhase = 'idle' | 'playing' | 'level-clear' | 'finished';

export interface DominoMindPlayerSlot {
  /** This player's private working layout for the current level. */
  pieces: Piece[];
  /** How many dominoes they have placed (bounded by the level budget). */
  placed: number;
  score: number;
  moves: number;
  attempts: number;
  levelsCleared: number;
  triggered: number;
  solvedAt: number | null;
  finishRank: number;
  /** The most recent simulation, for replay on the client. */
  lastRun: SimulationResult | null;
  disconnected: boolean;
  left: boolean;
}

export interface DominoMindState {
  phase: DominoMindPhase;
  level: number;
  totalLevels: number;
  levelName: string;
  hint: string;
  cols: number;
  rows: number;
  reach: number;
  budget: number;
  requiredTargets: string[];
  forbidden: string[];
  players: Record<string, DominoMindPlayerSlot>;
  levelStartedAt: number | null;
  levelEndsAt: number | null;
  levelMs: number;
  finishOrder: string[];
  lastEvent: string | null;
  finishReason: GameFinishReason | null;
  nextAIRequestAt: Record<string, number>;
}

export const LEVEL_CLEAR_SCORE = 250;
export const SPEED_BONUS_MAX = 150;
export const PLACE_BONUS = [120, 70, 40, 20];
export const ATTEMPT_PENALTY = 15;
export const BREAK_MS = 3_500;

const AI_INTERVAL: Record<AIDifficulty, number> = { easy: 2_600, medium: 1_600, hard: 900 };

function makeSlot(level: DominoLevel): DominoMindPlayerSlot {
  return {
    pieces: clonePieces(level),
    placed: 0,
    score: 0,
    moves: 0,
    attempts: 0,
    levelsCleared: 0,
    triggered: 0,
    solvedAt: null,
    finishRank: 0,
    lastRun: null,
    disconnected: false,
    left: false,
  };
}

function activePlayers(state: DominoMindState): Array<[string, DominoMindPlayerSlot]> {
  return Object.entries(state.players).filter(([, slot]) => !slot.left);
}

function isFacing(value: unknown): value is Facing {
  return typeof value === 'string' && (FACINGS as string[]).includes(value);
}

export function finishDominoMind(
  state: DominoMindState,
  ctx: GameContext,
  reason: GameFinishReason,
): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.finishReason = reason;
  state.levelEndsAt = null;
  state.lastEvent = reason === 'timeout' ? 'timeout' : 'finished';
  ctx.markStateChanged();
  ctx.finish(reason);
}

export function beginLevel(state: DominoMindState, ctx: GameContext): void {
  if (state.phase === 'finished') return;
  const level = levelAt(state.level);
  state.levelName = level.name;
  state.hint = level.hint;
  state.cols = level.cols;
  state.rows = level.rows;
  state.reach = level.reach;
  state.budget = level.budget;
  state.requiredTargets = [...level.requiredTargets];
  state.forbidden = [...level.forbidden];
  state.levelMs = level.timeLimit * 1000;
  state.finishOrder = [];
  state.phase = 'playing';
  state.levelStartedAt = ctx.now();
  state.levelEndsAt = ctx.now() + state.levelMs;
  state.lastEvent = `level:${state.level}`;

  for (const [, slot] of activePlayers(state)) {
    slot.pieces = clonePieces(level);
    slot.placed = 0;
    slot.solvedAt = null;
    slot.finishRank = 0;
    slot.lastRun = null;
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
    if (player.isAI) ctx.requestAI(player.id, 1_400);
  }
}

export function endLevel(state: DominoMindState, ctx: GameContext): void {
  if (state.phase !== 'playing') return;
  if (state.level + 1 >= state.totalLevels) {
    finishDominoMind(state, ctx, 'completed');
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

function maybeEndLevel(state: DominoMindState, ctx: GameContext): void {
  const contenders = activePlayers(state).filter(([, slot]) => !slot.disconnected);
  if (contenders.length > 0 && contenders.every(([, slot]) => slot.solvedAt !== null)) {
    endLevel(state, ctx);
  }
}

function resolveLevels(config: GameConfig): number {
  if (typeof config.rounds === 'number' && Number.isFinite(config.rounds)) {
    return Math.min(DOMINO_TOTAL_LEVELS, Math.max(1, Math.round(config.rounds)));
  }
  return 5;
}

export const dominoMindGame: GameModule<DominoMindState> = {
  metadata: DOMINO_MIND_METADATA,

  initialize(): void {
    // Stateless module.
  },

  createInitialState(players: readonly GamePlayerView[], config: GameConfig): DominoMindState {
    const first = levelAt(0);
    const state: DominoMindState = {
      phase: 'idle',
      level: 0,
      totalLevels: resolveLevels(config),
      levelName: '',
      hint: '',
      cols: first.cols,
      rows: first.rows,
      reach: first.reach,
      budget: first.budget,
      requiredTargets: [],
      forbidden: [],
      players: {},
      levelStartedAt: null,
      levelEndsAt: null,
      levelMs: first.timeLimit * 1000,
      finishOrder: [],
      lastEvent: null,
      finishReason: null,
      nextAIRequestAt: {},
    };
    for (const player of players) state.players[player.id] = makeSlot(first);
    return state;
  },

  playerJoined(player, state): void {
    const existing = state.players[player.id];
    if (existing) {
      existing.disconnected = false;
      return;
    }
    state.players[player.id] = makeSlot(levelAt(state.level));
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
    if (activePlayers(state).length === 0) finishDominoMind(state, ctx, 'abandoned');
  },

  start(state, ctx): void {
    if (state.phase === 'playing') return;
    const first = levelAt(0);
    state.players = {};
    for (const player of ctx.players) state.players[player.id] = makeSlot(first);
    state.level = 0;
    state.finishReason = null;
    beginLevel(state, ctx);
  },

  validateAction(playerId, action, state): ValidationResult {
    if (['score', 'win', 'finish', 'complete', 'solved', 'chain'].includes(action.type)) {
      return { valid: false, reason: 'The server runs the chain reaction.' };
    }
    if (state.phase !== 'playing') return { valid: false, reason: 'No puzzle is live.' };

    const slot = state.players[playerId];
    if (!slot || slot.left) return { valid: false, reason: 'You are not in this match.' };
    if (slot.disconnected) return { valid: false, reason: 'Reconnect to keep playing.' };
    if (slot.solvedAt !== null) return { valid: false, reason: 'You already solved this level.' };

    if (action.type === 'push') return { valid: true };

    if (action.type === 'place') {
      const { x, y, facing } = (action.payload ?? {}) as { x?: unknown; y?: unknown; facing?: unknown };
      if (typeof x !== 'number' || typeof y !== 'number' || !Number.isInteger(x) || !Number.isInteger(y)) {
        return { valid: false, reason: 'Pick a cell.' };
      }
      if (!inBounds(state, x, y)) return { valid: false, reason: 'That cell is off the board.' };
      if (!isFacing(facing)) return { valid: false, reason: 'Choose a direction.' };
      if (pieceAt(slot.pieces, x, y)) return { valid: false, reason: 'That cell is already occupied.' };
      // The placement budget is enforced server-side.
      if (slot.placed >= state.budget) return { valid: false, reason: 'You have used all your dominoes.' };
      return { valid: true };
    }

    if (action.type === 'rotate' || action.type === 'remove') {
      const pieceId = action.payload?.pieceId;
      if (typeof pieceId !== 'string') return { valid: false, reason: 'Pick a domino.' };
      const piece = slot.pieces.find((entry) => entry.id === pieceId);
      if (!piece) return { valid: false, reason: 'No such domino.' };
      // Only the player's own placed dominoes may be altered.
      if (!piece.id.startsWith('p')) return { valid: false, reason: 'That piece is fixed in place.' };
      return { valid: true };
    }

    return { valid: false, reason: 'Unknown action.' };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    if (state.phase !== 'playing') return actionRejected('No puzzle is live.');
    const slot = state.players[playerId];
    if (!slot || slot.left || slot.disconnected) return actionRejected('You cannot act.');
    if (slot.solvedAt !== null) return actionRejected('Already solved.');

    /* ---------------- place ---------------- */
    if (action.type === 'place') {
      const { x, y, facing } = (action.payload ?? {}) as { x?: unknown; y?: unknown; facing?: unknown };
      if (typeof x !== 'number' || typeof y !== 'number' || !Number.isInteger(x) || !Number.isInteger(y)) {
        return actionRejected('Pick a cell.');
      }
      if (!inBounds(state, x, y)) return actionRejected('Off the board.');
      if (!isFacing(facing)) return actionRejected('Choose a direction.');
      if (pieceAt(slot.pieces, x, y)) return actionRejected('That cell is occupied.');
      if (slot.placed >= state.budget) return actionRejected('No dominoes left to place.');

      slot.placed += 1;
      slot.moves += 1;
      slot.pieces.push({
        id: `p${slot.placed}`,
        x,
        y,
        facing,
        kind: 'domino',
        fallen: false,
        fallOrder: -1,
      });
      state.lastEvent = `place:${playerId}`;
      ctx.markStateChanged();
      return actionAccepted();
    }

    /* ---------------- rotate ---------------- */
    if (action.type === 'rotate') {
      const pieceId = action.payload?.pieceId;
      if (typeof pieceId !== 'string') return actionRejected('Pick a domino.');
      const piece = slot.pieces.find((entry) => entry.id === pieceId);
      if (!piece) return actionRejected('No such domino.');
      if (!piece.id.startsWith('p')) return actionRejected('That piece is fixed.');
      const index = FACINGS.indexOf(piece.facing);
      piece.facing = FACINGS[(index + 1) % FACINGS.length] as Facing;
      slot.moves += 1;
      state.lastEvent = `rotate:${playerId}`;
      ctx.markStateChanged();
      return actionAccepted();
    }

    /* ---------------- remove ---------------- */
    if (action.type === 'remove') {
      const pieceId = action.payload?.pieceId;
      if (typeof pieceId !== 'string') return actionRejected('Pick a domino.');
      const index = slot.pieces.findIndex((entry) => entry.id === pieceId);
      if (index < 0) return actionRejected('No such domino.');
      const piece = slot.pieces[index] as Piece;
      if (!piece.id.startsWith('p')) return actionRejected('That piece is fixed.');
      slot.pieces.splice(index, 1);
      slot.placed = Math.max(0, slot.placed - 1);
      slot.moves += 1;
      state.lastEvent = `remove:${playerId}`;
      ctx.markStateChanged();
      return actionAccepted();
    }

    /* ---------------- push (run the chain) ---------------- */
    if (action.type !== 'push') return actionRejected('Unknown action.');

    // Only the level's designated start piece may be pushed — otherwise the
    // puzzle would be trivially solvable by pushing the target directly.
    const start = startPieceOf(slot.pieces);
    if (!start) return actionRejected('There is no start domino on this board.');

    slot.attempts += 1;
    const { result } = simulate(
      slot.pieces,
      state,
      state.reach,
      start.id,
      state.requiredTargets,
      state.forbidden,
    );
    slot.lastRun = result;
    slot.triggered = Math.max(slot.triggered, result.triggered);

    if (!result.success) {
      slot.score = Math.max(0, slot.score - ATTEMPT_PENALTY);
      state.lastEvent = `failed:${playerId}`;
      ctx.markStateChanged();
      // A failed attempt is not fatal: the player may adjust and try again.
      return actionAccepted();
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
          attempts: slot?.attempts ?? 0,
          triggered: slot?.triggered ?? 0,
        },
      };
    });
    return { winners, isDraw, rankings, reason: state.finishReason ?? 'completed' };
  },

  reset(state): DominoMindState {
    const first = levelAt(0);
    return {
      ...state,
      phase: 'idle',
      level: 0,
      players: Object.fromEntries(Object.keys(state.players).map((id) => [id, makeSlot(first)])),
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

  /** A viewer sees only their own layout; opponents are progress only. */
  getPublicState(state, viewerId, ctx) {
    const me = viewerId ? state.players[viewerId] : undefined;
    const targetsTotal = Math.max(1, state.requiredTargets.length);

    return {
      phase: state.phase,
      level: state.level,
      totalLevels: state.totalLevels,
      levelName: state.levelName,
      hint: state.hint,
      cols: state.cols,
      rows: state.rows,
      reach: state.reach,
      budget: state.budget,
      requiredTargets: [...state.requiredTargets],
      forbidden: [...state.forbidden],
      levelEndsAt: state.levelEndsAt,
      finishOrder: [...state.finishOrder],
      lastEvent: state.lastEvent,
      finishReason: state.finishReason,
      serverTime: ctx.now(),
      // The viewer's own layout plus their last simulated cascade.
      pieces: me ? me.pieces.map((piece) => ({ ...piece })) : [],
      placed: me?.placed ?? 0,
      lastRun: me?.lastRun ? { ...me.lastRun } : null,
      me: me
        ? {
            score: me.score,
            moves: me.moves,
            attempts: me.attempts,
            solved: me.solvedAt !== null,
            finishRank: me.finishRank,
            levelsCleared: me.levelsCleared,
          }
        : null,
      players: Object.fromEntries(
        Object.entries(state.players).map(([id, slot]) => [
          id,
          {
            // Progress = fraction of required targets hit on the last attempt.
            progress: slot.lastRun
              ? Math.round(
                  ((targetsTotal - slot.lastRun.missingTargets.length) / targetsTotal) * 100,
                )
              : 0,
            score: slot.score,
            attempts: slot.attempts,
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
   * AI opponent. It searches placements the same way a player reasons: try a
   * candidate cell and facing, run the deterministic simulation, and keep the
   * layout that gets closest to the target. It never inspects a hidden answer
   * because there is none — the simulation is the answer.
   */
  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'playing') return null;
    const slot = state.players[playerId];
    if (!slot || slot.left || slot.solvedAt !== null) return null;

    const start = startPieceOf(slot.pieces);
    if (!start) return null;

    const run = (pieces: Piece[]) =>
      simulate(pieces, state, state.reach, start.id, state.requiredTargets, state.forbidden).result;

    // If the current layout already works, push it.
    if (run(slot.pieces).success) return { type: 'push' };

    // Out of budget: push anyway so the attempt is recorded (and scored).
    if (slot.placed >= state.budget) return { type: 'push' };

    // Try every free cell and facing, keep the best improvement.
    const free: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < state.rows; y += 1) {
      for (let x = 0; x < state.cols; x += 1) {
        if (!pieceAt(slot.pieces, x, y)) free.push({ x, y });
      }
    }

    const baseline = run(slot.pieces);
    let best: { x: number; y: number; facing: Facing; score: number } | null = null;

    for (const cell of free) {
      for (const facing of FACINGS) {
        const candidate: Piece[] = [
          ...slot.pieces.map((piece) => ({ ...piece })),
          {
            id: `probe`,
            x: cell.x,
            y: cell.y,
            facing,
            kind: 'domino' as const,
            fallen: false,
            fallOrder: -1,
          },
        ];
        const result = run(candidate);
        // Prefer: outright success, then fewer missing targets, then no
        // forbidden hits, then a longer cascade.
        const score =
          (result.success ? 1_000_000 : 0) +
          (state.requiredTargets.length - result.missingTargets.length) * 1_000 -
          result.hitForbidden.length * 5_000 +
          result.triggered;
        if (!best || score > best.score) best = { x: cell.x, y: cell.y, facing, score };
      }
    }

    const baselineScore =
      (state.requiredTargets.length - baseline.missingTargets.length) * 1_000 -
      baseline.hitForbidden.length * 5_000 +
      baseline.triggered;

    // Weaker bots sometimes place a poor domino instead of the best one.
    const sloppy = difficulty === 'easy' ? 0.45 : difficulty === 'medium' ? 0.18 : 0;
    if (best && ctx.random() < sloppy && free.length > 0) {
      const cell = free[Math.floor(ctx.random() * free.length)] as { x: number; y: number };
      const facing = FACINGS[Math.floor(ctx.random() * FACINGS.length)] as Facing;
      return { type: 'place', payload: { x: cell.x, y: cell.y, facing } };
    }

    if (best && best.score > baselineScore) {
      return { type: 'place', payload: { x: best.x, y: best.y, facing: best.facing } };
    }
    return { type: 'push' };
  },

  needsUpdateLoop: true,
  maxDurationMs: 30 * 60 * 1000,
};
