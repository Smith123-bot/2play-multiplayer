import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createPlayer, createTestPlatform, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  canWalk,
  ECHO_LAYOUTS,
  echoMazeGame,
  finishEcho,
  generateEchoMaze,
  openEchoRound,
  SCORE_CHECKPOINT,
  SCORE_FINISH,
  type EchoState,
} from './index';
import type { Room } from '../../rooms/Room';

describe('Echo Maze', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'echo-maze', { settings: { rounds: 2 } });
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as EchoState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const publicState = (viewerId?: string) =>
    platform.gameManager.getPublicState(room, viewerId) as {
      phase: string;
      tiles: string[];
      runners: Record<string, { x: number; y: number; score: number; trail: Array<{ x: number; y: number }> }>;
    };

  async function startWithPlayers(count: 3 | 4): Promise<void> {
    const local = createTestPlatform();
    const ids = [];
    for (let i = 0; i < count; i += 1) ids.push(await createPlayer(local.platform, `Em${count}${i}`));
    const extra = local.platform.roomManager.createRoom({
      gameId: 'echo-maze',
      maxPlayers: count,
      isPrivate: false,
      host: ids[0]!,
    });
    for (let i = 1; i < count; i += 1) local.platform.roomManager.joinRoom({ roomId: extra.id, player: ids[i]! });
    extra.status = 'PLAYING';
    extra.gameStartedAt = Date.now();
    local.platform.gameManager.createState(extra);
    local.platform.gameManager.start(extra);
    harness.destroy();
    harness = local;
    platform = local.platform;
    room = extra;
    players = platform.gameManager.playerViews(room);
  }

  it('ships ten seeded layouts with a floor goal and two checkpoints', () => {
    const ids = new Set<number>();
    for (let seed = 0; seed < ECHO_LAYOUTS; seed += 1) {
      const maze = generateEchoMaze(seed);
      expect(maze.layoutId).toBe(seed);
      expect(maze.walls).toHaveLength(121);
      expect(maze.walls[maze.goal.y * 11 + maze.goal.x]).toBe(false);
      expect(maze.checkpoints.length).toBeGreaterThan(0);
      ids.add(maze.layoutId);
    }
    expect(ids.size).toBe(10);
    expect(generateEchoMaze(0).walls).not.toEqual(generateEchoMaze(1).walls);
  });

  it('starts in preview then hides fog walls after the maze opens', () => {
    expect(state().phase).toBe('preview');
    expect(state().totalRounds).toBe(2);
    expect(Object.keys(state().runners)).toHaveLength(2);
    const preview = publicState(players[0]!.id);
    expect(preview.tiles.includes('fog')).toBe(false);
    expect(preview.tiles.includes('wall')).toBe(true);
    openEchoRound(state(), context());
    expect(state().phase).toBe('playing');
    expect(state().endsAt).toBeGreaterThan(context().now());
    const playing = publicState(players[0]!.id);
    expect(playing.tiles.includes('fog')).toBe(true);
  });

  it('accepts a legal step, records an echo trail, and rejects walls / client-owned results', () => {
    openEchoRound(state(), context());
    const playerId = players[0]!.id;
    const runner = state().runners[playerId]!;
    const legal = (['up', 'down', 'left', 'right'] as const).find((direction) => {
      const delta = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[direction];
      return canWalk(state(), runner.x + delta[0], runner.y + delta[1]);
    });
    expect(legal).toBeTruthy();
    const moved = platform.gameManager.handleAction(room, playerId, { type: 'move', payload: { direction: legal } });
    expect(moved.accepted).toBe(true);
    expect(runner.trail.length).toBeGreaterThan(1);

    expect(echoMazeGame.validateAction(playerId, { type: 'finish' }, state(), context()).valid).toBe(false);
    expect(echoMazeGame.validateAction(playerId, { type: 'path', payload: { cells: [] } }, state(), context()).valid).toBe(false);
    expect(echoMazeGame.validateAction(playerId, { type: 'score', payload: { score: 999 } }, state(), context()).valid).toBe(false);
    expect(echoMazeGame.handlePlayerAction(playerId, { type: 'finish' }, state(), context()).accepted).toBe(false);
  });

  it('awards a checkpoint once and a finish with leftover-time bonus', () => {
    openEchoRound(state(), context());
    const playerId = players[0]!.id;
    const runner = state().runners[playerId]!;
    const check = state().checkpoints[0];
    if (check) {
      const right = check.x + 1 < state().cols && canWalk(state(), check.x + 1, check.y);
      runner.x = right ? check.x + 1 : check.x - 1;
      runner.y = check.y;
      state().walls[check.y * state().cols + check.x] = false;
      const direction = right ? 'left' : 'right';
      expect(platform.gameManager.handleAction(room, playerId, { type: 'move', payload: { direction } }).accepted).toBe(true);
      expect(runner.checkpoints).toBe(1);
      expect(runner.score).toBe(SCORE_CHECKPOINT);
    }
    const goal = state().goal;
    runner.x = goal.x - 1;
    runner.y = goal.y;
    state().walls[goal.y * state().cols + goal.x] = false;
    state().walls[goal.y * state().cols + goal.x - 1] = false;
    expect(platform.gameManager.handleAction(room, playerId, { type: 'move', payload: { direction: 'right' } }).accepted).toBe(true);
    expect(runner.finished).toBe(true);
    expect(runner.score).toBeGreaterThanOrEqual(SCORE_FINISH);
  });

  it('timeout ranks by score; reset keeps seats; cleanup empties runners', () => {
    const seats = Object.keys(state().runners);
    state().runners[seats[0]!]!.score = 40;
    finishEcho(state(), context(), 'timeout');
    expect(state().finishReason).toBe('timeout');
    const next = echoMazeGame.reset(state());
    expect(Object.keys(next.runners)).toEqual(seats);
    expect(next.phase).toBe('idle');
    expect(next.runners[seats[0]!]!.score).toBe(0);
    echoMazeGame.cleanup(next);
    expect(Object.keys(next.runners)).toHaveLength(0);
  });

  it('disconnect, reconnect and leave', () => {
    const [first, second] = players.map((player) => player.id);
    echoMazeGame.playerLeft(first, state(), context(), 'disconnect');
    expect(state().runners[first]!.disconnected).toBe(true);
    echoMazeGame.playerJoined({ ...players[0]!, id: first }, state(), context());
    expect(state().runners[first]!.disconnected).toBe(false);
    echoMazeGame.playerLeft(first, state(), context(), 'leave');
    echoMazeGame.playerLeft(second, state(), context(), 'leave');
    expect(state().phase).toBe('finished');
  });

  it('AI returns a legal one-cell move once the maze is playing', () => {
    openEchoRound(state(), context());
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const move = echoMazeGame.getAIMove?.(players[0]!.id, difficulty, state(), context());
      expect(move?.type).toBe('move');
      expect(echoMazeGame.validateAction(players[0]!.id, move!, state(), context()).valid).toBe(true);
    }
  });

  it('initialises 3 and 4 player matches with distinct starts', async () => {
    for (const count of [3, 4] as const) {
      await startWithPlayers(count);
      expect(Object.keys(state().runners)).toHaveLength(count);
      const keys = new Set(Object.values(state().runners).map((runner) => `${runner.x},${runner.y}`));
      expect(keys.size).toBe(count);
    }
  });
});
