import type { GameAction, GameConfig, GameFinishReason } from '@2play/shared';
import { PATTERN_MEMORY_METADATA } from '@2play/shared';
export { PATTERN_MEMORY_METADATA };
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
 * Pattern Memory Battle — the server flashes a secret tile sequence, both
 * players replay it from memory.
 *
 * The authoritative pattern NEVER leaves the server during the show/input
 * phases: the public state exposes only the single tile currently flashing
 * (and the full pattern during the post-round reveal, for review). All phase
 * transitions ride the platform TimerManager through `ctx.schedule` — there
 * are no game-local timers.
 */

export type PatternPhase = 'idle' | 'show' | 'input' | 'reveal' | 'finished';

export interface PatternPlayerState {
  progress: number; // correct taps this round
  locked: boolean; // attempt finished (success or mistake/timeout)
  succeeded: boolean;
  mistakes: number;
  score: number;
  streak: number;
  bestStreak: number;
  latestInputSeq: number;
  completedRounds: number;
  disconnected: boolean;
  left: boolean;
}

export interface PatternRoundHistory {
  round: number;
  length: number;
  pattern: number[];
  outcomes: Record<string, 'perfect' | 'fail'>;
}

export interface PatternMemoryState {
  phase: PatternPhase;
  round: number; // 1-based
  totalRounds: number;
  pattern: number[]; // HIDDEN until reveal
  shown: number; // tiles flashed so far
  patternLength: number;
  showStepMs: number;
  inputMs: number;
  inputStartedAt: number | null;
  inputEndsAt: number | null;
  players: Record<string, PatternPlayerState>;
  history: PatternRoundHistory[];
  departed: Record<string, boolean>;
  startedAt: number | null;
  finishReason: GameFinishReason | null;
  lastEvent: string | null;
  tileCount: number;
  eventCounter: number;
}

const MAX_TILE_COUNT = 9;
const DEFAULT_ROUNDS = 8;
const MIN_ROUNDS = 3;
const MAX_ROUNDS = 15;
const BASE_LENGTH = 3;
const MAX_LENGTH = 7;
const REVEAL_MS = 1400;
const SHOW_STEP_BASE_MS = 620;
const SHOW_STEP_MIN_MS = 340;
const SHOW_STEP_ACCEL_MS = 25;
const INPUT_BASE_MS = 1500;
const INPUT_PER_TILE_MS = 900;
const POINTS_PER_TILE = 10;
const SPEED_BONUS_PER_TILE = 5;
const STREAK_BONUS_MAX = 6;

/** AI pacing + accuracy per difficulty. */
const AI_TAP_DELAY: Record<string, number> = { easy: 1400, medium: 900, hard: 480 };
const AI_TAP_JITTER: Record<string, number> = { easy: 900, medium: 600, hard: 320 };
const AI_ACCURACY: Record<string, number> = { easy: 0.6, medium: 0.85, hard: 0.97 };

export function roundsFor(requested?: number): number {
  if (typeof requested === 'number' && Number.isFinite(requested)) {
    return Math.min(MAX_ROUNDS, Math.max(MIN_ROUNDS, Math.round(requested)));
  }
  return DEFAULT_ROUNDS;
}

export function tileCountFor(round: number): number {
  return round <= 2 ? 4 : round <= 5 ? 6 : 9;
}

export function patternLengthFor(round: number): number {
  return Math.min(MAX_LENGTH, BASE_LENGTH + Math.floor((round - 1) / 2));
}

export function showStepFor(round: number): number {
  return Math.max(SHOW_STEP_MIN_MS, SHOW_STEP_BASE_MS - (round - 1) * SHOW_STEP_ACCEL_MS);
}

export function inputMsFor(length: number): number {
  return INPUT_BASE_MS + length * INPUT_PER_TILE_MS;
}

/**
 * Builds a random pattern: tiles 0..8, no immediate repeats. Uses bounded
 * selection — always terminates. Exported for tests.
 */
export function buildPattern(
  length: number,
  random: () => number,
  tileCount = MAX_TILE_COUNT,
): number[] {
  const safeTileCount = Math.max(2, Math.min(MAX_TILE_COUNT, Math.floor(tileCount)));
  const pattern: number[] = [];
  while (pattern.length < length) {
    const previous = pattern[pattern.length - 1];
    let tile = Math.floor(random() * (previous === undefined ? safeTileCount : safeTileCount - 1));
    // Select from all tiles except the previous one without retrying, so even
    // a pathological random source cannot stall the authoritative round.
    if (previous !== undefined && tile >= previous) tile += 1;
    pattern.push(tile);
  }
  return pattern;
}

function newPlayer(): PatternPlayerState {
  return {
    progress: 0,
    locked: false,
    succeeded: false,
    mistakes: 0,
    score: 0,
    streak: 0,
    bestStreak: 0,
    latestInputSeq: -1,
    completedRounds: 0,
    disconnected: false,
    left: false,
  };
}

/** Starts a round: builds the pattern and begins the show phase. Exported for tests. */
export function beginPatternRound(state: PatternMemoryState, ctx: GameContext): void {
  if (state.phase === 'input' || state.phase === 'show') return;
  state.round += 1;
  state.patternLength = patternLengthFor(state.round);
  state.tileCount = tileCountFor(state.round);
  state.pattern = buildPattern(state.patternLength, ctx.random, state.tileCount);
  state.shown = 0;
  state.showStepMs = showStepFor(state.round);
  state.inputMs = inputMsFor(state.patternLength);
  state.inputStartedAt = null;
  state.inputEndsAt = null;
  for (const player of Object.values(state.players)) {
    player.progress = 0;
    player.locked = false;
    player.succeeded = false;
  }
  state.phase = 'show';
  state.lastEvent = 'show-start';
  ctx.markStateChanged();
  ctx.schedule(state.showStepMs, () => advanceShow(state, ctx), 'turn', 'pattern-show');
}

/** Flashes the next tile; when done, opens the input phase. Exported for tests. */
export function advanceShow(state: PatternMemoryState, ctx: GameContext): void {
  if (state.phase !== 'show') return;
  state.shown += 1;
  ctx.markStateChanged();
  if (state.shown >= state.patternLength) {
    ctx.schedule(
      Math.max(150, state.showStepMs / 2),
      () => beginInput(state, ctx),
      'turn',
      'pattern-input',
    );
    return;
  }
  ctx.schedule(state.showStepMs, () => advanceShow(state, ctx), 'turn', 'pattern-show');
}

/** Opens the parallel input phase with its round timer. Exported for tests. */
export function beginInput(state: PatternMemoryState, ctx: GameContext): void {
  if (state.phase !== 'show') return;
  state.phase = 'input';
  const now = ctx.now();
  state.inputStartedAt = now;
  state.inputEndsAt = now + state.inputMs;
  state.lastEvent = 'input-start';
  ctx.markStateChanged();

  ctx.schedule(state.inputMs, () => expireInput(state, ctx), 'turn', 'pattern-input-timeout');

  // AI seats start replaying through the same pipeline as humans.
  for (const player of ctx.players) {
    if (!player.isAI) continue;
    const difficulty = player.aiDifficulty ?? 'medium';
    const delay = AI_TAP_DELAY[difficulty]! + Math.floor(ctx.random() * AI_TAP_JITTER[difficulty]!);
    ctx.requestAI(player.id, delay);
  }
}

/** Input timer: everyone unfinished fails the round. Exported for tests. */
export function expireInput(state: PatternMemoryState, ctx: GameContext): void {
  if (state.phase !== 'input') return;
  for (const player of Object.values(state.players)) {
    if (!player.locked) {
      player.locked = true;
      player.succeeded = false;
      player.streak = 0;
    }
  }
  completeRound(state, ctx);
}

/** All players locked (or timer expired): reveal, then next round. Exported for tests. */
export function completeRound(state: PatternMemoryState, ctx: GameContext): void {
  if (state.phase !== 'input') return;
  const outcomes: Record<string, 'perfect' | 'fail'> = {};
  for (const [playerId, player] of Object.entries(state.players)) {
    outcomes[playerId] = player.succeeded ? 'perfect' : 'fail';
  }
  state.history.push({
    round: state.round,
    length: state.patternLength,
    pattern: [...state.pattern],
    outcomes,
  });
  state.phase = 'reveal';
  state.lastEvent = 'reveal';
  ctx.markStateChanged();
  ctx.schedule(REVEAL_MS, () => beginNextRound(state, ctx), 'turn', 'pattern-reveal');
}

/** Moves on from the reveal: next round or the finish line. Exported for tests. */
export function beginNextRound(state: PatternMemoryState, ctx: GameContext): void {
  if (state.phase !== 'reveal') return;
  const active = Object.entries(state.players).filter(([playerId]) => !state.departed[playerId]);
  if (state.round >= state.totalRounds || active.length === 0) {
    state.phase = 'finished';
    state.finishReason = 'completed';
    state.lastEvent = 'finished';
    ctx.markStateChanged();
    ctx.finish('completed');
    return;
  }
  beginPatternRound(state, ctx);
}

function endIfEveryoneDeparted(state: PatternMemoryState, ctx: GameContext): void {
  const active = Object.entries(state.players).filter(
    ([playerId, player]) => !state.departed[playerId] && !player.left,
  );
  if (active.length === 0 && state.phase !== 'finished') {
    state.phase = 'finished';
    state.finishReason = 'completed';
    state.lastEvent = 'finished';
    ctx.markStateChanged();
    ctx.finish('completed');
  }
}

/** Ranking: score, then completed rounds, then seat. Exported for tests. */
export function computePatternRanking(state: PatternMemoryState, ctx: GameContext): RankingDraft[] {
  const ranked = [...ctx.players].sort((a, b) => {
    const scoreDiff = (state.players[b.id]?.score ?? 0) - (state.players[a.id]?.score ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    const doneDiff =
      (state.players[b.id]?.completedRounds ?? 0) - (state.players[a.id]?.completedRounds ?? 0);
    if (doneDiff !== 0) return doneDiff;
    return a.seatIndex - b.seatIndex;
  });
  const best = ranked[0];
  const winners = best
    ? ranked
        .filter(
          (player) =>
            (state.players[player.id]?.score ?? 0) === (state.players[best.id]?.score ?? 0) &&
            (state.players[player.id]?.completedRounds ?? 0) ===
              (state.players[best.id]?.completedRounds ?? 0),
        )
        .map((player) => player.id)
    : [];
  return ranked.map((player, index) => {
    const view = state.players[player.id];
    return {
      playerId: player.id,
      rank: index + 1,
      score: view?.score ?? 0,
      isWinner: winners.includes(player.id),
      isDraw: winners.length > 1,
      stats: {
        completed: view?.completedRounds ?? 0,
        mistakes: view?.mistakes ?? 0,
        bestStreak: view?.bestStreak ?? 0,
      },
    };
  });
}

/* ------------------------------------------------------------------ */
/* Module                                                              */
/* ------------------------------------------------------------------ */

export const patternMemoryGame: GameModule<PatternMemoryState> = {
  metadata: PATTERN_MEMORY_METADATA,

  initialize(_config: GameConfig): void {
    // Stateless module.
  },

  createInitialState(players, config): PatternMemoryState {
    return {
      phase: 'idle',
      round: 0,
      totalRounds: roundsFor(config.rounds),
      pattern: [],
      shown: 0,
      patternLength: 0,
      showStepMs: showStepFor(1),
      inputMs: inputMsFor(BASE_LENGTH),
      inputStartedAt: null,
      inputEndsAt: null,
      players: Object.fromEntries(players.map((player) => [player.id, newPlayer()])),
      history: [],
      departed: {},
      startedAt: null,
      finishReason: null,
      lastEvent: null,
      tileCount: tileCountFor(1),
      eventCounter: 0,
    };
  },

  playerJoined(player, state): void {
    if (!state.players[player.id]) state.players[player.id] = newPlayer();
  },

  playerReady(): void {
    // No per-player readiness behaviour.
  },

  playerLeft(playerId, state, ctx, reason): void {
    const player = state.players[playerId];
    if (!player) return;
    if (reason === 'disconnect') {
      player.disconnected = true;
      return;
    }
    player.left = true;
    state.departed[playerId] = true;
    state.lastEvent = `left:${playerId}`;
    ctx.markStateChanged();

    // The round can finish early if only leavers remain unlocked.
    if (state.phase === 'input') {
      const active = Object.keys(state.players).filter((id) => !state.departed[id]);
      const pending = active.filter((id) => !state.players[id]!.locked);
      if (pending.length === 0) completeRound(state, ctx);
      return;
    }
    endIfEveryoneDeparted(state, ctx);
  },

  start(state, ctx): void {
    if (state.phase !== 'idle') return;
    state.round = 0;
    state.history = [];
    state.departed = {};
    state.eventCounter = 0;
    state.players = Object.fromEntries(ctx.players.map((player) => [player.id, newPlayer()]));
    state.startedAt = ctx.now();
    state.finishReason = null;
    beginPatternRound(state, ctx);
  },

  validateAction(playerId, action, state): ValidationResult {
    if (action.type !== 'tap') return { valid: false, reason: 'Unknown action.' };
    const tile = action.payload?.tile;
    if (
      typeof tile !== 'number' ||
      !Number.isInteger(tile) ||
      tile < 0 ||
      tile >= state.tileCount
    ) {
      return { valid: false, reason: 'Invalid tile.' };
    }
    if (state.phase !== 'input') return { valid: false, reason: 'Not the input phase.' };
    const player = state.players[playerId];
    if (!player) return { valid: false, reason: 'You are not part of this match.' };
    if (player.locked) return { valid: false, reason: 'Your attempt is over.' };
    const sequence = action.payload?.sequence;
    if (
      sequence !== undefined &&
      (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 0)
    )
      return { valid: false, reason: 'Invalid input sequence.' };
    if (typeof sequence === 'number' && sequence <= player.latestInputSeq)
      return { valid: false, reason: 'Stale input.' };
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    if (action.type !== 'tap') return actionRejected('Unknown action.');
    const tile = action.payload?.tile;
    if (
      typeof tile !== 'number' ||
      !Number.isInteger(tile) ||
      tile < 0 ||
      tile >= state.tileCount
    ) {
      return actionRejected('Invalid tile.');
    }
    const player = state.players[playerId];
    if (!player) return actionRejected('You are not part of this match.');
    if (state.phase !== 'input') return actionRejected('Not the input phase.');
    if (player.locked) return actionRejected('Your attempt is over.');
    const sequence = action.payload?.sequence;
    if (
      sequence !== undefined &&
      (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 0)
    )
      return actionRejected('Invalid input sequence.');
    if (typeof sequence === 'number' && sequence <= player.latestInputSeq)
      return actionRejected('Stale input.');
    if (typeof sequence === 'number') player.latestInputSeq = sequence;

    const expected = state.pattern[player.progress]!;
    if (tile === expected) {
      player.progress += 1;
      state.eventCounter += 1;
      state.lastEvent = `tap:${playerId}:${state.eventCounter}`;
      if (player.progress >= state.patternLength) {
        // Full replay: 10/tile + speed bonus + streak bonus.
        const remaining = Math.max(
          0,
          1 - (ctx.now() - (state.inputStartedAt ?? ctx.now())) / state.inputMs,
        );
        const speedBonus = Math.floor(remaining * state.patternLength * SPEED_BONUS_PER_TILE);
        const streakBonus = Math.min(STREAK_BONUS_MAX, player.streak * 2);
        player.score += state.patternLength * POINTS_PER_TILE + speedBonus + streakBonus;
        player.streak += 1;
        player.bestStreak = Math.max(player.bestStreak, player.streak);
        player.completedRounds += 1;
        player.locked = true;
        player.succeeded = true;
        state.eventCounter += 1;
        state.lastEvent = `perfect:${playerId}:${state.eventCounter}`;
        ctx.markStateChanged();
      } else {
        ctx.markStateChanged();
      }
    } else {
      player.mistakes += 1;
      player.streak = 0;
      player.locked = true;
      player.succeeded = false;
      state.eventCounter += 1;
      state.lastEvent = `mistake:${playerId}:${state.eventCounter}`;
      ctx.markStateChanged();
    }

    // Round ends once every active player is locked.
    const active = Object.keys(state.players).filter((id) => !state.departed[id]);
    const pending = active.filter((id) => !state.players[id]!.locked);
    if (pending.length === 0) {
      completeRound(state, ctx);
      return actionAccepted(true);
    }

    // AI seats keep replaying through the same pipeline.
    const seat = ctx.players.find((candidate) => candidate.id === playerId);
    if (seat?.isAI && !player.locked) {
      const difficulty = seat.aiDifficulty ?? 'medium';
      const delay =
        AI_TAP_DELAY[difficulty]! + Math.floor(ctx.random() * AI_TAP_JITTER[difficulty]!);
      ctx.requestAI(playerId, delay);
    }
    return actionAccepted(false);
  },

  update(): void {
    // Schedule-driven game: no per-tick simulation.
  },

  tick(): void {
    // Schedule-driven game.
  },

  calculateScore(playerId, state): number {
    return state.players[playerId]?.score ?? 0;
  },

  checkWinCondition(state): string[] | null {
    if (state.phase !== 'finished') return null;
    const entries = Object.entries(state.players).filter(([playerId]) => !state.departed[playerId]);
    if (entries.length === 0) return [];
    const best = Math.max(...entries.map(([, player]) => player.score));
    return entries.filter(([, player]) => player.score === best).map(([playerId]) => playerId);
  },

  checkDrawCondition(state): boolean {
    if (state.phase !== 'finished') return false;
    return this.checkWinCondition(state)!.length > 1;
  },

  isGameFinished(state): boolean {
    return state.phase === 'finished';
  },

  finish(state): void {
    state.phase = 'finished';
  },

  getResult(state, ctx): GameResultDraft {
    const rankings = computePatternRanking(state, ctx);
    const winners = rankings.filter((entry) => entry.isWinner).map((entry) => entry.playerId);
    return {
      winners,
      isDraw: winners.length > 1,
      rankings,
      reason: state.finishReason ?? 'completed',
    };
  },

  reset(state): PatternMemoryState {
    const seats = Object.keys(state.players);
    return {
      ...state,
      phase: 'idle',
      round: 0,
      pattern: [],
      shown: 0,
      patternLength: 0,
      players: Object.fromEntries(seats.map((playerId) => [playerId, newPlayer()])),
      history: [],
      departed: {},
      startedAt: null,
      finishReason: null,
      lastEvent: null,
      tileCount: tileCountFor(1),
      eventCounter: 0,
    };
  },

  cleanup(): void {
    // Stateless module.
  },

  getPublicState(state, _viewerId, ctx) {
    const revealing = state.phase === 'reveal';
    return {
      phase: state.phase,
      round: state.round,
      totalRounds: state.totalRounds,
      patternLength: state.patternLength,
      tileCount: state.tileCount,
      shown: state.shown,
      showStepMs: state.showStepMs,
      inputEndsAt: state.inputEndsAt,
      // The flashing tile only — the rest of the pattern stays server-side.
      flash: state.phase === 'show' && state.shown > 0 ? state.pattern[state.shown - 1]! : null,
      // Full pattern only during the post-round reveal.
      revealPattern: revealing ? [...state.pattern] : null,
      history: state.history.map((entry) => ({ round: entry.round, length: entry.length })),
      players: Object.fromEntries(
        Object.entries(state.players).map(([playerId, player]) => [
          playerId,
          {
            progress: player.progress,
            locked: player.locked,
            succeeded: player.succeeded,
            mistakes: player.mistakes,
            score: player.score,
            streak: player.streak,
            bestStreak: player.bestStreak,
            latestInputSeq: player.latestInputSeq,
            completedRounds: player.completedRounds,
            disconnected: player.disconnected,
            left: player.left,
          },
        ]),
      ),
      startedAt: state.startedAt,
      finishReason: state.finishReason,
      lastEvent: state.lastEvent,
      serverTime: ctx.now(),
    };
  },

  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'input') return null;
    const player = state.players[playerId];
    if (!player || player.locked || player.left) return null;
    const expected = state.pattern[player.progress];
    if (expected === undefined) return null;

    const accuracy = AI_ACCURACY[difficulty] ?? AI_ACCURACY.medium!;
    if (ctx.random() < accuracy) {
      return { type: 'tap', payload: { tile: expected } };
    }
    // Wrong tap: any other tile.
    let wrong = Math.floor(ctx.random() * (state.tileCount - 1));
    if (wrong >= expected) wrong += 1;
    return { type: 'tap', payload: { tile: wrong } };
  },

  maxDurationMs: 8 * 60 * 1000,
};
