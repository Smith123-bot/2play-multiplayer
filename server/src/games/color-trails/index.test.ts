import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createTestPlatform, waitFor, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  colorTrailsGame,
  expireTrails,
  finishTrails,
  isTrailDirection,
  spawnToken,
  stepTrails,
  type ColorTrailsState,
} from './index';
import type { Room } from '../../rooms/Room';

describe('Color Trails', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'color-trails');
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as ColorTrailsState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const publicState = (viewerId?: string) =>
    platform.gameManager.getPublicState(room, viewerId) as {
      phase: string;
      tokens: Array<{ id: string; kind: string; hue: string }>;
      runners: Record<string, { x: number; y: number; score: number; trail: unknown[]; combo: number }>;
    };

  it('starts with tokens and empty scores', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    expect(state().tokens.length).toBeGreaterThan(0);
    expect(publicState(players[0]!.id).runners[players[0]!.id]?.score).toBe(0);
  });

  it('creates a trail that expires after its lifetime', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const runner = state().runners[players[0]!.id]!;
    runner.frozenUntil = 0;
    const before = runner.trail.length;
    stepTrails(state(), context());
    expect(runner.trail.length).toBeGreaterThan(before);
    const last = runner.trail[runner.trail.length - 1]!;
    state().stepIndex = last.expiresStep + 1;
    expireTrails(state());
    expect(runner.trail.includes(last)).toBe(false);
  });

  it('scores a matching pickup and grows combo', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const runner = state().runners[players[0]!.id]!;
    runner.x = 4;
    runner.y = 4;
    runner.direction = 'right';
    runner.pending = null;
    runner.frozenUntil = 0;
    runner.hue = 'red';
    runner.combo = 1;
    state().tokens = [{ id: 'p1', x: 5, y: 4, hue: 'red', kind: 'pickup' }];
    stepTrails(state(), context());
    expect(runner.score).toBe(10);
    expect(runner.combo).toBe(2);
    expect(runner.pickups).toBe(1);
  });

  it('awards a matching zone times combo', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const runner = state().runners[players[0]!.id]!;
    runner.x = 6;
    runner.y = 6;
    runner.direction = 'down';
    runner.pending = null;
    runner.frozenUntil = 0;
    runner.hue = 'blue';
    runner.combo = 2;
    state().tokens = [{ id: 'z1', x: 6, y: 7, hue: 'blue', kind: 'zone' }];
    stepTrails(state(), context());
    expect(runner.score).toBe(50);
    expect(runner.zones).toBe(1);
  });

  it('resets combo and penalises a trail collision', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const a = state().runners[players[0]!.id]!;
    const b = state().runners[players[1]!.id]!;
    a.x = 8;
    a.y = 8;
    a.direction = 'right';
    a.pending = null;
    a.frozenUntil = 0;
    a.score = 20;
    a.combo = 4;
    b.trail = [{ x: 9, y: 8, expiresStep: state().stepIndex + 5 }];
    stepTrails(state(), context());
    expect(a.score).toBe(10);
    expect(a.combo).toBe(0);
    expect(a.hits).toBe(1);
  });

  it('rejects reverse and unknown actions', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    state().runners[playerId]!.direction = 'up';
    state().runners[playerId]!.pending = null;
    expect(
      colorTrailsGame.validateAction(playerId, { type: 'turn', payload: { direction: 'down' } }, state(), context())
        .valid,
    ).toBe(false);
    expect(colorTrailsGame.validateAction(playerId, { type: 'paint' }, state(), context()).valid).toBe(false);
  });

  it('timeout finishes and ranks by score', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    state().runners[players[0]!.id]!.score = 80;
    state().runners[players[1]!.id]!.score = 10;
    finishTrails(state(), context(), 'timeout');
    expect(state().phase).toBe('finished');
    const draft = colorTrailsGame.getResult(state(), context());
    expect(draft.winners).toEqual([players[0]!.id]);
  });

  it('reset keeps seats', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const seats = Object.keys(state().runners);
    const next = colorTrailsGame.reset(state());
    expect(Object.keys(next.runners)).toEqual(seats);
    expect(next.phase).toBe('idle');
    expect(next.tokens).toEqual([]);
  });

  it('AI sends a legal turn', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const move = colorTrailsGame.getAIMove?.(players[0]!.id, 'medium', state(), context());
    expect(move?.type).toBe('turn');
    expect(isTrailDirection(move?.payload?.direction)).toBe(true);
  });

  it('spawnToken never overlaps a runner', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const token = spawnToken(state(), context(), 'pickup');
    expect(token).toBeTruthy();
    for (const runner of Object.values(state().runners)) {
      expect(token!.x === runner.x && token!.y === runner.y).toBe(false);
    }
  });
});
