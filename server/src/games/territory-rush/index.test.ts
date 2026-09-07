import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createTestPlatform, waitFor, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  captureEnclosed,
  cellIndex,
  countCells,
  encodeGrid,
  finishTerritory,
  isRushDirection,
  paintHome,
  RUSH_COLS,
  RUSH_ROWS,
  stepTerritory,
  territoryRushGame,
  type TerritoryRushState,
} from './index';
import type { Room } from '../../rooms/Room';

describe('Territory Rush', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'territory-rush');
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as TerritoryRushState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const publicState = (viewerId?: string) =>
    platform.gameManager.getPublicState(room, viewerId) as {
      phase: string;
      grid: string;
      cols: number;
      rows: number;
      runners: Record<string, { x: number; y: number; owner: number; cells: number; trail: unknown[] }>;
    };

  it('starts each player with a home territory on a bounded grid', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    expect(state().cols).toBe(RUSH_COLS);
    expect(state().rows).toBe(RUSH_ROWS);
    expect(state().grid).toHaveLength(RUSH_COLS * RUSH_ROWS);
    for (const player of players) {
      const runner = state().runners[player.id]!;
      expect(runner.home.length).toBeGreaterThan(0);
      expect(countCells(state().grid, runner.owner)).toBe(runner.home.length);
    }
    const view = publicState(players[0]!.id);
    expect(view.grid).toHaveLength(RUSH_COLS * RUSH_ROWS);
    expect(view.runners[players[0]!.id]?.cells).toBeGreaterThan(0);
  });

  it('paints a compact home and encodes the grid', () => {
    const grid = new Array<number>(16).fill(0);
    const home = paintHome(grid, 4, 4, 1, 1, 1);
    expect(home.length).toBe(9);
    expect(encodeGrid(grid).includes('1')).toBe(true);
    expect(isRushDirection('left')).toBe(true);
    expect(isRushDirection('north')).toBe(false);
  });

  it('rejects reverse, unknown actions and post-finish turns', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    const runner = state().runners[playerId]!;
    runner.direction = 'right';
    runner.pending = null;
    expect(
      territoryRushGame.validateAction(playerId, { type: 'turn', payload: { direction: 'left' } }, state(), context())
        .valid,
    ).toBe(false);
    expect(territoryRushGame.validateAction(playerId, { type: 'dash' }, state(), context()).valid).toBe(false);
    state().phase = 'finished';
    expect(
      territoryRushGame.validateAction(playerId, { type: 'turn', payload: { direction: 'up' } }, state(), context())
        .valid,
    ).toBe(false);
  });

  it('queues a turn without trusting a client position', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    const before = { x: state().runners[playerId]!.x, y: state().runners[playerId]!.y };
    const result = platform.gameManager.handleAction(room, playerId, {
      type: 'turn',
      payload: { direction: 'down' },
    });
    expect(result.accepted).toBe(true);
    expect(state().runners[playerId]!.pending).toBe('down');
    expect(state().runners[playerId]!.x).toBe(before.x);
    expect(state().runners[playerId]!.y).toBe(before.y);
  });

  it('does not leave the map when walking into a wall', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const runner = state().runners[players[0]!.id]!;
    runner.x = 0;
    runner.y = 5;
    runner.direction = 'left';
    runner.pending = null;
    runner.frozenUntil = 0;
    stepTerritory(state(), context());
    expect(runner.x).toBe(0);
  });

  it('lays a trail when leaving home and captures an enclosed pocket', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const cols = 8;
    const rows = 6;
    const grid = new Array<number>(cols * rows).fill(0);
    const home = paintHome(grid, cols, rows, 1, 1, 1);
    const trail = [
      cellIndex(cols, 3, 1),
      cellIndex(cols, 3, 2),
      cellIndex(cols, 3, 3),
      cellIndex(cols, 2, 3),
      cellIndex(cols, 1, 3),
      cellIndex(cols, 1, 2),
    ];
    const gained = captureEnclosed(grid, cols, rows, 1, trail, new Set(home));
    expect(gained).toBeGreaterThan(0);
    expect(countCells(grid, 1)).toBeGreaterThan(home.length);
  });

  it('cuts a rival trail and sends them home', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const a = state().runners[players[0]!.id]!;
    const b = state().runners[players[1]!.id]!;
    a.x = 10;
    a.y = 10;
    a.direction = 'right';
    a.pending = null;
    a.frozenUntil = 0;
    a.trail = [];
    b.x = 12;
    b.y = 10;
    b.direction = 'left';
    b.pending = null;
    b.frozenUntil = 0;
    b.trail = [cellIndex(state().cols, 11, 10)];
    const mid = b.home[Math.floor(b.home.length / 2)] ?? b.home[0]!;
    const homeX = mid % state().cols;
    const homeY = (mid / state().cols) | 0;
    const outcome = stepTerritory(state(), context());
    expect(outcome.cuts.length + b.deaths).toBeGreaterThan(0);
    expect(b.x).toBe(homeX);
    expect(b.y).toBe(homeY);
  });

  it('timeout finishes and ranks by cell count', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const a = state().runners[players[0]!.id]!;
    state().grid = state().grid.map(() => 0);
    for (let i = 0; i < 40; i += 1) state().grid[i] = a.owner;
    finishTerritory(state(), context(), 'timeout');
    expect(state().phase).toBe('finished');
    const draft = territoryRushGame.getResult(state(), context());
    expect(draft.winners).toContain(players[0]!.id);
    expect(draft.rankings).toHaveLength(2);
  });

  it('reset keeps seats and zeroes captures', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const seats = Object.keys(state().runners);
    state().runners[seats[0]!]!.captures = 4;
    const next = territoryRushGame.reset(state());
    expect(Object.keys(next.runners)).toEqual(seats);
    expect(next.phase).toBe('idle');
    expect(next.runners[seats[0]!]!.captures).toBe(0);
  });

  it('AI sends a legal turn', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const move = territoryRushGame.getAIMove?.(players[0]!.id, 'hard', state(), context());
    expect(move?.type).toBe('turn');
    expect(isRushDirection(move?.payload?.direction)).toBe(true);
  });

  it('duplicate same-direction turns are idempotent', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    const dir = state().runners[playerId]!.direction;
    const first = platform.gameManager.handleAction(room, playerId, { type: 'turn', payload: { direction: dir } });
    const second = platform.gameManager.handleAction(room, playerId, { type: 'turn', payload: { direction: dir } });
    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(true);
  });
});
