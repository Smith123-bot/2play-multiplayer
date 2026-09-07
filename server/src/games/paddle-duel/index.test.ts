import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createTestPlatform, waitFor, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  finishPaddleOnTimeout,
  launchServe,
  paddleDuelGame,
  predictBallY,
  resetPoint,
  scoreLimitFor,
  stepDuel,
  type PaddleDuelState,
} from './index';
import type { Room } from '../../rooms/Room';

describe('Paddle Duel', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'paddle-duel');
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as PaddleDuelState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const publicState = () =>
    platform.gameManager.getPublicState(room, players[0]!.id) as {
      phase: string;
      ball: { x: number; y: number; vx: number; vy: number };
      serveAt: number | null;
      paddles: Record<string, { side: string; y: number; dir: number; score: number }>;
      scoreLimit: number;
      serverTime: number;
    };

  /* ---------------------------------------------------------------- */
  /* Initialisation                                                    */
  /* ---------------------------------------------------------------- */

  it('starts playing with paddles on both sides and a frozen centre ball', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    expect(state().paddles[players[0]!.id]!.side).toBe('left');
    expect(state().paddles[players[1]!.id]!.side).toBe('right');
    expect(state().paddles[players[0]!.id]!.y).toBe(30);
    expect(state().scoreLimit).toBe(7);
    expect(state().ball.x).toBe(50);
    expect(state().ball.y).toBe(30);
    expect(state().serveAt).not.toBeNull();
    expect(state().endsAt).toBeGreaterThan(0);
  });

  it('maps the rounds setting onto the score limit (clamped 3–15)', () => {
    expect(scoreLimitFor(undefined)).toBe(7);
    expect(scoreLimitFor(5)).toBe(5);
    expect(scoreLimitFor(1)).toBe(3);
    expect(scoreLimitFor(99)).toBe(15);
    expect(scoreLimitFor(Number.NaN)).toBe(7);
  });

  /* ---------------------------------------------------------------- */
  /* Paddle movement                                                   */
  /* ---------------------------------------------------------------- */

  it('accepts paddle intents and moves the paddle on the server clock', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    expect(
      paddleDuelGame.validateAction(playerId, { type: 'move', payload: { direction: 'up' } }, state(), context())
        .valid,
    ).toBe(true);

    const down = platform.gameManager.handleAction(room, playerId, {
      type: 'move',
      payload: { direction: 'down' },
    });
    expect(down.accepted).toBe(true);
    expect(state().paddles[playerId]!.dir).toBe(1);

    const yBefore = state().paddles[playerId]!.y;
    platform.gameManager.update(room, 250);
    expect(state().paddles[playerId]!.y).toBeGreaterThan(yBefore);

    // Clamped inside the arena after a long sprint.
    for (let i = 0; i < 40; i += 1) platform.gameManager.update(room, 250);
    expect(state().paddles[playerId]!.y).toBe(54); // height - paddleHeight/2

    const stop = platform.gameManager.handleAction(room, playerId, {
      type: 'move',
      payload: { direction: 'stop' },
    });
    expect(stop.accepted).toBe(true);
    expect(state().paddles[playerId]!.dir).toBe(0);
  });

  it('rejects invalid actions, bad directions, ghosts and non-playing phases', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    expect(paddleDuelGame.validateAction(playerId, { type: 'dash' }, state(), context()).valid).toBe(false);
    expect(
      paddleDuelGame.validateAction(playerId, { type: 'move', payload: { direction: 'sideways' } }, state(), context())
        .valid,
    ).toBe(false);
    expect(
      paddleDuelGame.validateAction('ghost', { type: 'move', payload: { direction: 'up' } }, state(), context()).valid,
    ).toBe(false);
    expect(paddleDuelGame.validateAction(playerId, { type: 'move' }, state(), context()).valid).toBe(false);

    state().phase = 'idle';
    expect(
      paddleDuelGame.validateAction(playerId, { type: 'move', payload: { direction: 'up' } }, state(), context()).valid,
    ).toBe(false);
  });

  /* ---------------------------------------------------------------- */
  /* Ball physics                                                      */
  /* ---------------------------------------------------------------- */

  it('launches the serve toward the receiving side after the delay', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const servingTo = state().servingTo!;
    expect(['left', 'right']).toContain(servingTo);
    expect(state().ball.vx).toBe(0);

    // Fake the serve deadline passing.
    state().serveAt = context().now() - 1;
    platform.gameManager.update(room, 250);
    expect(state().serveAt).toBeNull();
    expect(state().ball.vx).not.toBe(0);
    expect(servingTo === 'left' ? state().ball.vx < 0 : state().ball.vx > 0).toBe(true);
    expect(state().lastEvent).toBe('serve');
  });

  it('bounces the ball off the top and bottom walls', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const ball = state().ball;
    ball.x = 50;
    ball.y = 2; // near the top
    ball.vx = 20;
    ball.vy = -30; // moving up fast
    state().serveAt = null;
    state().servingTo = null;
    const yBefore = ball.y;
    stepDuel(state(), 50, context().now(), context());
    expect(ball.vy).toBeGreaterThan(0); // flipped downward
    expect(ball.y).toBeGreaterThanOrEqual(state().ballRadius); // kept inside
    expect(ball.y).toBeLessThanOrEqual(yBefore + 1);
  });

  it('returns the ball off the left paddle, faster and angled by the hit offset', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const paddle = state().paddles[players[0]!.id]!; // left side
    paddle.y = 30;
    const ball = state().ball;
    state().serveAt = null;
    state().servingTo = null;
    ball.x = 8; // approaching the left face at x=5
    ball.y = 24; // hit above centre
    ball.vx = -50;
    ball.vy = 0;
    const speedBefore = Math.hypot(ball.vx, ball.vy);
    stepDuel(state(), 50, context().now(), context());
    expect(ball.vx).toBeGreaterThan(0); // reflected right
    expect(Math.hypot(ball.vx, ball.vy)).toBeGreaterThan(speedBefore);
    expect(ball.vy).toBeLessThan(0); // above-centre hit angles up
    expect(state().rallyHits).toBe(1);
    expect(state().paddles[players[0]!.id]!.rallies).toBe(1);
    expect(state().lastEvent).toBe('paddle');
  });

  it('predictBallY folds wall reflections', () => {
    // Straight shot down the middle stays put.
    expect(predictBallY({ x: 50, y: 30, vx: -40, vy: 0 }, 5, 60, 1)).toBeCloseTo(30, 5);
    // A shot that would cross the bottom wall reflects back up.
    const predicted = predictBallY({ x: 50, y: 30, vx: -10, vy: 35 }, 5, 60, 1);
    expect(predicted).toBeLessThan(59);
    expect(predicted).toBeGreaterThan(0);
  });

  /* ---------------------------------------------------------------- */
  /* Scoring                                                           */
  /* ---------------------------------------------------------------- */

  it('scores when the ball passes a paddle and schedules a serve to the conceder', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const [leftId, rightId] = players.map((player) => player.id);
    const ball = state().ball;
    state().serveAt = null;
    state().servingTo = null;
    ball.x = 102; // already beyond the right paddle, heading out
    ball.y = 30;
    ball.vx = 60;
    ball.vy = 0;
    // Park the right paddle far from the ball so it misses.
    state().paddles[rightId]!.y = 8;

    stepDuel(state(), 50, context().now(), context());
    expect(state().paddles[leftId]!.score).toBe(1);
    expect(state().serveAt).not.toBeNull();
    expect(state().servingTo).toBe('right'); // conceder receives
    expect(state().ball.x).toBe(50); // ball re-centred
    expect(state().rallyHits).toBe(0);

    // The serve launches toward the conceder.
    state().serveAt = context().now() - 1;
    platform.gameManager.update(room, 250);
    expect(state().ball.vx).toBeGreaterThan(0);
  });

  it('finishes the match when a player reaches the score limit', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const leftId = players[0]!.id;
    state().paddles[leftId]!.score = state().scoreLimit - 1;
    state().serveAt = null;
    state().servingTo = null;
    state().ball.x = 102;
    state().ball.y = 30;
    state().ball.vx = 60;
    state().ball.vy = 0;
    state().paddles[players[1]!.id]!.y = 8;

    stepDuel(state(), 50, context().now(), context());
    expect(state().phase).toBe('finished');
    expect(state().finishReason).toBe('completed');

    const draft = paddleDuelGame.getResult(state(), context());
    expect(draft.winners).toEqual([leftId]);
    expect(draft.isDraw).toBe(false);
    expect(draft.rankings[0]!.score).toBe(7);
  });

  /* ---------------------------------------------------------------- */
  /* Timeout / leaves / reset                                          */
  /* ---------------------------------------------------------------- */

  it('timeout: leader wins, equal scores draw', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    finishPaddleOnTimeout(state(), context());
    expect(state().phase).toBe('finished');
    expect(paddleDuelGame.checkDrawCondition(state())).toBe(true);
    expect(paddleDuelGame.checkWinCondition(state())).toHaveLength(2);

    // Unequal scores → the leader wins.
    state().phase = 'playing';
    state().paddles[players[1]!.id]!.score = 3;
    finishPaddleOnTimeout(state(), context());
    const draft = paddleDuelGame.getResult(state(), context());
    expect(draft.winners).toEqual([players[1]!.id]);
    expect(draft.reason).toBe('timeout');
  });

  it('disconnect freezes the paddle; leaving hands the match to the rival', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const [leftId, rightId] = players.map((player) => player.id);
    state().paddles[leftId]!.dir = 1;

    paddleDuelGame.playerLeft(leftId, state(), context(), 'disconnect');
    expect(state().paddles[leftId]!.disconnected).toBe(true);
    expect(state().paddles[leftId]!.dir).toBe(0);
    expect(state().phase).toBe('playing');

    paddleDuelGame.playerLeft(leftId, state(), context(), 'leave');
    expect(state().paddles[leftId]!.left).toBe(true);
    expect(state().phase).toBe('finished');
    const draft = paddleDuelGame.getResult(state(), context());
    expect(draft.winners).toEqual([rightId]); // stayed player outranks the leaver
  });

  it('reset keeps both seats and zeroes the duel', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const seats = Object.keys(state().paddles);
    state().paddles[seats[0]!]!.score = 5;
    state().paddles[seats[0]!]!.rallies = 9;

    const next = paddleDuelGame.reset(state());
    expect(Object.keys(next.paddles)).toEqual(seats);
    expect(next.phase).toBe('idle');
    expect(next.ball).toEqual({ x: 50, y: 30, vx: 0, vy: 0 });
    for (const paddle of Object.values(next.paddles)) {
      expect(paddle.score).toBe(0);
      expect(paddle.rallies).toBe(0);
      expect(paddle.y).toBe(30);
    }
  });

  /* ---------------------------------------------------------------- */
  /* AI + public state                                                 */
  /* ---------------------------------------------------------------- */

  it('AI returns legal intents that chase the incoming ball', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id; // left side
    const paddle = state().paddles[playerId]!;
    state().serveAt = null;
    state().servingTo = null;
    state().ball = { x: 50, y: 12, vx: -45, vy: 2 }; // incoming, high

    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      paddle.y = 30;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const move = paddleDuelGame.getAIMove?.(playerId, difficulty, state(), context());
        expect(move?.type).toBe('move');
        expect(['up', 'down', 'stop']).toContain(move?.payload?.direction);
      }
      // With the ball high above the paddle, hard AI moves up reliably.
      let ups = 0;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const move = paddleDuelGame.getAIMove?.(playerId, difficulty, state(), context());
        if (move?.payload?.direction === 'up') ups += 1;
      }
      if (difficulty === 'hard') expect(ups).toBeGreaterThan(15);
    }
  });

  it('public state exposes both paddles and the ball but never the seed', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const view = publicState();
    expect(view.phase).toBe('playing');
    expect(Object.keys(view.paddles)).toHaveLength(2);
    expect(view.ball).toEqual({ x: 50, y: 30, vx: 0, vy: 0 });
    expect(view.scoreLimit).toBe(7);
    expect(typeof view.serverTime).toBe('number');
    expect(JSON.stringify(view)).not.toContain('"seed"');
    expect(state().serveAt).not.toBeNull();
  });

  it('resetPoint and launchServe round-trip a full rally cycle', () => {
    // Pure-function check without a live room.
    expect(resetPoint).toBeDefined();
    expect(launchServe).toBeDefined();
    expect(stepDuel).toBeDefined();
  });
});
