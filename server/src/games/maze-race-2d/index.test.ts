import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createTestPlatform, waitFor, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  allActiveRunnersFinished,
  createMazeRandom,
  distancesToGoal,
  finishMazeOnTimeout,
  finisherScore,
  generateMaze,
  mazeRaceGame,
  pickStartCells,
  type MazeDirection,
  type MazeRaceState,
} from './index';
import type { Room } from '../../rooms/Room';

describe('Maze Race 2D', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'maze-race-2d', {
      settings: { gridSize: '11x11' },
    });
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as MazeRaceState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const publicState = (viewerId?: string) =>
    platform.gameManager.getPublicState(room, viewerId) as {
      phase: string;
      cols: number;
      walls: boolean[];
      goal: { x: number; y: number };
      runners: Record<string, { x: number; y: number; finished: boolean; steps: number } | null>;
    };

  /* ---------------------------------------------------------------- */
  /* Deterministic generation                                          */
  /* ---------------------------------------------------------------- */

  it('generates the same maze for the same seed and a different one otherwise', () => {
    const a = generateMaze(11, 11, createMazeRandom(42));
    const b = generateMaze(11, 11, createMazeRandom(42));
    const c = generateMaze(11, 11, createMazeRandom(43));
    expect(a.walls).toEqual(b.walls);
    expect(a.walls).not.toEqual(c.walls);
  });

  it('generates a fully connected maze with border walls and a floor goal', () => {
    const { walls, goal } = generateMaze(11, 11, createMazeRandom(7));
    // Odd dimensions carve a classic block maze: outer border is solid.
    for (let x = 0; x < 11; x += 1) {
      expect(walls[x]).toBe(true);
      expect(walls[10 * 11 + x]).toBe(true);
    }
    for (let y = 0; y < 11; y += 1) {
      expect(walls[y * 11]).toBe(true);
      expect(walls[y * 11 + 10]).toBe(true);
    }
    expect(walls[goal.y * 11 + goal.x]).toBe(false);
    expect(goal).toEqual({ x: 9, y: 9 });

    // Every floor cell can reach the goal.
    const distances = distancesToGoal(11, 11, walls, goal);
    const floors = walls.filter((wall) => !wall).length;
    const reachable = distances.filter((distance) => distance >= 0).length;
    expect(reachable).toBe(floors);
  });

  it('picks distinct fair start cells (equal distance to the goal)', () => {
    const rng = createMazeRandom(1234);
    const { walls, goal } = generateMaze(15, 15, rng);
    const distances = distancesToGoal(15, 15, walls, goal);
    const starts = pickStartCells(15, 15, walls, goal, distances, 4, rng);
    expect(starts).toHaveLength(4);
    const keys = new Set(starts.map((cell) => `${cell.x},${cell.y}`));
    expect(keys.size).toBe(4);
    for (const cell of starts) {
      expect(distances[cell.y * 15 + cell.x]).toBeGreaterThan(0);
      expect(walls[cell.y * 15 + cell.x]).toBe(false);
    }
    // All starts share the same shortest-path distance (±2 tolerance fallback).
    const startDistances = starts.map((cell) => distances[cell.y * 15 + cell.x]!);
    expect(Math.max(...startDistances) - Math.min(...startDistances)).toBeLessThanOrEqual(2);
  });

  /* ---------------------------------------------------------------- */
  /* Initial state / match start                                       */
  /* ---------------------------------------------------------------- */

  it('starts playing with runners on distinct starts and a live clock', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    expect(state().cols).toBe(11);
    expect(state().walls).toHaveLength(121);
    expect(state().goal).toEqual({ x: 9, y: 9 });
    expect(Object.keys(state().runners)).toHaveLength(2);

    const startKeys = new Set(
      Object.values(state().runners).map((runner) => `${runner.x},${runner.y}`),
    );
    expect(startKeys.size).toBe(2);
    expect(state().startedAt).toBeGreaterThan(0);
    expect(state().endsAt).toBe(state()!.startedAt! + state()!.durationMs);
    expect(state().finishOrder).toEqual([]);
  });

  /* ---------------------------------------------------------------- */
  /* Movement validation                                               */
  /* ---------------------------------------------------------------- */

  it('accepts legal moves and rejects wall collisions', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    const runner = state().runners[playerId]!;

    const legal = (['up', 'down', 'left', 'right'] as MazeDirection[]).filter((direction) => {
      const delta = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[direction]!;
      const [dx, dy] = delta;
      const nx = runner.x + dx;
      const ny = runner.y + dy;
      return nx >= 0 && ny >= 0 && nx < state().cols && ny < state().rows && !state().walls[ny * state().cols + nx];
    });
    expect(legal.length).toBeGreaterThan(0);

    const blocked = (['up', 'down', 'left', 'right'] as MazeDirection[]).find((direction) => !legal.includes(direction));
    if (blocked) {
      expect(
        mazeRaceGame.validateAction(
          playerId,
          { type: 'move', payload: { direction: blocked } },
          state(),
          context(),
        ),
      ).toEqual({ valid: false, reason: 'A wall blocks that way.' });
    }

    const before = { ...runner };
    const result = platform.gameManager.handleAction(room, playerId, {
      type: 'move',
      payload: { direction: legal[0]! },
    });
    expect(result.accepted).toBe(true);
    expect(runner.steps).toBe(before.steps + 1);
  });

  it('rejects unknown actions, bad payloads and unknown players', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;

    expect(mazeRaceGame.validateAction(playerId, { type: 'jump' }, state(), context()).valid).toBe(false);
    expect(
      mazeRaceGame.validateAction(
        playerId,
        { type: 'move', payload: { direction: 'north' } },
        state(),
        context(),
      ).valid,
    ).toBe(false);
    expect(mazeRaceGame.validateAction(playerId, { type: 'move' }, state(), context()).valid).toBe(false);
    expect(
      mazeRaceGame.validateAction(
        'ghost-player',
        { type: 'move', payload: { direction: 'up' } },
        state(),
        context(),
      ).valid,
    ).toBe(false);

    state().phase = 'finished';
    expect(
      mazeRaceGame.validateAction(playerId, { type: 'move', payload: { direction: 'up' } }, state(), context())
        .valid,
    ).toBe(false);
    state().phase = 'playing';
  });

  it('rejects movement after a runner has finished', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    const runner = state().runners[playerId]!;
    runner.finished = true;
    expect(
      mazeRaceGame.validateAction(playerId, { type: 'move', payload: { direction: 'up' } }, state(), context())
        .valid,
    ).toBe(false);
  });

  /* ---------------------------------------------------------------- */
  /* Goal detection / ranking                                          */
  /* ---------------------------------------------------------------- */

  it('detects the goal, records finish order and ranks by arrival', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const [first, second] = players.map((player) => player.id);

    // Teleport both runners next to the goal and walk them in.
    const firstRunner = state().runners[first]!;
    firstRunner.x = state().goal.x - 1;
    firstRunner.y = state().goal.y;
    const secondRunner = state().runners[second]!;
    secondRunner.x = state().goal.x;
    secondRunner.y = state().goal.y - 1;

    const stepOne = platform.gameManager.handleAction(room, first, {
      type: 'move',
      payload: { direction: 'right' },
    });
    expect(stepOne.accepted).toBe(true);
    expect(firstRunner.finished).toBe(true);
    expect(firstRunner.finishMs).toBeGreaterThanOrEqual(0);
    expect(state().finishOrder).toEqual([first]);
    expect(state().phase).toBe('playing'); // second runner still racing

    const stepTwo = platform.gameManager.handleAction(room, second, {
      type: 'move',
      payload: { direction: 'down' },
    });
    expect(stepTwo.accepted).toBe(true);
    expect(state().phase).toBe('finished');
    expect(state().finishOrder).toEqual([first, second]);
    expect(allActiveRunnersFinished(state())).toBe(true);

    const draft = mazeRaceGame.getResult(state(), context());
    expect(draft.winners).toEqual([first]);
    expect(draft.isDraw).toBe(false);
    expect(draft.rankings.map((entry) => entry.playerId)).toEqual([first, second]);
    expect(draft.rankings[0]!.score).toBeGreaterThan(0);
    expect(draft.rankings[0]!.score).toBeGreaterThanOrEqual(draft.rankings[1]!.score);
  });

  it('ranks unfinished players below finishers, closer to the goal first', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const [first, second] = players.map((player) => player.id);

    const firstRunner = state().runners[first]!;
    firstRunner.x = state().goal.x - 1;
    firstRunner.y = state().goal.y;
    platform.gameManager.handleAction(room, first, { type: 'move', payload: { direction: 'right' } });
    expect(firstRunner.finished).toBe(true);

    state().phase = 'finished';
    const draft = mazeRaceGame.getResult(state(), context());
    expect(draft.winners).toEqual([first]);
    expect(draft.rankings[0]!.playerId).toBe(first);
    expect(draft.rankings[1]!.playerId).toBe(second);
    expect(draft.rankings[1]!.score).toBe(0);
    expect(draft.rankings[1]!.stats.distanceLeft).toBeGreaterThanOrEqual(0);
    expect(finisherScore(state(), second)).toBe(0);
    expect(finisherScore(state(), first)).toBeGreaterThan(0);
  });

  /* ---------------------------------------------------------------- */
  /* Timeout                                                           */
  /* ---------------------------------------------------------------- */

  it('finishes with reason timeout when the clock expires', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    finishMazeOnTimeout(state(), context());
    expect(state().phase).toBe('finished');
    expect(state().finishReason).toBe('timeout');
    expect(mazeRaceGame.isGameFinished(state())).toBe(true);
  });

  /* ---------------------------------------------------------------- */
  /* Reset / rematch                                                   */
  /* ---------------------------------------------------------------- */

  it('reset keeps every seat and clears the race', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const seats = Object.keys(state().runners);
    state().finishOrder.push(seats[0]!);
    state().phase = 'finished';

    const next = mazeRaceGame.reset(state());
    expect(Object.keys(next.runners)).toEqual(seats);
    expect(next.finishOrder).toEqual([]);
    expect(next.phase).toBe('idle');
    expect(next.walls.every((wall) => wall)).toBe(true);
    for (const runner of Object.values(next.runners)) {
      expect(runner.steps).toBe(0);
      expect(runner.finished).toBe(false);
      expect(runner.finishMs).toBeNull();
    }
  });

  /* ---------------------------------------------------------------- */
  /* AI                                                                */
  /* ---------------------------------------------------------------- */

  it('AI moves are always legal; hard AI follows the shortest path', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;

    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      for (let attempt = 0; attempt < 15; attempt += 1) {
        const move = mazeRaceGame.getAIMove?.(playerId, difficulty, state(), context());
        expect(move?.type).toBe('move');
        const direction = move?.payload?.direction as MazeDirection;
        expect(['up', 'down', 'left', 'right']).toContain(direction);
        const runner = state().runners[playerId]!;
        const delta = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[direction]!;
        const nx = runner.x + delta[0]!;
        const ny = runner.y + delta[1]!;
        expect(state().walls[ny * state().cols + nx]).toBe(false);
      }
    }

    // Hard AI always decreases the distance to the goal.
    const distances = distancesToGoal(state().cols, state().rows, state().walls, state().goal);
    const runner = state().runners[playerId]!;
    const before = distances[runner.y * state().cols + runner.x]!;
    const move = mazeRaceGame.getAIMove?.(playerId, 'hard', state(), context());
    const delta = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[
      move?.payload?.direction as MazeDirection
    ]!;
    const after = distances[(runner.y + delta[1]!) * state().cols + (runner.x + delta[0]!)]!;
    expect(after).toBe(before - 1);

    runner.finished = true;
    expect(mazeRaceGame.getAIMove?.(playerId, 'hard', state(), context())).toBeNull();
  });

  /* ---------------------------------------------------------------- */
  /* Public state                                                      */
  /* ---------------------------------------------------------------- */

  it('exposes the playable maze but never the generation seed', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const view = publicState(players[0]!.id);
    expect(view.phase).toBe('playing');
    expect(view.walls).toHaveLength(121);
    expect(view.goal).toEqual({ x: 9, y: 9 });
    expect(Object.keys(view.runners)).toHaveLength(2);
    const serialised = JSON.stringify(view);
    expect(serialised).not.toContain('"seed"');
    expect(state().seed).not.toBe(0);
  });

  /* ---------------------------------------------------------------- */
  /* Disconnect / leave                                                */
  /* ---------------------------------------------------------------- */

  it('keeps a disconnected runner in the race and retires a leaver', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;

    mazeRaceGame.playerLeft(playerId, state(), context(), 'disconnect');
    expect(state().runners[playerId]!.disconnected).toBe(true);
    expect(state().runners[playerId]!.left).toBe(false);
    expect(state().phase).toBe('playing');

    mazeRaceGame.playerLeft(playerId, state(), context(), 'leave');
    expect(state().runners[playerId]!.left).toBe(true);
    // The other runner is still racing, so the match continues.
    expect(state().phase).toBe('playing');

    const other = players[1]!.id;
    state().runners[other]!.finished = true;
    mazeRaceGame.playerLeft(other, state(), context(), 'leave');
    expect(state().phase).toBe('finished');
    expect(state().finishReason).toBe('completed');
  });
});
