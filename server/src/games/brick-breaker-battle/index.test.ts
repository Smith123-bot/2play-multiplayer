import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createTestPlatform, waitFor, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  brickBreakerGame,
  brickRect,
  computeBreakerRanking,
  finishBreakerOnTimeout,
  isBrickIntent,
  launchBall,
  parkBall,
  predictBallX,
  stepBreaker,
  type BrickArena,
  type BrickBreakerState,
} from './index';
import type { Room } from '../../rooms/Room';

describe('Brick Breaker Battle', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'brick-breaker-battle');
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as BrickBreakerState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const arena = (id: string): BrickArena => state().arenas[id]!;
  const publicState = () =>
    platform.gameManager.getPublicState(room, players[0]!.id) as {
      phase: string;
      arenas: Record<string, { bricks: boolean[]; lives: number; score: number; ball: { x: number; y: number; vx: number; vy: number } }>;
    };

  /** Aims one player's ball straight up at a bottom-row brick (clear approach). */
  const aimAtBrick = (id: string, index: number) => {
    const a = arena(id);
    const rect = brickRect(index);
    a.launchAt = null;
    a.ball = { x: rect.x + rect.w / 2, y: rect.y + rect.h + 2, vx: 0, vy: -40 };
  };

  /* ---------------------------------------------------------------- */
  /* Initialisation                                                    */
  /* ---------------------------------------------------------------- */

  it('starts playing with two identical fresh arenas (28 bricks, 3 lives, parked balls)', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const [a, b] = players.map((player) => arena(player.id));
    expect(a.bricks).toHaveLength(28);
    expect(a.bricks.every(Boolean)).toBe(true);
    expect(a.lives).toBe(3);
    expect(a.score).toBe(0);
    expect(a.launchAt).not.toBeNull();
    expect(b.bricks).toEqual(a.bricks); // identical, fair wall
    expect(state().endsAt).toBeGreaterThan(0);
  });

  it('brickRect lays out a centred gapless grid', () => {
    const first = brickRect(0);
    const last = brickRect(27);
    expect(first.x).toBeCloseTo(1.5, 5);
    expect(first.y).toBe(6);
    expect(last.x + last.w).toBeCloseTo(98.5, 5);
    expect(state === state).toBe(true);
  });

  /* ---------------------------------------------------------------- */
  /* Paddle movement                                                   */
  /* ---------------------------------------------------------------- */

  it('accepts paddle intents, moves and clamps; rejects invalid input', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    expect(isBrickIntent('left')).toBe(true);
    expect(isBrickIntent('spin')).toBe(false);

    const right = platform.gameManager.handleAction(room, playerId, {
      type: 'move',
      payload: { direction: 'right' },
    });
    expect(right.accepted).toBe(true);
    const xBefore = arena(playerId).paddleX;
    platform.gameManager.update(room, 250);
    expect(arena(playerId).paddleX).toBeGreaterThan(xBefore);

    for (let i = 0; i < 60; i += 1) platform.gameManager.update(room, 250);
    expect(arena(playerId).paddleX).toBe(92); // width - paddleWidth/2

    expect(
      brickBreakerGame.validateAction(playerId, { type: 'jump' }, state(), context()).valid,
    ).toBe(false);
    expect(
      brickBreakerGame.validateAction(
        playerId,
        { type: 'move', payload: { direction: 'up' } },
        state(),
        context(),
      ).valid,
    ).toBe(false);
    expect(
      brickBreakerGame.validateAction('ghost', { type: 'move', payload: { direction: 'left' } }, state(), context())
        .valid,
    ).toBe(false);

    state().phase = 'idle';
    expect(
      brickBreakerGame.validateAction(playerId, { type: 'move', payload: { direction: 'left' } }, state(), context())
        .valid,
    ).toBe(false);
  });

  /* ---------------------------------------------------------------- */
  /* Ball physics                                                      */
  /* ---------------------------------------------------------------- */

  it('launches the parked ball upward after the delay', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    const a = arena(playerId);
    a.launchAt = context().now() - 1;
    platform.gameManager.update(room, 250);
    expect(a.launchAt).toBeNull();
    expect(a.ball.vy).toBeLessThan(0);
    expect(state().lastEvent).toBe(`launch:${playerId}`);
  });

  it('bounces off the side walls and the ceiling', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    const a = arena(playerId);
    a.launchAt = null;
    a.ball = { x: 1.2, y: 40, vx: -30, vy: 5 };
    stepBreaker(state(), 50, context().now(), context());
    expect(a.ball.vx).toBeGreaterThan(0); // left wall reflected

    a.ball = { x: 50, y: 1.2, vx: 5, vy: -30 };
    stepBreaker(state(), 50, context().now(), context());
    expect(a.ball.vy).toBeGreaterThan(0); // ceiling reflected
  });

  it('predictBallX folds wall reflections', () => {
    expect(predictBallX({ x: 50, y: 10, vx: 0, vy: 30 }, 66, 100, 1)).toBeCloseTo(50, 5);
    const predicted = predictBallX({ x: 20, y: 10, vx: 60, vy: 28 }, 66, 100, 1);
    expect(predicted).toBeGreaterThanOrEqual(1);
    expect(predicted).toBeLessThanOrEqual(99);
  });

  /* ---------------------------------------------------------------- */
  /* Bricks                                                            */
  /* ---------------------------------------------------------------- */

  it('destroys a hit brick, scores its row value and reflects the ball', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    aimAtBrick(playerId, 21); // bottom row (row 3), value 10
    const a = arena(playerId);
    stepBreaker(state(), 50, context().now(), context());
    expect(a.bricks[21]).toBe(false);
    expect(a.destroyed).toBe(1);
    expect(a.score).toBe(10); // chain 1 → x1
    expect(a.ball.vy).toBeGreaterThan(0); // reflected downward
    expect(state().lastEvent).toBe(`brick:${playerId}`);
  });

  it('chains combos: consecutive bricks multiply up to x4', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    const a = arena(playerId);
    a.launchAt = null;
    a.chain = 1; // one brick already broken without a save
    aimAtBrick(playerId, 22); // bottom row, value 10 → x2
    stepBreaker(state(), 50, context().now(), context());
    expect(a.score).toBe(20);
    expect(a.chain).toBe(2);

    a.chain = 5; // deep chain → capped x4
    aimAtBrick(playerId, 23); // bottom row, value 10 → x4
    stepBreaker(state(), 50, context().now(), context());
    expect(a.score).toBe(20 + 40);
  });

  it('a paddle save reflects the ball and resets the chain', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    const a = arena(playerId);
    a.launchAt = null;
    a.chain = 3;
    a.paddleX = 50;
    a.ball = { x: 50, y: 62, vx: 5, vy: 40 };
    stepBreaker(state(), 50, context().now(), context());
    expect(a.ball.vy).toBeLessThan(0);
    expect(a.chain).toBe(0);
    expect(state().lastEvent).toBe(`save:${playerId}`);
  });

  it('missing the ball costs a life and re-parks it; three misses end the run', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    const a = arena(playerId);
    a.launchAt = null;
    a.paddleX = 20; // park the paddle far away
    a.ball = { x: 80, y: 70, vx: 0, vy: 60 };

    stepBreaker(state(), 50, context().now(), context());
    expect(a.lives).toBe(2);
    expect(a.launchAt).not.toBeNull();
    expect(a.done).toBe(false);
    expect(state().lastEvent).toBe(`miss:${playerId}`);

    a.lives = 1;
    a.launchAt = null;
    a.ball = { x: 80, y: 70, vx: 0, vy: 60 };
    stepBreaker(state(), 50, context().now(), context());
    expect(a.lives).toBe(0);
    expect(a.done).toBe(true);
    expect(a.doneAt).not.toBeNull();
    expect(state().lastEvent).toBe(`out:${playerId}`);
  });

  it('clearing the wall banks the bonus and finishes the match when everyone is done', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const [aId, bId] = players.map((player) => player.id);
    const a = arena(aId);
    const b = arena(bId);

    a.bricks.fill(false);
    a.bricks[27] = true; // the lone survivor
    a.destroyed = 27;
    a.bricksBroken = 27;
    a.launchAt = null;
    const rect = brickRect(27);
    a.ball = { x: rect.x + rect.w / 2, y: rect.y + rect.h + 2, vx: 0, vy: -40 };
    stepBreaker(state(), 50, context().now(), context());
    expect(a.score).toBe(100 + 10); // clear bonus + last brick (chain 1)
    expect(a.done).toBe(true);

    // Rival still running → match continues.
    expect(state().phase).toBe('playing');

    // Rival runs out of lives → both done → finished.
    b.lives = 1;
    b.launchAt = null;
    b.ball = { x: 80, y: 70, vx: 0, vy: 60 };
    b.paddleX = 20;
    stepBreaker(state(), 50, context().now(), context());
    expect(state().phase).toBe('finished');
    expect(state().finishReason).toBe('completed');

    const draft = brickBreakerGame.getResult(state(), context());
    expect(draft.winners).toEqual([aId]); // 110 > 0
    expect(draft.rankings[0]!.stats.bricks).toBe(28);
    expect(draft.rankings[0]!.stats.cleared).toBe(1);
  });

  /* ---------------------------------------------------------------- */
  /* Ranking / timeout / leaves / reset                                */
  /* ---------------------------------------------------------------- */

  it('timeout ranks by score, earlier finish breaks ties', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const [aId, bId] = players.map((player) => player.id);
    arena(aId).score = 120;
    arena(bId).score = 200;
    finishBreakerOnTimeout(state(), context());
    expect(state().phase).toBe('finished');
    expect(state().finishReason).toBe('timeout');

    const draft = brickBreakerGame.getResult(state(), context());
    expect(draft.winners).toEqual([bId]);
    expect(computeBreakerRanking(state(), context())[0]!.playerId).toBe(bId);

    // Equal scores → earlier doneAt ranks first.
    state().phase = 'playing';
    arena(bId).score = 120;
    arena(bId).done = true;
    arena(bId).doneAt = 1000;
    arena(aId).done = true;
    arena(aId).doneAt = 2000;
    const ranking = computeBreakerRanking(state(), context());
    expect(ranking[0]!.playerId).toBe(bId);
  });

  it('disconnect freezes the paddle; leaving ends the run for the rival to bank points', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const [aId, bId] = players.map((player) => player.id);
    arena(aId).paddleDir = 1;

    brickBreakerGame.playerLeft(aId, state(), context(), 'disconnect');
    expect(arena(aId).disconnected).toBe(true);
    expect(arena(aId).paddleDir).toBe(0);
    expect(state().phase).toBe('playing');

    arena(bId).done = true; // rival already finished
    brickBreakerGame.playerLeft(aId, state(), context(), 'leave');
    expect(arena(aId).left).toBe(true);
    expect(state().phase).toBe('finished');
  });

  it('reset rebuilds fresh arenas for the same seats', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const seats = Object.keys(state().arenas);
    arena(seats[0]!).score = 300;
    arena(seats[0]!).lives = 0;

    const next = brickBreakerGame.reset(state());
    expect(Object.keys(next.arenas)).toEqual(seats);
    expect(next.phase).toBe('idle');
    for (const a of Object.values(next.arenas)) {
      expect(a.score).toBe(0);
      expect(a.lives).toBe(3);
      expect(a.bricks.every(Boolean)).toBe(true);
      expect(a.done).toBe(false);
    }
  });

  /* ---------------------------------------------------------------- */
  /* AI + public state                                                 */
  /* ---------------------------------------------------------------- */

  it('AI returns legal intents and chases a falling ball', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    const a = arena(playerId);
    a.launchAt = null;
    a.paddleX = 50;
    a.ball = { x: 20, y: 30, vx: 5, vy: 35 };

    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const move = brickBreakerGame.getAIMove?.(playerId, difficulty, state(), context());
        expect(move?.type).toBe('move');
        expect(['left', 'right', 'stop']).toContain(move?.payload?.direction);
      }
      let lefts = 0;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const move = brickBreakerGame.getAIMove?.(playerId, difficulty, state(), context());
        if (move?.payload?.direction === 'left') lefts += 1;
      }
      if (difficulty === 'hard') expect(lefts).toBeGreaterThan(15); // ball at x=20
    }
  });

  it('parkBall/launchBall round-trip and public state hides the seed', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    const a = arena(playerId);
    parkBall(a, context().now());
    expect(a.launchAt).not.toBeNull();
    expect(a.ball.vx).toBe(0);
    a.launchAt = context().now() - 1;
    launchBall(a, context());
    expect(a.launchAt).toBeNull();
    expect(a.ball.vy).toBeLessThan(0);

    const view = publicState();
    expect(view.phase).toBe('playing');
    expect(Object.keys(view.arenas)).toHaveLength(2);
    expect(view.arenas[playerId]!.bricks).toHaveLength(28);
    expect(JSON.stringify(view)).not.toContain('"seed"');
  });
});
