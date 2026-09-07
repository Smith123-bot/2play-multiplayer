import type { AIDifficulty, GameAction, GameConfig, GameFinishReason } from '@2play/shared';
import { WORD_SCRAMBLE_METADATA } from '@2play/shared';
export { WORD_SCRAMBLE_METADATA };
import type {
  ActionResult,
  GameContext,
  GameModule,
  GameResultDraft,
  RankingDraft,
  ValidationResult,
} from '../GameModule';
import { actionAccepted, actionRejected } from '../GameModule';
import { SCRAMBLE_WORDS } from './words';

/**
 * Word Scramble Battle — race to unscramble shuffled words.
 *
 * The server picks every word, shuffles it and validates every answer; the
 * original word is private state until the round ends (getPublicState strips
 * it). Rounds end early when every active player has solved the word.
 */

export type ScramblePhase = 'idle' | 'round' | 'reveal' | 'finished';

export interface ScrambleRound {
  number: number;
  /** HIDDEN until the reveal phase. */
  word: string;
  scrambled: string;
  startedAt: number;
  endsAt: number;
  /** Player ids that solved the word, in order. */
  solvedOrder: string[];
  solvedAtMs: Record<string, number>;
  attempts: Record<string, number>;
}

export interface WordScrambleState {
  phase: ScramblePhase;
  round: number;
  totalRounds: number;
  roundMs: number;
  current: ScrambleRound | null;
  /** Completed rounds — safe to expose (their words are already revealed). */
  history: Array<{ number: number; word: string; scrambled: string; solvedOrder: string[] }>;
  scores: Record<string, number>;
  solvedCount: Record<string, number>;
  attemptsTotal: Record<string, number>;
  usedWords: string[];
  startedAt: number | null;
  finishReason: GameFinishReason | null;
  lastEvent: string | null;
}

const DEFAULT_ROUNDS = 5;
const MIN_ROUNDS = 1;
const MAX_ROUNDS = 15;
const ROUND_MS = 20 * 1000;
const REVEAL_MS = 2500;
const MAX_ANSWER_LENGTH = 48;

/** AI solve pacing and accuracy per difficulty. */
const AI_SOLVE_DELAY: Record<AIDifficulty, number> = { easy: 9000, medium: 4500, hard: 1400 };
const AI_SOLVE_JITTER: Record<AIDifficulty, number> = { easy: 7000, medium: 3800, hard: 2600 };
const AI_ACCURACY: Record<AIDifficulty, number> = { easy: 0.55, medium: 0.82, hard: 0.96 };

function roundsFor(requested?: number): number {
  if (typeof requested === 'number' && Number.isFinite(requested)) {
    return Math.min(MAX_ROUNDS, Math.max(MIN_ROUNDS, Math.round(requested)));
  }
  return DEFAULT_ROUNDS;
}

/** Shuffles a word's letters; retries so the result differs when possible. */
export function scrambleWord(word: string, rng: () => number): string {
  const letters = [...word];
  for (let attempt = 0; attempt < 10; attempt += 1) {
    for (let i = letters.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [letters[i], letters[j]] = [letters[j]!, letters[i]!];
    }
    const candidate = letters.join('');
    if (candidate !== word) return candidate;
  }
  return letters.join('');
}

function normaliseAnswer(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toUpperCase().slice(0, MAX_ANSWER_LENGTH);
  return value.length === 0 ? null : value;
}

/** Players that still count for "everyone solved" (AIs + connected humans). */
function activePlayerIds(ctx: GameContext): string[] {
  return ctx.players.filter((player) => player.isAI || player.isConnected).map((player) => player.id);
}

/** Begins a fresh round (used by start and nextRound). Exported for tests. */
export function beginRound(state: WordScrambleState, ctx: GameContext): void {
  const rng = ctx.random;
  const pool = SCRAMBLE_WORDS.filter((word) => !state.usedWords.includes(word));
  const candidates = pool.length > 0 ? pool : SCRAMBLE_WORDS;
  const word = candidates[Math.floor(rng() * candidates.length)]!;
  if (pool.length > 0) state.usedWords.push(word);
  if (state.usedWords.length >= SCRAMBLE_WORDS.length) state.usedWords = [word];

  const now = ctx.now();
  state.current = {
    number: state.round,
    word,
    scrambled: scrambleWord(word, rng),
    startedAt: now,
    endsAt: now + state.roundMs,
    solvedOrder: [],
    solvedAtMs: {},
    attempts: {},
  };
  state.phase = 'round';
  state.lastEvent = 'round-start';
  ctx.markStateChanged();

  ctx.schedule(
    state.roundMs,
    () => {
      if (state.phase !== 'round' || state.current?.number !== state.round) return;
      completeRound(state, ctx);
    },
    'turn',
    'round-timeout',
  );

  // Each AI opponent plans one (pace + accuracy modelled) submission.
  for (const player of ctx.players) {
    if (!player.isAI) continue;
    const difficulty = player.aiDifficulty ?? 'medium';
    const delay = AI_SOLVE_DELAY[difficulty] + Math.floor(rng() * AI_SOLVE_JITTER[difficulty]);
    ctx.requestAI(player.id, delay);
  }
}

/** Ends the current round and reveals the word. Exported for tests. */
export function completeRound(state: WordScrambleState, ctx: GameContext): void {
  if (state.phase !== 'round' || !state.current) return;
  state.history.push({
    number: state.current.number,
    word: state.current.word,
    scrambled: state.current.scrambled,
    solvedOrder: [...state.current.solvedOrder],
  });
  state.phase = 'reveal';
  state.lastEvent = 'reveal';
  ctx.markStateChanged();

  ctx.schedule(
    REVEAL_MS,
    () => {
      if (state.phase !== 'reveal') return;
      beginNextRound(state, ctx);
    },
    'turn',
    'reveal',
  );
}

/** Moves to the next round or finishes the match. Exported for tests. */
export function beginNextRound(state: WordScrambleState, ctx: GameContext): void {
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
  beginRound(state, ctx);
}

/** Timer callback: the overall match cap. Exported for tests. */
export function finishScrambleOnTimeout(state: WordScrambleState, ctx: GameContext): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.finishReason = 'timeout';
  state.lastEvent = 'timeout';
  ctx.markStateChanged();
  ctx.finish('timeout');
}

/** Produces a plausible wrong guess (never equal to the real word). */
function wrongGuessFor(word: string, rng: () => number): string {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = scrambleWord(word, rng);
    if (candidate !== word) return candidate;
  }
  return `${word}X`;
}

export const wordScrambleGame: GameModule<WordScrambleState> = {
  metadata: WORD_SCRAMBLE_METADATA,

  initialize(_config: GameConfig): void {
    // Stateless module.
  },

  createInitialState(players, config): WordScrambleState {
    return {
      phase: 'idle',
      round: 0,
      totalRounds: roundsFor(config.rounds),
      roundMs: ROUND_MS,
      current: null,
      history: [],
      scores: Object.fromEntries(players.map((player) => [player.id, 0])),
      solvedCount: Object.fromEntries(players.map((player) => [player.id, 0])),
      attemptsTotal: Object.fromEntries(players.map((player) => [player.id, 0])),
      usedWords: [],
      startedAt: null,
      finishReason: null,
      lastEvent: null,
    };
  },

  playerJoined(player, state): void {
    if (state.scores[player.id] === undefined) state.scores[player.id] = 0;
    if (state.solvedCount[player.id] === undefined) state.solvedCount[player.id] = 0;
    if (state.attemptsTotal[player.id] === undefined) state.attemptsTotal[player.id] = 0;
  },

  playerReady(): void {
    // No per-player readiness behaviour.
  },

  playerLeft(playerId, state, ctx, reason): void {
    if (reason === 'disconnect') return; // The grace period keeps the seat.
    // A departed player no longer blocks early round completion.
    if (state.phase === 'round' && state.current) {
      const remaining = activePlayerIds(ctx).filter((id) => id !== playerId);
      const allSolved = remaining.every((id) => state.current?.solvedOrder.includes(id));
      if (remaining.length > 0 && allSolved) completeRound(state, ctx);
    }
    if (state.phase !== 'finished' && activePlayerIds(ctx).filter((id) => id !== playerId).length === 0) {
      finishScrambleOnTimeout(state, ctx);
    }
  },

  start(state, ctx): void {
    if (state.phase !== 'idle') return;
    for (const player of ctx.players) {
      if (state.scores[player.id] === undefined) state.scores[player.id] = 0;
      if (state.solvedCount[player.id] === undefined) state.solvedCount[player.id] = 0;
      if (state.attemptsTotal[player.id] === undefined) state.attemptsTotal[player.id] = 0;
    }
    state.round = 1;
    state.startedAt = ctx.now();
    state.finishReason = null;

    const worstCaseMs = state.totalRounds * (state.roundMs + REVEAL_MS) + 5000;
    ctx.schedule(
      worstCaseMs,
      () => finishScrambleOnTimeout(state, ctx),
      'gameDuration',
      'match-timeout',
    );

    beginRound(state, ctx);
  },

  validateAction(playerId, action, state): ValidationResult {
    if (action.type !== 'submit') return { valid: false, reason: 'Unknown action.' };
    if (state.phase !== 'round') return { valid: false, reason: 'No word is waiting right now.' };
    const answer = normaliseAnswer(action.payload?.answer);
    if (!answer) return { valid: false, reason: 'Type a word first.' };
    if (state.current?.solvedOrder.includes(playerId)) {
      return { valid: false, reason: 'You already solved this word.' };
    }
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    if (action.type !== 'submit') return actionRejected('Unknown action.');
    const answer = normaliseAnswer(action.payload?.answer);
    if (!answer) return actionRejected('Type a word first.');
    const round = state.current;
    if (!round || state.phase !== 'round') return actionRejected('No word is waiting right now.');
    if (round.solvedOrder.includes(playerId)) {
      return actionRejected('You already solved this word.');
    }

    round.attempts[playerId] = (round.attempts[playerId] ?? 0) + 1;
    state.attemptsTotal[playerId] = (state.attemptsTotal[playerId] ?? 0) + 1;

    if (answer === round.word) {
      const elapsed = ctx.now() - round.startedAt;
      const speedBonus = elapsed <= state.roundMs / 2 ? 1 : 0;
      const points = 1 + speedBonus;
      state.scores[playerId] = (state.scores[playerId] ?? 0) + points;
      state.solvedCount[playerId] = (state.solvedCount[playerId] ?? 0) + 1;
      round.solvedOrder.push(playerId);
      round.solvedAtMs[playerId] = elapsed;
      state.lastEvent = `correct:${playerId}`;
      ctx.markStateChanged();

      // Round ends early once every active player has solved it.
      const remaining = activePlayerIds(ctx).filter((id) => !round.solvedOrder.includes(id));
      if (remaining.length === 0) completeRound(state, ctx);
      return actionAccepted();
    }

    state.lastEvent = `wrong:${playerId}`;
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
      // Fewer total attempts is the efficiency tie-break.
      return (state.attemptsTotal[a.id] ?? 0) - (state.attemptsTotal[b.id] ?? 0);
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
          solved: state.solvedCount[player.id] ?? 0,
          attempts: state.attemptsTotal[player.id] ?? 0,
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

  reset(state): WordScrambleState {
    return {
      ...state,
      phase: 'idle',
      round: 0,
      current: null,
      history: [],
      scores: Object.fromEntries(Object.keys(state.scores).map((id) => [id, 0])),
      solvedCount: Object.fromEntries(Object.keys(state.solvedCount).map((id) => [id, 0])),
      attemptsTotal: Object.fromEntries(Object.keys(state.attemptsTotal).map((id) => [id, 0])),
      usedWords: [],
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
   * CRITICAL privacy boundary: while a round is running the original word is
   * NEVER sent — only the scrambled letters. The answer appears exclusively
   * during the reveal phase (and in history for past rounds).
   */
  getPublicState(state, _viewerId, ctx) {
    return {
      phase: state.phase,
      round: state.round,
      totalRounds: state.totalRounds,
      roundMs: state.roundMs,
      scrambled: state.current?.scrambled ?? null,
      endsAt: state.current?.endsAt ?? null,
      solved: state.current ? [...state.current.solvedOrder] : [],
      solvedAtMs: state.current ? { ...state.current.solvedAtMs } : {},
      attempts: state.current ? { ...state.current.attempts } : {},
      scores: { ...state.scores },
      solvedCount: { ...state.solvedCount },
      history: state.history.map((entry) => ({ ...entry, solvedOrder: [...entry.solvedOrder] })),
      answer: state.phase === 'reveal' ? (state.current?.word ?? null) : null,
      finishReason: state.finishReason,
      lastEvent: state.lastEvent,
      serverTime: ctx.now(),
    };
  },

  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'round' || !state.current) return null;
    if (state.current.solvedOrder.includes(playerId)) return null;
    const answer =
      ctx.random() < AI_ACCURACY[difficulty]
        ? state.current.word
        : wrongGuessFor(state.current.word, ctx.random);
    return { type: 'submit', payload: { answer } };
  },

  maxDurationMs: 10 * 60 * 1000,
};
