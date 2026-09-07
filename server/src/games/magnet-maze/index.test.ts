import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createTestPlatform, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  finishMagnet,
  generateMagnetMaze,
  MAGNET_COLS,
  MAGNET_ROWS,
  magnetFinishCell,
  magnetMazeGame,
  magnetScore,
  tryStep,
  type MagnetState,
  type MagnetTile,
} from './index';
import type { Room } from '../../rooms/Room';

function tileIndex(x: number, y: number, cols = MAGNET_COLS): number {
  return y * cols + x;
}

describe('Magnet Maze', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'magnet-maze');
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as MagnetState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const publicState = (viewerId?: string) =>
    platform.gameManager.getPublicState(room, viewerId) as {
      phase: string;
      tiles: MagnetTile[];
      runners: Record<string, { x: number; y: number; crystals: number; finished: boolean }>;
      finishCell: { x: number; y: number };
    };

  it('generates a deterministic maze with a finish cell', () => {
    const a = generateMagnetMaze(42);
    const b = generateMagnetMaze(42);
    const c = generateMagnetMaze(43);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    const finish = magnetFinishCell();
    expect(a[tileIndex(finish.x, finish.y)]).toBe('finish');
    expect(a).toHaveLength(MAGNET_COLS * MAGNET_ROWS);
  });

  it('starts playing with distinct starts and a live clock', () => {
    expect(state().phase).toBe('playing');
    expect(state().tiles).toHaveLength(MAGNET_COLS * MAGNET_ROWS);
    const keys = new Set(Object.values(state().runners).map((runner) => `${runner.x},${runner.y}`));
    expect(keys.size).toBe(2);
    expect(state().endsAt).toBe(state().startedAt! + state().durationMs);
    expect(publicState(players[0]!.id).finishCell).toEqual(state().finishCell);
  });

  it('accepts a legal step and rejects walls, unknown actions and a client-declared finish', () => {
    const playerId = players[0]!.id;
    const runner = state().runners[playerId]!;
    const legal = (['up', 'down', 'left', 'right'] as const).find((direction) => {
      const delta = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[direction];
      const tile = state().tiles[tileIndex(runner.x + delta[0]!, runner.y + delta[1]!)];
      return tile && tile !== 'wall';
    });
    expect(legal).toBeTruthy();
    const moved = platform.gameManager.handleAction(room, playerId, { type: 'move', payload: { direction: legal } });
    expect(moved.accepted).toBe(true);

    expect(magnetMazeGame.validateAction(playerId, { type: 'finish' }, state(), context()).valid).toBe(false);
    expect(magnetMazeGame.handlePlayerAction(playerId, { type: 'finish' }, state(), context()).accepted).toBe(false);
    expect(magnetMazeGame.validateAction(playerId, { type: 'teleport' }, state(), context()).valid).toBe(false);
    expect(
      magnetMazeGame.validateAction(playerId, { type: 'move', payload: { direction: 'north' } }, state(), context()).valid,
    ).toBe(false);
  });

  it('flips polarity and collects a crystal only once', () => {
    const playerId = players[0]!.id;
    const runner = state().runners[playerId]!;
    const flipped = platform.gameManager.handleAction(room, playerId, { type: 'flip' });
    expect(flipped.accepted).toBe(true);
    expect(runner.polarity).toBe('south');

    const nx = runner.x + 1;
    const ny = runner.y;
    state().tiles[tileIndex(nx, ny)] = 'crystal';
    const result = tryStep(state(), playerId, 'right', context().now());
    expect(result.ok).toBe(true);
    expect(runner.crystals).toBe(1);
    expect(state().collected).toContain(`${nx},${ny}`);
    runner.x = nx - 1;
    runner.y = ny;
    state().tiles[tileIndex(nx, ny)] = 'crystal';
    tryStep(state(), playerId, 'right', context().now());
    expect(runner.crystals).toBe(1);
  });

  it('stuns on spikes and rejects movement while frozen', () => {
    const playerId = players[0]!.id;
    const runner = state().runners[playerId]!;
    const nx = runner.x + 1;
    const ny = runner.y;
    state().tiles[tileIndex(nx, ny)] = 'spike';
    const now = context().now();
    expect(tryStep(state(), playerId, 'right', now).ok).toBe(true);
    expect(runner.frozenUntil).toBeGreaterThan(now);
    expect(magnetMazeGame.validateAction(playerId, { type: 'move', payload: { direction: 'left' } }, state(), context()).valid).toBe(
      false,
    );
  });

  it('only the server marks a finish — occupying the finish cell ranks first', () => {
    const [first, second] = players.map((player) => player.id);
    const finish = state().finishCell;
    const west = tileIndex(finish.x - 1, finish.y);
    state().tiles[west] = 'floor';
    const runner = state().runners[first]!;
    runner.x = finish.x - 1;
    runner.y = finish.y;
    runner.frozenUntil = 0;
    const stepped = tryStep(state(), first, 'right', context().now());
    expect(stepped.ok).toBe(true);
    expect(runner.finishedAt).not.toBeNull();
    expect(magnetScore(runner)).toBeGreaterThan(0);

    finishMagnet(state(), context(), 'completed');
    const draft = magnetMazeGame.getResult(state(), context());
    expect(draft.winners).toEqual([first]);
    expect(draft.rankings[0]!.playerId).toBe(first);
    expect(draft.rankings.map((entry) => entry.playerId)).toContain(second);
  });

  it('timeout ranks unfinished runners by crystals then distance; equal ranks draw', () => {
    const [a, b] = players.map((player) => player.id);
    state().runners[a]!.crystals = 2;
    state().runners[b]!.crystals = 2;
    state().runners[a]!.x = state().finishCell.x;
    state().runners[a]!.y = state().finishCell.y;
    state().runners[b]!.x = state().finishCell.x;
    state().runners[b]!.y = state().finishCell.y;
    finishMagnet(state(), context(), 'timeout');
    expect(state().finishReason).toBe('timeout');
    const draft = magnetMazeGame.getResult(state(), context());
    expect(draft.isDraw).toBe(true);
  });

  it('reset keeps seats and cleanup empties runners', () => {
    const seats = Object.keys(state().runners);
    state().runners[seats[0]!]!.crystals = 4;
    const next = magnetMazeGame.reset(state());
    expect(Object.keys(next.runners)).toEqual(seats);
    expect(next.phase).toBe('idle');
    expect(next.runners[seats[0]!]!.crystals).toBe(0);
    magnetMazeGame.cleanup(next);
    expect(Object.keys(next.runners)).toHaveLength(0);
  });

  it('disconnect, reconnect and leave', () => {
    const [first, second] = players.map((player) => player.id);
    magnetMazeGame.playerLeft(first, state(), context(), 'disconnect');
    expect(state().runners[first]!.disconnected).toBe(true);
    magnetMazeGame.playerJoined({ ...players[0]!, id: first }, state(), context());
    expect(state().runners[first]!.disconnected).toBe(false);
    magnetMazeGame.playerLeft(first, state(), context(), 'leave');
    magnetMazeGame.playerLeft(second, state(), context(), 'leave');
    expect(state().phase).toBe('finished');
  });

  it('AI returns a legal move or flip', () => {
    const move = magnetMazeGame.getAIMove?.(players[0]!.id, 'hard', state(), context());
    expect(move?.type === 'move' || move?.type === 'flip').toBe(true);
  });
});
