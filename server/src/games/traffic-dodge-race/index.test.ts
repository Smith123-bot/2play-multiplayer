import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createTestPlatform, waitFor, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  advanceRace,
  finishRaceOnTimeout,
  generateTraffic,
  laneClearance,
  trafficDodgeGame,
  type TrafficDodgeState,
} from './index';
import type { Room } from '../../rooms/Room';

describe('Traffic Dodge Race', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'traffic-dodge-race');
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as TrafficDodgeState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const publicState = (viewerId?: string) =>
    platform.gameManager.getPublicState(room, viewerId) as {
      phase: string;
      lanes: number;
      trackLength: number;
      traffic: Array<{ id: string; lane: number; pos: number }>;
      racers: Record<string, { lane: number; position: number; crashes: number; finished: boolean } | null>;
    };

  /* ---------------------------------------------------------------- */
  /* Generation                                                        */
  /* ---------------------------------------------------------------- */

  it('generates deterministic traffic from the rng', () => {
    const rngA = (() => {
      let v = 1;
      return () => {
        v = (v * 1103515245 + 12345) % 2147483648;
        return v / 2147483648;
      };
    })();
    const rngB = (() => {
      let v = 1;
      return () => {
        v = (v * 1103515245 + 12345) % 2147483648;
        return v / 2147483648;
      };
    })();
    const a = generateTraffic(rngA);
    const b = generateTraffic(rngB);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(20);
    for (const car of a) {
      expect(car.lane).toBeGreaterThanOrEqual(0);
      expect(car.lane).toBeLessThan(5);
      expect(car.speed).toBeGreaterThanOrEqual(4);
      expect(car.speed).toBeLessThanOrEqual(9);
    }
  });

  it('starts racing with traffic on the road and staggered lanes', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    expect(state().traffic.length).toBeGreaterThan(20);
    expect(state().lanes).toBe(5);
    expect(state().trackLength).toBe(2000);
    const [a, b] = players.map((player) => state().racers[player.id]!);
    expect(a.lane).toBe(1);
    expect(b.lane).toBe(3);
    expect(state().startedAt).toBeGreaterThan(0);
  });

  /* ---------------------------------------------------------------- */
  /* Movement validation                                               */
  /* ---------------------------------------------------------------- */

  it('accepts lane changes and rejects edges, spam and unknown actions', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id; // lane 1

    expect(
      trafficDodgeGame.validateAction(playerId, { type: 'boost' }, state(), context()).valid,
    ).toBe(false);
    expect(
      trafficDodgeGame.validateAction(
        playerId,
        { type: 'move', payload: { direction: 'up' } },
        state(),
        context(),
      ).valid,
    ).toBe(false);
    expect(trafficDodgeGame.validateAction(playerId, { type: 'move' }, state(), context()).valid).toBe(
      false,
    );
    expect(
      trafficDodgeGame.validateAction('ghost', { type: 'move', payload: { direction: 'left' } }, state(), context())
        .valid,
    ).toBe(false);

    const left = platform.gameManager.handleAction(room, playerId, {
      type: 'move',
      payload: { direction: 'left' },
    });
    expect(left.accepted).toBe(true);
    expect(state().racers[playerId]!.lane).toBe(0);

    // Edge of the road.
    const edge = platform.gameManager.handleAction(room, playerId, {
      type: 'move',
      payload: { direction: 'left' },
    });
    expect(edge.accepted).toBe(false);
    expect(edge.reason).toBe('The edge of the road blocks that way.');

    // Move cooldown prevents teleport-spam.
    const right = platform.gameManager.handleAction(room, playerId, {
      type: 'move',
      payload: { direction: 'right' },
    });
    expect(right.accepted).toBe(false); // still inside the 140ms cooldown
  });

  /* ---------------------------------------------------------------- */
  /* Progress / collisions / finish                                    */
  /* ---------------------------------------------------------------- */

  it('advances racers over time and speeds up gradually', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    expect(state().racers[playerId]!.position).toBe(0);

    platform.gameManager.update(room, 250);
    const afterOneTick = state().racers[playerId]!.position;
    expect(afterOneTick).toBeGreaterThan(0);

    platform.gameManager.update(room, 250);
    platform.gameManager.update(room, 250);
    expect(state().racers[playerId]!.position).toBeGreaterThan(afterOneTick);
    expect(state().racers[playerId]!.speed).toBeGreaterThan(10);
  });

  it('crashes into traffic: stun, crash count, dropped behind the car', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    const racer = state().racers[playerId]!;
    const lane = racer.lane;

    // Place a car overlapping the racer's path.
    state().traffic = [
      { id: 'test-car', lane, pos: racer.position + 1, length: 7, speed: 5 },
    ];
    const before = racer.crashes;
    advanceRace(state(), 250, context());

    expect(racer.crashes).toBe(before + 1);
    expect(racer.stunUntil).not.toBeNull();
    // Dropped behind the car that was hit (car advanced 1.25 units too).
    const car = state().traffic[0]!;
    expect(racer.position).toBe(Math.max(0, car.pos - 2));
    expect(state().lastEvent).toBe(`crash:${playerId}`);

    // Stunned racers cannot steer.
    expect(
      trafficDodgeGame.validateAction(
        playerId,
        { type: 'move', payload: { direction: 'right' } },
        state(),
        context(),
      ).valid,
    ).toBe(false);

    // Stun expires → movement allowed again.
    racer.stunUntil = null;
    expect(
      trafficDodgeGame.validateAction(
        playerId,
        { type: 'move', payload: { direction: 'right' } },
        state(),
        context(),
      ).valid,
    ).toBe(true);
  });

  it('laneClearance measures the distance to the nearest car ahead', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    state().traffic = [
      { id: 'a', lane: 2, pos: 100, length: 7, speed: 5 },
      { id: 'b', lane: 3, pos: 48, length: 7, speed: 6 },
    ];
    expect(laneClearance(state(), 2, 50)).toBe(50);
    expect(laneClearance(state(), 3, 50)).toBe(0); // overlapping (48–55)
    expect(laneClearance(state(), 0, 50)).toBe(Infinity);
  });

  it('finishes the racer at the track end and ends when all active finish', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const [a, b] = players.map((player) => player.id);

    // Park the traffic far behind the racers: a car spawned in the same lane
    // would legitimately crash the racer (the collision check runs before the
    // finish check), which is a different scenario than the one under test.
    for (const car of state().traffic) car.pos = -car.length - 100;

    state().racers[a]!.position = state().trackLength - 1;
    state().racers[a]!.stunUntil = null;
    advanceRace(state(), 250, context());
    expect(state().racers[a]!.finished).toBe(true);
    expect(state().racers[a]!.finishMs).toBeGreaterThanOrEqual(0);
    expect(state().phase).toBe('playing'); // b still racing

    state().racers[b]!.position = state().trackLength - 1;
    state().racers[b]!.stunUntil = null;
    advanceRace(state(), 250, context());
    expect(state().racers[b]!.finished).toBe(true);
    expect(state().phase).toBe('finished');
    expect(state().finishReason).toBe('completed');
  });

  it('rejects movement after finishing and ranks finishers by time', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const [a, b] = players.map((player) => player.id);
    state().racers[a]!.finished = true;
    state().racers[a]!.finishMs = 61000;
    expect(
      trafficDodgeGame.validateAction(a, { type: 'move', payload: { direction: 'left' } }, state(), context())
        .valid,
    ).toBe(false);

    state().racers[b]!.finished = true;
    state().racers[b]!.finishMs = 59000;
    state().phase = 'finished';
    const draft = trafficDodgeGame.getResult(state(), context());
    expect(draft.winners).toEqual([b]);
    expect(draft.rankings[0]!.playerId).toBe(b);
    expect(draft.rankings[0]!.score).toBe(2000);
    expect(draft.rankings[0]!.stats.finishMs).toBe(59000);
  });

  it('timeout ranks unfinished racers by progress and detects draws', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const [a, b] = players.map((player) => player.id);
    state().racers[a]!.position = 1200;
    state().racers[b]!.position = 900;

    finishRaceOnTimeout(state(), context());
    expect(state().phase).toBe('finished');
    expect(state().finishReason).toBe('timeout');

    const draft = trafficDodgeGame.getResult(state(), context());
    expect(draft.winners).toEqual([a]);
    expect(draft.rankings[1]!.stats.progress).toBe(900);

    state().racers[b]!.position = 1200;
    expect(trafficDodgeGame.checkDrawCondition(state())).toBe(true);
  });

  /* ---------------------------------------------------------------- */
  /* Reset / AI / public state / disconnect                            */
  /* ---------------------------------------------------------------- */

  it('reset keeps both seats and zeroes the race', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const seats = Object.keys(state().racers);
    state().racers[seats[0]!]!.crashes = 3;

    const next = trafficDodgeGame.reset(state());
    expect(Object.keys(next.racers)).toEqual(seats);
    expect(next.phase).toBe('idle');
    expect(next.traffic).toEqual([]);
    for (const racer of Object.values(next.racers)) {
      expect(racer.position).toBe(0);
      expect(racer.crashes).toBe(0);
      expect(racer.finished).toBe(false);
    }
  });

  it('AI only steers into safer lanes (or holds)', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    const racer = state().racers[playerId]!;
    racer.position = 100;

    // Wall of cars ahead in every lane except the rightmost.
    state().traffic = [0, 1, 2, 3, 4].map((lane) => ({
      id: `wall-${lane}`,
      lane,
      pos: lane === 4 ? 900 : 118,
      length: 7,
      speed: 5,
    }));
    racer.lane = 3; // one step from the safe lane
    const move = trafficDodgeGame.getAIMove?.(playerId, 'hard', state(), context());
    expect(move?.type).toBe('move');
    expect(move?.payload?.direction).toBe('right');

    // Safe current lane → no move needed.
    racer.lane = 4;
    expect(trafficDodgeGame.getAIMove?.(playerId, 'hard', state(), context())).toBeNull();

    racer.finished = true;
    expect(trafficDodgeGame.getAIMove?.(playerId, 'hard', state(), context())).toBeNull();
    state().phase = 'finished';
    expect(trafficDodgeGame.getAIMove?.(playerId, 'hard', state(), context())).toBeNull();
  });

  it('exposes the shared road and both racers through getPublicState', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const view = publicState(players[0]!.id);
    expect(view.phase).toBe('playing');
    expect(view.lanes).toBe(5);
    expect(view.traffic.length).toBeGreaterThan(20);
    expect(Object.keys(view.racers)).toHaveLength(2);
    for (const player of players) {
      expect([1, 3]).toContain(view.racers[player.id]!.lane);
    }
  });

  it('a disconnected racer keeps rolling; a leaver stops and cannot win by leaving', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;

    trafficDodgeGame.playerLeft(playerId, state(), context(), 'disconnect');
    expect(state().racers[playerId]!.disconnected).toBe(true);
    expect(state().phase).toBe('playing');

    trafficDodgeGame.playerLeft(playerId, state(), context(), 'leave');
    expect(state().racers[playerId]!.left).toBe(true);
    expect(state().racers[playerId]!.speed).toBe(0);
    expect(state().phase).toBe('playing'); // the other racer still racing

    // All remaining racers finished → the match ends even with a leaver.
    const other = players[1]!.id;
    state().racers[other]!.finished = true;
    trafficDodgeGame.playerLeft(other, state(), context(), 'leave');
    expect(state().phase).toBe('finished');
  });
});
