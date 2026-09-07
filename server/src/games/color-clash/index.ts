import type { AIDifficulty, GameAction, GameFinishReason } from '@2play/shared';
import { COLOR_CLASH_METADATA } from '@2play/shared';
export { COLOR_CLASH_METADATA };
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
 * Color Clash — fast colour-selection rounds. The server owns the target,
 * the correct option id, timestamps and scores. Labels travel with every
 * colour so the game is not colour-only.
 */

export type ClashPhase = 'idle' | 'preview' | 'round' | 'reveal' | 'finished';
export type ClashRoundType = 'name' | 'stroop' | 'memory' | 'race';

export interface ClashColor {
  id: string;
  label: string;
  hex: string;
}

export interface ClashOption {
  id: string;
  color: ClashColor;
}

export interface ClashPick {
  optionId: string;
  correct: boolean;
  elapsedMs: number;
  points: number;
}

export interface ClashRound {
  number: number;
  kind: ClashRoundType;
  instruction: string;
  word: string | null;
  wordInk: string | null;
  previewColor: ClashColor | null;
  options: ClashOption[];
  correctOptionId: string;
  startedAt: number;
  endsAt: number;
  picks: Record<string, ClashPick>;
}

export interface ColorClashState {
  phase: ClashPhase;
  round: number;
  totalRounds: number;
  previewMs: number;
  roundMs: number;
  revealMs: number;
  current: ClashRound | null;
  history: Array<{ number: number; kind: ClashRoundType; correctOptionId: string; winner: string | null }>;
  scores: Record<string, number>;
  hits: Record<string, number>;
  wrongs: Record<string, number>;
  startedAt: number | null;
  finishReason: GameFinishReason | null;
  lastEvent: string | null;
}

export const CLASH_COLORS: ClashColor[] = [
  { id: 'red', label: 'Red', hex: '#ef4444' },
  { id: 'blue', label: 'Blue', hex: '#3b82f6' },
  { id: 'green', label: 'Green', hex: '#22c55e' },
  { id: 'yellow', label: 'Yellow', hex: '#eab308' },
  { id: 'purple', label: 'Purple', hex: '#a855f7' },
  { id: 'orange', label: 'Orange', hex: '#f97316' },
];

const KINDS: ClashRoundType[] = ['name', 'stroop', 'memory', 'race'];
const DEFAULT_ROUNDS = 12;
const MIN_ROUNDS = 4;
const MAX_ROUNDS = 16;
const PREVIEW_MS = 900;
const ROUND_MS = 5000;
const REVEAL_MS = 1400;
const PLACE_POINTS = [100, 75, 50, 25];

const AI_DELAY: Record<AIDifficulty, number> = { easy: 2400, medium: 1200, hard: 420 };
const AI_JITTER: Record<AIDifficulty, number> = { easy: 1600, medium: 900, hard: 380 };
const AI_ACCURACY: Record<AIDifficulty, number> = { easy: 0.55, medium: 0.82, hard: 0.96 };

function roundsFor(requested?: number): number {
  if (typeof requested === 'number' && Number.isFinite(requested)) {
    return Math.min(MAX_ROUNDS, Math.max(MIN_ROUNDS, Math.round(requested)));
  }
  return DEFAULT_ROUNDS;
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

function pickColor(rng: () => number, except?: string): ClashColor {
  const pool = except ? CLASH_COLORS.filter((color) => color.id !== except) : CLASH_COLORS;
  return pool[Math.floor(rng() * pool.length)]!;
}

function optionCount(kind: ClashRoundType): number {
  return kind === 'race' ? 6 : 4;
}

export function buildClashRound(rng: () => number, number: number): Omit<ClashRound, 'startedAt' | 'endsAt' | 'picks'> {
  const kind = KINDS[(number - 1) % KINDS.length]!;
  const target = pickColor(rng);
  const count = optionCount(kind);
  const others = shuffle(
    CLASH_COLORS.filter((color) => color.id !== target.id),
    rng,
  ).slice(0, count - 1);
  const mixed = shuffle([target, ...others], rng);
  const options: ClashOption[] = mixed.map((color, index) => ({
    id: `opt-${index}`,
    color,
  }));
  const correctOptionId = options.find((option) => option.color.id === target.id)!.id;

  if (kind === 'name') {
    return {
      number,
      kind,
      instruction: `Tap ${target.label}`,
      word: null,
      wordInk: null,
      previewColor: null,
      options,
      correctOptionId,
    };
  }
  if (kind === 'stroop') {
    const ink = pickColor(rng, target.id);
    const inkOthers = shuffle(
      CLASH_COLORS.filter((color) => color.id !== ink.id),
      rng,
    ).slice(0, count - 1);
    const inkMixed = shuffle([ink, ...inkOthers], rng);
    const inkOptions: ClashOption[] = inkMixed.map((color, index) => ({
      id: `opt-${index}`,
      color,
    }));
    return {
      number,
      kind,
      instruction: 'Tap the INK colour (not the written word)',
      word: target.label.toUpperCase(),
      wordInk: ink.hex,
      previewColor: null,
      options: inkOptions,
      correctOptionId: inkOptions.find((option) => option.color.id === ink.id)!.id,
    };
  }
  if (kind === 'memory') {
    return {
      number,
      kind,
      instruction: 'Tap the colour you just saw',
      word: null,
      wordInk: null,
      previewColor: target,
      options,
      correctOptionId,
    };
  }
  return {
    number,
    kind,
    instruction: `Find ${target.label}`,
    word: null,
    wordInk: null,
    previewColor: null,
    options,
    correctOptionId,
  };
}

function activeIds(ctx: GameContext): string[] {
  return ctx.players.filter((player) => player.isAI || player.isConnected).map((player) => player.id);
}

export function beginClashRound(state: ColorClashState, ctx: GameContext): void {
  const built = buildClashRound(ctx.random, state.round);
  const now = ctx.now();
  const preview = built.kind === 'memory';
  state.current = {
    ...built,
    startedAt: now,
    endsAt: now + (preview ? state.previewMs + state.roundMs : state.roundMs),
    picks: {},
  };
  state.phase = preview ? 'preview' : 'round';
  state.lastEvent = preview ? 'preview' : 'round-start';
  ctx.markStateChanged();

  if (preview) {
    ctx.schedule(
      state.previewMs,
      () => {
        if (state.phase !== 'preview' || state.current?.number !== state.round) return;
        openClashOptions(state, ctx);
      },
      'turn',
      'preview',
    );
  } else {
    armRoundTimer(state, ctx);
    requestClashAI(state, ctx);
  }
}

export function openClashOptions(state: ColorClashState, ctx: GameContext): void {
  if (!state.current) return;
  const now = ctx.now();
  state.phase = 'round';
  state.current.startedAt = now;
  state.current.endsAt = now + state.roundMs;
  state.lastEvent = 'round-start';
  ctx.markStateChanged();
  armRoundTimer(state, ctx);
  requestClashAI(state, ctx);
}

function armRoundTimer(state: ColorClashState, ctx: GameContext): void {
  ctx.schedule(
    state.roundMs,
    () => {
      if (state.phase !== 'round' || state.current?.number !== state.round) return;
      completeClashRound(state, ctx);
    },
    'turn',
    'round-timeout',
  );
}

function requestClashAI(state: ColorClashState, ctx: GameContext): void {
  for (const player of ctx.players) {
    if (!player.isAI) continue;
    const difficulty = player.aiDifficulty ?? 'medium';
    const delay = AI_DELAY[difficulty] + Math.floor(ctx.random() * AI_JITTER[difficulty]);
    ctx.requestAI(player.id, delay);
  }
}

export function completeClashRound(state: ColorClashState, ctx: GameContext): void {
  if (state.phase !== 'round' || !state.current) return;
  const correct = Object.entries(state.current.picks)
    .filter(([, pick]) => pick.correct)
    .sort((a, b) => a[1].elapsedMs - b[1].elapsedMs);
  state.history.push({
    number: state.current.number,
    kind: state.current.kind,
    correctOptionId: state.current.correctOptionId,
    winner: correct[0]?.[0] ?? null,
  });
  state.phase = 'reveal';
  state.lastEvent = 'reveal';
  ctx.markStateChanged();
  ctx.schedule(
    state.revealMs,
    () => {
      if (state.phase !== 'reveal') return;
      beginNextClashRound(state, ctx);
    },
    'turn',
    'reveal',
  );
}

export function beginNextClashRound(state: ColorClashState, ctx: GameContext): void {
  if (state.phase !== 'reveal') return;
  if (state.round >= state.totalRounds) {
    finishClash(state, ctx, 'completed');
    return;
  }
  state.round += 1;
  beginClashRound(state, ctx);
}

export function finishClash(state: ColorClashState, ctx: GameContext, reason: GameFinishReason): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.finishReason = reason;
  state.lastEvent = reason === 'timeout' ? 'timeout' : 'finished';
  ctx.markStateChanged();
  ctx.finish(reason);
}

function placePoints(index: number): number {
  return PLACE_POINTS[Math.min(index, PLACE_POINTS.length - 1)] ?? 25;
}

export const colorClashGame: GameModule<ColorClashState> = {
  metadata: COLOR_CLASH_METADATA,

  initialize(): void {
    // Stateless module.
  },

  createInitialState(players, config): ColorClashState {
    return {
      phase: 'idle',
      round: 0,
      totalRounds: roundsFor(config.rounds),
      previewMs: PREVIEW_MS,
      roundMs: ROUND_MS,
      revealMs: REVEAL_MS,
      current: null,
      history: [],
      scores: Object.fromEntries(players.map((player) => [player.id, 0])),
      hits: Object.fromEntries(players.map((player) => [player.id, 0])),
      wrongs: Object.fromEntries(players.map((player) => [player.id, 0])),
      startedAt: null,
      finishReason: null,
      lastEvent: null,
    };
  },

  playerJoined(player, state): void {
    if (state.scores[player.id] === undefined) state.scores[player.id] = 0;
    if (state.hits[player.id] === undefined) state.hits[player.id] = 0;
    if (state.wrongs[player.id] === undefined) state.wrongs[player.id] = 0;
  },

  playerReady(): void {
    // No per-player readiness behaviour.
  },

  playerLeft(playerId, state, ctx, reason): void {
    if (reason === 'disconnect') return;
    if (state.phase === 'round' && state.current) {
      const remaining = activeIds(ctx).filter((id) => id !== playerId && !state.current!.picks[id]);
      if (remaining.length === 0) completeClashRound(state, ctx);
    }
    if (state.phase !== 'finished' && activeIds(ctx).filter((id) => id !== playerId).length === 0) {
      finishClash(state, ctx, 'abandoned');
    }
  },

  start(state, ctx): void {
    if (state.phase !== 'idle') return;
    state.round = 1;
    state.startedAt = ctx.now();
    const worst = state.totalRounds * (state.previewMs + state.roundMs + state.revealMs) + 5000;
    ctx.schedule(worst, () => finishClash(state, ctx, 'timeout'), 'gameDuration', 'match-timeout');
    beginClashRound(state, ctx);
  },

  validateAction(playerId, action, state): ValidationResult {
    if (action.type !== 'pick') return { valid: false, reason: 'Unknown action.' };
    if (state.phase !== 'round') return { valid: false, reason: 'Nothing to pick right now.' };
    const optionId = action.payload?.optionId;
    if (typeof optionId !== 'string' || state.current?.options.every((option) => option.id !== optionId)) {
      return { valid: false, reason: 'That colour is not on the board.' };
    }
    if (state.current?.picks[playerId]) return { valid: false, reason: 'You already picked this round.' };
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    if (action.type !== 'pick') return actionRejected('Unknown action.');
    const round = state.current;
    if (!round || state.phase !== 'round') return actionRejected('Nothing to pick right now.');
    if (round.picks[playerId]) return actionRejected('You already picked this round.');
    const optionId = action.payload?.optionId;
    const option = round.options.find((candidate) => candidate.id === optionId);
    if (!option) return actionRejected('That colour is not on the board.');

    const correct = option.id === round.correctOptionId;
    const elapsed = ctx.now() - round.startedAt;
    let points = 0;
    if (correct) {
      const priorCorrect = Object.values(round.picks).filter((pick) => pick.correct).length;
      points = placePoints(priorCorrect);
      state.scores[playerId] = (state.scores[playerId] ?? 0) + points;
      state.hits[playerId] = (state.hits[playerId] ?? 0) + 1;
      state.lastEvent = `hit:${playerId}`;
    } else {
      state.wrongs[playerId] = (state.wrongs[playerId] ?? 0) + 1;
      state.lastEvent = `miss:${playerId}`;
    }
    round.picks[playerId] = { optionId: option.id, correct, elapsedMs: elapsed, points };
    ctx.markStateChanged();

    const remaining = activeIds(ctx).filter((id) => !round.picks[id]);
    if (remaining.length === 0) completeClashRound(state, ctx);
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
  },

  getResult(state, ctx): GameResultDraft {
    const ranked = [...ctx.players].sort((a, b) => (state.scores[b.id] ?? 0) - (state.scores[a.id] ?? 0));
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
          hits: state.hits[player.id] ?? 0,
          wrongs: state.wrongs[player.id] ?? 0,
        },
      };
    });
    return { winners, isDraw: winners.length > 1, rankings, reason: state.finishReason ?? 'completed' };
  },

  reset(state): ColorClashState {
    const zero = (table: Record<string, number>) => Object.fromEntries(Object.keys(table).map((id) => [id, 0]));
    return {
      ...state,
      phase: 'idle',
      round: 0,
      current: null,
      history: [],
      scores: zero(state.scores),
      hits: zero(state.hits),
      wrongs: zero(state.wrongs),
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

  getPublicState(state, viewerId, ctx) {
    const current = state.current;
    const reveal = state.phase === 'reveal';
    const preview = state.phase === 'preview';
    return {
      phase: state.phase,
      round: state.round,
      totalRounds: state.totalRounds,
      kind: current?.kind ?? null,
      instruction: current?.instruction ?? null,
      word: current?.word ?? null,
      wordInk: current?.wordInk ?? null,
      previewColor: preview ? current?.previewColor ?? null : null,
      options: preview ? [] : current ? current.options.map((option) => ({ id: option.id, color: option.color })) : [],
      endsAt: current?.endsAt ?? null,
      picked: current ? Object.fromEntries(Object.entries(current.picks).map(([id, pick]) => [id, pick.optionId])) : {},
      myPick: viewerId && current?.picks[viewerId] ? { ...current.picks[viewerId]! } : null,
      correctOptionId: reveal ? (current?.correctOptionId ?? null) : null,
      scores: { ...state.scores },
      hits: { ...state.hits },
      history: state.history.map((entry) => ({ ...entry })),
      finishReason: state.finishReason,
      lastEvent: state.lastEvent,
      serverTime: ctx.now(),
    };
  },

  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'round' || !state.current) return null;
    if (state.current.picks[playerId]) return null;
    const round = state.current;
    if (ctx.random() < AI_ACCURACY[difficulty]) {
      return { type: 'pick', payload: { optionId: round.correctOptionId } };
    }
    const wrong = round.options.filter((option) => option.id !== round.correctOptionId);
    return { type: 'pick', payload: { optionId: wrong[Math.floor(ctx.random() * wrong.length)]!.id } };
  },

  maxDurationMs: 10 * 60 * 1000,
};
