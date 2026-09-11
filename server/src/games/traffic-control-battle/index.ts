import type { AIDifficulty, GameAction, GameConfig, GameFinishReason } from '@2play/shared';
import { TRAFFIC_CONTROL_METADATA } from '@2play/shared';
export { TRAFFIC_CONTROL_METADATA };
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
import {
  APPROACHES,
  LANES,
  MATCH_MS,
  MIN_GREEN_TICKS,
  TICK_MS,
  bestPhaseFor,
  makeJunction,
  mulberry32,
  phaseFor,
  queueKey,
  queuedOn,
  requestPhase,
  tickJunction,
  totalQueued,
  worstEmergency,
  type Junction,
  type Phase,
} from './simulation';

export * from './simulation';

/**
 * Traffic Control Battle — competitive junction management.
 *
 * Every player runs an identical intersection fed by the same seeded car
 * schedule, so the only difference between players is how well they time their
 * signals. The server owns the simulation entirely: clients may only request a
 * phase change, and even that is refused if the minimum green has not elapsed.
 */

export type TrafficPhase = 'idle' | 'playing' | 'finished';

export interface TrafficState {
  phase: TrafficPhase;
  junctions: Record<string, Junction>;
  tick: number;
  accumulatorMs: number;
  startedAt: number | null;
  endsAt: number | null;
  durationMs: number;
  carSeq: number;
  lastEvent: string | null;
  finishReason: GameFinishReason | null;
  nextAIRequestAt: Record<string, number>;
}

const AI_INTERVAL: Record<AIDifficulty, number> = { easy: 1_400, medium: 800, hard: 450 };
/** Chance a weaker AI switches to the wrong phase on purpose. */
const AI_ERROR: Record<AIDifficulty, number> = { easy: 0.35, medium: 0.12, hard: 0.02 };

function activePlayers(state: TrafficState): Array<[string, Junction]> {
  return Object.entries(state.junctions).filter(([, junction]) => !junction.left);
}

export function finishTraffic(state: TrafficState, ctx: GameContext, reason: GameFinishReason): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.finishReason = reason;
  state.endsAt = null;
  state.lastEvent = reason === 'timeout' ? 'timeout' : 'finished';
  ctx.markStateChanged();
  ctx.finish(reason);
}

/** Advances every junction by one fixed step using one shared seeded stream. */
export function stepAll(state: TrafficState, ctx: GameContext): void {
  if (state.phase !== 'playing') return;
  state.tick += 1;
  // Difficulty ramps: traffic gets heavier as the match runs on.
  const spawnChance = Math.min(0.85, 0.3 + state.tick * 0.003);

  for (const [id, junction] of activePlayers(state)) {
    // Each junction draws from a stream seeded by (matchSeed, tick, player) so
    // every player faces the SAME schedule while staying independent.
    const seed = (ctx.seed ^ (state.tick * 0x9e3779b1) ^ hashId(id)) >>> 0;
    const random = mulberry32(seed);
    const outcome = tickJunction(junction, state.tick, random, spawnChance, () => {
      state.carSeq += 1;
      return `c${state.carSeq}`;
    });
    if (outcome.collision) state.lastEvent = `collision:${id}`;
    else if (outcome.emergencyLost) state.lastEvent = `emergency-lost:${id}`;
    else if (outcome.cleared > 0) state.lastEvent = `cleared:${id}`;
  }
  ctx.markStateChanged();
}

/** Stable small hash so each seat gets a distinct-but-deterministic stream. */
function hashId(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function isPhase(value: unknown): value is Phase {
  return value === 'ns' || value === 'ew';
}

export const trafficControlGame: GameModule<TrafficState> = {
  metadata: TRAFFIC_CONTROL_METADATA,

  initialize(): void {
    // Stateless module.
  },

  createInitialState(players: readonly GamePlayerView[], _config: GameConfig): TrafficState {
    const state: TrafficState = {
      phase: 'idle',
      junctions: {},
      tick: 0,
      accumulatorMs: 0,
      startedAt: null,
      endsAt: null,
      durationMs: MATCH_MS,
      carSeq: 0,
      lastEvent: null,
      finishReason: null,
      nextAIRequestAt: {},
    };
    for (const player of players) state.junctions[player.id] = makeJunction();
    return state;
  },

  playerJoined(player, state): void {
    const existing = state.junctions[player.id];
    if (existing) {
      // Reconnection keeps the junction exactly as it was.
      existing.disconnected = false;
      return;
    }
    state.junctions[player.id] = makeJunction();
  },

  playerReady(): void {
    // Lobby concern.
  },

  playerLeft(playerId, state, ctx, reason): void {
    const junction = state.junctions[playerId];
    if (!junction) return;
    if (reason === 'disconnect') {
      junction.disconnected = true;
      ctx.markStateChanged();
      return;
    }
    junction.left = true;
    if (activePlayers(state).length === 0) finishTraffic(state, ctx, 'abandoned');
  },

  start(state, ctx): void {
    if (state.phase === 'playing') return;
    state.junctions = {};
    for (const player of ctx.players) state.junctions[player.id] = makeJunction();
    state.tick = 0;
    state.accumulatorMs = 0;
    state.carSeq = 0;
    state.phase = 'playing';
    state.startedAt = ctx.now();
    state.endsAt = ctx.now() + state.durationMs;
    state.finishReason = null;
    state.lastEvent = 'start';
    state.nextAIRequestAt = {};
    ctx.markStateChanged();
    ctx.schedule(state.durationMs, () => finishTraffic(state, ctx, 'timeout'), 'gameDuration', 'match');
    for (const player of ctx.players) {
      if (player.isAI) ctx.requestAI(player.id, 600);
    }
  },

  validateAction(playerId, action, state): ValidationResult {
    // The client may never assert an outcome or edit the simulation.
    if (['score', 'win', 'finish', 'complete', 'clear', 'spawn', 'setState'].includes(action.type)) {
      return { valid: false, reason: 'The server runs the junction.' };
    }
    if (state.phase !== 'playing') return { valid: false, reason: 'The junction is not live.' };

    const junction = state.junctions[playerId];
    if (!junction || junction.left) return { valid: false, reason: 'You are not running a junction.' };
    if (junction.disconnected) return { valid: false, reason: 'Reconnect to keep controlling.' };

    if (action.type !== 'phase') return { valid: false, reason: 'Unknown action.' };
    const requested = action.payload?.phase;
    if (!isPhase(requested)) return { valid: false, reason: 'Choose the north-south or east-west phase.' };
    if (junction.phase === requested) return { valid: false, reason: 'That phase is already running.' };
    // Minimum green is enforced here so signal spamming cannot cause chaos.
    if (junction.sincePhase < MIN_GREEN_TICKS) {
      return { valid: false, reason: 'The current green must run a little longer.' };
    }
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    if (state.phase !== 'playing') return actionRejected('The junction is not live.');
    const junction = state.junctions[playerId];
    if (!junction || junction.left || junction.disconnected) return actionRejected('You cannot act.');
    if (action.type !== 'phase') return actionRejected('Unknown action.');

    const requested = action.payload?.phase;
    if (!isPhase(requested)) return actionRejected('Invalid phase.');
    if (!requestPhase(junction, requested)) {
      return actionRejected('That phase change is not allowed yet.');
    }
    state.lastEvent = `phase:${playerId}:${requested}`;
    ctx.markStateChanged();
    return actionAccepted();
  },

  /** The heartbeat: a fixed-step simulation driven by the platform tick. */
  update(state, deltaTimeMs, ctx): void {
    if (state.phase !== 'playing') return;
    state.accumulatorMs += deltaTimeMs;
    // Catch up in whole steps so the simulation stays deterministic.
    let guard = 0;
    while (state.accumulatorMs >= TICK_MS && guard < 8) {
      state.accumulatorMs -= TICK_MS;
      guard += 1;
      stepAll(state, ctx);
    }

    const now = ctx.now();
    for (const view of ctx.players) {
      if (!view.isAI) continue;
      const junction = state.junctions[view.id];
      if (!junction || junction.left) continue;
      const difficulty = view.aiDifficulty ?? 'medium';
      if (now >= (state.nextAIRequestAt[view.id] ?? 0)) {
        ctx.requestAI(view.id, 40);
        state.nextAIRequestAt[view.id] = now + AI_INTERVAL[difficulty];
      }
    }
  },

  tick(): void {
    // Handled by update().
  },

  calculateScore(playerId, state): number {
    return state.junctions[playerId]?.score ?? 0;
  },

  checkWinCondition(state): string[] | null {
    if (state.phase !== 'finished') return null;
    const entries = activePlayers(state);
    if (entries.length === 0) return [];
    const best = Math.max(...entries.map(([, junction]) => junction.score));
    return entries.filter(([, junction]) => junction.score === best).map(([id]) => id);
  },

  checkDrawCondition(state): boolean {
    return (this.checkWinCondition(state)?.length ?? 0) > 1;
  },

  isGameFinished(state): boolean {
    return state.phase === 'finished';
  },

  finish(state): void {
    state.phase = 'finished';
    state.endsAt = null;
  },

  getResult(state, ctx): GameResultDraft {
    const ranked = [...ctx.players].sort((a, b) => {
      const byScore = (state.junctions[b.id]?.score ?? 0) - (state.junctions[a.id]?.score ?? 0);
      if (byScore !== 0) return byScore;
      // Tie-break on cars cleared, then fewer collisions.
      const byCleared = (state.junctions[b.id]?.cleared ?? 0) - (state.junctions[a.id]?.cleared ?? 0);
      if (byCleared !== 0) return byCleared;
      return (state.junctions[a.id]?.collisions ?? 0) - (state.junctions[b.id]?.collisions ?? 0);
    });
    const best = ranked.length > 0 ? state.junctions[ranked[0]?.id ?? '']?.score ?? 0 : 0;
    const winners = ranked
      .filter((player) => (state.junctions[player.id]?.score ?? 0) === best)
      .map((player) => player.id);
    const isDraw = winners.length > 1;

    const rankings: RankingDraft[] = ranked.map((player, index) => {
      const junction = state.junctions[player.id];
      return {
        playerId: player.id,
        rank: isDraw ? 1 : index + 1,
        score: junction?.score ?? 0,
        isWinner: winners.includes(player.id),
        isDraw,
        stats: {
          cleared: junction?.cleared ?? 0,
          collisions: junction?.collisions ?? 0,
          jams: junction?.jams ?? 0,
          emergencies: junction?.emergenciesCleared ?? 0,
        },
      };
    });
    return { winners, isDraw, rankings, reason: state.finishReason ?? 'completed' };
  },

  reset(state): TrafficState {
    return {
      ...state,
      phase: 'idle',
      junctions: Object.fromEntries(Object.keys(state.junctions).map((id) => [id, makeJunction()])),
      tick: 0,
      accumulatorMs: 0,
      carSeq: 0,
      startedAt: null,
      endsAt: null,
      lastEvent: null,
      finishReason: null,
      nextAIRequestAt: {},
    };
  },

  cleanup(state): void {
    state.junctions = {};
    state.phase = 'finished';
  },

  /**
   * Each player sees their OWN junction in full; opponents are reduced to a
   * scoreboard, so nobody can read another player's queues.
   */
  getPublicState(state, viewerId, ctx) {
    const mine = viewerId ? state.junctions[viewerId] : undefined;

    return {
      phase: state.phase,
      tick: state.tick,
      endsAt: state.endsAt,
      durationMs: state.durationMs,
      lastEvent: state.lastEvent,
      finishReason: state.finishReason,
      serverTime: ctx.now(),
      minGreenTicks: MIN_GREEN_TICKS,
      // The viewer's own junction, fully detailed.
      junction: mine
        ? {
            phase: mine.phase,
            sincePhase: mine.sincePhase,
            canSwitch: mine.sincePhase >= MIN_GREEN_TICKS,
            signals: APPROACHES.map((approach) => ({
              approach,
              state: mine.signals[approach].state,
            })),
            queues: APPROACHES.flatMap((approach) =>
              LANES.map((lane) => {
                const queue = mine.queues[queueKey(approach, lane)] ?? [];
                return {
                  approach,
                  lane,
                  count: queue.length,
                  emergency: queue.some((car) => car.emergency),
                  longestWait: queue.reduce((max, car) => Math.max(max, car.waited), 0),
                };
              }),
            ),
            inBox: mine.inBox.map((car) => ({
              id: car.id,
              approach: car.approach,
              lane: car.lane,
              emergency: car.emergency,
            })),
            totalQueued: totalQueued(mine),
            cleared: mine.cleared,
            collisions: mine.collisions,
            jams: mine.jams,
            emergenciesCleared: mine.emergenciesCleared,
            emergenciesLost: mine.emergenciesLost,
            score: mine.score,
          }
        : null,
      // Opponents: score and headline stats only, never their queues.
      players: Object.fromEntries(
        Object.entries(state.junctions).map(([id, junction]) => [
          id,
          {
            score: junction.score,
            cleared: junction.cleared,
            collisions: junction.collisions,
            queued: totalQueued(junction),
            disconnected: junction.disconnected,
          },
        ]),
      ),
    };
  },

  /**
   * AI controller. It reads only its own junction — exactly what a human sees —
   * and prioritises emergency vehicles, then the busier axis. Weaker bots
   * deliberately mistime, which is a genuine mistake rather than a handicap.
   */
  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'playing') return null;
    const junction = state.junctions[playerId];
    if (!junction || junction.left) return null;
    // Respect the same minimum green a human faces.
    if (junction.sincePhase < MIN_GREEN_TICKS) return null;

    let target = bestPhaseFor(junction);

    // A real mistake: serve the wrong axis.
    if (ctx.random() < AI_ERROR[difficulty]) {
      target = target === 'ns' ? 'ew' : 'ns';
    }
    if (target === junction.phase) return null;

    // Hard bots hold a green when the other side is genuinely empty.
    if (difficulty === 'hard') {
      const emergency = worstEmergency(junction);
      if (!emergency) {
        const incoming = target === 'ns' ? queuedOn(junction, 'n') + queuedOn(junction, 's') : queuedOn(junction, 'e') + queuedOn(junction, 'w');
        if (incoming === 0) return null;
      }
      void phaseFor;
    }

    return { type: 'phase', payload: { phase: target } };
  },

  needsUpdateLoop: true,
  maxDurationMs: 10 * 60 * 1000,
};
