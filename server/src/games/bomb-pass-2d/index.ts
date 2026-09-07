import type { GameAction, GameConfig, GameFinishReason } from '@2play/shared';
import { BOMB_PASS_METADATA } from '@2play/shared';
export { BOMB_PASS_METADATA };
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
 * Bomb Pass 2D — a cartoon firework, hot-potato style.
 *
 * A purely fictional party object: nobody builds anything, it just ticks. The
 * server owns the fuse (TimerManager via `ctx.schedule`), the holder, pass
 * validation, strikes and points — clients only ever send `pass` intents.
 */

export type BombPhase = 'idle' | 'countdown' | 'running' | 'roundResult' | 'finished';

export interface BombPlayerState {
  strikes: number;
  points: number;
  eliminated: boolean;
  receivedAt: number; // when the bomb landed in their hands
  disconnected: boolean;
  left: boolean;
}

export interface BombPassState {
  phase: BombPhase;
  round: number; // 1-based
  totalRounds: number;
  players: Record<string, BombPlayerState>;
  holderId: string | null;
  lastHolderId: string | null;
  fuseMs: number;
  fuseEndsAt: number | null;
  roundEndsAt: number | null; // countdown / result deadlines
  passCooldownMs: number;
  strikesToEliminate: number;
  lastExplosionHolder: string | null;
  departed: Record<string, boolean>;
  startedAt: number | null;
  finishReason: GameFinishReason | null;
  lastEvent: string | null;
}

const DEFAULT_ROUNDS = 8;
const MIN_ROUNDS = 3;
const MAX_ROUNDS = 15;
const STRIKES_TO_ELIMINATE = 3;
const PASS_COOLDOWN_MS = 350;
const COUNTDOWN_MS = 1100;
const ROUND_RESULT_MS = 1800;
const FUSE_BASE_MS = 5600;
const FUSE_DECAY_PER_ROUND_MS = 240;
const FUSE_JITTER_MS = 1400;
const FUSE_MIN_MS = 2400;
const FUSE_MAX_MS = 6200;

/** AI hold times: how long an AI holder risks keeping the firework. */
const AI_HOLD: Record<string, number> = { easy: 650, medium: 1600, hard: 2600 };
const AI_HOLD_JITTER: Record<string, number> = { easy: 500, medium: 900, hard: 1100 };

export function roundsFor(requested?: number): number {
  if (typeof requested === 'number' && Number.isFinite(requested)) {
    return Math.min(MAX_ROUNDS, Math.max(MIN_ROUNDS, Math.round(requested)));
  }
  return DEFAULT_ROUNDS;
}

/** Fuse length for a round — shorter as the match heats up. Exported for tests. */
export function fuseFor(round: number, random: () => number): number {
  const jitter = Math.floor(random() * FUSE_JITTER_MS);
  return Math.min(FUSE_MAX_MS, Math.max(FUSE_MIN_MS, FUSE_BASE_MS - (round - 1) * FUSE_DECAY_PER_ROUND_MS + jitter));
}

function newPlayer(): BombPlayerState {
  return {
    strikes: 0,
    points: 0,
    eliminated: false,
    receivedAt: 0,
    disconnected: false,
    left: false,
  };
}

/** Players still in the game (not eliminated, not departed). */
export function alivePlayers(state: BombPassState): string[] {
  return Object.entries(state.players)
    .filter(([playerId, player]) => !player.eliminated && !player.left && !state.departed[playerId])
    .map(([playerId]) => playerId);
}

/** Picks the round's first holder: random, avoiding repeats when possible. */
export function pickHolder(state: BombPassState, random: () => number): string | null {
  const alive = alivePlayers(state);
  if (alive.length === 0) return null;
  const pool = alive.length > 1 ? alive.filter((id) => id !== state.lastHolderId) : alive;
  return pool[Math.floor(random() * pool.length)] ?? alive[0]!;
}

/** Starts a round: countdown → armed fuse. Exported for tests. */
export function beginBombRound(state: BombPassState, ctx: GameContext): void {
  if (state.phase === 'running' || state.phase === 'countdown') return;
  const alive = alivePlayers(state);
  if (alive.length <= 1 || state.round >= state.totalRounds) {
    finishBombMatch(state, ctx, 'completed');
    return;
  }
  state.round += 1;
  state.holderId = pickHolder(state, ctx.random);
  state.lastExplosionHolder = null;
  state.fuseMs = fuseFor(state.round, ctx.random);
  state.fuseEndsAt = null;
  state.phase = 'countdown';
  state.roundEndsAt = ctx.now() + COUNTDOWN_MS;
  state.lastEvent = 'round-start';
  ctx.markStateChanged();
  ctx.schedule(COUNTDOWN_MS, () => armFuse(state, ctx), 'turn', 'bomb-countdown');
}

/** Arms the fuse for the running phase. Exported for tests. */
export function armFuse(state: BombPassState, ctx: GameContext): void {
  if (state.phase !== 'countdown') return;
  const now = ctx.now();
  state.phase = 'running';
  state.fuseEndsAt = now + state.fuseMs;
  const holder = state.holderId ? state.players[state.holderId] : null;
  if (holder) holder.receivedAt = now;
  state.lastEvent = 'armed';
  ctx.markStateChanged();
  ctx.schedule(state.fuseMs, () => explode(state, ctx), 'turn', 'bomb-fuse');
  scheduleAIHolderPass(state, ctx);
}

/** The fuse burns out: holder takes a strike, survivors score. Exported for tests. */
export function explode(state: BombPassState, ctx: GameContext): void {
  if (state.phase !== 'running' || state.holderId === null) return;
  const holderId = state.holderId;
  const holder = state.players[holderId]!;
  holder.strikes += 1;
  state.lastExplosionHolder = holderId;
  state.lastEvent = `boom:${holderId}`;
  for (const [playerId, player] of Object.entries(state.players)) {
    if (playerId === holderId) continue;
    if (player.eliminated || player.left || state.departed[playerId]) continue;
    player.points += 1;
  }
  if (holder.strikes >= state.strikesToEliminate) {
    holder.eliminated = true;
  }
  state.holderId = null;
  state.fuseEndsAt = null;
  state.lastHolderId = holderId;
  ctx.markStateChanged();

  const alive = alivePlayers(state);
  if (alive.length <= 1) {
    finishBombMatch(state, ctx, 'completed');
    return;
  }
  state.phase = 'roundResult';
  state.roundEndsAt = ctx.now() + ROUND_RESULT_MS;
  ctx.schedule(ROUND_RESULT_MS, () => beginBombRound(state, ctx), 'turn', 'bomb-result');
}

function finishBombMatch(state: BombPassState, ctx: GameContext, reason: GameFinishReason): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.finishReason = reason;
  state.lastEvent = 'finished';
  ctx.markStateChanged();
  ctx.finish(reason);
}

/** Schedules an AI holder's pass through the normal AI pipeline. */
function scheduleAIHolderPass(state: BombPassState, ctx: GameContext): void {
  if (state.phase !== 'running' || state.holderId === null) return;
  const seat = ctx.players.find((player) => player.id === state.holderId);
  if (!seat?.isAI) return;
  const difficulty = seat.aiDifficulty ?? 'medium';
  const hold = AI_HOLD[difficulty]! + Math.floor(ctx.random() * AI_HOLD_JITTER[difficulty]!);
  ctx.requestAI(seat.id, Math.max(450, hold - state.passCooldownMs));
}

/** Ranking: survivors first, then fewest strikes, then points. Exported for tests. */
export function computeBombRanking(state: BombPassState, ctx: GameContext): RankingDraft[] {
  const isOut = (playerId: string): boolean =>
    (state.players[playerId]?.eliminated ?? true) ||
    state.departed[playerId] === true ||
    state.players[playerId]?.left === true;
  const ranked = [...ctx.players].sort((a, b) => {
    const aOut = isOut(a.id);
    const bOut = isOut(b.id);
    if (aOut !== bOut) return aOut ? 1 : -1;
    const strikeDiff = (state.players[a.id]?.strikes ?? 0) - (state.players[b.id]?.strikes ?? 0);
    if (strikeDiff !== 0) return strikeDiff;
    const pointDiff = (state.players[b.id]?.points ?? 0) - (state.players[a.id]?.points ?? 0);
    if (pointDiff !== 0) return pointDiff;
    return a.seatIndex - b.seatIndex;
  });
  const best = ranked[0];
  const winners = best
    ? ranked
        .filter(
          (player) =>
            isOut(player.id) === isOut(best.id) &&
            (state.players[player.id]?.strikes ?? 0) === (state.players[best.id]?.strikes ?? 0) &&
            (state.players[player.id]?.points ?? 0) === (state.players[best.id]?.points ?? 0),
        )
        .map((player) => player.id)
    : [];
  return ranked.map((player, index) => {
    const view = state.players[player.id];
    return {
      playerId: player.id,
      rank: index + 1,
      score: view?.points ?? 0,
      isWinner: winners.includes(player.id),
      isDraw: winners.length > 1,
      stats: {
        strikes: view?.strikes ?? 0,
        survived: view && !view.eliminated ? 1 : 0,
      },
    };
  });
}

/* ------------------------------------------------------------------ */
/* Module                                                              */
/* ------------------------------------------------------------------ */

export const bombPassGame: GameModule<BombPassState> = {
  metadata: BOMB_PASS_METADATA,

  initialize(_config: GameConfig): void {
    // Stateless module.
  },

  createInitialState(players, config): BombPassState {
    return {
      phase: 'idle',
      round: 0,
      totalRounds: roundsFor(config.rounds),
      players: Object.fromEntries(players.map((player) => [player.id, newPlayer()])),
      holderId: null,
      lastHolderId: null,
      fuseMs: FUSE_BASE_MS,
      fuseEndsAt: null,
      roundEndsAt: null,
      passCooldownMs: PASS_COOLDOWN_MS,
      strikesToEliminate: STRIKES_TO_ELIMINATE,
      lastExplosionHolder: null,
      departed: {},
      startedAt: null,
      finishReason: null,
      lastEvent: null,
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

    // If the leaver was holding the bomb, hand it to someone else.
    if (state.holderId === playerId) {
      const next = pickHolder({ ...state, holderId: null, lastHolderId: playerId }, ctx.random);
      state.holderId = next;
      if (next) state.players[next]!.receivedAt = ctx.now();
    }
    ctx.markStateChanged();

    const alive = alivePlayers(state);
    if (alive.length <= 1) {
      finishBombMatch(state, ctx, 'completed');
    }
  },

  start(state, ctx): void {
    if (state.phase !== 'idle') return;
    state.round = 0;
    state.players = Object.fromEntries(ctx.players.map((player) => [player.id, newPlayer()]));
    state.departed = {};
    state.holderId = null;
    state.lastHolderId = null;
    state.startedAt = ctx.now();
    state.finishReason = null;
    beginBombRound(state, ctx);
  },

  validateAction(playerId, action, state, ctx): ValidationResult {
    if (action.type !== 'pass') return { valid: false, reason: 'Unknown action.' };
    const targetId = action.payload?.targetId;
    if (typeof targetId !== 'string' || !state.players[targetId]) {
      return { valid: false, reason: 'Pass to a real player.' };
    }
    if (state.phase !== 'running') return { valid: false, reason: 'Nothing to pass right now.' };
    if (state.holderId !== playerId) {
      return { valid: false, reason: 'You are not holding the firework.' };
    }
    if (targetId === playerId) return { valid: false, reason: 'You cannot pass to yourself.' };
    const target = state.players[targetId]!;
    if (target.eliminated || target.left || (state.departed[targetId] ?? false)) {
      return { valid: false, reason: 'That player is out of the game.' };
    }
    if (target.disconnected) return { valid: false, reason: 'That player cannot catch right now.' };
    const held = ctx.now() - (state.players[playerId]?.receivedAt ?? 0);
    if (held < state.passCooldownMs) {
      return { valid: false, reason: 'Hold it for a moment before passing.' };
    }
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    if (action.type !== 'pass') return actionRejected('Unknown action.');
    const targetId = action.payload?.targetId;
    if (typeof targetId !== 'string' || !state.players[targetId]) {
      return actionRejected('Pass to a real player.');
    }
    if (state.phase !== 'running') return actionRejected('Nothing to pass right now.');
    if (state.holderId !== playerId) return actionRejected('You are not holding the firework.');
    if (targetId === playerId) return actionRejected('You cannot pass to yourself.');
    const target = state.players[targetId]!;
    if (target.eliminated || target.left || (state.departed[targetId] ?? false)) {
      return actionRejected('That player is out of the game.');
    }
    if (target.disconnected) return actionRejected('That player cannot catch right now.');
    const held = ctx.now() - (state.players[playerId]?.receivedAt ?? 0);
    if (held < state.passCooldownMs) return actionRejected('Hold it for a moment before passing.');

    state.holderId = targetId;
    target.receivedAt = ctx.now();
    state.lastHolderId = playerId;
    state.lastEvent = `pass:${targetId}`;
    ctx.markStateChanged();
    scheduleAIHolderPass(state, ctx);
    return actionAccepted(true);
  },

  update(): void {
    // Schedule-driven game: no per-tick simulation.
  },

  tick(): void {
    // Schedule-driven game.
  },

  calculateScore(playerId, state): number {
    return state.players[playerId]?.points ?? 0;
  },

  checkWinCondition(state): string[] | null {
    if (state.phase !== 'finished') return null;
    const entries = Object.entries(state.players).filter(([playerId]) => !state.departed[playerId]);
    if (entries.length === 0) return [];
    const survivors = entries.filter(([, player]) => !player.eliminated);
    const pool = survivors.length > 0 ? survivors : entries;
    const bestStrikes = Math.min(...pool.map(([, player]) => player.strikes));
    const tightest = pool.filter(([, player]) => player.strikes === bestStrikes);
    const bestPoints = Math.max(...tightest.map(([, player]) => player.points));
    return tightest.filter(([, player]) => player.points === bestPoints).map(([playerId]) => playerId);
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
    const rankings = computeBombRanking(state, ctx);
    const winners = rankings.filter((entry) => entry.isWinner).map((entry) => entry.playerId);
    return {
      winners,
      isDraw: winners.length > 1,
      rankings,
      reason: state.finishReason ?? 'completed',
    };
  },

  reset(state): BombPassState {
    const seats = Object.keys(state.players);
    return {
      ...state,
      phase: 'idle',
      round: 0,
      players: Object.fromEntries(seats.map((playerId) => [playerId, newPlayer()])),
      holderId: null,
      lastHolderId: null,
      fuseEndsAt: null,
      roundEndsAt: null,
      lastExplosionHolder: null,
      departed: {},
      startedAt: null,
      finishReason: null,
      lastEvent: null,
    };
  },

  cleanup(): void {
    // Stateless module.
  },

  getPublicState(state, _viewerId, ctx) {
    const holder = state.holderId ? state.players[state.holderId] : null;
    return {
      phase: state.phase,
      round: state.round,
      totalRounds: state.totalRounds,
      fuseMs: state.fuseMs,
      fuseEndsAt: state.fuseEndsAt,
      roundEndsAt: state.roundEndsAt,
      passCooldownMs: state.passCooldownMs,
      strikesToEliminate: state.strikesToEliminate,
      holderId: state.holderId,
      lastExplosionHolder: state.lastExplosionHolder,
      passAvailableAt: holder ? holder.receivedAt + state.passCooldownMs : null,
      players: Object.fromEntries(
        Object.entries(state.players).map(([playerId, player]) => [
          playerId,
          {
            strikes: player.strikes,
            points: player.points,
            eliminated: player.eliminated,
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
    if (state.phase !== 'running' || state.holderId !== playerId) return null;
    const alive = alivePlayers(state).filter((id) => id !== playerId && !state.players[id]!.disconnected);
    if (alive.length === 0) return null;
    let target: string;
    if (difficulty === 'hard') {
      // Feed the leader's rival: prefer the player with the most strikes.
      target = alive.reduce((worst, id) =>
        (state.players[id]?.strikes ?? 0) > (state.players[worst]?.strikes ?? 0) ? id : worst,
      alive[0]!);
      if (ctx.random() < 0.2) target = alive[Math.floor(ctx.random() * alive.length)]!;
    } else {
      target = alive[Math.floor(ctx.random() * alive.length)]!;
    }
    return { type: 'pass', payload: { targetId: target } };
  },

  maxDurationMs: 8 * 60 * 1000,
};
