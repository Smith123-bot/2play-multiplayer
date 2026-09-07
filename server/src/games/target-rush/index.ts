import type { AIDifficulty, GameAction, GameConfig, GameFinishReason } from '@2play/shared';
import { TARGET_RUSH_METADATA } from '@2play/shared';
export { TARGET_RUSH_METADATA };
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
 * Target Rush — duel of quick eyes.
 *
 * Each round the server picks a prompt symbol and spawns three targets (one
 * matching, two decoys) at non-overlapping cells. Which target is correct
 * NEVER leaves the server before the reveal; clients send only
 * `{ type: 'hit', targetId }` and the server decides validity, points, combo
 * and round outcomes. All timing uses ctx.now() / TimerManager.
 */

export type TargetRushPhase = 'idle' | 'round' | 'reveal' | 'finished';

export interface RushTarget {
  id: string;
  symbol: string;
  x: number; // 0..3 grid cell
  y: number; // 0..2 grid cell
}

export interface RushRound {
  number: number;
  prompt: string;
  targets: RushTarget[];
  /** HIDDEN until the reveal phase. */
  correctId: string;
  spawnedAt: number;
  endsAt: number;
  /** Player ids that already tapped (correct or wrong) this round. */
  tapped: Record<string, boolean>;
}

export interface TargetRushState {
  phase: TargetRushPhase;
  round: number;
  totalRounds: number;
  roundMs: number;
  revealMs: number;
  current: RushRound | null;
  history: Array<{ number: number; prompt: string; correctId: string; winner: string | null }>;
  scores: Record<string, number>;
  hits: Record<string, number>;
  wrongs: Record<string, number>;
  streaks: Record<string, number>;
  bestStreak: Record<string, number>;
  lockUntil: Record<string, number>;
  /** Players who actually left (disconnects keep the seat). */
  departed: Record<string, boolean>;
  startedAt: number | null;
  finishReason: GameFinishReason | null;
  lastEvent: string | null;
}

const SYMBOLS = ['⭐', '🔺', '🔷', '🍀', '🔥', '💎', '⚡', '🌙'];
const GRID_COLS = 4;
const GRID_ROWS = 3;
const TARGET_COUNT = 3;
const DEFAULT_ROUNDS = 8;
const MIN_ROUNDS = 3;
const MAX_ROUNDS = 15;
const ROUND_MS = 6000;
const REVEAL_MS = 1500;
const LOCK_MS = 1000;
const BASE_POINTS = 10;
const MAX_SPEED_BONUS = 10;
const COMBO_STEP = 2;
const MAX_COMBO_BONUS = 6;

/** AI tap pacing and accuracy per difficulty. */
const AI_TAP_DELAY: Record<AIDifficulty, number> = { easy: 3000, medium: 1500, hard: 650 };
const AI_TAP_JITTER: Record<AIDifficulty, number> = { easy: 2200, medium: 1300, hard: 700 };
const AI_ACCURACY: Record<AIDifficulty, number> = { easy: 0.55, medium: 0.83, hard: 0.96 };

function roundsFor(requested?: number): number {
  if (typeof requested === 'number' && Number.isFinite(requested)) {
    return Math.min(MAX_ROUNDS, Math.max(MIN_ROUNDS, Math.round(requested)));
  }
  return DEFAULT_ROUNDS;
}

/**
 * Builds one round: prompt symbol, three distinct targets on distinct cells,
 * exactly one matching the prompt. Uses bounded shuffles — always terminates
 * even with degenerate rng streams. Exported for tests.
 */
export function buildRound(rng: () => number, number: number): RushRound {
  const prompt = SYMBOLS[Math.floor(rng() * SYMBOLS.length)]!;

  // Shuffle helper (Fisher-Yates) — terminates for any rng stream.
  const shuffle = <T,>(items: T[]): T[] => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy;
  };

  const decoys = shuffle(SYMBOLS.filter((symbol) => symbol !== prompt)).slice(0, TARGET_COUNT - 1);

  const allCells: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < GRID_ROWS; y += 1) {
    for (let x = 0; x < GRID_COLS; x += 1) allCells.push({ x, y });
  }
  const cells = shuffle(allCells).slice(0, TARGET_COUNT);

  const targets: RushTarget[] = [prompt, ...decoys].map((symbol, index) => ({
    id: `target-${index}`,
    symbol,
    x: cells[index]!.x,
    y: cells[index]!.y,
  }));
  const correctId = targets[0]!.id;

  // Shuffle which option carries the correct symbol.
  const shuffled = shuffle(targets);
  return {
    number,
    prompt,
    targets: shuffled,
    correctId,
    spawnedAt: 0,
    endsAt: 0,
    tapped: {},
  };
}

function activePlayerIds(ctx: GameContext): string[] {
  return ctx.players.filter((player) => player.isAI || player.isConnected).map((player) => player.id);
}

/** Begins a fresh round. Exported for tests. */
export function beginRushRound(state: TargetRushState, ctx: GameContext): void {
  const round = buildRound(ctx.random, state.round);
  const now = ctx.now();
  round.spawnedAt = now;
  round.endsAt = now + state.roundMs;
  state.current = round;
  state.phase = 'round';
  state.lastEvent = 'round-start';
  ctx.markStateChanged();

  ctx.schedule(
    state.roundMs,
    () => {
      if (state.phase !== 'round' || state.current?.number !== state.round) return;
      completeRushRound(state, ctx, null);
    },
    'turn',
    'round-timeout',
  );

  for (const player of ctx.players) {
    if (!player.isAI) continue;
    const difficulty = player.aiDifficulty ?? 'medium';
    const delay = AI_TAP_DELAY[difficulty] + Math.floor(ctx.random() * AI_TAP_JITTER[difficulty]);
    ctx.requestAI(player.id, delay);
  }
}

/**
 * Ends the current round (winner = first correct tapper, or null on expiry).
 * Exported for tests.
 */
export function completeRushRound(state: TargetRushState, ctx: GameContext, winner: string | null): void {
  if (state.phase !== 'round' || !state.current) return;
  state.history.push({
    number: state.current.number,
    prompt: state.current.prompt,
    correctId: state.current.correctId,
    winner,
  });
  state.phase = 'reveal';
  state.lastEvent = winner ? `won:${winner}` : 'expired';
  ctx.markStateChanged();

  ctx.schedule(
    state.revealMs,
    () => {
      if (state.phase !== 'reveal') return;
      beginNextRushRound(state, ctx);
    },
    'turn',
    'reveal',
  );
}

/** Moves to the next round or finishes the match. Exported for tests. */
export function beginNextRushRound(state: TargetRushState, ctx: GameContext): void {
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
  beginRushRound(state, ctx);
}

/** Timer callback: the overall match cap. Exported for tests. */
export function finishRushOnTimeout(state: TargetRushState, ctx: GameContext): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.finishReason = 'timeout';
  state.lastEvent = 'timeout';
  ctx.markStateChanged();
  ctx.finish('timeout');
}

export const targetRushGame: GameModule<TargetRushState> = {
  metadata: TARGET_RUSH_METADATA,

  initialize(_config: GameConfig): void {
    // Stateless module.
  },

  createInitialState(players, config): TargetRushState {
    return {
      phase: 'idle',
      round: 0,
      totalRounds: roundsFor(config.rounds),
      roundMs: ROUND_MS,
      revealMs: REVEAL_MS,
      current: null,
      history: [],
      scores: Object.fromEntries(players.map((player) => [player.id, 0])),
      hits: Object.fromEntries(players.map((player) => [player.id, 0])),
      wrongs: Object.fromEntries(players.map((player) => [player.id, 0])),
      streaks: Object.fromEntries(players.map((player) => [player.id, 0])),
      bestStreak: Object.fromEntries(players.map((player) => [player.id, 0])),
      lockUntil: {},
      departed: {},
      startedAt: null,
      finishReason: null,
      lastEvent: null,
    };
  },

  playerJoined(player, state): void {
    for (const table of [state.scores, state.hits, state.wrongs, state.streaks, state.bestStreak]) {
      if (table[player.id] === undefined) table[player.id] = 0;
    }
  },

  playerReady(): void {
    // No per-player readiness behaviour.
  },

  playerLeft(playerId, state, ctx, reason): void {
    if (reason === 'disconnect') return; // Grace period keeps the seat.
    state.departed[playerId] = true;
    const remaining = activePlayerIds(ctx).filter((id) => !state.departed[id]);
    if (state.phase !== 'finished' && remaining.length === 0) {
      finishRushOnTimeout(state, ctx);
    }
  },

  start(state, ctx): void {
    if (state.phase !== 'idle') return;
    state.round = 1;
    state.startedAt = ctx.now();
    state.finishReason = null;

    const worstCaseMs = state.totalRounds * (state.roundMs + state.revealMs) + 5000;
    ctx.schedule(worstCaseMs, () => finishRushOnTimeout(state, ctx), 'gameDuration', 'match-timeout');

    beginRushRound(state, ctx);
  },

  validateAction(playerId, action, state): ValidationResult {
    if (action.type !== 'hit') return { valid: false, reason: 'Unknown action.' };
    if (state.phase !== 'round') return { valid: false, reason: 'No target is active right now.' };
    const targetId = action.payload?.targetId;
    if (typeof targetId !== 'string' || state.current?.targets.every((t) => t.id !== targetId)) {
      return { valid: false, reason: 'That target does not exist.' };
    }
    if (state.current?.tapped[playerId]) {
      return { valid: false, reason: 'You already tapped this round.' };
    }
    if ((state.lockUntil[playerId] ?? 0) > 0) {
      return { valid: false, reason: 'You are locked out for a moment.' };
    }
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    if (action.type !== 'hit') return actionRejected('Unknown action.');
    const round = state.current;
    if (!round || state.phase !== 'round') return actionRejected('No target is active right now.');
    const targetId = action.payload?.targetId;
    const target = round.targets.find((candidate) => candidate.id === targetId);
    if (!target) return actionRejected('That target does not exist.');
    if (round.tapped[playerId]) return actionRejected('You already tapped this round.');
    if ((state.lockUntil[playerId] ?? 0) > 0) {
      return actionRejected('You are locked out for a moment.');
    }

    round.tapped[playerId] = true;

    if (target.id === round.correctId) {
      const elapsed = ctx.now() - round.spawnedAt;
      const speedBonus = Math.max(
        0,
        Math.round(MAX_SPEED_BONUS * (1 - Math.min(1, elapsed / state.roundMs))),
      );
      const priorStreak = state.streaks[playerId] ?? 0;
      const comboBonus = Math.min(MAX_COMBO_BONUS, priorStreak * COMBO_STEP);
      const points = BASE_POINTS + speedBonus + comboBonus;

      state.scores[playerId] = (state.scores[playerId] ?? 0) + points;
      state.hits[playerId] = (state.hits[playerId] ?? 0) + 1;
      state.streaks[playerId] = priorStreak + 1;
      state.bestStreak[playerId] = Math.max(state.bestStreak[playerId] ?? 0, priorStreak + 1);
      state.lastEvent = `hit:${playerId}:${points}`;

      // Everyone who did not win the round loses their streak.
      for (const other of ctx.players) {
        if (other.id !== playerId) state.streaks[other.id] = 0;
      }
      ctx.markStateChanged();

      completeRushRound(state, ctx, playerId);
      return actionAccepted();
    }

    // Wrong target: no points, streak broken, short lockout.
    state.wrongs[playerId] = (state.wrongs[playerId] ?? 0) + 1;
    state.streaks[playerId] = 0;
    state.lockUntil[playerId] = ctx.now() + LOCK_MS;
    state.lastEvent = `miss:${playerId}`;
    ctx.markStateChanged();
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
      return (state.bestStreak[a.id] ?? 0) - (state.bestStreak[b.id] ?? 0);
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
          hits: state.hits[player.id] ?? 0,
          wrongs: state.wrongs[player.id] ?? 0,
          bestStreak: state.bestStreak[player.id] ?? 0,
        },
      };
    });

    return { winners, isDraw: winners.length > 1, rankings, reason: state.finishReason ?? 'completed' };
  },

  reset(state): TargetRushState {
    const zero = (table: Record<string, number>) =>
      Object.fromEntries(Object.keys(table).map((id) => [id, 0]));
    return {
      ...state,
      phase: 'idle',
      round: 0,
      current: null,
      history: [],
      scores: zero(state.scores),
      hits: zero(state.hits),
      wrongs: zero(state.wrongs),
      streaks: zero(state.streaks),
      bestStreak: zero(state.bestStreak),
      lockUntil: {},
      departed: {},
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
   * CRITICAL privacy boundary: targets, prompt and timings are public, but
   * `correctId` is exposed ONLY during the reveal phase (and for past rounds
   * in history).
   */
  getPublicState(state, viewerId, ctx) {
    const current = state.current;
    const reveal = state.phase === 'reveal';
    return {
      phase: state.phase,
      round: state.round,
      totalRounds: state.totalRounds,
      roundMs: state.roundMs,
      prompt: current?.prompt ?? null,
      targets: current ? current.targets.map((t) => ({ id: t.id, symbol: t.symbol, x: t.x, y: t.y })) : [],
      endsAt: current?.endsAt ?? null,
      tapped: current ? { ...current.tapped } : {},
      myLockedUntil: viewerId ? (state.lockUntil[viewerId] ?? 0) : 0,
      correctId: reveal ? (current?.correctId ?? null) : null,
      scores: { ...state.scores },
      hits: { ...state.hits },
      streaks: { ...state.streaks },
      history: state.history.map((entry) => ({ ...entry })),
      finishReason: state.finishReason,
      lastEvent: state.lastEvent,
      serverTime: ctx.now(),
    };
  },

  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'round' || !state.current) return null;
    if (state.current.tapped[playerId]) return null;
    const rng = ctx.random;
    const correct =
      rng() < AI_ACCURACY[difficulty]
        ? state.current.correctId
        : state.current.targets.filter((t) => t.id !== state.current!.correctId)[0]!.id;
    return { type: 'hit', payload: { targetId: correct } };
  },

  maxDurationMs: 8 * 60 * 1000,
};
