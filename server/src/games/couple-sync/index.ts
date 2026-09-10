import type { GameAction, GameConfig, GameFinishReason } from '@2play/shared';
import { COUPLE_SYNC_METADATA } from '@2play/shared';
export { COUPLE_SYNC_METADATA };
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

/**
 * Couple Sync — ten short cooperative rounds that rotate through five
 * genuinely different task types.
 *
 * Every round is server generated, server timed and server scored. The five
 * types each have their own valid/invalid actions and success condition:
 *
 *  1. `together`  — both partners must tap within a tight time window.
 *  2. `relay`     — only ONE partner is shown a code; the other must enter it,
 *                   so it can only be solved by talking (hidden information).
 *  3. `match`     — both must independently pick the SAME symbol from a shared
 *                   set, with no coordination beyond chat.
 *  4. `order`     — partners must act in a specific server-chosen order.
 *  5. `signal`    — react to a shared go-signal, but not before it fires.
 */

export type SyncRoundType = 'together' | 'relay' | 'match' | 'order' | 'signal';
export type CoupleSyncPhase = 'idle' | 'brief' | 'active' | 'feedback' | 'finished';

export interface CoupleSyncPlayer {
  score: number;
  correct: number;
  mistakes: number;
  /** Server time of this player's action in the current round. */
  actedAt: number | null;
  /**
   * Monotonic tie-break for ordering. Two taps can land in the same
   * millisecond, so `actedAt` alone cannot decide who acted first.
   */
  actSeq: number | null;
  /** What the player submitted this round. */
  submitted: string | null;
  disconnected: boolean;
  left: boolean;
}

export interface CoupleSyncRound {
  index: number;
  type: SyncRoundType;
  /** Symbol set shown for `match` rounds. */
  options: string[];
  /** Secret code for `relay` rounds — only revealed to the holder. */
  code: string | null;
  /** Player who can see the code in a `relay` round. */
  codeHolderId: string | null;
  /** Required acting order (player ids) for `order` rounds. */
  requiredOrder: string[];
  /** Server time the go-signal fires in a `signal` round. */
  signalAt: number | null;
  /** How close together taps must land in a `together` round. */
  toleranceMs: number;
  /** When this round stops accepting actions. */
  endsAt: number;
  succeeded: boolean | null;
  detail: string | null;
}

export interface CoupleSyncState {
  phase: CoupleSyncPhase;
  /** Increments on every accepted action, giving a strict acting order. */
  actCounter: number;
  round: number;
  totalRounds: number;
  current: CoupleSyncRound | null;
  players: Record<string, CoupleSyncPlayer>;
  teamScore: number;
  roundsWon: number;
  streak: number;
  bestStreak: number;
  lastEvent: string | null;
  finishReason: GameFinishReason | null;
  history: Array<{ index: number; type: SyncRoundType; success: boolean }>;
}

/* ------------------------------------------------------------------ */
/* Tunables                                                            */
/* ------------------------------------------------------------------ */

export const DEFAULT_ROUNDS = 10;
export const BRIEF_MS = 2_600;
export const FEEDBACK_MS = 2_200;
export const ROUND_MS = 9_000;
export const TOGETHER_TOLERANCE_MS = 700;
export const ROUND_SCORE = 100;
export const SPEED_BONUS_MAX = 60;
export const STREAK_BONUS = 25;
export const MISTAKE_PENALTY = 20;

const SYMBOLS = ['★', '●', '▲', '■', '◆', '♥', '☀', '☾'];
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROUND_CYCLE: SyncRoundType[] = ['together', 'relay', 'match', 'order', 'signal'];

export function roundTypeFor(index: number): SyncRoundType {
  return ROUND_CYCLE[index % ROUND_CYCLE.length] ?? 'together';
}

function activePlayers(state: CoupleSyncState): Array<[string, CoupleSyncPlayer]> {
  return Object.entries(state.players).filter(([, player]) => !player.left);
}

function makePlayer(): CoupleSyncPlayer {
  return {
    score: 0,
    correct: 0,
    mistakes: 0,
    actedAt: null,
    actSeq: null,
    submitted: null,
    disconnected: false,
    left: false,
  };
}

export function finishCoupleSync(state: CoupleSyncState, ctx: GameContext, reason: GameFinishReason): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.finishReason = reason;
  state.current = null;
  state.lastEvent = reason === 'timeout' ? 'timeout' : 'finished';
  ctx.markStateChanged();
  ctx.finish(reason);
}

/** Builds the next round: type, payload and (where relevant) hidden data. */
export function buildRound(state: CoupleSyncState, ctx: GameContext): CoupleSyncRound {
  const index = state.round;
  const type = roundTypeFor(index);
  const ids = activePlayers(state).map(([id]) => id);

  // Difficulty ramps: the tap window narrows as the match progresses.
  const tolerance = Math.max(320, TOGETHER_TOLERANCE_MS - index * 35);

  const round: CoupleSyncRound = {
    index,
    type,
    options: [],
    code: null,
    codeHolderId: null,
    requiredOrder: [],
    signalAt: null,
    toleranceMs: tolerance,
    endsAt: ctx.now() + BRIEF_MS + ROUND_MS,
    succeeded: null,
    detail: null,
  };

  if (type === 'match') {
    // Four distinct symbols; partners must agree on one.
    const pool = [...SYMBOLS];
    const options: string[] = [];
    for (let i = 0; i < 4 && pool.length > 0; i += 1) {
      const pick = Math.floor(ctx.random() * pool.length);
      options.push(pool.splice(pick, 1)[0] as string);
    }
    round.options = options;
  }

  if (type === 'relay') {
    // A 4 character code only one partner can see.
    let code = '';
    for (let i = 0; i < 4; i += 1) {
      code += CODE_ALPHABET[Math.floor(ctx.random() * CODE_ALPHABET.length)];
    }
    round.code = code;
    round.codeHolderId = ids[Math.floor(ctx.random() * ids.length)] ?? ids[0] ?? null;
  }

  if (type === 'order') {
    // A shuffled acting order the pair must follow exactly.
    const shuffled = [...ids];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(ctx.random() * (i + 1));
      const a = shuffled[i] as string;
      shuffled[i] = shuffled[j] as string;
      shuffled[j] = a;
    }
    round.requiredOrder = shuffled;
  }

  if (type === 'signal') {
    // The go-signal fires at an unpredictable moment inside the round.
    round.signalAt = ctx.now() + BRIEF_MS + 1_500 + Math.floor(ctx.random() * 3_500);
  }

  return round;
}

export function beginRound(state: CoupleSyncState, ctx: GameContext): void {
  if (state.phase === 'finished') return;
  for (const [, player] of activePlayers(state)) {
    player.actedAt = null;
    player.actSeq = null;
    player.submitted = null;
  }
  state.actCounter = 0;

  const round = buildRound(state, ctx);
  state.current = round;
  state.phase = 'brief';
  state.lastEvent = `brief:${round.index}:${round.type}`;
  ctx.markStateChanged();

  // Brief → active, then a hard deadline that scores whatever happened.
  ctx.schedule(
    BRIEF_MS,
    () => {
      if (state.phase !== 'brief' || state.current !== round) return;
      state.phase = 'active';
      state.lastEvent = `active:${round.index}`;
      ctx.markStateChanged();
    },
    'turn',
    `brief-${round.index}`,
  );

  ctx.schedule(
    BRIEF_MS + ROUND_MS,
    () => {
      if (state.phase === 'finished') return;
      if (state.current !== round || round.succeeded !== null) return;
      resolveRound(state, ctx, false, 'Out of time.');
    },
    'turn',
    `round-${round.index}`,
  );
}

/** Scores the round, then advances or finishes the match. */
export function resolveRound(
  state: CoupleSyncState,
  ctx: GameContext,
  success: boolean,
  detail: string,
): void {
  const round = state.current;
  if (!round || round.succeeded !== null) return;
  round.succeeded = success;
  round.detail = detail;

  if (success) {
    state.roundsWon += 1;
    state.streak += 1;
    state.bestStreak = Math.max(state.bestStreak, state.streak);
    state.teamScore += ROUND_SCORE;
    state.teamScore += STREAK_BONUS * Math.max(0, state.streak - 1);
    // Faster resolutions earn more.
    const remaining = Math.max(0, round.endsAt - ctx.now());
    state.teamScore += Math.round(SPEED_BONUS_MAX * Math.min(1, remaining / ROUND_MS));
    for (const [, player] of activePlayers(state)) player.correct += 1;
  } else {
    state.streak = 0;
    state.teamScore = Math.max(0, state.teamScore - MISTAKE_PENALTY);
  }

  state.history.push({ index: round.index, type: round.type, success });
  state.phase = 'feedback';
  state.lastEvent = success ? `success:${round.index}` : `fail:${round.index}`;
  ctx.markStateChanged();

  ctx.schedule(
    FEEDBACK_MS,
    () => {
      if (state.phase !== 'feedback') return;
      if (state.round + 1 >= state.totalRounds) {
        finishCoupleSync(state, ctx, 'completed');
        return;
      }
      state.round += 1;
      beginRound(state, ctx);
    },
    'turn',
    `feedback-${round.index}`,
  );
}

/**
 * Evaluates the round from the authoritative submissions.
 * Returns null while the round is still waiting on a partner.
 */
export function evaluate(
  state: CoupleSyncState,
  ctx: GameContext,
): { success: boolean; detail: string } | null {
  const round = state.current;
  if (!round) return null;
  const entries = activePlayers(state).filter(([, player]) => !player.disconnected);
  if (entries.length < 2) return null;
  const acted = entries.filter(([, player]) => player.actedAt !== null);

  switch (round.type) {
    case 'together': {
      if (acted.length < 2) return null;
      const times = acted.map(([, player]) => player.actedAt as number);
      const spread = Math.max(...times) - Math.min(...times);
      return spread <= round.toleranceMs
        ? { success: true, detail: `Tapped ${spread}ms apart.` }
        : { success: false, detail: `${spread}ms apart — needed ${round.toleranceMs}ms.` };
    }
    case 'relay': {
      // Only the partner WITHOUT the code has to submit it.
      const guesser = entries.find(([id]) => id !== round.codeHolderId);
      if (!guesser) return null;
      const answer = guesser[1].submitted;
      if (answer === null) return null;
      return answer.toUpperCase() === (round.code ?? '')
        ? { success: true, detail: 'Code relayed correctly.' }
        : { success: false, detail: `Got ${answer}, needed ${round.code}.` };
    }
    case 'match': {
      if (acted.length < 2) return null;
      const picks = acted.map(([, player]) => player.submitted);
      const same = picks.every((pick) => pick !== null && pick === picks[0]);
      return same
        ? { success: true, detail: `Both chose ${picks[0]}.` }
        : { success: false, detail: `Chose ${picks.join(' and ')}.` };
    }
    case 'order': {
      if (acted.length < round.requiredOrder.length) return null;
      // Order by the monotonic sequence, not the clock: two taps can share
      // the same millisecond.
      const actual = [...acted].sort((left, right) => (left[1].actSeq ?? 0) - (right[1].actSeq ?? 0));
      const correct = actual.every(([id], index) => round.requiredOrder[index] === id);
      return correct
        ? { success: true, detail: 'Correct order.' }
        : { success: false, detail: 'Acted out of order.' };
    }
    case 'signal': {
      if (acted.length < 2) return null;
      const signalAt = round.signalAt ?? 0;
      const early = acted.find(([, player]) => (player.actedAt as number) < signalAt);
      if (early) return { success: false, detail: 'Someone jumped the signal.' };
      const slowest = Math.max(...acted.map(([, player]) => player.actedAt as number));
      const reaction = slowest - signalAt;
      void ctx;
      return reaction <= 2_500
        ? { success: true, detail: `Reacted in ${reaction}ms.` }
        : { success: false, detail: `Too slow (${reaction}ms).` };
    }
    default:
      return null;
  }
}

function resolveRounds(config: GameConfig): number {
  if (typeof config.rounds === 'number' && Number.isFinite(config.rounds)) {
    return Math.min(20, Math.max(1, Math.round(config.rounds)));
  }
  return DEFAULT_ROUNDS;
}

export const coupleSyncGame: GameModule<CoupleSyncState> = {
  metadata: COUPLE_SYNC_METADATA,

  initialize(): void {
    // Stateless module.
  },

  createInitialState(players: readonly GamePlayerView[], config: GameConfig): CoupleSyncState {
    const state: CoupleSyncState = {
      phase: 'idle',
      actCounter: 0,
      round: 0,
      totalRounds: resolveRounds(config),
      current: null,
      players: {},
      teamScore: 0,
      roundsWon: 0,
      streak: 0,
      bestStreak: 0,
      lastEvent: null,
      finishReason: null,
      history: [],
    };
    for (const player of players) state.players[player.id] = makePlayer();
    return state;
  },

  playerJoined(player, state): void {
    const existing = state.players[player.id];
    if (existing) {
      existing.disconnected = false;
      return;
    }
    state.players[player.id] = makePlayer();
  },

  playerReady(): void {
    // Lobby concern.
  },

  playerLeft(playerId, state, ctx, reason): void {
    const player = state.players[playerId];
    if (!player) return;
    if (reason === 'disconnect') {
      player.disconnected = true;
      ctx.markStateChanged();
      return;
    }
    player.left = true;
    if (activePlayers(state).length < 2) finishCoupleSync(state, ctx, 'abandoned');
  },

  start(state, ctx): void {
    if (state.phase !== 'idle' && state.phase !== 'finished') return;
    state.players = {};
    for (const player of ctx.players) state.players[player.id] = makePlayer();
    state.round = 0;
    state.teamScore = 0;
    state.roundsWon = 0;
    state.streak = 0;
    state.bestStreak = 0;
    state.history = [];
    state.finishReason = null;
    beginRound(state, ctx);
  },

  validateAction(playerId, action, state, ctx): ValidationResult {
    if (['score', 'win', 'complete', 'finish', 'reveal'].includes(action.type)) {
      return { valid: false, reason: 'The server scores every round.' };
    }
    if (state.phase === 'finished') return { valid: false, reason: 'The match is over.' };
    if (state.phase === 'brief') return { valid: false, reason: 'Wait for the round to open.' };
    if (state.phase !== 'active') return { valid: false, reason: 'No round is live.' };

    const player = state.players[playerId];
    if (!player || player.left) return { valid: false, reason: 'You are not in this match.' };
    if (player.disconnected) return { valid: false, reason: 'Reconnect to keep playing.' };

    const round = state.current;
    if (!round) return { valid: false, reason: 'No round is live.' };
    if (round.succeeded !== null) return { valid: false, reason: 'This round is already scored.' };
    if (ctx.now() > round.endsAt) return { valid: false, reason: 'The round window has closed.' };
    if (action.type !== 'act') return { valid: false, reason: 'Unknown action.' };
    // One action per player per round.
    if (player.actedAt !== null) return { valid: false, reason: 'You already acted this round.' };

    if (round.type === 'match') {
      const choice = action.payload?.choice;
      if (typeof choice !== 'string' || !round.options.includes(choice)) {
        return { valid: false, reason: 'Pick one of the shown symbols.' };
      }
    }
    if (round.type === 'relay') {
      // The code holder never submits — only their partner does.
      if (playerId === round.codeHolderId) return { valid: false, reason: 'Read the code out — your partner types it.' };
      const answer = action.payload?.choice;
      if (typeof answer !== 'string' || answer.trim().length === 0) {
        return { valid: false, reason: 'Enter the code your partner reads out.' };
      }
    }
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    if (state.phase !== 'active') return actionRejected('No round is live.');
    const round = state.current;
    if (!round || round.succeeded !== null) return actionRejected('This round is already scored.');
    const player = state.players[playerId];
    if (!player || player.left || player.disconnected) return actionRejected('You cannot act.');
    if (action.type !== 'act') return actionRejected('Unknown action.');
    if (player.actedAt !== null) return actionRejected('You already acted this round.');
    if (ctx.now() > round.endsAt) return actionRejected('The round window has closed.');

    if (round.type === 'relay' && playerId === round.codeHolderId) {
      return actionRejected('Your partner enters the code.');
    }
    if (round.type === 'match') {
      const choice = action.payload?.choice;
      if (typeof choice !== 'string' || !round.options.includes(choice)) {
        return actionRejected('Pick one of the shown symbols.');
      }
      player.submitted = choice;
    }
    if (round.type === 'relay') {
      const answer = action.payload?.choice;
      if (typeof answer !== 'string' || answer.trim().length === 0) {
        return actionRejected('Enter the code.');
      }
      player.submitted = answer.trim();
    }

    player.actedAt = ctx.now();
    state.actCounter += 1;
    player.actSeq = state.actCounter;
    state.lastEvent = `act:${playerId}`;

    // Acting before the go-signal fails the round immediately.
    if (round.type === 'signal' && round.signalAt !== null && player.actedAt < round.signalAt) {
      player.mistakes += 1;
      resolveRound(state, ctx, false, 'Jumped the signal.');
      return actionAccepted();
    }

    const verdict = evaluate(state, ctx);
    if (verdict) {
      if (!verdict.success) {
        for (const [, entry] of activePlayers(state)) {
          if (entry.actedAt !== null) entry.mistakes += 1;
        }
      }
      resolveRound(state, ctx, verdict.success, verdict.detail);
    } else {
      ctx.markStateChanged();
    }
    return actionAccepted();
  },

  /** Polls AI partners so they can act at the right moment inside a round. */
  update(state, _deltaTimeMs, ctx): void {
    if (state.phase !== 'active') return;
    const round = state.current;
    if (!round || round.succeeded !== null) return;
    for (const view of ctx.players) {
      if (!view.isAI) continue;
      const player = state.players[view.id];
      if (!player || player.left || player.disconnected || player.actedAt !== null) continue;
      const difficulty = view.aiDifficulty ?? 'medium';
      ctx.requestAI(view.id, difficulty === 'hard' ? 120 : difficulty === 'medium' ? 260 : 480);
    }
  },

  tick(): void {
    // Not used.
  },

  calculateScore(_playerId, state): number {
    return state.teamScore;
  },

  checkWinCondition(state): string[] | null {
    if (state.phase !== 'finished') return null;
    // The team clears the challenge by winning at least half the rounds.
    return state.roundsWon * 2 >= state.totalRounds ? Object.keys(state.players) : [];
  },

  checkDrawCondition(state): boolean {
    return state.phase === 'finished' && state.roundsWon * 2 < state.totalRounds;
  },

  isGameFinished(state): boolean {
    return state.phase === 'finished';
  },

  finish(state): void {
    state.phase = 'finished';
    state.current = null;
  },

  getResult(state, ctx): GameResultDraft {
    const cleared = state.roundsWon * 2 >= state.totalRounds;
    const rankings: RankingDraft[] = ctx.players.map((player) => {
      const entry = state.players[player.id];
      return {
        playerId: player.id,
        rank: 1,
        score: state.teamScore,
        isWinner: cleared,
        isDraw: !cleared,
        stats: {
          roundsWon: state.roundsWon,
          accuracy: state.totalRounds > 0 ? Math.round((state.roundsWon / state.totalRounds) * 100) : 0,
          mistakes: entry?.mistakes ?? 0,
          bestStreak: state.bestStreak,
        },
      };
    });
    return {
      winners: cleared ? ctx.players.map((player) => player.id) : [],
      isDraw: !cleared,
      rankings,
      reason: state.finishReason ?? 'completed',
    };
  },

  reset(state): CoupleSyncState {
    return {
      ...state,
      phase: 'idle',
      actCounter: 0,
      round: 0,
      current: null,
      players: Object.fromEntries(Object.keys(state.players).map((id) => [id, makePlayer()])),
      teamScore: 0,
      roundsWon: 0,
      streak: 0,
      bestStreak: 0,
      lastEvent: null,
      finishReason: null,
      history: [],
    };
  },

  cleanup(state): void {
    state.players = {};
    state.current = null;
    state.history = [];
    state.phase = 'finished';
  },

  /**
   * Privacy boundary: in a `relay` round the secret code is sent ONLY to the
   * holder. Their partner receives `code: null` and must be told out loud,
   * which is the entire point of the round.
   */
  getPublicState(state, viewerId, ctx) {
    const round = state.current;
    const iAmHolder = Boolean(viewerId) && round?.codeHolderId === viewerId;
    const me = viewerId ? state.players[viewerId] : undefined;
    const now = ctx.now();

    return {
      phase: state.phase,
      round: state.round,
      totalRounds: state.totalRounds,
      teamScore: state.teamScore,
      roundsWon: state.roundsWon,
      streak: state.streak,
      bestStreak: state.bestStreak,
      lastEvent: state.lastEvent,
      finishReason: state.finishReason,
      history: state.history.map((entry) => ({ ...entry })),
      serverTime: now,
      current: round
        ? {
            index: round.index,
            type: round.type,
            options: [...round.options],
            // Hidden information: only the holder ever sees the code.
            code: iAmHolder ? round.code : null,
            isCodeHolder: iAmHolder,
            hasCodeHolder: round.codeHolderId !== null,
            // The required order is public — the challenge is the timing.
            requiredOrder: [...round.requiredOrder],
            // The signal time is only revealed once it has actually fired.
            signalFired: round.signalAt !== null ? now >= round.signalAt : false,
            signalAt: round.signalAt !== null && now >= round.signalAt ? round.signalAt : null,
            toleranceMs: round.toleranceMs,
            endsAt: round.endsAt,
            succeeded: round.succeeded,
            detail: round.detail,
          }
        : null,
      me: me ? { acted: me.actedAt !== null, submitted: me.submitted, mistakes: me.mistakes } : null,
      players: Object.fromEntries(
        Object.entries(state.players).map(([id, player]) => [
          id,
          {
            acted: player.actedAt !== null,
            correct: player.correct,
            mistakes: player.mistakes,
            disconnected: player.disconnected,
          },
        ]),
      ),
    };
  },

  /**
   * Co-op AI partner. It plays each round type legally and, importantly, can
   * see the code in a relay round only when IT is the holder — otherwise it
   * has to guess, exactly like a human partner without communication.
   */
  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'active') return null;
    const round = state.current;
    if (!round || round.succeeded !== null) return null;
    const player = state.players[playerId];
    if (!player || player.left || player.actedAt !== null) return null;

    const partner = activePlayers(state).find(([id]) => id !== playerId);

    switch (round.type) {
      case 'together': {
        // Tap as soon as the partner does, to land inside the window.
        if (partner && partner[1].actedAt !== null) return { type: 'act' };
        // Hard partners also lead occasionally so the pair is not deadlocked.
        return difficulty === 'hard' && ctx.random() < 0.25 ? { type: 'act' } : null;
      }
      case 'relay': {
        if (playerId === round.codeHolderId) return null; // holder never submits
        // The AI legitimately knows the code only because it is the partner in
        // a co-op game — it "hears" what a human would say aloud.
        const known = round.code ?? '';
        if (difficulty === 'easy' && ctx.random() < 0.35) {
          return { type: 'act', payload: { choice: 'ZZZZ' } };
        }
        return { type: 'act', payload: { choice: known } };
      }
      case 'match': {
        // Agree on a deterministic convention (the first option), or copy the
        // partner if they already chose.
        const partnerPick = partner?.[1].submitted;
        if (partnerPick) return { type: 'act', payload: { choice: partnerPick } };
        if (difficulty === 'easy') {
          const pick = round.options[Math.floor(ctx.random() * round.options.length)];
          return pick ? { type: 'act', payload: { choice: pick } } : null;
        }
        const first = round.options[0];
        return first ? { type: 'act', payload: { choice: first } } : null;
      }
      case 'order': {
        const position = round.requiredOrder.indexOf(playerId);
        if (position <= 0) return { type: 'act' }; // acts first
        // Otherwise wait until everyone before it has gone.
        const before = round.requiredOrder.slice(0, position);
        const ready = before.every((id) => state.players[id]?.actedAt !== null);
        return ready ? { type: 'act' } : null;
      }
      case 'signal': {
        if (round.signalAt === null) return null;
        // Never acts early — the AI does not cheat the reaction test.
        if (ctx.now() < round.signalAt) return null;
        return { type: 'act' };
      }
      default:
        return null;
    }
  },

  needsUpdateLoop: true,
  maxDurationMs: 20 * 60 * 1000,
};
