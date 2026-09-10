import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createTestPlatform, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  APPROACHES,
  AMBER_TICKS,
  CROSS_TICKS,
  JAM_LENGTH,
  LANES,
  MIN_GREEN_TICKS,
  PENALTY_COLLISION,
  PENALTY_EMERGENCY_LOST,
  SCORE_CLEAR,
  SCORE_EMERGENCY,
  EMERGENCY_PATIENCE,
  bestPhaseFor,
  finishTraffic,
  isNorthSouth,
  makeJunction,
  mulberry32,
  phaseFor,
  queueKey,
  queuedOn,
  requestPhase,
  stepAll,
  tickJunction,
  totalQueued,
  trafficControlGame,
  worstEmergency,
  type Car,
  type Junction,
  type TrafficState,
} from './index';
import type { Room } from '../../rooms/Room';

/** Builds a car for direct queue manipulation in tests. */
function car(id: string, approach: 'n' | 'e' | 's' | 'w', emergency = false): Car {
  return { id, approach, lane: 'straight', waited: 0, emergency, crossing: 0 };
}

/** Runs ticks with spawning disabled so a scenario stays controlled. */
function quietTicks(junction: Junction, count: number, startTick = 0): void {
  for (let i = 0; i < count; i += 1) {
    tickJunction(junction, startTick + i, () => 1, 0, () => `x${i}`);
  }
}

describe('Traffic Control Battle', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'traffic-control-battle');
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as TrafficState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const act = (playerId: string, action: { type: string; payload?: Record<string, unknown> }) =>
    platform.gameManager.handleAction(room, playerId, action);
  const mine = (playerId: string) => state().junctions[playerId]!;

  /* ---------------- setup ---------------- */

  it('gives every player their own junction with four approaches and two lanes', () => {
    expect(state().phase).toBe('playing');
    expect(state().endsAt).toBeGreaterThan(context().now());
    for (const player of players) {
      const junction = mine(player.id);
      expect(Object.keys(junction.queues)).toHaveLength(APPROACHES.length * LANES.length);
      expect(Object.keys(junction.signals)).toHaveLength(4);
      // North/south opens on green, east/west on red.
      expect(junction.signals.n.state).toBe('green');
      expect(junction.signals.e.state).toBe('red');
      expect(junction.phase).toBe('ns');
    }
  });

  it('maps approaches to the correct axis', () => {
    expect(isNorthSouth('n')).toBe(true);
    expect(isNorthSouth('s')).toBe(true);
    expect(isNorthSouth('e')).toBe(false);
    expect(phaseFor('n')).toBe('ns');
    expect(phaseFor('w')).toBe('ew');
  });

  it('uses a deterministic car schedule', () => {
    const a = mulberry32(1234);
    const b = mulberry32(1234);
    for (let i = 0; i < 30; i += 1) expect(a()).toBe(b());
  });

  /* ---------------- signals ---------------- */

  it('enforces a minimum green before a phase may change', () => {
    const junction = makeJunction();
    junction.sincePhase = 0;
    // Too early.
    expect(requestPhase(junction, 'ew')).toBe(false);
    expect(junction.phase).toBe('ns');

    junction.sincePhase = MIN_GREEN_TICKS;
    expect(requestPhase(junction, 'ew')).toBe(true);
    expect(junction.phase).toBe('ew');
    // Requesting the phase already running is refused.
    junction.sincePhase = MIN_GREEN_TICKS;
    expect(requestPhase(junction, 'ew')).toBe(false);
  });

  it('runs an amber transition before the outgoing axis turns red', () => {
    const junction = makeJunction();
    junction.sincePhase = MIN_GREEN_TICKS;
    requestPhase(junction, 'ew');
    // The outgoing north/south pair goes amber, not straight to red.
    expect(junction.signals.n.state).toBe('amber');
    expect(junction.signals.s.state).toBe('amber');

    quietTicks(junction, AMBER_TICKS);
    expect(junction.signals.n.state).toBe('red');
    // And the incoming pair is now green.
    expect(junction.signals.e.state).toBe('green');
  });

  /* ---------------- traffic flow ---------------- */

  it('releases queued cars on green and scores them once they clear the box', () => {
    const junction = makeJunction();
    junction.queues[queueKey('n', 'straight')]!.push(car('c1', 'n'));
    expect(queuedOn(junction, 'n')).toBe(1);

    // One tick moves the car into the box.
    quietTicks(junction, 1);
    expect(junction.inBox).toHaveLength(1);
    expect(queuedOn(junction, 'n')).toBe(0);

    // After the crossing ticks it is cleared and scored.
    quietTicks(junction, CROSS_TICKS, 1);
    expect(junction.cleared).toBe(1);
    expect(junction.score).toBeGreaterThanOrEqual(SCORE_CLEAR);
  });

  it('holds cars on a red approach', () => {
    const junction = makeJunction(); // north/south is green
    junction.queues[queueKey('e', 'straight')]!.push(car('c1', 'e'));
    quietTicks(junction, 3);
    // East is red, so the car never enters the box.
    expect(queuedOn(junction, 'e')).toBe(1);
    expect(junction.cleared).toBe(0);
  });

  it('turn lanes discharge more slowly than straight lanes', () => {
    const junction = makeJunction();
    junction.queues[queueKey('n', 'straight')]!.push(car('s1', 'n'), car('s2', 'n'));
    junction.queues[queueKey('n', 'turn')]!.push(car('t1', 'n'), car('t2', 'n'));
    // Tick 1 (odd index skipped for turns) then tick 2.
    tickJunction(junction, 0, () => 1, 0, () => 'x');
    tickJunction(junction, 1, () => 1, 0, () => 'x');
    // The straight lane has released both; the turn lane only one.
    expect(junction.queues[queueKey('n', 'straight')]).toHaveLength(0);
    expect(junction.queues[queueKey('n', 'turn')]!.length).toBeGreaterThan(0);
  });

  /* ---------------- collisions and penalties ---------------- */

  it('detects a collision when both axes occupy the junction box', () => {
    const junction = makeJunction();
    junction.score = 200;
    // Force a conflicting state: cars from both axes already crossing.
    junction.inBox = [
      { ...car('a', 'n'), crossing: 2 },
      { ...car('b', 'e'), crossing: 2 },
    ];
    const outcome = tickJunction(junction, 0, () => 1, 0, () => 'x');
    expect(outcome.collision).toBe(true);
    expect(junction.collisions).toBe(1);
    expect(junction.score).toBe(200 - PENALTY_COLLISION);
    // The box is cleared after an incident.
    expect(junction.inBox).toHaveLength(0);
  });

  it('charges a congestion penalty when a lane backs up', () => {
    const junction = makeJunction();
    junction.score = 100;
    const queue = junction.queues[queueKey('e', 'straight')]!;
    for (let i = 0; i < JAM_LENGTH; i += 1) queue.push(car(`c${i}`, 'e'));
    const outcome = tickJunction(junction, 0, () => 1, 0, () => 'x');
    expect(outcome.jammed).toBe(true);
    expect(junction.jams).toBe(1);
    expect(junction.score).toBeLessThan(100);
  });

  it('rewards clearing an emergency vehicle and penalises abandoning one', () => {
    const good = makeJunction();
    good.queues[queueKey('n', 'straight')]!.push(car('amb', 'n', true));
    quietTicks(good, 1 + CROSS_TICKS);
    expect(good.emergenciesCleared).toBe(1);
    expect(good.score).toBeGreaterThanOrEqual(SCORE_CLEAR + SCORE_EMERGENCY);

    const bad = makeJunction();
    bad.score = 200;
    const stuck = car('amb2', 'e', true); // east is red
    stuck.waited = EMERGENCY_PATIENCE;
    bad.queues[queueKey('e', 'straight')]!.push(stuck);
    const outcome = tickJunction(bad, 0, () => 1, 0, () => 'x');
    expect(outcome.emergencyLost).toBe(true);
    expect(bad.emergenciesLost).toBe(1);
    expect(bad.score).toBe(200 - PENALTY_EMERGENCY_LOST);
  });

  it('finds the longest-waiting emergency vehicle', () => {
    const junction = makeJunction();
    const old = car('old', 'e', true);
    old.waited = 10;
    junction.queues[queueKey('e', 'straight')]!.push(car('new', 'e', true), old);
    expect(worstEmergency(junction)?.id).toBe('old');
    expect(worstEmergency(makeJunction())).toBeNull();
  });

  /* ---------------- actions and anti-cheat ---------------- */

  it('accepts a legal phase change and rejects one during the minimum green', () => {
    const playerId = players[0]!.id;
    mine(playerId).sincePhase = MIN_GREEN_TICKS;
    expect(act(playerId, { type: 'phase', payload: { phase: 'ew' } }).accepted).toBe(true);
    expect(mine(playerId).phase).toBe('ew');
    // Immediately again: refused.
    expect(act(playerId, { type: 'phase', payload: { phase: 'ns' } }).accepted).toBe(false);
  });

  it('rejects malformed payloads and outcome-asserting actions', () => {
    const playerId = players[0]!.id;
    const ctx = context();
    for (const phase of [undefined, null, 'diagonal', 42, {}]) {
      expect(
        trafficControlGame.validateAction(playerId, { type: 'phase', payload: { phase } }, state(), ctx).valid,
      ).toBe(false);
    }
    for (const type of ['score', 'win', 'finish', 'complete', 'clear', 'spawn', 'setState']) {
      expect(trafficControlGame.validateAction(playerId, { type, payload: { score: 9999 } }, state(), ctx).valid).toBe(
        false,
      );
      expect(trafficControlGame.handlePlayerAction(playerId, { type }, state(), ctx).accepted).toBe(false);
    }
    expect(mine(playerId).score).toBe(0);
  });

  it('rejects actions after the match finishes', () => {
    const playerId = players[0]!.id;
    finishTraffic(state(), context(), 'timeout');
    expect(act(playerId, { type: 'phase', payload: { phase: 'ew' } }).accepted).toBe(false);
  });

  /* ---------------- the update loop ---------------- */

  it('advances the simulation in fixed steps and generates traffic', () => {
    const playerId = players[0]!.id;
    const before = state().tick;
    // Feed enough time for several fixed steps.
    trafficControlGame.update!(state(), 2_000, context());
    expect(state().tick).toBeGreaterThan(before);
    // Traffic should have appeared somewhere on the junction.
    const junction = mine(playerId);
    expect(totalQueued(junction) + junction.inBox.length + junction.cleared).toBeGreaterThan(0);
  });

  it('every player faces the same schedule but an independent junction', () => {
    const [a, b] = players.map((player) => player.id);
    // Diverge the two players by switching only one junction's phase.
    mine(a).sincePhase = MIN_GREEN_TICKS;
    act(a, { type: 'phase', payload: { phase: 'ew' } });
    for (let i = 0; i < 12; i += 1) stepAll(state(), context());
    // Independent state: the phases differ, so the outcomes differ.
    expect(mine(a).phase).not.toBe(mine(b).phase);
  });

  /* ---------------- scoring and result ---------------- */

  it('ranks by score, then cars cleared, then fewer collisions', () => {
    const [a, b] = players.map((player) => player.id);
    mine(a).score = 300;
    mine(b).score = 500;
    finishTraffic(state(), context(), 'timeout');

    expect(trafficControlGame.checkWinCondition(state())).toEqual([b]);
    const result = trafficControlGame.getResult(state(), context());
    expect(result.rankings[0]!.playerId).toBe(b);
    expect(result.isDraw).toBe(false);
    expect(result.rankings[0]!.stats).toHaveProperty('collisions');
    expect(result.rankings[0]!.stats).toHaveProperty('emergencies');
  });

  it('reports a draw on equal scores', () => {
    const [a, b] = players.map((player) => player.id);
    mine(a).score = 250;
    mine(b).score = 250;
    finishTraffic(state(), context(), 'timeout');
    expect(trafficControlGame.checkDrawCondition(state())).toBe(true);
    expect(trafficControlGame.getResult(state(), context()).isDraw).toBe(true);
  });

  /* ---------------- hidden information ---------------- */

  it('shows a player their own junction but only a scoreboard for opponents', () => {
    const [a, b] = players.map((player) => player.id);
    mine(b).queues[queueKey('n', 'straight')]!.push(car('secret', 'n', true));

    const view = platform.gameManager.getPublicState(room, a) as Record<string, unknown> & {
      junction: { queues: unknown[] } | null;
      players: Record<string, { score: number }>;
    };
    expect(view.junction).not.toBeNull();
    expect(Array.isArray(view.junction!.queues)).toBe(true);
    // The opponent is a scoreboard entry, not a junction.
    expect((view.players[b] as unknown as { queues?: unknown }).queues).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain('secret');
  });

  /* ---------------- lifecycle ---------------- */

  it('handles disconnect, reconnect and leave', () => {
    const playerId = players[0]!.id;
    mine(playerId).score = 120;

    trafficControlGame.playerLeft(playerId, state(), context(), 'disconnect');
    expect(mine(playerId).disconnected).toBe(true);
    expect(act(playerId, { type: 'phase', payload: { phase: 'ew' } }).accepted).toBe(false);

    trafficControlGame.playerJoined({ ...players[0]! }, state(), context());
    expect(mine(playerId).disconnected).toBe(false);
    expect(mine(playerId).score).toBe(120);

    trafficControlGame.playerLeft(playerId, state(), context(), 'leave');
    expect(mine(playerId).left).toBe(true);
  });

  it('reset and cleanup prepare a rematch with no leaked state', () => {
    const playerId = players[0]!.id;
    mine(playerId).score = 400;
    mine(playerId).cleared = 30;
    finishTraffic(state(), context(), 'timeout');

    const next = trafficControlGame.reset(state());
    expect(next.phase).toBe('idle');
    expect(next.tick).toBe(0);
    expect(next.carSeq).toBe(0);
    expect(Object.values(next.junctions).every((j) => j.score === 0 && j.cleared === 0)).toBe(true);
    expect(Object.values(next.junctions).every((j) => j.inBox.length === 0)).toBe(true);

    trafficControlGame.cleanup(next);
    expect(Object.keys(next.junctions)).toHaveLength(0);
  });

  /* ---------------- AI ---------------- */

  it('the AI prioritises an emergency vehicle over queue length', () => {
    const junction = makeJunction(); // running north/south
    // Long north/south queue, but an emergency waiting on east.
    for (let i = 0; i < 5; i += 1) junction.queues[queueKey('n', 'straight')]!.push(car(`n${i}`, 'n'));
    junction.queues[queueKey('e', 'straight')]!.push(car('amb', 'e', true));
    expect(bestPhaseFor(junction)).toBe('ew');
  });

  it('the AI serves the busier axis when there is no emergency', () => {
    const junction = makeJunction();
    junction.queues[queueKey('e', 'straight')]!.push(car('e1', 'e'), car('e2', 'e'));
    expect(bestPhaseFor(junction)).toBe('ew');
  });

  it('the AI only produces legal phase changes and respects the minimum green', () => {
    const playerId = players[0]!.id;
    // During the minimum green it must not act at all.
    mine(playerId).sincePhase = 0;
    expect(trafficControlGame.getAIMove?.(playerId, 'hard', state(), context())).toBeNull();

    mine(playerId).sincePhase = MIN_GREEN_TICKS;
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const action = trafficControlGame.getAIMove?.(playerId, difficulty, state(), context());
      if (!action) continue;
      expect(action.type).toBe('phase');
      expect(trafficControlGame.validateAction(playerId, action, state(), context()).valid).toBe(true);
    }
  });

  it('the AI stops once the match is over', () => {
    finishTraffic(state(), context(), 'timeout');
    expect(trafficControlGame.getAIMove?.(players[0]!.id, 'hard', state(), context())).toBeNull();
  });

  it('an AI-run junction clears real traffic over a full match', () => {
    const playerId = players[0]!.id;
    for (let step = 0; step < 200; step += 1) {
      const action = trafficControlGame.getAIMove?.(playerId, 'hard', state(), context());
      if (action) act(playerId, action);
      stepAll(state(), context());
    }
    const junction = mine(playerId);
    // It actually moved traffic rather than deadlocking.
    expect(junction.cleared).toBeGreaterThan(5);
    expect(junction.score).toBeGreaterThan(0);
  });
});
