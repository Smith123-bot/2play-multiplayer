import type { GameAction, GameFinishReason } from '@2play/shared';
import { ONE_BUTTON_METADATA } from '@2play/shared';
export { ONE_BUTTON_METADATA };
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
 * One Button Battle — one primary action, many contexts. Clients only send tap.
 * The server owns the window, the context and the score.
 */

export type ButtonPhase = 'idle' | 'playing' | 'finished';
export type ButtonContext = 'jump' | 'dash' | 'dodge' | 'switch' | 'collect' | 'shield';
export type TapResult = 'hit' | 'miss' | 'ignored';

export interface CueEvent {
  id: number;
  context: ButtonContext;
  appearAt: number;
  windowStart: number;
  windowEnd: number;
  resolved: Record<string, 'hit' | 'miss' | 'pending'>;
}

export interface OneButtonPlayer {
  score: number;
  streak: number;
  hits: number;
  misses: number;
  lastResult: 'hit' | 'miss' | 'idle';
  disconnected: boolean;
  left: boolean;
}

export interface OneButtonState {
  phase: ButtonPhase;
  events: CueEvent[];
  currentIndex: number;
  players: Record<string, OneButtonPlayer>;
  startedAt: number | null;
  endsAt: number | null;
  sequenceMs: number;
  finishReason: GameFinishReason | null;
  lastEvent: string | null;
}

export const CONTEXTS: ButtonContext[] = ['jump', 'dash', 'dodge', 'switch', 'collect', 'shield'];
export const MATCH_MS = 48_000;
export const WINDOW_MS = 900;
export const LEAD_MS = 1_200;
export const GAP_MS = 2_400;
export const HIT_BASE = 20;
export const HIT_STREAK = 5;
export const EVENT_COUNT = 16;

export function buildSequence(playerIds: string[], count = EVENT_COUNT): CueEvent[] {
  const events: CueEvent[] = [];
  for (let i = 0; i < count; i += 1) {
    const appearAt = 800 + i * GAP_MS;
    const windowStart = appearAt + LEAD_MS;
    const windowEnd = windowStart + WINDOW_MS;
    const resolved: Record<string, 'hit' | 'miss' | 'pending'> = {};
    for (const id of playerIds) resolved[id] = 'pending';
    events.push({
      id: i,
      context: CONTEXTS[i % CONTEXTS.length]!,
      appearAt,
      windowStart,
      windowEnd,
      resolved,
    });
  }
  return events;
}

function makePlayer(): OneButtonPlayer {
  return {
    score: 0,
    streak: 0,
    hits: 0,
    misses: 0,
    lastResult: 'idle',
    disconnected: false,
    left: false,
  };
}

export function elapsedOf(state: OneButtonState, now: number): number {
  if (state.startedAt == null) return 0;
  return Math.max(0, now - state.startedAt);
}

export function resolveTap(state: OneButtonState, playerId: string, nowElapsed: number): TapResult {
  const player = state.players[playerId];
  if (!player || player.left || state.phase !== 'playing') return 'ignored';
  const cue = state.events[state.currentIndex];
  if (!cue) return 'ignored';
  if (cue.resolved[playerId] !== 'pending') return 'ignored';
  if (nowElapsed < cue.appearAt) return 'ignored';
  if (nowElapsed < cue.windowStart || nowElapsed > cue.windowEnd) {
    cue.resolved[playerId] = 'miss';
    player.misses += 1;
    player.streak = 0;
    player.lastResult = 'miss';
    state.lastEvent = `miss:${playerId}`;
    return 'miss';
  }
  cue.resolved[playerId] = 'hit';
  player.hits += 1;
  player.streak += 1;
  player.score += HIT_BASE + (player.streak - 1) * HIT_STREAK;
  player.lastResult = 'hit';
  state.lastEvent = `hit:${playerId}`;
  return 'hit';
}

function missPendings(cue: CueEvent, state: OneButtonState): void {
  for (const [id, player] of Object.entries(state.players)) {
    if (player.left) continue;
    if (cue.resolved[id] === 'pending') {
      cue.resolved[id] = 'miss';
      player.misses += 1;
      player.streak = 0;
      player.lastResult = 'miss';
    }
  }
}

export function advanceCues(state: OneButtonState, nowElapsed: number): void {
  while (state.currentIndex < state.events.length) {
    const cue = state.events[state.currentIndex]!;
    if (nowElapsed <= cue.windowEnd) break;
    missPendings(cue, state);
    state.currentIndex += 1;
  }
}

export function finishOneButton(state: OneButtonState, ctx: GameContext, reason: GameFinishReason): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.finishReason = reason;
  state.lastEvent = reason === 'timeout' ? 'timeout' : 'finished';
  ctx.markStateChanged();
  ctx.finish(reason);
}

export const oneButtonGame: GameModule<OneButtonState> = {
  metadata: ONE_BUTTON_METADATA,

  initialize(): void {
    // Stateless module.
  },

  createInitialState(players): OneButtonState {
    const ids = players.map((player) => player.id);
    const events = buildSequence(ids);
    const last = events[events.length - 1];
    return {
      phase: 'idle',
      events,
      currentIndex: 0,
      players: Object.fromEntries(players.map((player) => [player.id, makePlayer()])),
      startedAt: null,
      endsAt: null,
      sequenceMs: (last?.windowEnd ?? MATCH_MS) + 800,
      finishReason: null,
      lastEvent: null,
    };
  },

  playerJoined(player, state): void {
    const existing = state.players[player.id];
    if (existing) {
      existing.disconnected = false;
      return;
    }
    state.players[player.id] = makePlayer();
    for (const cue of state.events) {
      if (cue.resolved[player.id] === undefined) cue.resolved[player.id] = 'pending';
    }
  },

  playerReady(): void {
    // Lobby concern.
  },

  playerLeft(playerId, state, ctx, reason): void {
    const player = state.players[playerId];
    if (!player) return;
    if (reason === 'disconnect') {
      player.disconnected = true;
      return;
    }
    player.left = true;
    const remaining = Object.values(state.players).filter((entry) => !entry.left);
    if (remaining.length <= 1) finishOneButton(state, ctx, 'abandoned');
  },

  start(state, ctx): void {
    if (state.phase === 'playing') return;
    const ids = ctx.players.map((player) => player.id);
    ctx.players.forEach((player) => {
      state.players[player.id] = makePlayer();
    });
    state.events = buildSequence(ids);
    state.currentIndex = 0;
    state.phase = 'playing';
    state.startedAt = ctx.now();
    state.endsAt = ctx.now() + MATCH_MS;
    const last = state.events[state.events.length - 1];
    state.sequenceMs = (last?.windowEnd ?? MATCH_MS) + 800;
    state.lastEvent = 'start';
    ctx.markStateChanged();
    ctx.schedule(MATCH_MS, () => finishOneButton(state, ctx, 'timeout'), 'gameDuration', 'match-timeout');
    for (const player of ctx.players) {
      if (player.isAI) ctx.requestAI(player.id, 400);
    }
  },

  validateAction(playerId, action, state): ValidationResult {
    if (action.type === 'score' || action.type === 'hit' || action.type === 'context') {
      return { valid: false, reason: 'The server owns the window and the score.' };
    }
    if (action.type !== 'tap') return { valid: false, reason: 'Unknown action.' };
    if (state.phase !== 'playing') return { valid: false, reason: 'The sequence has not started.' };
    const player = state.players[playerId];
    if (!player || player.left) return { valid: false, reason: 'You are not in this match.' };
    const cue = state.events[state.currentIndex];
    if (!cue) return { valid: false, reason: 'No event to tap.' };
    if (cue.resolved[playerId] !== 'pending') return { valid: false, reason: 'Already resolved this cue.' };
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    if (action.type !== 'tap') return actionRejected('The server owns the window and the score.');
    const player = state.players[playerId];
    if (!player || state.phase !== 'playing') return actionRejected('You cannot tap.');
    const result = resolveTap(state, playerId, elapsedOf(state, ctx.now()));
    if (result === 'ignored') return actionRejected('Nothing to tap yet.');
    ctx.markStateChanged();
    return actionAccepted();
  },

  update(state, _delta, ctx): void {
    if (state.phase !== 'playing') return;
    const elapsed = elapsedOf(state, ctx.now());
    const before = state.currentIndex;
    advanceCues(state, elapsed);
    if (state.currentIndex !== before) ctx.markStateChanged();
    if (state.currentIndex >= state.events.length) {
      finishOneButton(state, ctx, 'completed');
      return;
    }
    for (const player of ctx.players) {
      if (!player.isAI) continue;
      const body = state.players[player.id];
      if (!body || body.left) continue;
      const cue = state.events[state.currentIndex];
      if (!cue || cue.resolved[player.id] !== 'pending') continue;
      if (elapsed < cue.windowStart || elapsed > cue.windowEnd) continue;
      ctx.requestAI(player.id, 40);
    }
  },

  tick(): void {
    // Handled by update.
  },

  calculateScore(playerId, state): number {
    return state.players[playerId]?.score ?? 0;
  },

  checkWinCondition(state): string[] | null {
    if (state.phase !== 'finished') return null;
    const entries = Object.entries(state.players).filter(([, player]) => !player.left);
    if (entries.length === 0) return [];
    const best = Math.max(...entries.map(([, player]) => player.score));
    return entries.filter(([, player]) => player.score === best).map(([id]) => id);
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
      const left = state.players[a.id];
      const right = state.players[b.id];
      return (right?.score ?? 0) - (left?.score ?? 0) || (right?.hits ?? 0) - (left?.hits ?? 0);
    });
    const best = ranked[0] ? state.players[ranked[0].id]?.score ?? 0 : 0;
    const winners = ranked.filter((player) => (state.players[player.id]?.score ?? 0) === best).map((player) => player.id);
    const rankings: RankingDraft[] = ranked.map((player, index) => {
      const entry = state.players[player.id];
      return {
        playerId: player.id,
        rank: index + 1,
        score: entry?.score ?? 0,
        isWinner: winners.includes(player.id),
        isDraw: winners.length > 1,
        stats: { hits: entry?.hits ?? 0, misses: entry?.misses ?? 0, streak: entry?.streak ?? 0 },
      };
    });
    return { winners, isDraw: winners.length > 1, rankings, reason: state.finishReason ?? 'completed' };
  },

  reset(state): OneButtonState {
    const ids = Object.keys(state.players);
    const events = buildSequence(ids);
    const last = events[events.length - 1];
    return {
      ...state,
      phase: 'idle',
      events,
      currentIndex: 0,
      players: Object.fromEntries(ids.map((id) => [id, makePlayer()])),
      startedAt: null,
      endsAt: null,
      sequenceMs: (last?.windowEnd ?? MATCH_MS) + 800,
      finishReason: null,
      lastEvent: null,
    };
  },

  cleanup(state): void {
    state.players = {};
    state.events = [];
    state.phase = 'finished';
  },

  getPublicState(state, viewerId, ctx) {
    const elapsed = elapsedOf(state, ctx.now());
    const cue = state.events[state.currentIndex] ?? null;
    return {
      phase: state.phase,
      elapsed,
      currentIndex: state.currentIndex,
      totalEvents: state.events.length,
      current: cue
        ? {
            id: cue.id,
            context: cue.context,
            appearAt: cue.appearAt,
            windowStart: cue.windowStart,
            windowEnd: cue.windowEnd,
            myResult: viewerId ? cue.resolved[viewerId] ?? 'pending' : 'pending',
          }
        : null,
      endsAt: state.endsAt,
      finishReason: state.finishReason,
      lastEvent: state.lastEvent,
      serverTime: ctx.now(),
      players: Object.fromEntries(
        Object.entries(state.players).map(([id, player]) => [
          id,
          {
            score: player.score,
            streak: player.streak,
            hits: player.hits,
            misses: player.misses,
            lastResult: player.lastResult,
            disconnected: player.disconnected,
          },
        ]),
      ),
    };
  },

  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'playing') return null;
    const player = state.players[playerId];
    if (!player || player.left) return null;
    const cue = state.events[state.currentIndex];
    if (!cue || cue.resolved[playerId] !== 'pending') return null;
    const elapsed = elapsedOf(state, ctx.now());
    if (elapsed < cue.windowStart || elapsed > cue.windowEnd) return null;
    if (difficulty === 'easy' && ctx.random() < 0.35) return null;
    return { type: 'tap' };
  },

  needsUpdateLoop: true,
  maxDurationMs: 6 * 60 * 1000,
};
