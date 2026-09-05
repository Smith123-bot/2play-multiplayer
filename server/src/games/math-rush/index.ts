import type { AIDifficulty, GameAction, GameConfig } from '@2play/shared';
import type {
  ActionResult,
  GameContext,
  GameModule,
  GameResultDraft,
  RankingDraft,
  ValidationResult,
} from '../GameModule';
import { actionAccepted, actionRejected } from '../GameModule';
import { MATH_RUSH_METADATA } from '@2play/shared';
export { MATH_RUSH_METADATA };

export interface MathQuestion {
  id: string;
  text: string;
  /** Kept server side only until the reveal phase. */
  answer: number;
  endsAt: number;
  difficulty: AIDifficulty;
}

export interface MathAnswer {
  playerId: string;
  questionId: string;
  value: number;
  correct: boolean;
  timeMs: number;
  points: number;
}

export interface MathRushState {
  phase: 'idle' | 'question' | 'reveal' | 'finished';
  questionIndex: number;
  totalQuestions: number;
  difficulty: AIDifficulty;
  question: MathQuestion | null;
  answers: MathAnswer[];
  /** Players locked out of the current question (answered already). */
  answered: string[];
  scores: Record<string, number>;
  correctCounts: Record<string, number>;
  fastestMs: Record<string, number>;
  history: Array<{ questionId: string; text: string; answer: number; scorers: string[] }>;
  lastEvent: string | null;
  seed: number;
}


const QUESTION_SECONDS: Record<AIDifficulty, number> = { easy: 20, medium: 16, hard: 13 };
const REVEAL_MS = 2200;
const TOTAL_QUESTIONS = 10;
const BASE_POINTS = 10;
const MAX_BONUS = 10;

/** AI answering pace and accuracy. */
const AI_PACE: Record<AIDifficulty, { minMs: number; maxMs: number; accuracy: number }> = {
  easy: { minMs: 6000, maxMs: 11000, accuracy: 0.6 },
  medium: { minMs: 3500, maxMs: 7000, accuracy: 0.85 },
  hard: { minMs: 1600, maxMs: 4000, accuracy: 0.97 },
};

interface GeneratedQuestion {
  text: string;
  answer: number;
}

/** Deterministic question generator (seeded, server side only). */
function generateQuestion(difficulty: AIDifficulty, random: () => number): GeneratedQuestion {
  const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));

  if (difficulty === 'easy') {
    const a = int(2, 40);
    const b = int(2, 40);
    if (random() < 0.5) return { text: `${a} + ${b}`, answer: a + b };
    const big = Math.max(a, b);
    const small = Math.min(a, b);
    return { text: `${big} - ${small}`, answer: big - small };
  }

  if (difficulty === 'medium') {
    const roll = random();
    if (roll < 0.3) {
      const a = int(20, 90);
      const b = int(10, 90);
      return { text: `${a} + ${b}`, answer: a + b };
    }
    if (roll < 0.5) {
      const a = int(30, 150);
      const b = int(10, 120);
      return { text: `${a} - ${b}`, answer: a - b };
    }
    if (roll < 0.8) {
      const a = int(3, 12);
      const b = int(3, 12);
      return { text: `${a} × ${b}`, answer: a * b };
    }
    const b = int(2, 12);
    const quotient = int(2, 12);
    return { text: `${b * quotient} ÷ ${b}`, answer: quotient };
  }

  // Hard: multiplication, division, percentages and mixed arithmetic.
  const roll = random();
  if (roll < 0.25) {
    const a = int(11, 25);
    const b = int(6, 19);
    return { text: `${a} × ${b}`, answer: a * b };
  }
  if (roll < 0.45) {
    const b = int(4, 15);
    const quotient = int(6, 20);
    return { text: `${b * quotient} ÷ ${b}`, answer: quotient };
  }
  if (roll < 0.7) {
    const percent = int(5, 90);
    const value = int(20, 400);
    return { text: `${percent}% of ${value}`, answer: Math.round((percent / 100) * value) };
  }
  const a = int(10, 60);
  const b = int(3, 12);
  const c = int(5, 40);
  if (random() < 0.5) return { text: `${a} + ${b} × ${c}`, answer: a + b * c };
  return { text: `(${a} + ${c}) × ${b}`, answer: (a + c) * b };
}

export const mathRushGame: GameModule<MathRushState> = {
  metadata: MATH_RUSH_METADATA,

  initialize(): void {
    // Stateless module.
  },

  createInitialState(players, config): MathRushState {
    const difficulty: AIDifficulty = config.aiDifficulty ?? 'medium';
    return {
      phase: 'idle',
      questionIndex: 0,
      totalQuestions: TOTAL_QUESTIONS,
      difficulty,
      question: null,
      answers: [],
      answered: [],
      scores: Object.fromEntries(players.map((player) => [player.id, 0])),
      correctCounts: Object.fromEntries(players.map((player) => [player.id, 0])),
      fastestMs: Object.fromEntries(players.map((player) => [player.id, 0])),
      history: [],
      lastEvent: null,
      seed: config.seed ?? 1,
    };
  },

  playerJoined(player, state): void {
    if (state.scores[player.id] === undefined) state.scores[player.id] = 0;
    if (state.correctCounts[player.id] === undefined) state.correctCounts[player.id] = 0;
  },

  playerReady(): void {
    // Lobby concern.
  },

  playerLeft(playerId, state, ctx): void {
    state.answered = state.answered.filter((id) => id !== playerId);
    if (state.phase === 'question') {
      const remaining = ctx.players.filter(
        (player) => (player.isAI || player.isConnected) && player.id !== playerId,
      );
      if (remaining.length === 0) ctx.finish('abandoned');
    }
  },

  start(state, ctx): void {
    nextQuestion(state, ctx);
  },

  validateAction(playerId, action, state, ctx): ValidationResult {
    if (action.type !== 'answer') return { valid: false, reason: 'Unknown action.' };
    if (state.phase !== 'question' || !state.question) {
      return { valid: false, reason: 'There is no active question.' };
    }
    if (state.answered.includes(playerId)) {
      return { valid: false, reason: 'You already answered this question.' };
    }
    const questionId = action.payload?.questionId;
    if (questionId !== state.question.id) {
      return { valid: false, reason: 'That question is no longer active.' };
    }
    const value = action.payload?.value;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { valid: false, reason: 'Enter a number.' };
    }
    if (Math.abs(value) > 1_000_000) return { valid: false, reason: 'That answer is out of range.' };
    if (ctx.now() > state.question.endsAt) return { valid: false, reason: 'Time is up.' };
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    if (action.type !== 'answer') return actionRejected('Unknown action.');
    if (!state.question) return actionRejected('There is no active question.');

    const value = Number(action.payload?.value);
    const question = state.question;
    const timeMs = Math.max(0, ctx.now() - (question.endsAt - QUESTION_SECONDS[state.difficulty] * 1000));
    const correct = value === question.answer;
    const remainingMs = Math.max(0, question.endsAt - ctx.now());
    const bonus = correct
      ? Math.round(Math.min(MAX_BONUS, (remainingMs / (QUESTION_SECONDS[state.difficulty] * 1000)) * MAX_BONUS))
      : 0;
    const points = correct ? BASE_POINTS + bonus : 0;

    state.answers.push({ playerId, questionId: question.id, value, correct, timeMs, points });
    state.answered.push(playerId);
    if (correct) {
      state.scores[playerId] = (state.scores[playerId] ?? 0) + points;
      state.correctCounts[playerId] = (state.correctCounts[playerId] ?? 0) + 1;
      const fastest = state.fastestMs[playerId] ?? 0;
      if (fastest === 0 || timeMs < fastest) state.fastestMs[playerId] = timeMs;
    }
    state.lastEvent = `answer:${playerId}:${correct ? 'correct' : 'wrong'}`;
    ctx.markStateChanged();

    // Everyone has answered: reveal immediately instead of waiting for the clock.
    const participants = ctx.players.filter((player) => player.isAI || player.isConnected);
    if (participants.every((player) => state.answered.includes(player.id))) {
      revealQuestion(state, ctx);
    }
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
    state.question = null;
  },

  getResult(state, ctx): GameResultDraft {
    const ranked = [...ctx.players].sort((a, b) => {
      const diff = (state.scores[b.id] ?? 0) - (state.scores[a.id] ?? 0);
      if (diff !== 0) return diff;
      return (state.correctCounts[b.id] ?? 0) - (state.correctCounts[a.id] ?? 0);
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
        correct: state.correctCounts[player.id] ?? 0,
        accuracy: Math.round(
          ((state.correctCounts[player.id] ?? 0) / Math.max(1, state.totalQuestions)) * 100,
        ),
        fastestMs: Math.round(state.fastestMs[player.id] ?? 0),
      },
    }));

    return { winners, isDraw: winners.length > 1, rankings, reason: 'completed' };
  },

  reset(state): MathRushState {
    return {
      ...state,
      phase: 'idle',
      questionIndex: 0,
      question: null,
      answers: [],
      answered: [],
      scores: Object.fromEntries(Object.keys(state.scores).map((id) => [id, 0])),
      correctCounts: Object.fromEntries(Object.keys(state.correctCounts).map((id) => [id, 0])),
      fastestMs: Object.fromEntries(Object.keys(state.fastestMs).map((id) => [id, 0])),
      history: [],
      lastEvent: null,
      seed: (state.seed + 1013) >>> 0,
    };
  },

  cleanup(state): void {
    state.question = null;
    state.answers = [];
    state.phase = 'finished';
  },

  /** The answer is only published during the reveal phase. */
  getPublicState(state, _viewerId, ctx) {
    const revealAnswer = state.phase === 'reveal' || state.phase === 'finished';
    return {
      phase: state.phase,
      questionIndex: state.questionIndex,
      totalQuestions: state.totalQuestions,
      difficulty: state.difficulty,
      serverTime: ctx.now(),
      question: state.question
        ? {
            id: state.question.id,
            text: state.question.text,
            endsAt: state.question.endsAt,
            ...(revealAnswer ? { answer: state.question.answer } : {}),
          }
        : null,
      answered: [...state.answered],
      scores: { ...state.scores },
      correctCounts: { ...state.correctCounts },
      fastestMs: { ...state.fastestMs },
      recentAnswers: state.answers.slice(-12).map((answer) => ({
        playerId: answer.playerId,
        correct: answer.correct,
        points: answer.points,
        timeMs: answer.timeMs,
      })),
      history: state.history.slice(-10),
      lastEvent: state.lastEvent,
    };
  },

  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'question' || !state.question) return null;
    if (state.answered.includes(playerId)) return null;
    const pace = AI_PACE[difficulty];
    const correct = ctx.random() < pace.accuracy;
    if (!correct) {
      // A believable near miss (the AI still has to "compute" something).
      const offset = 1 + Math.floor(ctx.random() * 6);
      const value = state.question.answer + (ctx.random() < 0.5 ? offset : -offset);
      return { type: 'answer', payload: { questionId: state.question.id, value } };
    }
    return { type: 'answer', payload: { questionId: state.question.id, value: state.question.answer } };
  },

  maxDurationMs: 12 * 60 * 1000,
};

/* ------------------------------------------------------------------ */
/* Question orchestration                                              */
/* ------------------------------------------------------------------ */

function nextQuestion(state: MathRushState, ctx: GameContext): void {
  if (state.questionIndex >= state.totalQuestions) {
    state.phase = 'finished';
    ctx.markStateChanged();
    ctx.finish('completed');
    return;
  }

  state.questionIndex += 1;
  const generated = generateQuestion(state.difficulty, ctx.random);
  const durationMs = QUESTION_SECONDS[state.difficulty] * 1000;
  state.question = {
    id: `q${state.questionIndex}-${ctx.now()}`,
    text: generated.text,
    answer: generated.answer,
    endsAt: ctx.now() + durationMs,
    difficulty: state.difficulty,
  };
  state.answers = [];
  state.answered = [];
  state.phase = 'question';
  state.lastEvent = `question:${state.questionIndex}`;
  ctx.markStateChanged();

  for (const player of ctx.players) {
    if (!player.isAI) continue;
    const difficulty = player.aiDifficulty ?? 'medium';
    const pace = AI_PACE[difficulty];
    const delay = Math.min(
      durationMs - 200,
      pace.minMs + Math.floor(ctx.random() * (pace.maxMs - pace.minMs)),
    );
    ctx.requestAI(player.id, Math.max(400, delay));
  }

  ctx.schedule(durationMs, () => revealQuestion(state, ctx), 'gameDuration', 'question');
}

function revealQuestion(state: MathRushState, ctx: GameContext): void {
  if (state.phase !== 'question') return;
  if (!state.question) return;

  state.history.push({
    questionId: state.question.id,
    text: state.question.text,
    answer: state.question.answer,
    scorers: state.answers.filter((answer) => answer.correct).map((answer) => answer.playerId),
  });
  state.phase = 'reveal';
  state.lastEvent = `reveal:${state.questionIndex}`;
  ctx.markStateChanged();

  ctx.schedule(REVEAL_MS, () => nextQuestion(state, ctx), 'turn', 'next-question');
}

export type { GameConfig };
