import type { AIDifficulty, GameAction, GameConfig, GameFinishReason } from '@2play/shared';
import {
  OPTION_COUNT,
  SHAPE_COLORS,
  SHAPE_FORMS,
  SHAPE_MATCH_METADATA,
  type ShapeDescriptor,
} from '@2play/shared';
export { SHAPE_MATCH_METADATA };
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
 * Shape Match Battle — fast visual matching rounds.
 *
 * Each round the server generates a target shape plus four options (exactly
 * one correct) and never tells the client which one it is: clients send only
 * an option id, the server validates. One selection per player per round.
 */

export type ShapePhase = 'idle' | 'round' | 'reveal' | 'finished';

export interface ShapeOption {
  id: string;
  shape: ShapeDescriptor;
}

export interface ShapeSelection {
  optionId: string;
  correct: boolean;
  elapsedMs: number;
  points: number;
}

export interface ShapeRound {
  number: number;
  target: ShapeDescriptor;
  options: ShapeOption[];
  /** HIDDEN until the reveal phase. */
  correctOptionId: string;
  startedAt: number;
  endsAt: number;
  selections: Record<string, ShapeSelection>;
}

export interface ShapeMatchState {
  phase: ShapePhase;
  round: number;
  totalRounds: number;
  roundMs: number;
  current: ShapeRound | null;
  /** Completed rounds — their answers are already revealed. */
  history: Array<{ number: number; correctOptionId: string; selections: Record<string, ShapeSelection> }>;
  scores: Record<string, number>;
  correctCount: Record<string, number>;
  startedAt: number | null;
  finishReason: GameFinishReason | null;
  lastEvent: string | null;
}

const DEFAULT_ROUNDS = 10;
const MIN_ROUNDS = 3;
const MAX_ROUNDS = 15;
const ROUND_MS = 10 * 1000;
const REVEAL_MS = 2000;

/** AI reaction pacing and accuracy per difficulty. */
const AI_PICK_DELAY: Record<AIDifficulty, number> = { easy: 3400, medium: 1700, hard: 650 };
const AI_PICK_JITTER: Record<AIDifficulty, number> = { easy: 2400, medium: 1400, hard: 750 };
const AI_ACCURACY: Record<AIDifficulty, number> = { easy: 0.6, medium: 0.85, hard: 0.97 };

function roundsFor(requested?: number): number {
  if (typeof requested === 'number' && Number.isFinite(requested)) {
    return Math.min(MAX_ROUNDS, Math.max(MIN_ROUNDS, Math.round(requested)));
  }
  return DEFAULT_ROUNDS;
}

/** All shape descriptors (form × colour) — the option universe. */
const SHAPE_UNIVERSE: ShapeDescriptor[] = SHAPE_FORMS.flatMap((form) =>
  SHAPE_COLORS.map((color) => ({ form, color })),
);

function activePlayerIds(ctx: GameContext): string[] {
  return ctx.players.filter((player) => player.isAI || player.isConnected).map((player) => player.id);
}

/** Builds one round: a target, the correct option and three distractors. */
export function buildRoundOptions(rng: () => number): {
  target: ShapeDescriptor;
  options: ShapeOption[];
  correctOptionId: string;
} {
  const pool = [...SHAPE_UNIVERSE];
  const pick = (): ShapeDescriptor => {
    const index = Math.floor(rng() * pool.length);
    const [shape] = pool.splice(index, 1);
    return shape!;
  };

  const target = pick();
  const distractors = Array.from({ length: OPTION_COUNT - 1 }, () => pick());

  const shapes = [target, ...distractors];
  // Shuffle the option order so the answer position is unpredictable.
  for (let i = shapes.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [shapes[i], shapes[j]] = [shapes[j]!, shapes[i]!];
  }
  const correctIndex = shapes.indexOf(target);
  const options: ShapeOption[] = shapes.map((shape, index) => ({
    id: `shape-${index}`,
    shape,
  }));
  return { target, options, correctOptionId: options[correctIndex]!.id };
}

/** Begins a fresh round. Exported for tests. */
export function beginShapeRound(state: ShapeMatchState, ctx: GameContext): void {
  const rng = ctx.random;
  const { target, options, correctOptionId } = buildRoundOptions(rng);
  const now = ctx.now();

  state.current = {
    number: state.round,
    target,
    options,
    correctOptionId,
    startedAt: now,
    endsAt: now + state.roundMs,
    selections: {},
  };
  state.phase = 'round';
  state.lastEvent = 'round-start';
  ctx.markStateChanged();

  ctx.schedule(
    state.roundMs,
    () => {
      if (state.phase !== 'round' || state.current?.number !== state.round) return;
      completeShapeRound(state, ctx);
    },
    'turn',
    'round-timeout',
  );

  for (const player of ctx.players) {
    if (!player.isAI) continue;
    const difficulty = player.aiDifficulty ?? 'medium';
    const delay = AI_PICK_DELAY[difficulty] + Math.floor(rng() * AI_PICK_JITTER[difficulty]);
    ctx.requestAI(player.id, delay);
  }
}

/** Ends the current round and reveals the answer. Exported for tests. */
export function completeShapeRound(state: ShapeMatchState, ctx: GameContext): void {
  if (state.phase !== 'round' || !state.current) return;
  state.history.push({
    number: state.current.number,
    correctOptionId: state.current.correctOptionId,
    selections: { ...state.current.selections },
  });
  state.phase = 'reveal';
  state.lastEvent = 'reveal';
  ctx.markStateChanged();

  ctx.schedule(
    REVEAL_MS,
    () => {
      if (state.phase !== 'reveal') return;
      beginNextShapeRound(state, ctx);
    },
    'turn',
    'reveal',
  );
}

/** Moves to the next round or finishes the match. Exported for tests. */
export function beginNextShapeRound(state: ShapeMatchState, ctx: GameContext): void {
  if (state.phase !== 'reveal') return;
  if (state.round >= state.totalRounds) {
    state.phase = 'finished';
    state.finishReason ??= 'completed';
    state.lastEvent = 'finished';
    ctx.markStateChanged();
    ctx.finish('completed');
    return;
  }
  state.round += 1;
  beginShapeRound(state, ctx);
}

/** Timer callback: the overall match cap. Exported for tests. */
export function finishShapeOnTimeout(state: ShapeMatchState, ctx: GameContext): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.finishReason = 'timeout';
  state.lastEvent = 'timeout';
  ctx.markStateChanged();
  ctx.finish('timeout');
}

export const shapeMatchGame: GameModule<ShapeMatchState> = {
  metadata: SHAPE_MATCH_METADATA,

  initialize(_config: GameConfig): void {
    // Stateless module.
  },

  createInitialState(players, config): ShapeMatchState {
    return {
      phase: 'idle',
      round: 0,
      totalRounds: roundsFor(config.rounds),
      roundMs: ROUND_MS,
      current: null,
      history: [],
      scores: Object.fromEntries(players.map((player) => [player.id, 0])),
      correctCount: Object.fromEntries(players.map((player) => [player.id, 0])),
      startedAt: null,
      finishReason: null,
      lastEvent: null,
    };
  },

  playerJoined(player, state): void {
    if (state.scores[player.id] === undefined) state.scores[player.id] = 0;
    if (state.correctCount[player.id] === undefined) state.correctCount[player.id] = 0;
  },

  playerReady(): void {
    // No per-player readiness behaviour.
  },

  playerLeft(playerId, state, ctx, reason): void {
    if (reason === 'disconnect') return; // Grace period keeps the seat.
    if (state.phase === 'round' && state.current) {
      const remaining = activePlayerIds(ctx).filter((id) => id !== playerId);
      const allPicked = remaining.every((id) => state.current?.selections[id] !== undefined);
      if (remaining.length > 0 && allPicked) completeShapeRound(state, ctx);
    }
    if (state.phase !== 'finished' && activePlayerIds(ctx).filter((id) => id !== playerId).length === 0) {
      finishShapeOnTimeout(state, ctx);
    }
  },

  start(state, ctx): void {
    if (state.phase !== 'idle') return;
    for (const player of ctx.players) {
      if (state.scores[player.id] === undefined) state.scores[player.id] = 0;
      if (state.correctCount[player.id] === undefined) state.correctCount[player.id] = 0;
    }
    state.round = 1;
    state.startedAt = ctx.now();
    state.finishReason = null;

    const worstCaseMs = state.totalRounds * (state.roundMs + REVEAL_MS) + 5000;
    ctx.schedule(
      worstCaseMs,
      () => finishShapeOnTimeout(state, ctx),
      'gameDuration',
      'match-timeout',
    );

    beginShapeRound(state, ctx);
  },

  validateAction(playerId, action, state): ValidationResult {
    if (action.type !== 'select') return { valid: false, reason: 'Unknown action.' };
    if (state.phase !== 'round') return { valid: false, reason: 'Nothing to pick right now.' };
    const optionId = action.payload?.optionId;
    if (typeof optionId !== 'string' || state.current?.options.every((option) => option.id !== optionId)) {
      return { valid: false, reason: 'That option does not exist.' };
    }
    if (state.current?.selections[playerId] !== undefined) {
      return { valid: false, reason: 'You already picked this round.' };
    }
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    if (action.type !== 'select') return actionRejected('Unknown action.');
    const round = state.current;
    if (!round || state.phase !== 'round') return actionRejected('Nothing to pick right now.');
    const optionId = action.payload?.optionId;
    const option = round.options.find((candidate) => candidate.id === optionId);
    if (!option) return actionRejected('That option does not exist.');
    if (round.selections[playerId] !== undefined) {
      return actionRejected('You already picked this round.');
    }

    const elapsed = ctx.now() - round.startedAt;
    const correct = option.id === round.correctOptionId;
    const points = correct ? (elapsed <= state.roundMs / 2 ? 2 : 1) : 0;

    round.selections[playerId] = { optionId: option.id, correct, elapsedMs: elapsed, points };
    if (correct) {
      state.scores[playerId] = (state.scores[playerId] ?? 0) + points;
      state.correctCount[playerId] = (state.correctCount[playerId] ?? 0) + 1;
      state.lastEvent = `correct:${playerId}`;
    } else {
      state.lastEvent = `wrong:${playerId}`;
    }
    ctx.markStateChanged();

    const remaining = activePlayerIds(ctx).filter((id) => round.selections[id] === undefined);
    if (remaining.length === 0) completeShapeRound(state, ctx);

    return actionAccepted();
  },

  update(): void {
    // Round timers drive everything — no simulation loop.
  },

  tick(): void {
    // Timer driven.
  },

  calculateScore(playerId, state): number {
    return state.scores[playerId] ?? 0;
  },

  checkWinCondition(state): string[] | null {
    if (state.phase !== 'finished') return null;
    const entries = Object.entries(state.scores);
    if (entries.length === 0) return null;
    const best = Math.max(...entries.map(([, value]) => value));
    return entries.filter(([, value]) => value === best).map(([id]) => id);
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
    const ranked = [...ctx.players].sort((a, b) => {
      const diff = (state.scores[b.id] ?? 0) - (state.scores[a.id] ?? 0);
      if (diff !== 0) return diff;
      return (state.correctCount[a.id] ?? 0) - (state.correctCount[b.id] ?? 0);
    });
    const topScore = state.scores[ranked[0]?.id ?? ''] ?? 0;
    const winners = ranked
      .filter((player) => (state.scores[player.id] ?? 0) === topScore)
      .map((player) => player.id);

    const rankings: RankingDraft[] = ranked.map((player) => {
      const score = state.scores[player.id] ?? 0;
      const rank = ranked.filter((other) => (state.scores[other.id] ?? 0) > score).length + 1;
      return {
        playerId: player.id,
        rank,
        score,
        isWinner: winners.includes(player.id),
        isDraw: winners.length > 1,
        stats: {
          correct: state.correctCount[player.id] ?? 0,
          rounds: state.totalRounds,
        },
      };
    });

    return {
      winners,
      isDraw: winners.length > 1,
      rankings,
      reason: state.finishReason ?? 'completed',
    };
  },

  reset(state): ShapeMatchState {
    return {
      ...state,
      phase: 'idle',
      round: 0,
      current: null,
      history: [],
      scores: Object.fromEntries(Object.keys(state.scores).map((id) => [id, 0])),
      correctCount: Object.fromEntries(Object.keys(state.correctCount).map((id) => [id, 0])),
      startedAt: null,
      finishReason: null,
      lastEvent: null,
    };
  },

  cleanup(state): void {
    state.current = null;
    state.history = [];
    state.phase = 'finished';
  },

  /**
   * CRITICAL privacy boundary: the target and the option shapes are public,
   * but which option is correct is NOT — it is exposed only during the reveal
   * phase (and for past rounds in history). Selections are exposed as pure
   * option ids; per-selection correctness is hidden until the reveal too.
   */
  getPublicState(state, viewerId, ctx) {
    const current = state.current;
    const reveal = state.phase === 'reveal';
    return {
      phase: state.phase,
      round: state.round,
      totalRounds: state.totalRounds,
      roundMs: state.roundMs,
      target: current ? { ...current.target } : null,
      options: current ? current.options.map((option) => ({ id: option.id, shape: option.shape })) : [],
      endsAt: current?.endsAt ?? null,
      picked: current
        ? Object.fromEntries(Object.entries(current.selections).map(([id, sel]) => [id, sel.optionId]))
        : {},
      mySelection:
        viewerId && current && current.selections[viewerId]
          ? { ...current.selections[viewerId]! }
          : null,
      correctOptionId: reveal ? (current?.correctOptionId ?? null) : null,
      scores: { ...state.scores },
      correctCount: { ...state.correctCount },
      history: state.history.map((entry) => ({
        number: entry.number,
        correctOptionId: entry.correctOptionId,
        picks: Object.fromEntries(
          Object.entries(entry.selections).map(([id, sel]) => [id, sel.optionId]),
        ),
      })),
      finishReason: state.finishReason,
      lastEvent: state.lastEvent,
      serverTime: ctx.now(),
    };
  },

  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'round' || !state.current) return null;
    const round = state.current;
    if (round.selections[playerId] !== undefined) return null;

    const rng = ctx.random;
    if (rng() < AI_ACCURACY[difficulty]) {
      return { type: 'select', payload: { optionId: round.correctOptionId } };
    }
    const wrong = round.options.filter((option) => option.id !== round.correctOptionId);
    const pick = wrong[Math.floor(rng() * wrong.length)]!;
    return { type: 'select', payload: { optionId: pick.id } };
  },

  maxDurationMs: 10 * 60 * 1000,
};
