import type { AIDifficulty, GameAction, GameConfig } from '@2play/shared';
import { pick } from '@2play/shared';
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
import { WORD_RACE_METADATA } from '@2play/shared';
import {
  WORD_CATEGORIES,
  isValidWord,
  normalizeWord,
  wordsFor,
  type WordCategory,
} from './words';

export { WORD_RACE_METADATA };

export type WordRacePhase = 'idle' | 'intro' | 'typing' | 'roundResult' | 'finished';

export interface WordSubmission {
  playerId: string;
  word: string;
  valid: boolean;
  reason: 'ok' | 'invalid' | 'duplicate';
  points: number;
  at: number;
}

export interface WordRaceState {
  phase: WordRacePhase;
  round: number;
  totalRounds: number;
  category: WordCategory | null;
  categoriesUsed: WordCategory[];
  roundEndsAt: number | null;
  submissions: WordSubmission[];
  usedWords: string[];
  scores: Record<string, number>;
  validCounts: Record<string, number>;
  roundResults: Array<{ round: number; category: WordCategory | null; scores: Record<string, number> }>;
  lastEvent: string | null;
}


const ROUND_SECONDS = 60;
const INTRO_MS = 3000;
const RESULT_MS = 3000;

/** How quickly (and how well) the AI types. */
const AI_PACE: Record<AIDifficulty, { minMs: number; maxMs: number; accuracy: number }> = {
  easy: { minMs: 6000, maxMs: 11000, accuracy: 0.6 },
  medium: { minMs: 3500, maxMs: 6500, accuracy: 0.82 },
  hard: { minMs: 2000, maxMs: 4000, accuracy: 0.96 },
};

function scoresFor(players: readonly GamePlayerView[]): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const player of players) scores[player.id] = 0;
  return scores;
}

function pickCategory(state: WordRaceState, ctx: GameContext): WordCategory {
  const remaining = WORD_CATEGORIES.filter((category) => !state.categoriesUsed.includes(category));
  const pool = remaining.length > 0 ? remaining : WORD_CATEGORIES;
  return pick(pool, ctx.random);
}

export const wordRaceGame: GameModule<WordRaceState> = {
  metadata: WORD_RACE_METADATA,

  initialize(): void {
    // Dictionaries are static module data.
  },

  createInitialState(players, config): WordRaceState {
    return {
      phase: 'idle',
      round: 0,
      totalRounds: Math.max(1, Math.min(5, config.rounds ?? 3)),
      category: null,
      categoriesUsed: [],
      roundEndsAt: null,
      submissions: [],
      usedWords: [],
      scores: scoresFor(players),
      validCounts: Object.fromEntries(players.map((player) => [player.id, 0])),
      roundResults: [],
      lastEvent: null,
    };
  },

  playerJoined(player, state): void {
    if (state.scores[player.id] === undefined) state.scores[player.id] = 0;
    if (state.validCounts[player.id] === undefined) state.validCounts[player.id] = 0;
  },

  playerReady(): void {
    // Lobby concern only.
  },

  playerLeft(playerId, state, ctx): void {
    if (state.phase === 'typing') {
      const stillPlaying = ctx.players.filter(
        (player) => (player.isAI || player.isConnected) && player.id !== playerId,
      );
      if (stillPlaying.length === 0) ctx.finish('abandoned');
    }
  },

  start(state, ctx): void {
    beginRound(state, ctx);
  },

  validateAction(playerId, action, state, ctx): ValidationResult {
    if (action.type !== 'submit') return { valid: false, reason: 'Unknown action.' };
    if (state.phase !== 'typing') return { valid: false, reason: 'The round is not running.' };
    if (state.roundEndsAt !== null && ctx.now() > state.roundEndsAt) {
      return { valid: false, reason: 'Time is up.' };
    }
    const raw = action.payload?.word;
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      return { valid: false, reason: 'Type a word first.' };
    }
    const word = normalizeWord(raw);
    if (word.length < 2 || word.length > 24) {
      return { valid: false, reason: 'Words must be 2–24 letters.' };
    }
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    if (action.type !== 'submit') return actionRejected('Unknown action.');
    if (state.category === null) return actionRejected('The round has no category yet.');

    const word = normalizeWord(String(action.payload?.word ?? ''));
    const alreadyUsed = state.usedWords.includes(word);
    const valid = !alreadyUsed && isValidWord(state.category, word);
    const reason: WordSubmission['reason'] = valid ? 'ok' : alreadyUsed ? 'duplicate' : 'invalid';
    const points = valid ? 1 : 0;

    state.submissions.push({ playerId, word, valid, reason, points, at: ctx.now() });
    if (valid) {
      state.usedWords.push(word);
      state.scores[playerId] = (state.scores[playerId] ?? 0) + points;
      state.validCounts[playerId] = (state.validCounts[playerId] ?? 0) + 1;
    }
    state.lastEvent = `submit:${playerId}:${reason}`;
    ctx.markStateChanged();

    const player = ctx.players.find((candidate) => candidate.id === playerId);
    if (player?.isAI) scheduleNextAIWord(state, ctx, playerId);

    return actionAccepted();
  },

  update(): void {
    // Timer driven.
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
    state.roundEndsAt = null;
  },

  getResult(state, ctx): GameResultDraft {
    const ranked = [...ctx.players].sort((a, b) => {
      const diff = (state.scores[b.id] ?? 0) - (state.scores[a.id] ?? 0);
      return diff !== 0 ? diff : (state.validCounts[b.id] ?? 0) - (state.validCounts[a.id] ?? 0);
    });
    const top = state.scores[ranked[0]?.id ?? ''] ?? 0;
    const winners = ranked.filter((player) => (state.scores[player.id] ?? 0) === top).map((player) => player.id);

    const rankings: RankingDraft[] = ranked.map((player, index) => ({
      playerId: player.id,
      rank: index + 1,
      score: state.scores[player.id] ?? 0,
      isWinner: winners.includes(player.id),
      isDraw: winners.length > 1,
      stats: {
        validWords: state.validCounts[player.id] ?? 0,
        submissions: state.submissions.filter((entry) => entry.playerId === player.id).length,
        accuracy: Math.round(
          ((state.validCounts[player.id] ?? 0) /
            Math.max(1, state.submissions.filter((entry) => entry.playerId === player.id).length)) *
            100,
        ),
      },
    }));

    return { winners, isDraw: winners.length > 1, rankings, reason: 'completed' };
  },

  reset(state): WordRaceState {
    return {
      ...state,
      phase: 'idle',
      round: 0,
      category: null,
      categoriesUsed: [],
      roundEndsAt: null,
      submissions: [],
      usedWords: [],
      scores: Object.fromEntries(Object.keys(state.scores).map((id) => [id, 0])),
      validCounts: Object.fromEntries(Object.keys(state.validCounts).map((id) => [id, 0])),
      roundResults: [],
      lastEvent: null,
    };
  },

  cleanup(state): void {
    state.submissions = [];
    state.phase = 'finished';
  },

  getPublicState(state, _viewerId, ctx) {
    return {
      phase: state.phase,
      round: state.round,
      totalRounds: state.totalRounds,
      category: state.category,
      roundEndsAt: state.roundEndsAt,
      serverTime: ctx.now(),
      usedWords: [...state.usedWords],
      scores: { ...state.scores },
      submissions: state.submissions.slice(-40),
      roundResults: [...state.roundResults],
      lastEvent: state.lastEvent,
    };
  },

  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'typing' || state.category === null) return null;
    const pace = AI_PACE[difficulty];
    const pool = wordsFor(state.category).filter((word) => !state.usedWords.includes(word));
    if (pool.length === 0) return null;

    // A weaker AI sometimes repeats a word that is already taken (scores 0).
    if (ctx.random() > pace.accuracy && state.usedWords.length > 0) {
      return { type: 'submit', payload: { word: pick(state.usedWords, ctx.random) } };
    }
    return { type: 'submit', payload: { word: pick(pool, ctx.random) } };
  },

  maxDurationMs: 10 * 60 * 1000,
};

/* ------------------------------------------------------------------ */
/* Round orchestration                                                 */
/* ------------------------------------------------------------------ */

function beginRound(state: WordRaceState, ctx: GameContext): void {
  state.round += 1;
  state.phase = 'intro';
  const category = pickCategory(state, ctx);
  state.category = category;
  state.categoriesUsed.push(category);
  state.submissions = [];
  state.usedWords = [];
  state.roundEndsAt = null;
  state.lastEvent = `round-intro:${state.round}`;
  ctx.markStateChanged();

  ctx.schedule(INTRO_MS, () => {
    if (state.phase !== 'intro') return;
    state.phase = 'typing';
    state.roundEndsAt = ctx.now() + ROUND_SECONDS * 1000;
    state.lastEvent = `round-start:${state.round}`;
    ctx.markStateChanged();

    for (const player of ctx.players) {
      if (player.isAI) scheduleNextAIWord(state, ctx, player.id);
    }

    ctx.schedule(ROUND_SECONDS * 1000, () => endRound(state, ctx), 'gameDuration', 'round');
  }, 'turn', 'intro');
}

function scheduleNextAIWord(state: WordRaceState, ctx: GameContext, playerId: string): void {
  const player = ctx.players.find((candidate) => candidate.id === playerId);
  if (!player?.isAI) return;
  const difficulty = player.aiDifficulty ?? 'medium';
  const pace = AI_PACE[difficulty];
  const delay = pace.minMs + Math.floor(ctx.random() * (pace.maxMs - pace.minMs));
  ctx.requestAI(playerId, delay);
}

function endRound(state: WordRaceState, ctx: GameContext): void {
  if (state.phase !== 'typing') return;
  state.phase = 'roundResult';
  state.roundEndsAt = null;
  state.roundResults.push({ round: state.round, category: state.category, scores: { ...state.scores } });
  state.lastEvent = `round-end:${state.round}`;
  ctx.markStateChanged();

  ctx.schedule(RESULT_MS, () => {
    if (state.round >= state.totalRounds) {
      state.phase = 'finished';
      ctx.markStateChanged();
      ctx.finish('completed');
      return;
    }
    beginRound(state, ctx);
  }, 'turn', 'next-round');
}

export type { GameConfig };
