import type { AIDifficulty, GameAction, GameFinishReason } from '@2play/shared';
import { TRAFFIC_CONTROL_METADATA } from '@2play/shared';
export { TRAFFIC_CONTROL_METADATA };
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
 * Traffic Control Battle — private intersections, server-driven cars.
 *
 * Clients only flip lights. The server spawns, moves, scores, penalises
 * jams and collisions.
 */

export type TrafficPhase = 'idle' | 'playing' | 'finished';
export type LightAxis = 'ns' | 'ew';
export type Approach = 'n' | 's' | 'e' | 'w';

export interface TrafficCar {
  id: string;
  approach: Approach;
  progress: number;
  waiting: boolean;
}

export interface TrafficZone {
  axis: LightAxis;
  lastSwitchAt: number;
  cars: TrafficCar[];
  score: number;
  cleared: number;
  jams: number;
  collisions: number;
  disconnected: boolean;
  left: boolean;
}

export interface TrafficState {
  phase: TrafficPhase;
  zones: Record<string, TrafficZone>;
  stepMs: number;
  stepIndex: number;
  accumulatorMs: number;
  startedAt: number | null;
  endsAt: number | null;
  durationMs: number;
  finishReason: GameFinishReason | null;
  lastEvent: string | null;
  nextAIRequestAt: Record<string, number>;
  carSeq: number;
}

export const TRAFFIC_STEP_MS = 250;
export const TRAFFIC_MATCH_MS = 120_000;
export const SWITCH_COOLDOWN_MS = 400;
export const JAM_THRESHOLD = 6;
export const SCORE_CLEAR = 10;
export const PENALTY_JAM = 15;
export const PENALTY_COLLISION = 25;
const APPROACHES: Approach[] = ['n', 's', 'e', 'w'];
const AI_INTERVAL: Record<AIDifficulty, number> = { easy: 900, medium: 500, hard: 280 };

function isNs(approach: Approach): boolean {
  return approach === 'n' || approach === 's';
}

function emptyZone(): TrafficZone {
  return {
    axis: 'ns',
    lastSwitchAt: 0,
    cars: [],
    score: 0,
    cleared: 0,
    jams: 0,
    collisions: 0,
    disconnected: false,
    left: false,
  };
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function spawnCar(state: TrafficState, zone: TrafficZone, rng: () => number): void {
  const approach = APPROACHES[Math.floor(rng() * APPROACHES.length)]!;
  const waitingOnAxis = zone.cars.filter((car) => isNs(car.approach) === isNs(approach)).length;
  if (waitingOnAxis >= 8) return;
  state.carSeq += 1;
  zone.cars.push({ id: `c${state.carSeq}`, approach, progress: 0, waiting: true });
}

export function stepTraffic(state: TrafficState, ctx: GameContext): void {
  if (state.phase !== 'playing') return;
  const rng = mulberry32((ctx.seed ^ state.stepIndex) >>> 0);
  const spawnChance = Math.min(0.85, 0.28 + state.stepIndex * 0.004);
  for (const zone of Object.values(state.zones)) {
    if (zone.left) continue;
    if (rng() < spawnChance) spawnCar(state, zone, rng);
    const remaining: TrafficCar[] = [];
    for (const car of zone.cars) {
      const green = zone.axis === 'ns' ? isNs(car.approach) : !isNs(car.approach);
      if (!green) {
        car.waiting = true;
        remaining.push(car);
        continue;
      }
      car.waiting = false;
      car.progress += 1;
      if (car.progress >= 6) {
        zone.cleared += 1;
        zone.score += SCORE_CLEAR;
        continue;
      }
      remaining.push(car);
    }
    zone.cars = remaining;
    let boxNs = 0;
    let boxEw = 0;
    for (const car of zone.cars) {
      if (car.progress < 4) continue;
      if (isNs(car.approach)) boxNs += 1;
      else boxEw += 1;
    }
    if (boxNs > 0 && boxEw > 0) {
      zone.collisions += 1;
      zone.score = Math.max(0, zone.score - PENALTY_COLLISION);
      zone.cars = zone.cars.filter((car) => car.progress < 4);
      state.lastEvent = 'collision';
    }
    const queued = zone.cars.filter((car) => car.waiting).length;
    if (queued >= JAM_THRESHOLD) {
      zone.jams += 1;
      zone.score = Math.max(0, zone.score - PENALTY_JAM);
      zone.cars = zone.cars.slice(0, JAM_THRESHOLD - 1);
      state.lastEvent = 'jam';
    }
  }
  state.stepIndex += 1;
}

export function finishTraffic(state: TrafficState, ctx: GameContext, reason: GameFinishReason): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.finishReason = reason;
  state.lastEvent = reason === 'timeout' ? 'timeout' : 'finished';
  ctx.markStateChanged();
  ctx.finish(reason);
}

export const trafficControlGame: GameModule<TrafficState> = {
  metadata: TRAFFIC_CONTROL_METADATA,

  initialize(): void {
    // Stateless module.
  },

  createInitialState(players): TrafficState {
    const zones: Record<string, TrafficZone> = {};
    for (const player of players) zones[player.id] = emptyZone();
    return {
      phase: 'idle',
      zones,
      stepMs: TRAFFIC_STEP_MS,
      stepIndex: 0,
      accumulatorMs: 0,
      startedAt: null,
      endsAt: null,
      durationMs: TRAFFIC_MATCH_MS,
      finishReason: null,
      lastEvent: null,
      nextAIRequestAt: {},
      carSeq: 0,
    };
  },

  playerJoined(player, state): void {
    const existing = state.zones[player.id];
    if (existing) {
      existing.disconnected = false;
      return;
    }
    state.zones[player.id] = emptyZone();
  },

  playerReady(): void {
    // Lobby concern.
  },

  playerLeft(playerId, state, ctx, reason): void {
    const zone = state.zones[playerId];
    if (!zone) return;
    if (reason === 'disconnect') {
      zone.disconnected = true;
      return;
    }
    zone.left = true;
    const remaining = Object.values(state.zones).filter((entry) => !entry.left);
    if (remaining.length <= 1) finishTraffic(state, ctx, 'abandoned');
  },

  start(state, ctx): void {
    if (state.phase === 'playing') return;
    const zones: Record<string, TrafficZone> = {};
    for (const player of ctx.players) zones[player.id] = emptyZone();
    state.zones = zones;
    state.stepIndex = 0;
    state.accumulatorMs = 0;
    state.carSeq = 0;
    state.phase = 'playing';
    state.startedAt = ctx.now();
    state.endsAt = state.startedAt + state.durationMs;
    state.finishReason = null;
    state.lastEvent = 'start';
    ctx.markStateChanged();
    ctx.schedule(state.durationMs, () => finishTraffic(state, ctx, 'timeout'), 'gameDuration', 'match-timeout');
  },

  validateAction(playerId, action, state, ctx): ValidationResult {
    if (state.phase !== 'playing') return { valid: false, reason: 'The intersection is not live.' };
    const zone = state.zones[playerId];
    if (!zone || zone.left) return { valid: false, reason: 'You are not running this junction.' };
    if (action.type !== 'switch') return { valid: false, reason: 'Unknown action.' };
    if (ctx.now() - zone.lastSwitchAt < SWITCH_COOLDOWN_MS) return { valid: false, reason: 'Lights are cooling down.' };
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    const zone = state.zones[playerId];
    if (!zone || state.phase !== 'playing' || zone.left) return actionRejected('You cannot switch.');
    if (action.type !== 'switch') return actionRejected('Unknown action.');
    if (ctx.now() - zone.lastSwitchAt < SWITCH_COOLDOWN_MS) return actionRejected('Cooldown.');
    zone.axis = zone.axis === 'ns' ? 'ew' : 'ns';
    zone.lastSwitchAt = ctx.now();
    state.lastEvent = `switch:${playerId}:${zone.axis}`;
    ctx.markStateChanged();
    return actionAccepted();
  },

  update(state, deltaTimeMs, ctx): void {
    if (state.phase !== 'playing') return;
    for (const player of ctx.players) {
      if (!player.isAI) continue;
      const zone = state.zones[player.id];
      if (!zone || zone.left) continue;
      const now = ctx.now();
      const difficulty = player.aiDifficulty ?? 'medium';
      if (now >= (state.nextAIRequestAt[player.id] ?? 0)) {
        ctx.requestAI(player.id, 40);
        state.nextAIRequestAt[player.id] = now + AI_INTERVAL[difficulty];
      }
    }
    state.accumulatorMs += deltaTimeMs;
    let guard = 0;
    while (state.accumulatorMs >= state.stepMs && state.phase === 'playing' && guard < 4) {
      state.accumulatorMs -= state.stepMs;
      guard += 1;
      stepTraffic(state, ctx);
    }
  },

  tick(): void {
    // Handled by update().
  },

  calculateScore(playerId, state): number {
    return state.zones[playerId]?.score ?? 0;
  },

  checkWinCondition(state): string[] | null {
    if (state.phase !== 'finished') return null;
    const entries = Object.entries(state.zones).filter(([, zone]) => !zone.left);
    if (entries.length === 0) return [];
    const best = Math.max(...entries.map(([, zone]) => zone.score));
    return entries.filter(([, zone]) => zone.score === best).map(([id]) => id);
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
    const ranked = [...ctx.players].sort((a, b) => (state.zones[b.id]?.score ?? 0) - (state.zones[a.id]?.score ?? 0));
    const best = ranked[0] ? state.zones[ranked[0].id]?.score ?? 0 : 0;
    const winners = ranked.filter((player) => (state.zones[player.id]?.score ?? 0) === best).map((player) => player.id);
    const rankings: RankingDraft[] = ranked.map((player, index) => {
      const zone = state.zones[player.id];
      return {
        playerId: player.id,
        rank: index + 1,
        score: zone?.score ?? 0,
        isWinner: winners.includes(player.id),
        isDraw: winners.length > 1,
        stats: { cleared: zone?.cleared ?? 0, jams: zone?.jams ?? 0, collisions: zone?.collisions ?? 0 },
      };
    });
    return { winners, isDraw: winners.length > 1, rankings, reason: state.finishReason ?? 'completed' };
  },

  reset(state): TrafficState {
    const zones: Record<string, TrafficZone> = {};
    for (const id of Object.keys(state.zones)) zones[id] = emptyZone();
    return {
      ...state,
      phase: 'idle',
      zones,
      stepIndex: 0,
      accumulatorMs: 0,
      startedAt: null,
      endsAt: null,
      finishReason: null,
      lastEvent: null,
      nextAIRequestAt: {},
      carSeq: 0,
    };
  },

  cleanup(state): void {
    state.zones = {};
    state.phase = 'finished';
  },

  getPublicState(state, _viewerId, ctx) {
    return {
      phase: state.phase,
      stepMs: state.stepMs,
      stepIndex: state.stepIndex,
      startedAt: state.startedAt,
      endsAt: state.endsAt,
      durationMs: state.durationMs,
      finishReason: state.finishReason,
      lastEvent: state.lastEvent,
      serverTime: ctx.now(),
      zones: Object.fromEntries(
        Object.entries(state.zones).map(([id, zone]) => [
          id,
          {
            axis: zone.axis,
            score: zone.score,
            cleared: zone.cleared,
            jams: zone.jams,
            collisions: zone.collisions,
            disconnected: zone.disconnected,
            cars: zone.cars.map((car) => ({ ...car })),
          },
        ]),
      ),
    };
  },

  getAIMove(playerId, difficulty, state): GameAction | null {
    if (state.phase !== 'playing') return null;
    const zone = state.zones[playerId];
    if (!zone || zone.left) return null;
    const nsWait = zone.cars.filter((car) => isNs(car.approach) && car.waiting).length;
    const ewWait = zone.cars.filter((car) => !isNs(car.approach) && car.waiting).length;
    const want: LightAxis = nsWait >= ewWait ? 'ns' : 'ew';
    if (difficulty === 'easy' && Math.random() < 0.4) return { type: 'switch' };
    if (zone.axis !== want) return { type: 'switch' };
    return null;
  },

  needsUpdateLoop: true,
  maxDurationMs: 5 * 60 * 1000,
};
