import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createTestPlatform, waitFor, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import { finishDash, platformDashGame, stepRunner, stepWorld, type DashState } from './index';
import { COURSE_SUMMIT, movingX } from './courses';
import type { Room } from '../../rooms/Room';

describe('Platform Dash 2D', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'platform-dash-2d', {
      settings: { gridSize: 'summit' },
    });
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as DashState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const publicState = (viewerId?: string) =>
    platform.gameManager.getPublicState(room, viewerId) as {
      phase: string;
      platforms: Array<{ id: string; kind: string }>;
      runners: Record<string, { x: number; y: number; finished: boolean }>;
      courseName: string;
    };

  it('loads the summit course with a finish line', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    expect(state().courseId).toBe('summit');
    expect(state().platforms.some((platform) => platform.kind === 'finish')).toBe(true);
    expect(publicState(players[0]!.id).runners[players[0]!.id]).toBeTruthy();
  });

  it('rejects unknown actions and movement after finish', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    expect(platformDashGame.validateAction(playerId, { type: 'teleport' }, state(), context()).valid).toBe(false);
    state().runners[playerId]!.finished = true;
    expect(
      platformDashGame.validateAction(
        playerId,
        { type: 'input', payload: { right: true } },
        state(),
        context(),
      ).valid,
    ).toBe(false);
  });

  it('applies input flags without trusting client positions', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    const before = { ...state().runners[playerId]! };
    const result = platform.gameManager.handleAction(room, playerId, {
      type: 'input',
      payload: { left: false, right: true, jump: true },
    });
    expect(result.accepted).toBe(true);
    expect(state().runners[playerId]!.right).toBe(true);
    expect(state().runners[playerId]!.x).toBe(before.x);
    expect(state().runners[playerId]!.y).toBe(before.y);
  });

  it('gravity pulls the runner down until they land', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const runner = state().runners[players[0]!.id]!;
    runner.x = 40;
    runner.y = 120;
    runner.vy = 0;
    runner.grounded = false;
    const now = Date.now();
    for (let i = 0; i < 40; i += 1) {
      stepRunner(state(), runner, 0.016, now + i * 16);
    }
    expect(runner.y).toBeLessThan(120);
  });

  it('falling below the world respawns at the checkpoint', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const runner = state().runners[players[0]!.id]!;
    runner.y = -120;
    runner.vy = -10;
    const outcome = stepRunner(state(), runner, 0.016, Date.now());
    expect(outcome.fell).toBe(true);
    expect(runner.falls).toBe(1);
    expect(runner.x).toBe(runner.checkpoint.x);
  });

  it('touching the finish records order and scores 100 for first', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    const finish = state().platforms.find((platform) => platform.kind === 'finish')!;
    const runner = state().runners[playerId]!;
    runner.x = finish.x + 2;
    runner.y = finish.y + 2;
    runner.finished = false;
    stepWorld(state(), 32, context());
    expect(state().finishOrder[0]).toBe(playerId);
    expect(platformDashGame.calculateScore(playerId, state())).toBe(100);
  });

  it('moving platforms actually move', () => {
    const platform = COURSE_SUMMIT.platforms.find((entry) => entry.kind === 'moving')!;
    const a = movingX(platform, 0);
    const b = movingX(platform, 600);
    expect(a).not.toBe(b);
  });

  it('timeout finishes and ranks unfinished runners by distance', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    state().runners[players[0]!.id]!.x = 400;
    state().runners[players[1]!.id]!.x = 80;
    finishDash(state(), context(), 'timeout');
    expect(state().phase).toBe('finished');
    const draft = platformDashGame.getResult(state(), context());
    expect(draft.winners).toEqual([players[0]!.id]);
  });

  it('reset keeps seats', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const seats = Object.keys(state().runners);
    const next = platformDashGame.reset(state());
    expect(Object.keys(next.runners)).toEqual(seats);
    expect(next.phase).toBe('idle');
    expect(next.finishOrder).toEqual([]);
  });

  it('AI always sends a legal input', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const move = platformDashGame.getAIMove?.(players[0]!.id, 'hard', state(), context());
    expect(move?.type).toBe('input');
    expect(move?.payload).toMatchObject({ right: true });
  });

  it('disconnect keeps the runner in the race', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    platformDashGame.playerLeft(players[0]!.id, state(), context(), 'disconnect');
    expect(state().runners[players[0]!.id]!.disconnected).toBe(true);
    expect(state().phase).toBe('playing');
  });
});
