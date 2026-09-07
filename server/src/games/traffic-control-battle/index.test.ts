import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createTestPlatform, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  finishTraffic,
  JAM_THRESHOLD,
  PENALTY_COLLISION,
  PENALTY_JAM,
  SCORE_CLEAR,
  stepTraffic,
  trafficControlGame,
  type TrafficState,
} from './index';
import type { Room } from '../../rooms/Room';

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
  const publicState = (viewerId?: string) =>
    platform.gameManager.getPublicState(room, viewerId) as {
      phase: string;
      zones: Record<string, { axis: string; score: number; cars: unknown[] }>;
    };

  it('starts with a private zone per player and a live clock', () => {
    expect(state().phase).toBe('playing');
    expect(Object.keys(state().zones)).toHaveLength(2);
    expect(state().endsAt).toBe(state().startedAt! + state().durationMs);
    expect(publicState(players[0]!.id).zones[players[0]!.id]?.axis).toBe('ns');
  });

  it('switches lights on a cooldown and rejects unknown actions', () => {
    const playerId = players[0]!.id;
    const zone = state().zones[playerId]!;
    zone.lastSwitchAt = 0;
    const first = platform.gameManager.handleAction(room, playerId, { type: 'switch' });
    expect(first.accepted).toBe(true);
    expect(zone.axis).toBe('ew');
    expect(trafficControlGame.validateAction(playerId, { type: 'switch' }, state(), context()).valid).toBe(false);
    zone.lastSwitchAt = 0;
    expect(trafficControlGame.validateAction(playerId, { type: 'honk' }, state(), context()).valid).toBe(false);
    expect(trafficControlGame.validateAction('ghost', { type: 'switch' }, state(), context()).valid).toBe(false);
    state().phase = 'finished';
    expect(trafficControlGame.validateAction(playerId, { type: 'switch' }, state(), context()).valid).toBe(false);
    state().phase = 'playing';
  });

  it('spawns and moves cars on the server; a cleared car scores', () => {
    const playerId = players[0]!.id;
    const zone = state().zones[playerId]!;
    zone.axis = 'ns';
    zone.cars = [{ id: 'c-test', approach: 'n', progress: 5, waiting: false }];
    stepTraffic(state(), context());
    expect(zone.cleared).toBeGreaterThanOrEqual(1);
    expect(zone.score).toBeGreaterThanOrEqual(SCORE_CLEAR);
    expect(zone.cars.some((car) => car.id === 'c-test')).toBe(false);
  });

  it('penalises a jam when the red queue is too long', () => {
    const playerId = players[0]!.id;
    const zone = state().zones[playerId]!;
    zone.axis = 'ew';
    zone.cars = Array.from({ length: JAM_THRESHOLD }, (_, index) => ({
      id: `jam-${index}`,
      approach: 'n' as const,
      progress: 0,
      waiting: true,
    }));
    const scoreBefore = zone.score;
    stepTraffic(state(), context());
    expect(zone.jams).toBeGreaterThanOrEqual(1);
    expect(zone.score).toBe(Math.max(0, scoreBefore - PENALTY_JAM));
  });

  it('penalises a collision when both axes occupy the box', () => {
    const playerId = players[0]!.id;
    const zone = state().zones[playerId]!;
    zone.axis = 'ns';
    zone.score = 80;
    zone.collisions = 0;
    zone.cars = [
      { id: 'n4', approach: 'n', progress: 3, waiting: false },
      { id: 'e4', approach: 'e', progress: 4, waiting: false },
    ];
    stepTraffic(state(), context());
    expect(zone.collisions).toBeGreaterThanOrEqual(1);
    expect(zone.score).toBeLessThanOrEqual(80 - PENALTY_COLLISION + SCORE_CLEAR);
  });

  it('timeout ranks by score; equal scores are a draw', () => {
    const [a, b] = players.map((player) => player.id);
    state().zones[a]!.score = 30;
    state().zones[b]!.score = 30;
    finishTraffic(state(), context(), 'timeout');
    expect(state().finishReason).toBe('timeout');
    const draft = trafficControlGame.getResult(state(), context());
    expect(draft.isDraw).toBe(true);
    expect(draft.winners).toHaveLength(2);
    state().zones[a]!.score = 90;
    const win = trafficControlGame.getResult(state(), context());
    expect(win.winners).toEqual([a]);
    expect(win.isDraw).toBe(false);
  });

  it('reset keeps seats and cleanup empties zones', () => {
    const seats = Object.keys(state().zones);
    state().zones[seats[0]!]!.score = 44;
    const next = trafficControlGame.reset(state());
    expect(Object.keys(next.zones)).toEqual(seats);
    expect(next.phase).toBe('idle');
    expect(next.zones[seats[0]!]!.score).toBe(0);
    trafficControlGame.cleanup(next);
    expect(Object.keys(next.zones)).toHaveLength(0);
  });

  it('disconnect, reconnect and leave', () => {
    const [first, second] = players.map((player) => player.id);
    trafficControlGame.playerLeft(first, state(), context(), 'disconnect');
    expect(state().zones[first]!.disconnected).toBe(true);
    trafficControlGame.playerJoined({ ...players[0]!, id: first }, state(), context());
    expect(state().zones[first]!.disconnected).toBe(false);
    trafficControlGame.playerLeft(first, state(), context(), 'leave');
    trafficControlGame.playerLeft(second, state(), context(), 'leave');
    expect(state().phase).toBe('finished');
    expect(state().finishReason).toBe('abandoned');
  });

  it('AI switches when the waiting axis is starved', () => {
    const playerId = players[0]!.id;
    const zone = state().zones[playerId]!;
    zone.axis = 'ns';
    zone.cars = [
      { id: 'w1', approach: 'e', progress: 0, waiting: true },
      { id: 'w2', approach: 'e', progress: 0, waiting: true },
      { id: 'w3', approach: 'w', progress: 0, waiting: true },
    ];
    const move = trafficControlGame.getAIMove?.(playerId, 'hard', state(), context());
    expect(move?.type).toBe('switch');
  });
});
