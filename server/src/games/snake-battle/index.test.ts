import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createTestPlatform, waitFor, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  chooseAIDirection,
  finishSnakeOnTimeout,
  isReverse,
  snakeBattleGame,
  spawnFood,
  stepSnakes,
  type SnakeBattleState,
  type SnakePlayerState,
} from './index';
import type { Room } from '../../rooms/Room';

function makeSnake(overrides: Partial<SnakePlayerState> = {}): SnakePlayerState {
  return {
    body: [{ x: 5, y: 8 }],
    direction: 'right',
    pendingDirection: null,
    alive: true,
    deathStep: null,
    diedAt: null,
    score: 0,
    foodEaten: 0,
    growPending: 0,
    disconnected: false,
    left: false,
    ...overrides,
  };
}

describe('Snake Battle', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'snake-battle');
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as SnakeBattleState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const publicState = (viewerId?: string) =>
    platform.gameManager.getPublicState(room, viewerId) as {
      phase: string;
      snakes: Record<string, { body: Array<{ x: number; y: number }>; alive: boolean; score: number } | null>;
      foods: Array<{ x: number; y: number }>;
      endsAt: number | null;
    };

  /* ---------------------------------------------------------------- */
  /* Start state                                                       */
  /* ---------------------------------------------------------------- */

  it('starts playing with two symmetric snakes and food on the board', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    expect(Object.keys(state().snakes)).toHaveLength(2);
    const [a, b] = players.map((player) => state().snakes[player.id]!);
    expect(a.body).toHaveLength(3);
    expect(b.body).toHaveLength(3);
    expect(a.direction).toBe('right');
    expect(b.direction).toBe('left');
    // Symmetric: mirrored heads around the centre column.
    expect(a.body[0]!.x + b.body[0]!.x).toBe(state().cols - 1);
    expect(a.body[0]!.y).toBe(b.body[0]!.y);
    expect(state().foods).toHaveLength(2);
    expect(state().startedAt).toBeGreaterThan(0);
  });

  /* ---------------------------------------------------------------- */
  /* Pure step mechanics                                               */
  /* ---------------------------------------------------------------- */

  it('moves snakes one cell per step in their direction', () => {
    const snakeState: SnakeBattleState = {
      phase: 'playing',
      cols: 17,
      rows: 17,
      snakes: {
        a: makeSnake({ body: [{ x: 5, y: 8 }, { x: 4, y: 8 }, { x: 3, y: 8 }] }),
      },
      foods: [],
      stepMs: 250,
      stepIndex: 0,
      accumulatorMs: 0,
      startedAt: 1,
      endsAt: 2,
      durationMs: 1000,
      finishReason: null,
      lastEvent: null,
      nextAIRequestAt: {},
    };
    const ctx = context();
    stepSnakes(snakeState, ctx);
    expect(snakeState.snakes.a!.body[0]).toEqual({ x: 6, y: 8 });
    expect(snakeState.snakes.a!.body).toHaveLength(3); // tail vacates
    expect(snakeState.stepIndex).toBe(1);
  });

  it('eating food grows the snake, scores 10 and respawns the food', () => {
    const snakeState: SnakeBattleState = {
      phase: 'playing',
      cols: 17,
      rows: 17,
      snakes: {
        a: makeSnake({ body: [{ x: 5, y: 8 }, { x: 4, y: 8 }] }),
      },
      foods: [{ x: 6, y: 8, value: 10 }],
      stepMs: 250,
      stepIndex: 0,
      accumulatorMs: 0,
      startedAt: 1,
      endsAt: 2,
      durationMs: 1000,
      finishReason: null,
      lastEvent: null,
      nextAIRequestAt: {},
    };
    stepSnakes(snakeState, context());
    const snake = snakeState.snakes.a!;
    expect(snake.body).toHaveLength(3); // grew
    expect(snake.score).toBe(10);
    expect(snake.foodEaten).toBe(1);
    // The board keeps FOOD_COUNT pellets — the eaten one is replaced elsewhere.
    expect(snakeState.foods).toHaveLength(2);
    expect(snakeState.foods.every((food) => food.value === 10)).toBe(true);
    expect(snakeState.foods.some((food) => food.x === 6 && food.y === 8)).toBe(false);
  });

  it('kills on wall collision, self collision and body collision', () => {
    const ctx = context();
    const build = (snake: SnakePlayerState): SnakeBattleState => ({
      phase: 'playing',
      cols: 17,
      rows: 17,
      snakes: { a: snake },
      foods: [],
      stepMs: 250,
      stepIndex: 0,
      accumulatorMs: 0,
      startedAt: 1,
      endsAt: 2,
      durationMs: 1000,
      finishReason: null,
      lastEvent: null,
      nextAIRequestAt: {},
    });

    const wall = build(makeSnake({ body: [{ x: 16, y: 0 }], direction: 'right' }));
    stepSnakes(wall, ctx);
    expect(wall.snakes.a!.alive).toBe(false);
    expect(wall.snakes.a!.deathStep).toBe(0);

    // Self collision: the next head lands on a non-tail body cell.
    const hook = [
      { x: 4, y: 4 }, { x: 5, y: 4 }, { x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 },
    ];
    const self = build(makeSnake({ body: hook, direction: 'down' }));
    stepSnakes(self, ctx);
    expect(self.snakes.a!.alive).toBe(false);

    const other = build(makeSnake({ body: [{ x: 5, y: 8 }] }));
    other.snakes.b = makeSnake({ body: [{ x: 6, y: 8 }, { x: 6, y: 9 }], direction: 'up' });
    stepSnakes(other, ctx);
    expect(other.snakes.a!.alive).toBe(false); // a ran into b's body
    expect(other.snakes.b!.alive).toBe(true);
  });

  it('simultaneous head-to-head kills both snakes', () => {
    const snakeState: SnakeBattleState = {
      phase: 'playing',
      cols: 17,
      rows: 17,
      snakes: {
        a: makeSnake({ body: [{ x: 7, y: 8 }, { x: 6, y: 8 }], direction: 'right' }),
        b: makeSnake({ body: [{ x: 9, y: 8 }, { x: 10, y: 8 }], direction: 'left' }),
      },
      foods: [],
      stepMs: 250,
      stepIndex: 42,
      accumulatorMs: 0,
      startedAt: 1,
      endsAt: 2,
      durationMs: 1000,
      finishReason: null,
      lastEvent: null,
      nextAIRequestAt: {},
    };
    stepSnakes(snakeState, context());
    expect(snakeState.snakes.a!.alive).toBe(false);
    expect(snakeState.snakes.b!.alive).toBe(false);
    expect(snakeState.snakes.a!.deathStep).toBe(42);
    expect(snakeState.snakes.b!.deathStep).toBe(42);
  });

  it('reverse directions are detected', () => {
    expect(isReverse('up', 'down')).toBe(true);
    expect(isReverse('left', 'right')).toBe(true);
    expect(isReverse('up', 'left')).toBe(false);
    expect(isReverse('up', 'up')).toBe(false);
  });

  /* ---------------------------------------------------------------- */
  /* Actions through the pipeline                                      */
  /* ---------------------------------------------------------------- */

  it('accepts valid turns (queued for the next step) and rejects reverses', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    const snake = state().snakes[playerId]!; // heading right

    // Direct reverse of the current heading is rejected outright.
    expect(
      snakeBattleGame.validateAction(
        playerId,
        { type: 'turn', payload: { direction: 'left' } },
        state(),
        context(),
      ),
    ).toEqual({ valid: false, reason: 'A snake cannot reverse into itself.' });

    const ok = platform.gameManager.handleAction(room, playerId, {
      type: 'turn',
      payload: { direction: 'up' },
    });
    expect(ok.accepted).toBe(true);
    expect(snake.pendingDirection).toBe('up');
    expect(snake.direction).toBe('right'); // not applied until the next step

    // Reverse of the QUEUED direction is also rejected.
    expect(
      snakeBattleGame.validateAction(
        playerId,
        { type: 'turn', payload: { direction: 'down' } },
        state(),
        context(),
      ).valid,
    ).toBe(false);
    expect(snake.pendingDirection).toBe('up');
  });

  it('rejects unknown actions, bad directions, unknown players and dead snakes', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;

    expect(snakeBattleGame.validateAction(playerId, { type: 'boost' }, state(), context()).valid).toBe(false);
    expect(
      snakeBattleGame.validateAction(
        playerId,
        { type: 'turn', payload: { direction: 'north' } },
        state(),
        context(),
      ).valid,
    ).toBe(false);
    expect(snakeBattleGame.validateAction(playerId, { type: 'turn' }, state(), context()).valid).toBe(false);
    expect(
      snakeBattleGame.validateAction('ghost', { type: 'turn', payload: { direction: 'up' } }, state(), context())
        .valid,
    ).toBe(false);

    const snake = state().snakes[playerId]!;
    snake.alive = false;
    expect(
      snakeBattleGame.validateAction(playerId, { type: 'turn', payload: { direction: 'up' } }, state(), context())
        .valid,
    ).toBe(false);
    snake.alive = true;
  });

  /* ---------------------------------------------------------------- */
  /* Real-time loop + lifecycle                                        */
  /* ---------------------------------------------------------------- */

  it('the update loop advances snakes on the fixed clock', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    const headBefore = { ...state().snakes[playerId]!.body[0]! };
    const stepsBefore = state().stepIndex;

    // The platform ticks update() every GAME_TICK_MS; the unit fixture has no
    // loop, so we drive the exact same entry point manually.
    platform.gameManager.update(room, 250);
    platform.gameManager.update(room, 250);

    expect(state().stepIndex).toBeGreaterThanOrEqual(stepsBefore + 2);
    const headAfter = state().snakes[playerId]!.body[0]!;
    expect(headAfter.x).toBeGreaterThan(headBefore.x); // still heading right
  });

  it('a disconnected snake keeps sliding; a leaver dies and the match can end', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;

    snakeBattleGame.playerLeft(playerId, state(), context(), 'disconnect');
    expect(state().snakes[playerId]!.disconnected).toBe(true);
    expect(state().snakes[playerId]!.alive).toBe(true);
    expect(state().phase).toBe('playing');

    snakeBattleGame.playerLeft(playerId, state(), context(), 'leave');
    expect(state().snakes[playerId]!.alive).toBe(false);
    expect(state().phase).toBe('playing'); // survivor still racing

    snakeBattleGame.playerLeft(players[1]!.id, state(), context(), 'leave');
    await waitFor(() => state().phase === 'finished', { timeoutMs: 5000 });
    expect(state().finishReason).toBe('completed');
  });

  it('finishes with reason timeout when the clock expires', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    finishSnakeOnTimeout(state(), context());
    expect(state().phase).toBe('finished');
    expect(state().finishReason).toBe('timeout');
    expect(snakeBattleGame.isGameFinished(state())).toBe(true);
  });

  /* ---------------------------------------------------------------- */
  /* Results: winner / draw                                            */
  /* ---------------------------------------------------------------- */

  it('survivor wins over the earlier crash; same-step deaths break by score; full tie is a draw', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const [a, b] = players.map((player) => player.id);

    // a died earlier, b still alive → b wins regardless of score.
    state().snakes[a]!.alive = false;
    state().snakes[a]!.deathStep = 10;
    state().snakes[a]!.score = 500;
    state().phase = 'finished';
    let draft = snakeBattleGame.getResult(state(), context());
    expect(draft.winners).toEqual([b]);
    expect(draft.rankings[0]!.playerId).toBe(b);

    // Both died on the same step → higher score wins.
    state().snakes[b]!.alive = false;
    state().snakes[b]!.deathStep = 10;
    state().snakes[b]!.score = 50;
    draft = snakeBattleGame.getResult(state(), context());
    expect(draft.winners).toEqual([a]);

    // Full tie → draw.
    state().snakes[b]!.score = 500;
    draft = snakeBattleGame.getResult(state(), context());
    expect(draft.winners).toHaveLength(2);
    expect(draft.isDraw).toBe(true);
    expect(draft.rankings.every((entry) => entry.isDraw)).toBe(true);
  });

  it('checkWinCondition and checkDrawCondition agree with getResult', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const [a, b] = players.map((player) => player.id);
    state().phase = 'finished';
    state().snakes[a]!.alive = false;
    state().snakes[a]!.deathStep = 4;
    expect(snakeBattleGame.checkWinCondition(state())).toEqual([b]);
    expect(snakeBattleGame.checkDrawCondition(state())).toBe(false);

    state().snakes[b]!.alive = false;
    state().snakes[b]!.deathStep = 4;
    expect(snakeBattleGame.checkDrawCondition(state())).toBe(true);
  });

  /* ---------------------------------------------------------------- */
  /* Reset / rematch                                                   */
  /* ---------------------------------------------------------------- */

  it('reset keeps both seats and zeroes the match', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const seats = Object.keys(state().snakes);
    state().snakes[seats[0]!]!.score = 90;

    const next = snakeBattleGame.reset(state());
    expect(Object.keys(next.snakes)).toEqual(seats);
    expect(next.phase).toBe('idle');
    expect(next.foods).toEqual([]);
    expect(next.stepIndex).toBe(0);
    for (const snake of Object.values(next.snakes)) {
      expect(snake.score).toBe(0);
      expect(snake.foodEaten).toBe(0);
    }
    expect(snakeBattleGame.isGameFinished(next)).toBe(false);
  });

  /* ---------------------------------------------------------------- */
  /* AI                                                                */
  /* ---------------------------------------------------------------- */

  it('AI steering avoids immediate death and prefers food', () => {
    const snakeState: SnakeBattleState = {
      phase: 'playing',
      cols: 17,
      rows: 17,
      snakes: {
        a: makeSnake({ body: [{ x: 8, y: 8 }, { x: 7, y: 8 }, { x: 6, y: 8 }] }),
      },
      foods: [{ x: 8, y: 5, value: 10 }],
      stepMs: 250,
      stepIndex: 0,
      accumulatorMs: 0,
      startedAt: 1,
      endsAt: 2,
      durationMs: 1000,
      finishReason: null,
      lastEvent: null,
      nextAIRequestAt: {},
    };
    // Wall straight ahead: (17,8) is out of bounds → must turn.
    snakeState.snakes.a!.body[0] = { x: 16, y: 8 };
    const direction = chooseAIDirection(snakeState, 'a', 'hard', () => 0.5);
    expect(direction).not.toBe('right');
    const delta = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[direction ?? 'up']!;
    expect(snakeState.snakes.a!.body.some(
      (cell) => cell.x === 16 + delta[0]! && cell.y === 8 + delta[1]!,
    )).toBe(false);

    // Food straight above → hard AI goes up.
    snakeState.snakes.a!.body = [{ x: 8, y: 8 }, { x: 7, y: 8 }, { x: 6, y: 8 }];
    const towardFood = chooseAIDirection(snakeState, 'a', 'hard', () => 0.01);
    expect(towardFood).toBe('up');
  });

  it('getAIMove submits only meaningful turns and none when dead or finished', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    let submitted = 0;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const move = snakeBattleGame.getAIMove?.(playerId, 'medium', state(), context());
      if (move) {
        submitted += 1;
        expect(move.type).toBe('turn');
        expect(['up', 'down', 'left', 'right']).toContain(move.payload?.direction);
      }
    }
    expect(submitted).toBeGreaterThan(0);

    const snake = state().snakes[playerId]!;
    snake.alive = false;
    expect(snakeBattleGame.getAIMove?.(playerId, 'hard', state(), context())).toBeNull();
    state().phase = 'finished';
    expect(snakeBattleGame.getAIMove?.(playerId, 'hard', state(), context())).toBeNull();
  });

  /* ---------------------------------------------------------------- */
  /* Public state / misc                                               */
  /* ---------------------------------------------------------------- */

  it('exposes both snakes and foods with a server clock', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const view = publicState(players[0]!.id);
    expect(view.phase).toBe('playing');
    expect(Object.keys(view.snakes)).toHaveLength(2);
    for (const player of players) {
      expect(view.snakes[player.id]!.body).toHaveLength(3);
      expect(view.snakes[player.id]!.alive).toBe(true);
    }
    expect(view.foods).toHaveLength(2);
    expect(view.endsAt).toBeGreaterThan(0);
  });

  it('spawnFood places food only on free cells', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    state().foods = [];
    spawnFood(state(), context());
    spawnFood(state(), context());
    expect(state().foods).toHaveLength(2);
    const occupied = new Set(
      Object.values(state().snakes).flatMap((snake) => snake.body.map((cell) => `${cell.x},${cell.y}`)),
    );
    for (const food of state().foods) {
      expect(occupied.has(`${food.x},${food.y}`)).toBe(false);
    }
  });
});
