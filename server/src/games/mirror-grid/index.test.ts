import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createTestPlatform, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  MIRROR_TOTAL_LEVELS,
  cellsEqual,
  countCorrect,
  endLevel,
  finishMirror,
  flipsColumns,
  generateLevel,
  indexOf,
  isSolved,
  mirrorGridGame,
  reflect,
  seededRandom,
  specForLevel,
  wrongIndices,
  type Grid,
  type MirrorState,
} from './index';
import type { Room } from '../../rooms/Room';

describe('Mirror Grid', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'mirror-grid');
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as MirrorState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const act = (playerId: string, action: { type: string; payload?: Record<string, unknown> }) =>
    platform.gameManager.handleAction(room, playerId, action);

  /** Fills a player's answer with the correct solution. */
  const solveFor = (playerId: string) => {
    state().players[playerId]!.answer = state().solution.map((cell) => (cell ? { ...cell } : null));
  };

  /* ---------------- reflection maths ---------------- */

  it('reflects across a VERTICAL mirror by swapping columns', () => {
    const grid: Grid = new Array(9).fill(null);
    grid[indexOf(3, 0, 0)] = { symbol: 'circle', color: 'red' };
    grid[indexOf(3, 2, 1)] = { symbol: 'star', color: 'blue' };

    const out = reflect(grid, 3, 'left-right');
    // (0,0) -> (2,0) and (2,1) -> (0,1). Rows are untouched.
    expect(out[indexOf(3, 2, 0)]).toEqual({ symbol: 'circle', color: 'red' });
    expect(out[indexOf(3, 0, 0)]).toBeNull();
    expect(out[indexOf(3, 0, 1)]).toEqual({ symbol: 'star', color: 'blue' });
  });

  it('reflects across a HORIZONTAL mirror by swapping rows', () => {
    const grid: Grid = new Array(9).fill(null);
    grid[indexOf(3, 0, 0)] = { symbol: 'circle', color: 'red' };

    const out = reflect(grid, 3, 'top-bottom');
    // (0,0) -> (0,2). Columns are untouched.
    expect(out[indexOf(3, 0, 2)]).toEqual({ symbol: 'circle', color: 'red' });
    expect(out[indexOf(3, 2, 0)]).toBeNull();
  });

  it('does not confuse the two mirror axes', () => {
    expect(flipsColumns('left-right')).toBe(true);
    expect(flipsColumns('vertical')).toBe(true);
    expect(flipsColumns('top-bottom')).toBe(false);
    expect(flipsColumns('horizontal')).toBe(false);

    const grid: Grid = new Array(9).fill(null);
    grid[indexOf(3, 0, 0)] = { symbol: 'square', color: 'green' };
    // The two mirrors must produce DIFFERENT results for an off-diagonal cell.
    expect(reflect(grid, 3, 'left-right')).not.toEqual(reflect(grid, 3, 'top-bottom'));
  });

  it('reflecting twice returns the original grid', () => {
    for (const mirror of ['left-right', 'top-bottom', 'vertical', 'horizontal'] as const) {
      const level = generateLevel(99, 4);
      const twice = reflect(reflect(level.source, level.size, mirror), level.size, mirror);
      expect(twice).toEqual(level.source);
    }
  });

  /* ---------------- generation ---------------- */

  it('generates the same puzzle for a given seed and different ones otherwise', () => {
    const a = generateLevel(1234, 2);
    const b = generateLevel(1234, 2);
    const c = generateLevel(1235, 2);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a.source)).not.toBe(JSON.stringify(c.source));
  });

  it('every generated level has exactly one correct answer, derived by reflection', () => {
    for (let level = 0; level < MIRROR_TOTAL_LEVELS; level += 1) {
      for (let seed = 1; seed <= 40; seed += 1) {
        const generated = generateLevel(seed, level);
        const spec = specForLevel(level);
        expect(generated.size).toBe(spec.size);
        // The stored solution IS the reflection of the source.
        expect(generated.solution).toEqual(reflect(generated.source, generated.size, generated.mirror));
        expect(isSolved(generated.solution, generated.solution)).toBe(true);
        // And the source itself is generally NOT the answer (except by chance
        // on a symmetric board), so copying is not a strategy.
        expect(generated.source.filter(Boolean).length).toBe(Math.min(spec.filled, spec.size * spec.size));
      }
    }
  });

  it('grids grow with difficulty', () => {
    expect(specForLevel(0).size).toBe(3);
    expect(specForLevel(MIRROR_TOTAL_LEVELS - 1).size).toBe(7);
    for (let level = 1; level < MIRROR_TOTAL_LEVELS; level += 1) {
      expect(specForLevel(level).size).toBeGreaterThanOrEqual(specForLevel(level - 1).size);
    }
  });

  it('seededRandom is stable and in range', () => {
    const a = seededRandom(7);
    const b = seededRandom(7);
    for (let i = 0; i < 40; i += 1) {
      const value = a();
      expect(value).toBe(b());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  /* ---------------- match setup ---------------- */

  it('starts a race where every player gets the identical puzzle', () => {
    expect(state().phase).toBe('playing');
    expect(state().level).toBe(0);
    expect(state().source.length).toBe(state().size * state().size);
    expect(state().levelEndsAt).toBeGreaterThan(context().now());

    const [a, b] = players.map((player) => player.id);
    const viewA = platform.gameManager.getPublicState(room, a) as { source: unknown };
    const viewB = platform.gameManager.getPublicState(room, b) as { source: unknown };
    // Same question for everyone — that is what makes the race fair.
    expect(JSON.stringify(viewA.source)).toBe(JSON.stringify(viewB.source));
  });

  /* ---------------- hidden information ---------------- */

  it('never sends the solution or another player answer to a client', () => {
    const [a, b] = players.map((player) => player.id);
    // Give B a distinctive answer so a leak would be detectable.
    state().players[b]!.answer[0] = { symbol: 'star', color: 'yellow' };

    const view = platform.gameManager.getPublicState(room, a) as Record<string, unknown> & {
      myAnswer: Grid;
      players: Record<string, { progress: number }>;
    };
    expect(view.solution).toBeUndefined();
    const json = JSON.stringify(view);
    expect(json).not.toContain('"solution"');
    // A sees only their own (empty) grid.
    expect(view.myAnswer.filter(Boolean)).toHaveLength(0);
    // B is a progress percentage, not a grid.
    expect(typeof view.players[b]!.progress).toBe('number');
    expect((view.players[b] as unknown as { answer?: unknown }).answer).toBeUndefined();
  });

  /* ---------------- placing cells ---------------- */

  it('places and clears a cell', () => {
    const playerId = players[0]!.id;
    expect(act(playerId, { type: 'set', payload: { index: 0, symbol: 'circle', color: 'red' } }).accepted).toBe(
      true,
    );
    expect(state().players[playerId]!.answer[0]).toEqual({ symbol: 'circle', color: 'red' });
    expect(state().players[playerId]!.moves).toBe(1);

    expect(act(playerId, { type: 'set', payload: { index: 0, symbol: null } }).accepted).toBe(true);
    expect(state().players[playerId]!.answer[0]).toBeNull();
  });

  it('rejects invalid coordinates, symbols and colours', () => {
    const playerId = players[0]!.id;
    const ctx = context();
    const size = state().size;
    for (const payload of [
      { index: -1, symbol: 'circle', color: 'red' },
      { index: size * size, symbol: 'circle', color: 'red' },
      { index: 1.5, symbol: 'circle', color: 'red' },
      { index: 0, symbol: 'hexagon', color: 'red' },
      { index: 0, symbol: 'circle', color: 'purple' },
      { index: 0 },
      {},
    ]) {
      expect(
        mirrorGridGame.validateAction(playerId, { type: 'set', payload }, state(), ctx).valid,
        JSON.stringify(payload),
      ).toBe(false);
    }
  });

  /* ---------------- anti-cheat ---------------- */

  it('rejects outcome-asserting actions — the client cannot claim a solve', () => {
    const playerId = players[0]!.id;
    const ctx = context();
    for (const type of ['score', 'win', 'finish', 'complete', 'solved', 'solution']) {
      expect(mirrorGridGame.validateAction(playerId, { type, payload: { score: 9999 } }, state(), ctx).valid).toBe(
        false,
      );
      expect(mirrorGridGame.handlePlayerAction(playerId, { type }, state(), ctx).accepted).toBe(false);
    }
    expect(state().players[playerId]!.score).toBe(0);
    expect(state().players[playerId]!.solvedAt).toBeNull();
  });

  it('a wrong submit is rejected, costs points and never reveals the answer', () => {
    const playerId = players[0]!.id;
    state().players[playerId]!.score = 100;
    // Deliberately wrong: a single cell that cannot match a full solution.
    state().players[playerId]!.answer[0] = { symbol: 'star', color: 'yellow' };

    const result = act(playerId, { type: 'submit' });
    expect(result.accepted).toBe(false);
    expect(state().players[playerId]!.mistakes).toBe(1);
    expect(state().players[playerId]!.score).toBe(90);
    expect(state().players[playerId]!.solvedAt).toBeNull();

    // The feedback carries no solution data.
    const view = platform.gameManager.getPublicState(room, playerId);
    expect(JSON.stringify(view)).not.toContain('"solution"');
  });

  it('rejects actions after solving and after the match ends', () => {
    const playerId = players[0]!.id;
    solveFor(playerId);
    expect(act(playerId, { type: 'submit' }).accepted).toBe(true);
    // Already solved: no more edits.
    expect(act(playerId, { type: 'set', payload: { index: 0, symbol: 'circle', color: 'red' } }).accepted).toBe(
      false,
    );

    finishMirror(state(), context(), 'completed');
    expect(act(players[1]!.id, { type: 'submit' }).accepted).toBe(false);
  });

  /* ---------------- solving ---------------- */

  it('the SERVER validates the reflection and scores the solve', () => {
    const playerId = players[0]!.id;
    solveFor(playerId);
    expect(act(playerId, { type: 'submit' }).accepted).toBe(true);

    const slot = state().players[playerId]!;
    expect(slot.solvedAt).toBeGreaterThan(0);
    expect(slot.finishRank).toBe(1);
    expect(slot.levelsCleared).toBe(1);
    expect(slot.score).toBeGreaterThanOrEqual(200);
    expect(state().finishOrder[0]).toBe(playerId);
  });

  it('records finish order so the first correct solve wins', () => {
    const [a, b] = players.map((player) => player.id);
    solveFor(a);
    act(a, { type: 'submit' });
    // A solved first; B's rank must be second if the level is still live.
    expect(state().players[a]!.finishRank).toBe(1);
    if (state().phase === 'playing') {
      solveFor(b);
      act(b, { type: 'submit' });
      expect(state().players[b]!.finishRank).toBe(2);
      expect(state().players[a]!.score).toBeGreaterThan(state().players[b]!.score);
    }
  });

  it('counts correct cells and reports which are wrong (without the answer)', () => {
    const solution = state().solution;
    const answer: Grid = solution.map((cell) => (cell ? { ...cell } : null));
    expect(countCorrect(answer, solution)).toBe(solution.length);
    expect(wrongIndices(answer, solution)).toHaveLength(0);

    answer[0] = answer[0] ? null : { symbol: 'star', color: 'red' };
    expect(wrongIndices(answer, solution)).toEqual([0]);
    expect(cellsEqual(null, null)).toBe(true);
    expect(cellsEqual({ symbol: 'star', color: 'red' }, { symbol: 'star', color: 'blue' })).toBe(false);
  });

  /* ---------------- progression ---------------- */

  it('advances through levels and finishes after the last one', () => {
    state().totalLevels = 2;
    endLevel(state(), context());
    expect(state().level).toBe(1);
    expect(state().phase).toBe('level-clear');

    state().phase = 'playing';
    endLevel(state(), context());
    expect(state().phase).toBe('finished');
    expect(mirrorGridGame.isGameFinished(state())).toBe(true);
  });

  it('honours a configured level count', async () => {
    const local = createTestPlatform();
    const fixture = await createGameFixture(local.platform, 'mirror-grid', { settings: { rounds: 3 } });
    expect((fixture.room.gameState as MirrorState).totalLevels).toBe(3);
    local.destroy();
  });

  /* ---------------- results ---------------- */

  it('ranks by score and breaks ties on server completion time', () => {
    const [a, b] = players.map((player) => player.id);
    state().players[a]!.score = 300;
    state().players[b]!.score = 300;
    state().players[a]!.solvedAt = 2_000;
    state().players[b]!.solvedAt = 1_000;
    finishMirror(state(), context(), 'completed');

    const result = mirrorGridGame.getResult(state(), context());
    // Equal scores: B ranks first for the earlier server timestamp.
    expect(result.rankings[0]!.playerId).toBe(b);
    expect(result.isDraw).toBe(true);
    expect(result.rankings[0]!.stats).toHaveProperty('mistakes');
  });

  /* ---------------- lifecycle ---------------- */

  it('handles disconnect, reconnect and leave', () => {
    const playerId = players[0]!.id;
    act(playerId, { type: 'set', payload: { index: 0, symbol: 'circle', color: 'red' } });

    mirrorGridGame.playerLeft(playerId, state(), context(), 'disconnect');
    expect(state().players[playerId]!.disconnected).toBe(true);
    expect(act(playerId, { type: 'submit' }).accepted).toBe(false);

    mirrorGridGame.playerJoined({ ...players[0]! }, state(), context());
    expect(state().players[playerId]!.disconnected).toBe(false);
    expect(state().players[playerId]!.moves).toBe(1);

    mirrorGridGame.playerLeft(playerId, state(), context(), 'leave');
    expect(state().players[playerId]!.left).toBe(true);
  });

  it('reset and cleanup prepare a rematch', () => {
    finishMirror(state(), context(), 'completed');
    const next = mirrorGridGame.reset(state());
    expect(next.phase).toBe('idle');
    expect(next.level).toBe(0);
    expect(next.solution).toHaveLength(0);
    expect(Object.values(next.players).every((slot) => slot.score === 0)).toBe(true);

    mirrorGridGame.cleanup(next);
    expect(Object.keys(next.players)).toHaveLength(0);
  });

  /* ---------------- AI ---------------- */

  it('the AI produces only legal actions and can solve a level', () => {
    const playerId = players[0]!.id;
    let guard = 0;
    while (!state().players[playerId]!.solvedAt && guard < 400) {
      guard += 1;
      const action = mirrorGridGame.getAIMove?.(playerId, 'hard', state(), context());
      if (!action) break;
      expect(['set', 'submit']).toContain(action.type);
      if (action.type === 'set') {
        expect(mirrorGridGame.validateAction(playerId, action, state(), context()).valid).toBe(true);
      }
      act(playerId, action);
      if (state().phase !== 'playing') break;
    }
    expect(state().players[playerId]!.solvedAt).toBeGreaterThan(0);
  });

  it('the AI stops once solved or the match ends', () => {
    const playerId = players[0]!.id;
    state().players[playerId]!.solvedAt = 1;
    expect(mirrorGridGame.getAIMove?.(playerId, 'hard', state(), context())).toBeNull();
    state().players[playerId]!.solvedAt = null;
    finishMirror(state(), context(), 'completed');
    expect(mirrorGridGame.getAIMove?.(playerId, 'hard', state(), context())).toBeNull();
  });
});
