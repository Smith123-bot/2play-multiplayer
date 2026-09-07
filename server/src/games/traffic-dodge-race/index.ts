import type { GameAction, GameConfig, GameFinishReason } from '@2play/shared';
import { TRAFFIC_DODGE_METADATA } from '@2play/shared';
export { TRAFFIC_DODGE_METADATA };
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
 * Traffic Dodge Race — deterministic arcade lane dodger.
 *
 * The whole road (traffic schedule) is generated from the match seed so both
 * racers see the identical world. The server advances positions on the fixed
 * tick loop, resolves collisions, stuns and finishes. Clients only send lane
 * change intents — never positions, progress or finish claims.
 */

export type TrafficPhase = 'idle' | 'playing' | 'finished';
export type TrafficDirection = 'left' | 'right';

export interface TrafficCar {
  id: string;
  lane: number;
  /** Front position of the car along the track. */
  pos: number;
  length: number;
  /** Absolute forward speed in units/second (always slower than a healthy racer). */
  speed: number;
}

export interface TrafficRacer {
  lane: number;
  position: number;
  speed: number;
  stunUntil: number | null;
  crashes: number;
  finished: boolean;
  finishMs: number | null;
  disconnected: boolean;
  left: boolean;
  lastMoveAt: number;
}

export interface TrafficDodgeState {
  phase: TrafficPhase;
  lanes: number;
  trackLength: number;
  baseSpeed: number;
  maxSpeed: number;
  accelPerSecond: number;
  stunMs: number;
  racers: Record<string, TrafficRacer>;
  traffic: TrafficCar[];
  startedAt: number | null;
  endsAt: number | null;
  durationMs: number;
  finishReason: GameFinishReason | null;
  lastEvent: string | null;
  nextAIRequestAt: Record<string, number>;
}

const LANES = 5;
const TRACK_LENGTH = 2000;
const BASE_SPEED = 14;
const MAX_SPEED = 27;
const ACCEL_PER_SECOND = 0.16;
const STUN_MS = 1500;
const MATCH_MS = 150 * 1000;
const MOVE_COOLDOWN_MS = 140;
const CAR_LENGTH = 7;
const CAR_SPEED_MIN = 4;
const CAR_SPEED_MAX = 9;
/** Average gap (in track units) between generated cars. */
const TRAFFIC_DENSITY = 26;
const AI_REQUEST_INTERVAL_MS = 300;

export function isTrafficDirection(value: unknown): value is TrafficDirection {
  return value === 'left' || value === 'right';
}

/**
 * Deterministic traffic schedule from the seed: a stream of cars spread over
 * the track with pseudo-random lanes and speeds. Exported for tests.
 */
export function generateTraffic(rng: () => number): TrafficCar[] {
  const cars: TrafficCar[] = [];
  let pos = 60;
  let id = 0;
  while (pos < TRACK_LENGTH + 120) {
    const lane = Math.floor(rng() * LANES);
    const speed = CAR_SPEED_MIN + rng() * (CAR_SPEED_MAX - CAR_SPEED_MIN);
    cars.push({ id: `car-${id}`, lane, pos, length: CAR_LENGTH, speed });
    id += 1;
    pos += TRAFFIC_DENSITY * (0.55 + rng() * 0.9);
  }
  return cars;
}

/** Timer callback: the race clock expired. Exported for tests. */
export function finishRaceOnTimeout(state: TrafficDodgeState, ctx: GameContext): void {
  if (state.phase !== 'playing') return;
  state.phase = 'finished';
  state.finishReason = 'timeout';
  state.lastEvent = 'timeout';
  ctx.markStateChanged();
  ctx.finish('timeout');
}

function activeRacers(state: TrafficDodgeState): Array<[string, TrafficRacer]> {
  return Object.entries(state.racers).filter(([, racer]) => !racer.left);
}

function allActiveFinished(state: TrafficDodgeState): boolean {
  const active = activeRacers(state);
  return active.length > 0 && active.every(([, racer]) => racer.finished);
}

/**
 * Advances the whole race by deltaTimeMs (server authoritative). Exported for
 * tests.
 */
export function advanceRace(state: TrafficDodgeState, deltaTimeMs: number, ctx: GameContext): void {
  if (state.phase !== 'playing') return;
  const now = ctx.now();
  const dt = deltaTimeMs / 1000;

  for (const car of state.traffic) {
    car.pos += car.speed * dt;
  }

  for (const [playerId, racer] of activeRacers(state)) {
    if (racer.finished) continue;

    if (racer.stunUntil !== null && now < racer.stunUntil) {
      racer.speed = 0;
    } else {
      racer.stunUntil = null;
      const elapsed = (now - (state.startedAt ?? now)) / 1000;
      racer.speed = Math.min(state.maxSpeed, state.baseSpeed + elapsed * state.accelPerSecond);
      racer.position += racer.speed * dt;
    }

    // Collision: player point inside a car's occupied range in the same lane.
    for (const car of state.traffic) {
      if (car.lane !== racer.lane) continue;
      if (racer.position >= car.pos && racer.position <= car.pos + car.length) {
        racer.crashes += 1;
        racer.stunUntil = now + state.stunMs;
        racer.position = Math.max(0, car.pos - 2);
        racer.speed = 0;
        state.lastEvent = `crash:${playerId}`;
        ctx.markStateChanged();
        break;
      }
    }

    if (racer.position >= state.trackLength) {
      racer.finished = true;
      racer.position = state.trackLength;
      racer.finishMs = now - (state.startedAt ?? now);
      state.lastEvent = `finish:${playerId}`;
      ctx.markStateChanged();
    }
  }

  if (state.phase === 'playing' && allActiveFinished(state)) {
    state.phase = 'finished';
    state.finishReason = 'completed';
    state.lastEvent = 'all-finished';
    ctx.markStateChanged();
    ctx.finish('completed');
  }
}

/** Lane clearance helper (distance to the nearest car ahead in a lane). */
export function laneClearance(state: TrafficDodgeState, lane: number, from: number): number {
  let clearance = Infinity;
  for (const car of state.traffic) {
    if (car.lane !== lane) continue;
    const gap = car.pos - from;
    if (gap >= -car.length && gap < clearance) clearance = Math.max(0, gap);
  }
  return clearance;
}

export const trafficDodgeGame: GameModule<TrafficDodgeState> = {
  metadata: TRAFFIC_DODGE_METADATA,

  initialize(_config: GameConfig): void {
    // Stateless module.
  },

  createInitialState(players, _config): TrafficDodgeState {
    return {
      phase: 'idle',
      lanes: LANES,
      trackLength: TRACK_LENGTH,
      baseSpeed: BASE_SPEED,
      maxSpeed: MAX_SPEED,
      accelPerSecond: ACCEL_PER_SECOND,
      stunMs: STUN_MS,
      racers: Object.fromEntries(
        players.map((player) => [
          player.id,
          {
            lane: 2,
            position: 0,
            speed: 0,
            stunUntil: null,
            crashes: 0,
            finished: false,
            finishMs: null,
            disconnected: false,
            left: false,
            lastMoveAt: 0,
          } satisfies TrafficRacer,
        ]),
      ),
      traffic: [],
      startedAt: null,
      endsAt: null,
      durationMs: MATCH_MS,
      finishReason: null,
      lastEvent: null,
      nextAIRequestAt: {},
    };
  },

  playerJoined(player, state): void {
    if (!state.racers[player.id]) {
      state.racers[player.id] = {
        lane: 2,
        position: 0,
        speed: 0,
        stunUntil: null,
        crashes: 0,
        finished: false,
        finishMs: null,
        disconnected: false,
        left: false,
        lastMoveAt: 0,
      };
    }
  },

  playerReady(): void {
    // No per-player readiness behaviour.
  },

  playerLeft(playerId, state, ctx, reason): void {
    const racer = state.racers[playerId];
    if (!racer) return;
    if (reason === 'disconnect') {
      racer.disconnected = true;
      return;
    }
    racer.left = true;
    racer.disconnected = false;
    racer.speed = 0;
    state.lastEvent = `left:${playerId}`;
    const active = activeRacers(state);
    if (state.phase === 'playing' && (active.length === 0 || active.every(([, racerEntry]) => racerEntry.finished))) {
      state.phase = 'finished';
      state.finishReason = 'completed';
      ctx.markStateChanged();
      ctx.finish('completed');
    }
  },

  start(state, ctx): void {
    if (state.phase === 'playing') return;
    const rng = ctx.random;
    state.traffic = generateTraffic(rng);
    state.racers = {};
    ctx.players.forEach((player, index) => {
      state.racers[player.id] = {
        lane: index % 2 === 0 ? 1 : 3, // staggered start lanes
        position: 0,
        speed: 0,
        stunUntil: null,
        crashes: 0,
        finished: false,
        finishMs: null,
        disconnected: false,
        left: false,
        lastMoveAt: 0,
      };
    });
    state.phase = 'playing';
    state.startedAt = ctx.now();
    state.endsAt = state.startedAt + state.durationMs;
    state.finishReason = null;
    state.lastEvent = 'start';
    state.nextAIRequestAt = {};
    ctx.markStateChanged();

    ctx.schedule(
      state.durationMs,
      () => finishRaceOnTimeout(state, ctx),
      'gameDuration',
      'match-timeout',
    );
  },

  validateAction(playerId, action, state): ValidationResult {
    if (action.type !== 'move') return { valid: false, reason: 'Unknown action.' };
    const direction = action.payload?.direction;
    if (!isTrafficDirection(direction)) {
      return { valid: false, reason: 'Invalid direction — use left or right.' };
    }
    if (state.phase !== 'playing') return { valid: false, reason: 'The race is not running.' };
    const racer = state.racers[playerId];
    if (!racer) return { valid: false, reason: 'You are not part of this race.' };
    if (racer.left) return { valid: false, reason: 'You left this race.' };
    if (racer.finished) return { valid: false, reason: 'You already crossed the line.' };
    if (racer.stunUntil !== null) return { valid: false, reason: 'Recovering from a crash…' };
    const targetLane = racer.lane + (direction === 'left' ? -1 : 1);
    if (targetLane < 0 || targetLane >= state.lanes) {
      return { valid: false, reason: 'The edge of the road blocks that way.' };
    }
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    if (action.type !== 'move') return actionRejected('Unknown action.');
    const direction = action.payload?.direction;
    if (!isTrafficDirection(direction)) return actionRejected('Invalid direction.');
    const racer = state.racers[playerId];
    if (!racer) return actionRejected('You are not part of this race.');
    if (racer.finished) return actionRejected('You already crossed the line.');
    if (racer.stunUntil !== null) return actionRejected('Recovering from a crash…');
    const targetLane = racer.lane + (direction === 'left' ? -1 : 1);
    if (targetLane < 0 || targetLane >= state.lanes) {
      return actionRejected('The edge of the road blocks that way.');
    }
    const now = ctx.now();
    if (now - racer.lastMoveAt < MOVE_COOLDOWN_MS) {
      return actionRejected('Too fast — steady your steering.');
    }
    racer.lane = targetLane;
    racer.lastMoveAt = now;
    state.lastEvent = `lane:${playerId}:${targetLane}`;
    ctx.markStateChanged();
    return actionAccepted();
  },

  /** Fixed-step simulation driven by the platform tick loop. */
  update(state, deltaTimeMs, ctx): void {
    if (state.phase !== 'playing') return;

    for (const player of ctx.players) {
      if (!player.isAI) continue;
      const racer = state.racers[player.id];
      if (!racer || racer.finished || racer.left) continue;
      const now = ctx.now();
      if (now >= (state.nextAIRequestAt[player.id] ?? 0)) {
        ctx.requestAI(player.id, 50);
        state.nextAIRequestAt[player.id] = now + AI_REQUEST_INTERVAL_MS;
      }
    }

    advanceRace(state, deltaTimeMs, ctx);
  },

  tick(): void {
    // Handled by update().
  },

  calculateScore(playerId, state): number {
    const racer = state.racers[playerId];
    if (!racer) return 0;
    return Math.round(racer.finished ? state.trackLength : racer.position);
  },

  checkWinCondition(state): string[] | null {
    if (state.phase !== 'finished') return null;
    const finishers = Object.entries(state.racers)
      .filter(([, racer]) => racer.finished && racer.finishMs !== null)
      .sort((a, b) => (a[1].finishMs ?? 0) - (b[1].finishMs ?? 0));
    if (finishers.length > 0) {
      const best = finishers[0]![1].finishMs!;
      return finishers.filter(([, racer]) => racer.finishMs === best).map(([id]) => id);
    }
    const entries = Object.entries(state.racers);
    if (entries.length === 0) return null;
    const bestProgress = Math.max(...entries.map(([, racer]) => racer.position));
    return entries.filter(([, racer]) => racer.position === bestProgress).map(([id]) => id);
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
      const aRacer = state.racers[a.id];
      const bRacer = state.racers[b.id];
      const aFinish = aRacer?.finishMs ?? Number.POSITIVE_INFINITY;
      const bFinish = bRacer?.finishMs ?? Number.POSITIVE_INFINITY;
      if (aFinish !== bFinish) return aFinish - bFinish;
      const diff = (bRacer?.position ?? 0) - (aRacer?.position ?? 0);
      if (diff !== 0) return diff;
      const crashDiff = (aRacer?.crashes ?? 0) - (bRacer?.crashes ?? 0);
      if (crashDiff !== 0) return crashDiff;
      return a.seatIndex - b.seatIndex;
    });
    const winners = trafficDodgeGame.checkWinCondition(state) ?? [];
    const winnerSet = new Set(winners);

    const rankings: RankingDraft[] = ranked.map((player, index) => {
      const racer = state.racers[player.id];
      return {
        playerId: player.id,
        rank: index + 1,
        score: racer ? Math.round(racer.finished ? state.trackLength : racer.position) : 0,
        isWinner: winnerSet.has(player.id),
        isDraw: winners.length > 1,
        stats: {
          progress: racer ? Math.round(racer.position) : 0,
          crashes: racer?.crashes ?? 0,
          finishMs: racer?.finishMs ?? -1,
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

  reset(state): TrafficDodgeState {
    const seats = Object.keys(state.racers);
    return {
      ...state,
      phase: 'idle',
      racers: Object.fromEntries(
        seats.map((playerId) => [
          playerId,
          {
            lane: 2,
            position: 0,
            speed: 0,
            stunUntil: null,
            crashes: 0,
            finished: false,
            finishMs: null,
            disconnected: false,
            left: false,
            lastMoveAt: 0,
          } satisfies TrafficRacer,
        ]),
      ),
      traffic: [],
      startedAt: null,
      endsAt: null,
      finishReason: null,
      lastEvent: null,
      nextAIRequestAt: {},
    };
  },

  cleanup(state): void {
    state.racers = {};
    state.traffic = [];
    state.phase = 'finished';
  },

  /** The road is shared and public — positions/speeds come from the server. */
  getPublicState(state, _viewerId, ctx) {
    return {
      phase: state.phase,
      lanes: state.lanes,
      trackLength: state.trackLength,
      startedAt: state.startedAt,
      endsAt: state.endsAt,
      durationMs: state.durationMs,
      stunMs: state.stunMs,
      finishReason: state.finishReason,
      lastEvent: state.lastEvent,
      serverTime: ctx.now(),
      traffic: state.traffic.map((car) => ({ ...car })),
      racers: Object.fromEntries(
        ctx.players.map((player) => {
          const racer = state.racers[player.id];
          return [
            player.id,
            racer
              ? {
                  lane: racer.lane,
                  position: racer.position,
                  speed: racer.speed,
                  stunUntil: racer.stunUntil,
                  crashes: racer.crashes,
                  finished: racer.finished,
                  finishMs: racer.finishMs,
                  disconnected: racer.disconnected,
                }
              : null,
          ];
        }),
      ),
    };
  },

  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'playing') return null;
    const racer = state.racers[playerId];
    if (!racer || racer.finished || racer.left || racer.stunUntil !== null) return null;

    const rng = ctx.random;
    const DANGER = difficulty === 'easy' ? 18 : difficulty === 'medium' ? 34 : 50;
    if (difficulty === 'easy' && rng() < 0.2) return null; // sometimes daydreams

    const current = laneClearance(state, racer.lane, racer.position);
    if (current > DANGER) return null; // lane is safe — hold it

    const options: Array<'left' | 'right'> = [];
    if (racer.lane > 0) options.push('left');
    if (racer.lane < state.lanes - 1) options.push('right');
    let best: 'left' | 'right' | null = null;
    let bestClearance = current;
    for (const option of options) {
      const lane = racer.lane + (option === 'left' ? -1 : 1);
      const clearance = laneClearance(state, lane, racer.position);
      if (clearance > bestClearance + 4) {
        bestClearance = clearance;
        best = option;
      }
    }
    if (!best) return null; // every option is worse — hold and pray
    return { type: 'move', payload: { direction: best } };
  },

  needsUpdateLoop: true,
  maxDurationMs: 8 * 60 * 1000,
};
