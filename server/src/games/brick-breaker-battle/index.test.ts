import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createTestPlatform, waitFor, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  ballSpeedForLevel,
  brickBreakerGame,
  brickRect,
  computeBreakerRanking,
  effectivePaddleWidth,
  finishBreakerOnTimeout,
  isBrickIntent,
  launchBall,
  parkBall,
  predictBallX,
  rowsForLevel,
  stepBreaker,
  totalBricksFor,
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
    aimAtBrick(playerId, 21); // bottom row (row 3), value 15
    const a = arena(playerId);
    stepBreaker(state(), 50, context().now(), context());
    expect(a.bricks[21]).toBe(false);
    expect(a.destroyed).toBe(1);
    expect(a.score).toBe(15); // chain 1 → x1
    expect(a.ball.vy).toBeGreaterThan(0); // reflected downward
    expect(state().lastEvent).toBe(`brick:${playerId}`);
  });

  it('chains combos: consecutive bricks multiply up to x4', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    const a = arena(playerId);
    a.launchAt = null;
    a.chain = 1; // one brick already broken without a save
    aimAtBrick(playerId, 22); // bottom row, value 15 → x2
    stepBreaker(state(), 50, context().now(), context());
    expect(a.score).toBe(30);
    expect(a.chain).toBe(2);

    a.chain = 5; // deep chain → capped x4
    aimAtBrick(playerId, 23); // bottom row, value 15 → x4
    stepBreaker(state(), 50, context().now(), context());
    expect(a.score).toBe(30 + 60);
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

  it('clearing the wall levels up: bonus, extra life, bigger wall; match ends when everyone is done', async () => {
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
    expect(a.score).toBe(100 + 15); // clear bonus (level 1) + last brick (chain 1)
    expect(a.done).toBe(false); // level 2 spawns instead of ending the run
    expect(a.level).toBe(2);
    expect(a.levelsCleared).toBe(1);
    expect(a.rows).toBe(5);
    expect(a.bricks).toHaveLength(35); // 5 rows, all fresh
    expect(a.bricks.every(Boolean)).toBe(true);
    expect(a.lives).toBe(4); // +1 life on level up
    expect(a.launchAt).not.toBeNull(); // ball re-parked
    expect(state().lastEvent).toBe(`level:${aId}:2`);

    // Rival still running → match continues.
    expect(state().phase).toBe('playing');

    // Player A runs out of lives on the bigger wall.
    a.lives = 1;
    a.launchAt = null;
    a.ball = { x: 80, y: 70, vx: 0, vy: 60 };
    a.paddleX = 20;
    stepBreaker(state(), 50, context().now(), context());
    expect(a.done).toBe(true);

    // Rival runs out of lives → both done → finished.
    b.lives = 1;
    b.launchAt = null;
    b.ball = { x: 80, y: 70, vx: 0, vy: 60 };
    b.paddleX = 20;
    stepBreaker(state(), 50, context().now(), context());
    expect(state().phase).toBe('finished');
    expect(state().finishReason).toBe('completed');

    const draft = brickBreakerGame.getResult(state(), context());
    expect(draft.winners).toEqual([aId]); // 115 > 0
    expect(draft.rankings[0]!.stats.bricks).toBe(28);
    expect(draft.rankings[0]!.stats.cleared).toBe(1);
  });

  it('difficulty scales with the level: faster launches, taller walls', () => {
    expect(ballSpeedForLevel(1)).toBe(38);
    expect(ballSpeedForLevel(2)).toBe(42);
    expect(ballSpeedForLevel(3)).toBe(46);
    expect(ballSpeedForLevel(99)).toBe(46); // capped
    expect(rowsForLevel(1)).toBe(4);
    expect(rowsForLevel(2)).toBe(5);
    expect(rowsForLevel(3)).toBe(6);
    expect(totalBricksFor(4)).toBe(28);
    expect(totalBricksFor(5)).toBe(35);
    expect(totalBricksFor(6)).toBe(42);
  });

  it('power-ups drop from broken bricks and are caught with the paddle', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    const a = arena(playerId);

    // Rigged PRNG: drop roll passes, kind roll selects "wide".
    const queue = [0.01, 0.01];
    const rigged = { ...context(), random: () => (queue.shift() ?? 1) as number };
    aimAtBrick(playerId, 21);
    stepBreaker(state(), 50, context().now(), rigged);
    expect(a.bricks[21]).toBe(false);
    expect(a.powerUps).toHaveLength(1);
    expect(a.powerUps[0]!.kind).toBe('wide');

    // Park the ball, park the paddle under the capsule and let it fall.
    const capsule = a.powerUps[0]!;
    parkBall(a, context().now());
    a.paddleDir = 0;
    a.paddleX = capsule.x;
    for (let step = 0; step < 70; step += 1) {
      stepBreaker(state(), 50, context().now(), context());
      if (a.powerUps.length === 0) break;
    }
    expect(a.powerUps).toHaveLength(0); // caught
    expect(a.wideUntil).toBeGreaterThan(context().now());
    expect(effectivePaddleWidth(a, state().paddleWidth, context().now())).toBeCloseTo(
      state().paddleWidth * 1.4,
      5,
    );
    expect(state().lastEvent).toBe(`power:${playerId}:wide`);
  });

  it('life and points capsules apply their effects when caught', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    const a = arena(playerId);

    // Life capsule: drop passes, kind roll ≥ 0.75 → "life".
    const lifeQueue = [0.01, 0.9];
    aimAtBrick(playerId, 21);
    stepBreaker(state(), 50, context().now(), { ...context(), random: () => (lifeQueue.shift() ?? 1) as number });
    expect(a.powerUps[0]!.kind).toBe('life');
    const lifeCapsule = a.powerUps[0]!;
    parkBall(a, context().now());
    a.paddleDir = 0;
    a.paddleX = lifeCapsule.x;
    for (let step = 0; step < 70; step += 1) {
      stepBreaker(state(), 50, context().now(), context());
      if (a.powerUps.length === 0) break;
    }
    expect(a.lives).toBe(4); // 3 + 1

    // Points capsule: drop passes, kind roll 0.6 → "points".
    const pointsQueue = [0.01, 0.6];
    aimAtBrick(playerId, 22);
    stepBreaker(state(), 50, context().now(), { ...context(), random: () => (pointsQueue.shift() ?? 1) as number });
    expect(a.powerUps[0]!.kind).toBe('points');
    const pointsCapsule = a.powerUps[0]!;
    parkBall(a, context().now());
    a.paddleDir = 0;
    a.paddleX = pointsCapsule.x;
    const scoreBefore = a.score;
    for (let step = 0; step < 70; step += 1) {
      stepBreaker(state(), 50, context().now(), context());
      if (a.powerUps.length === 0) break;
    }
    expect(a.score).toBe(scoreBefore + 75);
  });

  it('a very fast ball cannot tunnel through the paddle (micro-stepped physics)', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    const a = arena(playerId);
    a.launchAt = null;
    a.paddleX = 50;
    a.paddleDir = 0;
    // One 50ms step at this speed would travel ~9.5 units — straight past the
    // paddle and out the floor if the simulation did not micro-step.
    a.ball = { x: 50, y: 63.9, vx: 0, vy: 190 };
    stepBreaker(state(), 50, context().now(), context());
    expect(a.ball.vy).toBeLessThan(0); // saved, not missed
    expect(a.ball.y).toBeLessThan(66);
    expect(a.lives).toBe(3);
    expect(a.chain).toBe(0); // save resets the combo
    expect(state().lastEvent).toBe(`save:${playerId}`);
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
