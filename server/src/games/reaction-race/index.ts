import type { AIDifficulty, GameAction, GameConfig, GameFinishReason } from '@2play/shared';
import { MIN_HUMAN_REACTION_MS } from '@2play/shared';
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
import { REACTION_RACE_METADATA } from '@2play/shared';
export { REACTION_RACE_METADATA };

export type ReactionPhase = 'idle' | 'waiting' | 'go' | 'roundResult' | 'finished';

export interface ReactionRaceState {
  phase: ReactionPhase;
  round: number;
  totalRounds: number;
  /** Server timestamp of the GO signal (null until the signal is given). */
  goAt: number | null;
  /** Players who already acted this round. */
  reacted: Record<string, { timeMs: number | null; falseStart: boolean }>;
  falseStarts: string[];
  roundWinner: string | null;
  scores: Record<string, number>;
  times: Record<string, number[]>;
  history: Array<{
    round: number;
    winner: string | null;
    times: Record<string, number | null>;
    falseStarts: string[];
  }>;
  /** Epoch ms when the current phase ends (UI timers only — the server decides). */
  phaseEndsAt: number | null;
  lastEvent: string | null;
}


const ROUND_RESULT_MS = 2200;
const GO_WINDOW_MS = 4000;
const MIN_WAIT_MS = 1500;
const MAX_WAIT_MS = 5000;

/** Difficulty => reaction time window in ms. */
const AI_REACTION: Record<AIDifficulty, [number, number]> = {
  easy: [430, 720],
  medium: [300, 520],
  hard: [200, 380],
};
/** Chance an AI false starts during the waiting phase. */
const AI_FALSE_START_CHANCE: Record<AIDifficulty, number> = {
  easy: 0.22,
  medium: 0.08,
  hard: 0.01,
};

/** Players that can still act this round (AI always can, humans must be connected). */
function participants(ctx: GameContext): GamePlayerView[] {
  return ctx.players.filter((player) => player.isAI || player.isConnected);
}

function scoresFor(players: readonly GamePlayerView[]): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const player of players) scores[player.id] = 0;
  return scores;
}

function hasEveryoneActed(state: ReactionRaceState, players: readonly GamePlayerView[]): boolean {
  return players.every(
    (player) => state.reacted[player.id] !== undefined || state.falseStarts.includes(player.id),
  );
}

export const reactionRaceGame: GameModule<ReactionRaceState> = {
  metadata: REACTION_RACE_METADATA,

  initialize(): void {
    // No external resources: the module is pure logic.
  },

  createInitialState(players, config): ReactionRaceState {
    const totalRounds = Math.max(1, Math.min(9, config.rounds ?? 5));
    return {
      phase: 'idle',
      round: 0,
      totalRounds,
      goAt: null,
      reacted: {},
      falseStarts: [],
      roundWinner: null,
      scores: scoresFor(players),
      times: Object.fromEntries(players.map((player) => [player.id, [] as number[]])),
      history: [],
      phaseEndsAt: null,
      lastEvent: null,
    };
  },

  playerJoined(player, state): void {
    if (state.scores[player.id] === undefined) state.scores[player.id] = 0;
    if (state.times[player.id] === undefined) state.times[player.id] = [];
  },

  playerReady(): void {
    // Readiness is a lobby concept for this game.
  },

  playerLeft(playerId, state, ctx): void {
    delete state.reacted[playerId];
    if (state.phase === 'waiting' || state.phase === 'go') {
      const remaining = participants(ctx).filter((player) => player.id !== playerId);
      if (remaining.length === 0) {
        ctx.finish('abandoned');
        return;
      }
      // If everyone who could still react has acted, close the round.
      if (state.phase === 'go' && hasEveryoneActed(state, remaining)) {
        endRound(state, ctx, null);
      }
    }
  },

  start(state, ctx): void {
    beginRound(state, ctx);
  },

  validateAction(playerId, action, state): ValidationResult {
    if (action.type !== 'tap') return { valid: false, reason: 'Unknown action.' };
    if (state.phase === 'finished' || state.phase === 'idle' || state.phase === 'roundResult') {
      return { valid: false, reason: 'There is nothing to react to right now.' };
    }
    if (state.reacted[playerId]) return { valid: false, reason: 'You already reacted.' };
    if (state.falseStarts.includes(playerId)) {
      return { valid: false, reason: 'You false started this round.' };
    }
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    if (action.type !== 'tap') return actionRejected('Unknown action.');

    if (state.phase === 'waiting') {
      // False start.
      state.falseStarts.push(playerId);
      state.reacted[playerId] = { timeMs: null, falseStart: true };
      state.lastEvent = `false-start:${playerId}`;
      ctx.markStateChanged();

      const others = participants(ctx).filter((player) => player.id !== playerId);
      if (hasEveryoneActed(state, others)) {
        endRound(state, ctx, null);
      }
      return actionAccepted();
    }

    if (state.phase !== 'go' || state.goAt === null) {
      return actionRejected('Not yet!');
    }

    const reaction = ctx.now() - state.goAt;
    if (!Number.isFinite(reaction) || reaction < MIN_HUMAN_REACTION_MS) {
      // Impossible: the client cannot physically have reacted that fast.
      state.falseStarts.push(playerId);
      state.reacted[playerId] = { timeMs: null, falseStart: true };
      state.lastEvent = `impossible:${playerId}`;
      ctx.logger.warn('impossible reaction rejected', { playerId, reaction });
      ctx.markStateChanged();
      if (hasEveryoneActed(state, participants(ctx))) endRound(state, ctx, null);
      return actionAccepted();
    }

    state.reacted[playerId] = { timeMs: reaction, falseStart: false };
    state.times[playerId] = [...(state.times[playerId] ?? []), reaction];
    state.lastEvent = `react:${playerId}`;
    ctx.markStateChanged();
    endRound(state, ctx, playerId);
    return actionAccepted();
  },

  update(): void {
    // Event driven: no per-tick simulation needed.
  },

  tick(): void {
    // Event driven.
  },

  calculateScore(playerId, state): number {
    return state.scores[playerId] ?? 0;
  },

  checkWinCondition(state): string[] | null {
    if (state.phase !== 'finished') return null;
    const entries = Object.entries(state.scores);
    if (entries.length === 0) return null;
    const best = Math.max(...entries.map(([, score]) => score));
    return entries.filter(([, score]) => score === best).map(([id]) => id);
  },

  checkDrawCondition(state): boolean {
    const winners = this.checkWinCondition(state);
    return (winners?.length ?? 0) > 1;
  },

  isGameFinished(state): boolean {
    return state.phase === 'finished';
  },

  finish(state): void {
    state.phase = 'finished';
  },

  getResult(state, ctx): GameResultDraft {
    const players = ctx.players;
    const bestAverage = (playerId: string): number => {
      const times = state.times[playerId] ?? [];
      if (times.length === 0) return Number.POSITIVE_INFINITY;
      return times.reduce((sum, value) => sum + value, 0) / times.length;
    };

    const ranked = [...players].sort((a, b) => {
      const scoreDiff = (state.scores[b.id] ?? 0) - (state.scores[a.id] ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
      return bestAverage(a.id) - bestAverage(b.id);
    });

    const topScore = state.scores[ranked[0]?.id ?? ''] ?? 0;
    const winners = ranked
      .filter((player) => (state.scores[player.id] ?? 0) === topScore)
      .map((player) => player.id);

    const rankings: RankingDraft[] = ranked.map((player, index) => ({
      playerId: player.id,
      rank: index + 1,
      score: state.scores[player.id] ?? 0,
      isWinner: winners.includes(player.id),
      isDraw: winners.length > 1,
      stats: {
        roundsWon: state.scores[player.id] ?? 0,
        fastestReactionMs: Math.round(
          (state.times[player.id] ?? []).reduce(
            (min, value) => Math.min(min, value),
            Number.POSITIVE_INFINITY,
          ) || 0,
        ),
        averageReactionMs: Math.round(bestAverage(player.id) || 0),
        falseStarts: state.history.filter((round) => round.falseStarts.includes(player.id)).length,
      },
    }));

    return {
      winners,
      isDraw: winners.length > 1,
      rankings,
      reason: (state.history.length === state.totalRounds ? 'completed' : 'forfeit') as GameFinishReason,
    };
  },

  reset(state: ReactionRaceState): ReactionRaceState {
    // Keep every seat, zero every score: the room and players survive a rematch.
    return {
      phase: 'idle',
      round: 0,
      totalRounds: state.totalRounds,
      goAt: null,
      reacted: {},
      falseStarts: [],
      roundWinner: null,
      scores: Object.fromEntries(Object.keys(state.scores).map((id) => [id, 0])),
      times: Object.fromEntries(Object.keys(state.times).map((id) => [id, [] as number[]])),
      history: [],
      phaseEndsAt: null,
      lastEvent: null,
    };
  },

  cleanup(state): void {
    state.phase = 'finished';
    state.goAt = null;
  },

  getPublicState(state, _viewerId, ctx) {
    // `goAt` is only revealed once the GO signal has actually been given.
    const revealGoAt = state.phase === 'go' || state.phase === 'roundResult' || state.phase === 'finished';
    return {
      phase: state.phase,
      round: state.round,
      totalRounds: state.totalRounds,
      goAt: revealGoAt ? state.goAt : null,
      serverTime: ctx.now(),
      roundWinner: state.roundWinner,
      falseStarts: [...state.falseStarts],
      reacted: Object.fromEntries(
        Object.entries(state.reacted).map(([id, value]) => [
          id,
          { timeMs: value.timeMs, falseStart: value.falseStart },
        ]),
      ),
      scores: { ...state.scores },
      history: state.history.slice(-5),
      lastEvent: state.lastEvent,
      phaseEndsAt: state.phaseEndsAt,
    };
  },

  getAIMove(playerId, difficulty, state): GameAction | null {
    if (state.phase === 'go' || state.phase === 'waiting') {
      if (state.reacted[playerId] || state.falseStarts.includes(playerId)) return null;
      return { type: 'tap' };
    }
    return null;
  },

  maxDurationMs: 6 * 60 * 1000,
};

/* ------------------------------------------------------------------ */
/* Internal round orchestration (server side only)                     */
/* ------------------------------------------------------------------ */

function beginRound(state: ReactionRaceState, ctx: GameContext): void {
  state.round += 1;
  state.phase = 'waiting';
  state.goAt = null;
  state.reacted = {};
  state.falseStarts = [];
  state.roundWinner = null;
  state.lastEvent = `round-start:${state.round}`;
  state.phaseEndsAt = ctx.now() + MAX_WAIT_MS;
  ctx.markStateChanged();

  const waitMs = MIN_WAIT_MS + Math.floor(ctx.random() * (MAX_WAIT_MS - MIN_WAIT_MS));

  // Some AIs jump the gun — modelled explicitly, never randomly punished.
  for (const player of ctx.players) {
    if (!player.isAI) continue;
    const difficulty = player.aiDifficulty ?? 'medium';
    if (ctx.random() < AI_FALSE_START_CHANCE[difficulty]) {
      const falseStartAt = 200 + Math.floor(ctx.random() * Math.max(200, waitMs - 400));
      ctx.requestAI(player.id, falseStartAt);
    }
  }

  ctx.schedule(waitMs, () => {
    if (state.phase !== 'waiting') return;
    state.phase = 'go';
    state.goAt = ctx.now();
    state.lastEvent = 'go';
    state.phaseEndsAt = ctx.now() + GO_WINDOW_MS;
    ctx.markStateChanged();

    // Every AI reacts with a difficulty-scaled, human-like delay.
    for (const player of ctx.players) {
      if (!player.isAI) continue;
      const difficulty = player.aiDifficulty ?? 'medium';
      const [min, max] = AI_REACTION[difficulty];
      const delay = min + Math.floor(ctx.random() * (max - min));
      ctx.requestAI(player.id, delay);
    }

    ctx.schedule(GO_WINDOW_MS, () => {
      if (state.phase !== 'go') return;
      endRound(state, ctx, null);
    }, 'turn', 'go-window');
  }, 'turn', 'go-signal');
}

function endRound(state: ReactionRaceState, ctx: GameContext, winner: string | null): void {
  if (state.phase === 'roundResult' || state.phase === 'finished') return;

  if (winner) {
    state.roundWinner = winner;
    state.scores[winner] = (state.scores[winner] ?? 0) + 1;
  }

  state.history.push({
    round: state.round,
    winner,
    times: Object.fromEntries(
      Object.entries(state.reacted).map(([id, value]) => [id, value.timeMs]),
    ),
    falseStarts: [...state.falseStarts],
  });

  state.phase = 'roundResult';
  state.phaseEndsAt = ctx.now() + ROUND_RESULT_MS;
  state.lastEvent = winner ? `round-won:${winner}` : 'round-void';
  ctx.markStateChanged();

  const majority = Math.floor(state.totalRounds / 2) + 1;
  const hasClinched = Object.values(state.scores).some((score) => score >= majority);
  const playedAll = state.round >= state.totalRounds;

  ctx.schedule(ROUND_RESULT_MS, () => {
    if (hasClinched || playedAll) {
      state.phase = 'finished';
      ctx.markStateChanged();
      ctx.finish('completed');
      return;
    }
    beginRound(state, ctx);
  }, 'turn', 'next-round');
}

export type { GameConfig };
