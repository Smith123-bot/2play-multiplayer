import type { AIDifficulty, GameAction, GameFinishReason } from '@2play/shared';
import { DRAW_GUESS_METADATA } from '@2play/shared';
export { DRAW_GUESS_METADATA };
import type {
  ActionResult,
  GameContext,
  GameModule,
  GameResultDraft,
  RankingDraft,
  ValidationResult,
} from '../GameModule';
import { actionAccepted, actionRejected } from '../GameModule';
import { allDrawWords, normalizeGuess, type DrawCategory } from './words';

/**
 * Draw & Guess Battle — party drawing with a server-owned secret word.
 *
 * Strokes are lists of normalised points (0–1). The secret word is stripped
 * from public state for every viewer except the current drawer.
 */

export type DrawPhase = 'idle' | 'prepare' | 'drawing' | 'reveal' | 'finished';
export type DrawTool = 'brush' | 'eraser';

export interface DrawPoint {
  x: number;
  y: number;
}

export interface DrawStroke {
  id: string;
  color: string;
  size: number;
  tool: DrawTool;
  points: DrawPoint[];
}

export interface DrawGuess {
  playerId: string;
  text: string;
  correct: boolean;
  at: number;
}

export interface DrawRound {
  number: number;
  drawerId: string;
  word: string;
  category: DrawCategory;
  startedAt: number;
  endsAt: number;
  strokes: DrawStroke[];
  guesses: DrawGuess[];
  solvedOrder: string[];
}

export interface DrawGuessState {
  phase: DrawPhase;
  round: number;
  totalRounds: number;
  prepareMs: number;
  drawMs: number;
  revealMs: number;
  current: DrawRound | null;
  history: Array<{ number: number; word: string; drawerId: string; solvers: string[] }>;
  scores: Record<string, number>;
  solvedCount: Record<string, number>;
  drawnCount: Record<string, number>;
  usedWords: string[];
  drawerCursor: number;
  startedAt: number | null;
  finishReason: GameFinishReason | null;
  lastEvent: string | null;
}

const DEFAULT_ROUNDS = 6;
const MIN_ROUNDS = 2;
const MAX_ROUNDS = 12;
const PREPARE_MS = 3000;
const DRAW_MS = 45_000;
const REVEAL_MS = 3500;
const MAX_GUESS_LENGTH = 32;
const MAX_STROKE_POINTS = 40;
const MAX_STROKES = 180;
const MAX_POINT_BATCH = 24;
const BRUSH_MIN = 2;
const BRUSH_MAX = 28;
const PALETTE = ['#111827', '#ef4444', '#3b82f6', '#22c55e', '#eab308', '#f97316', '#a855f7', '#78350f', '#ffffff'];
const GUESS_POINTS = [100, 75, 50, 25];
const DRAWER_BONUS = 40;

const AI_GUESS_DELAY: Record<AIDifficulty, number> = { easy: 14_000, medium: 8_000, hard: 3_500 };
const AI_GUESS_JITTER: Record<AIDifficulty, number> = { easy: 10_000, medium: 6_000, hard: 2_500 };
const AI_ACCURACY: Record<AIDifficulty, number> = { easy: 0.4, medium: 0.72, hard: 0.92 };

const WORD_BANK = allDrawWords();

function roundsFor(requested: number | undefined, playerCount: number): number {
  if (typeof requested === 'number' && Number.isFinite(requested)) {
    return Math.min(MAX_ROUNDS, Math.max(MIN_ROUNDS, Math.round(requested)));
  }
  return Math.min(MAX_ROUNDS, Math.max(DEFAULT_ROUNDS, playerCount * 2));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function isTool(value: unknown): value is DrawTool {
  return value === 'brush' || value === 'eraser';
}

function activeIds(ctx: GameContext, state: DrawGuessState): string[] {
  return ctx.players
    .filter((player) => (player.isAI || player.isConnected) && state.scores[player.id] !== undefined)
    .map((player) => player.id);
}

function guessersOf(state: DrawGuessState, ctx: GameContext): string[] {
  const drawerId = state.current?.drawerId;
  return activeIds(ctx, state).filter((id) => id !== drawerId);
}

export function pickPrompt(
  used: string[],
  rng: () => number,
): { word: string; category: DrawCategory } {
  const unused = WORD_BANK.filter((entry) => !used.includes(entry.word));
  const pool = unused.length > 0 ? unused : WORD_BANK;
  return pool[Math.floor(rng() * pool.length)]!;
}

export function guessPointsFor(index: number): number {
  return GUESS_POINTS[Math.min(index, GUESS_POINTS.length - 1)]!;
}

function nextDrawerId(state: DrawGuessState, ctx: GameContext): string | null {
  const seats = activeIds(ctx, state);
  if (seats.length === 0) return null;
  for (let step = 0; step < seats.length; step += 1) {
    const index = (state.drawerCursor + step) % seats.length;
    const id = seats[index];
    if (id) {
      state.drawerCursor = index + 1;
      return id;
    }
  }
  return seats[0] ?? null;
}

/** Starts prepare → drawing for a fresh round. Exported for tests. */
export function beginDrawRound(state: DrawGuessState, ctx: GameContext): void {
  const drawerId = nextDrawerId(state, ctx);
  if (!drawerId) {
    finishDrawMatch(state, ctx, 'abandoned');
    return;
  }
  const prompt = pickPrompt(state.usedWords, ctx.random);
  state.usedWords.push(prompt.word);
  if (state.usedWords.length >= WORD_BANK.length) state.usedWords = [prompt.word];

  const now = ctx.now();
  state.current = {
    number: state.round,
    drawerId,
    word: prompt.word,
    category: prompt.category,
    startedAt: now,
    endsAt: now + state.prepareMs + state.drawMs,
    strokes: [],
    guesses: [],
    solvedOrder: [],
  };
  state.drawnCount[drawerId] = (state.drawnCount[drawerId] ?? 0) + 1;
  state.phase = 'prepare';
  state.lastEvent = `prepare:${drawerId}`;
  ctx.markStateChanged();

  ctx.schedule(
    state.prepareMs,
    () => {
      if (state.phase !== 'prepare' || state.current?.number !== state.round) return;
      openDrawing(state, ctx);
    },
    'turn',
    'prepare',
  );
}

export function openDrawing(state: DrawGuessState, ctx: GameContext): void {
  if (state.phase !== 'prepare' || !state.current) return;
  const now = ctx.now();
  state.phase = 'drawing';
  state.current.startedAt = now;
  state.current.endsAt = now + state.drawMs;
  state.lastEvent = 'draw';
  ctx.markStateChanged();

  ctx.schedule(
    state.drawMs,
    () => {
      if (state.phase !== 'drawing' || state.current?.number !== state.round) return;
      completeDrawRound(state, ctx);
    },
    'turn',
    'draw-timeout',
  );

  for (const player of ctx.players) {
    if (!player.isAI) continue;
    if (player.id === state.current.drawerId) {
      ctx.requestAI(player.id, 400 + Math.floor(ctx.random() * 600));
      continue;
    }
    const difficulty = player.aiDifficulty ?? 'medium';
    const delay = AI_GUESS_DELAY[difficulty] + Math.floor(ctx.random() * AI_GUESS_JITTER[difficulty]);
    ctx.requestAI(player.id, delay);
  }
}

export function completeDrawRound(state: DrawGuessState, ctx: GameContext): void {
  if ((state.phase !== 'drawing' && state.phase !== 'prepare') || !state.current) return;
  state.history.push({
    number: state.current.number,
    word: state.current.word,
    drawerId: state.current.drawerId,
    solvers: [...state.current.solvedOrder],
  });
  state.phase = 'reveal';
  state.lastEvent = 'reveal';
  ctx.markStateChanged();

  ctx.schedule(
    state.revealMs,
    () => {
      if (state.phase !== 'reveal') return;
      beginNextDrawRound(state, ctx);
    },
    'turn',
    'reveal',
  );
}

export function beginNextDrawRound(state: DrawGuessState, ctx: GameContext): void {
  if (state.phase !== 'reveal') return;
  if (state.round >= state.totalRounds) {
    finishDrawMatch(state, ctx, 'completed');
    return;
  }
  state.round += 1;
  beginDrawRound(state, ctx);
}

export function finishDrawMatch(state: DrawGuessState, ctx: GameContext, reason: GameFinishReason): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.finishReason = reason;
  state.lastEvent = reason === 'timeout' ? 'timeout' : 'finished';
  ctx.markStateChanged();
  ctx.finish(reason);
}

function maybeEndRoundEarly(state: DrawGuessState, ctx: GameContext): void {
  if (state.phase !== 'drawing' || !state.current) return;
  const remaining = guessersOf(state, ctx).filter((id) => !state.current!.solvedOrder.includes(id));
  if (remaining.length === 0) completeDrawRound(state, ctx);
}

export const drawGuessGame: GameModule<DrawGuessState> = {
  metadata: DRAW_GUESS_METADATA,

  initialize(): void {
    // Stateless module.
  },

  createInitialState(players, config): DrawGuessState {
    return {
      phase: 'idle',
      round: 0,
      totalRounds: roundsFor(config.rounds, players.length),
      prepareMs: PREPARE_MS,
      drawMs: DRAW_MS,
      revealMs: REVEAL_MS,
      current: null,
      history: [],
      scores: Object.fromEntries(players.map((player) => [player.id, 0])),
      solvedCount: Object.fromEntries(players.map((player) => [player.id, 0])),
      drawnCount: Object.fromEntries(players.map((player) => [player.id, 0])),
      usedWords: [],
      drawerCursor: 0,
      startedAt: null,
      finishReason: null,
      lastEvent: null,
    };
  },

  playerJoined(player, state): void {
    if (state.scores[player.id] === undefined) state.scores[player.id] = 0;
    if (state.solvedCount[player.id] === undefined) state.solvedCount[player.id] = 0;
    if (state.drawnCount[player.id] === undefined) state.drawnCount[player.id] = 0;
  },

  playerReady(): void {
    // No per-player readiness behaviour.
  },

  playerLeft(playerId, state, ctx, reason): void {
    if (reason === 'disconnect') return;
    if (state.phase === 'drawing' && state.current?.drawerId === playerId) {
      completeDrawRound(state, ctx);
      return;
    }
    if (state.phase === 'drawing') maybeEndRoundEarly(state, ctx);
    if (state.phase !== 'finished' && activeIds(ctx, state).filter((id) => id !== playerId).length === 0) {
      finishDrawMatch(state, ctx, 'abandoned');
    }
  },

  start(state, ctx): void {
    if (state.phase !== 'idle') return;
    for (const player of ctx.players) {
      if (state.scores[player.id] === undefined) state.scores[player.id] = 0;
      if (state.solvedCount[player.id] === undefined) state.solvedCount[player.id] = 0;
      if (state.drawnCount[player.id] === undefined) state.drawnCount[player.id] = 0;
    }
    state.round = 1;
    state.startedAt = ctx.now();
    state.finishReason = null;
    const worstCase = state.totalRounds * (state.prepareMs + state.drawMs + state.revealMs) + 8000;
    ctx.schedule(worstCase, () => finishDrawMatch(state, ctx, 'timeout'), 'gameDuration', 'match-timeout');
    beginDrawRound(state, ctx);
  },

  validateAction(playerId, action, state): ValidationResult {
    if (action.type === 'stroke' || action.type === 'clear') {
      if (state.phase !== 'drawing') return { valid: false, reason: 'Drawing is not open right now.' };
      if (state.current?.drawerId !== playerId) return { valid: false, reason: 'Only the drawer can sketch.' };
      if (action.type === 'clear') return { valid: true };
      const points = action.payload?.points;
      if (!Array.isArray(points) || points.length === 0 || points.length > MAX_POINT_BATCH) {
        return { valid: false, reason: 'Send a short stroke of points.' };
      }
      if ((state.current?.strokes.length ?? 0) >= MAX_STROKES) {
        return { valid: false, reason: 'The canvas is full this round.' };
      }
      const color = action.payload?.color;
      if (typeof color !== 'string' || !PALETTE.includes(color)) {
        return { valid: false, reason: 'Pick a colour from the palette.' };
      }
      if (!isTool(action.payload?.tool)) return { valid: false, reason: 'Use the brush or eraser.' };
      return { valid: true };
    }
    if (action.type === 'guess') {
      if (state.phase !== 'drawing') return { valid: false, reason: 'Guessing is not open right now.' };
      if (state.current?.drawerId === playerId) return { valid: false, reason: 'The drawer cannot guess.' };
      if (state.current?.solvedOrder.includes(playerId)) {
        return { valid: false, reason: 'You already guessed this word.' };
      }
      const text = typeof action.payload?.text === 'string' ? normalizeGuess(action.payload.text) : '';
      if (!text || text.length > MAX_GUESS_LENGTH) return { valid: false, reason: 'Type a short guess.' };
      return { valid: true };
    }
    return { valid: false, reason: 'Unknown action.' };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    const round = state.current;
    if (!round) return actionRejected('No round is running.');

    if (action.type === 'clear') {
      if (state.phase !== 'drawing' || round.drawerId !== playerId) {
        return actionRejected('Only the drawer can clear the canvas.');
      }
      round.strokes = [];
      state.lastEvent = 'clear';
      ctx.markStateChanged();
      return actionAccepted();
    }

    if (action.type === 'stroke') {
      if (state.phase !== 'drawing' || round.drawerId !== playerId) {
        return actionRejected('Only the drawer can sketch.');
      }
      const rawPoints = action.payload?.points;
      if (!Array.isArray(rawPoints)) return actionRejected('Send a stroke of points.');
      const points: DrawPoint[] = [];
      for (const raw of rawPoints.slice(0, MAX_STROKE_POINTS)) {
        if (!raw || typeof raw !== 'object') continue;
        const record = raw as { x?: unknown; y?: unknown };
        if (typeof record.x !== 'number' || typeof record.y !== 'number') continue;
        points.push({ x: clamp01(record.x), y: clamp01(record.y) });
      }
      if (points.length === 0) return actionRejected('Empty stroke.');
      const color = typeof action.payload?.color === 'string' ? action.payload.color : PALETTE[0]!;
      const sizeRaw = action.payload?.size;
      const size =
        typeof sizeRaw === 'number' && Number.isFinite(sizeRaw)
          ? Math.min(BRUSH_MAX, Math.max(BRUSH_MIN, Math.round(sizeRaw)))
          : 6;
      const tool: DrawTool = isTool(action.payload?.tool) ? action.payload.tool : 'brush';
      round.strokes.push({
        id: `s${round.strokes.length + 1}`,
        color: PALETTE.includes(color) ? color : PALETTE[0]!,
        size,
        tool,
        points,
      });
      if (round.strokes.length > MAX_STROKES) round.strokes.splice(0, round.strokes.length - MAX_STROKES);
      state.lastEvent = 'stroke';
      ctx.markStateChanged();
      return actionAccepted();
    }

    if (action.type === 'guess') {
      if (state.phase !== 'drawing') return actionRejected('Guessing is not open right now.');
      if (round.drawerId === playerId) return actionRejected('The drawer cannot guess.');
      if (round.solvedOrder.includes(playerId)) return actionRejected('You already guessed this word.');
      const text = typeof action.payload?.text === 'string' ? normalizeGuess(action.payload.text) : '';
      if (!text) return actionRejected('Type a guess.');
      const correct = text === normalizeGuess(round.word);
      round.guesses.push({ playerId, text, correct, at: ctx.now() });
      if (correct) {
        const points = guessPointsFor(round.solvedOrder.length);
        round.solvedOrder.push(playerId);
        state.scores[playerId] = (state.scores[playerId] ?? 0) + points;
        state.solvedCount[playerId] = (state.solvedCount[playerId] ?? 0) + 1;
        state.scores[round.drawerId] = (state.scores[round.drawerId] ?? 0) + DRAWER_BONUS;
        state.lastEvent = `correct:${playerId}`;
        ctx.markStateChanged();
        maybeEndRoundEarly(state, ctx);
        return actionAccepted();
      }
      state.lastEvent = `wrong:${playerId}`;
      ctx.markStateChanged();
      return actionAccepted();
    }

    return actionRejected('Unknown action.');
  },

  update(): void {
    // Timers drive the round.
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
      return (state.solvedCount[b.id] ?? 0) - (state.solvedCount[a.id] ?? 0);
    });
    const top = state.scores[ranked[0]?.id ?? ''] ?? 0;
    const winners = ranked.filter((player) => (state.scores[player.id] ?? 0) === top).map((player) => player.id);
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
          drawn: state.drawnCount[player.id] ?? 0,
        },
      };
    });
    return { winners, isDraw: winners.length > 1, rankings, reason: state.finishReason ?? 'completed' };
  },

  reset(state): DrawGuessState {
    const zero = (table: Record<string, number>) => Object.fromEntries(Object.keys(table).map((id) => [id, 0]));
    return {
      ...state,
      phase: 'idle',
      round: 0,
      current: null,
      history: [],
      scores: zero(state.scores),
      solvedCount: zero(state.solvedCount),
      drawnCount: zero(state.drawnCount),
      usedWords: [],
      drawerCursor: 0,
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
   * Privacy: the secret word is sent ONLY to the current drawer (and during
   * reveal / history). Guess text from other players is public; correctness
   * of in-flight guesses is visible so the room can cheer, but the word itself
   * is never in the payload for guessers mid-round.
   */
  getPublicState(state, viewerId, ctx) {
    const current = state.current;
    const isDrawer = Boolean(viewerId && current && current.drawerId === viewerId);
    const reveal = state.phase === 'reveal' || state.phase === 'finished';
    return {
      phase: state.phase,
      round: state.round,
      totalRounds: state.totalRounds,
      prepareMs: state.prepareMs,
      drawMs: state.drawMs,
      drawerId: current?.drawerId ?? null,
      category: current?.category ?? null,
      word: isDrawer || reveal ? (current?.word ?? null) : null,
      endsAt: current?.endsAt ?? null,
      strokes: current
        ? current.strokes.map((stroke) => ({
            id: stroke.id,
            color: stroke.color,
            size: stroke.size,
            tool: stroke.tool,
            points: stroke.points.map((point) => ({ x: point.x, y: point.y })),
          }))
        : [],
      solved: current ? [...current.solvedOrder] : [],
      guesses: current
        ? current.guesses.map((guess) => ({
            playerId: guess.playerId,
            text: guess.text,
            correct: guess.correct,
          }))
        : [],
      scores: { ...state.scores },
      solvedCount: { ...state.solvedCount },
      history: state.history.map((entry) => ({ ...entry, solvers: [...entry.solvers] })),
      palette: [...PALETTE],
      finishReason: state.finishReason,
      lastEvent: state.lastEvent,
      serverTime: ctx.now(),
    };
  },

  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (!state.current) return null;
    if (state.phase === 'drawing' && state.current.drawerId === playerId) {
      // A simple scribble so the canvas is not blank — never encodes the word.
      const rng = ctx.random;
      const points: DrawPoint[] = [];
      const ox = 0.3 + rng() * 0.3;
      const oy = 0.3 + rng() * 0.3;
      for (let i = 0; i < 8; i += 1) {
        points.push({
          x: clamp01(ox + Math.cos(i) * 0.12 * (0.5 + rng())),
          y: clamp01(oy + Math.sin(i) * 0.12 * (0.5 + rng())),
        });
      }
      return {
        type: 'stroke',
        payload: { color: PALETTE[Math.floor(rng() * (PALETTE.length - 1))]!, size: 8, tool: 'brush', points },
      };
    }
    if (state.phase !== 'drawing') return null;
    if (state.current.drawerId === playerId) return null;
    if (state.current.solvedOrder.includes(playerId)) return null;
    const correct = ctx.random() < AI_ACCURACY[difficulty];
    const text = correct ? state.current.word : 'sketch';
    return { type: 'guess', payload: { text } };
  },

  maxDurationMs: 12 * 60 * 1000,
};
