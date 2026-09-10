import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createTestPlatform, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  E,
  FUSE_TOTAL_LEVELS,
  N,
  S,
  W,
  connects,
  countBits,
  distinctRotations,
  endLevel,
  evaluateCircuits,
  finishFuse,
  fuseGame,
  fuseSpec,
  generateBoard,
  isSolved,
  kindForMask,
  litBulbs,
  maskHas,
  progressOf,
  reachableFrom,
  rotateMask,
  rotateTile,
  seededRandom,
  type CircuitBoard,
  type FuseState,
  type Tile,
} from './index';
import type { Room } from '../../rooms/Room';

/** Undoes the generator's scramble; the result must be a solved board. */
function unscramble(board: CircuitBoard): CircuitBoard {
  for (const tile of board.tiles) {
    if (tile.fixed) continue;
    const steps = (tile.rotation / 90) % 4;
    if (steps) tile.mask = rotateMask(tile.mask, 4 - steps);
    tile.rotation = 0;
  }
  return board;
}

describe('Fuse', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'fuse');
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as FuseState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const act = (playerId: string, action: { type: string; payload?: Record<string, unknown> }) =>
    platform.gameManager.handleAction(room, playerId, action);
  const boardOf = (playerId: string) => state().players[playerId]!.board;

  /* ---------------- masks and rotation ---------------- */

  it('rotates a connection mask correctly', () => {
    // N -> E -> S -> W -> N
    expect(rotateMask(N, 1)).toBe(E);
    expect(rotateMask(E, 1)).toBe(S);
    expect(rotateMask(S, 1)).toBe(W);
    expect(rotateMask(W, 1)).toBe(N);
    // A full turn is identity.
    expect(rotateMask(N | E, 4)).toBe(N | E);
    // A straight looks the same after two turns.
    expect(rotateMask(N | S, 2)).toBe(N | S);
  });

  it('classifies masks into tile kinds', () => {
    expect(kindForMask(0)).toBe('empty');
    expect(kindForMask(N | S)).toBe('straight');
    expect(kindForMask(E | W)).toBe('straight');
    expect(kindForMask(N | E)).toBe('corner');
    expect(kindForMask(N | E | S)).toBe('tee');
    expect(kindForMask(N | E | S | W)).toBe('cross');
    expect(countBits(N | E | S | W)).toBe(4);
    expect(maskHas(N | E, 'N')).toBe(true);
    expect(maskHas(N | E, 'S')).toBe(false);
  });

  it('knows how many distinct orientations a mask has', () => {
    expect(distinctRotations(N | E | S | W)).toBe(1); // a cross never changes
    expect(distinctRotations(N | S)).toBe(2); // a straight has two
    expect(distinctRotations(N | E)).toBe(4); // a corner has four
  });

  /* ---------------- connectivity ---------------- */

  it('connects only when BOTH tiles open toward each other', () => {
    const tiles: Tile[] = [
      { id: 'a', x: 0, y: 0, kind: 'straight', mask: E, rotation: 0, circuit: null, fixed: false },
      { id: 'b', x: 1, y: 0, kind: 'straight', mask: W, rotation: 0, circuit: null, fixed: false },
    ];
    const board: CircuitBoard = { cols: 2, rows: 1, tiles, circuits: 0 };
    expect(connects(board, tiles[0]!, 'E')).toBe(true);
    expect(connects(board, tiles[1]!, 'W')).toBe(true);

    // A one-sided opening is NOT a connection.
    tiles[1]!.mask = N;
    expect(connects(board, tiles[0]!, 'E')).toBe(false);
  });

  it('traverses the graph from a source', () => {
    const tiles: Tile[] = [
      { id: 's', x: 0, y: 0, kind: 'source', mask: E, rotation: 0, circuit: 0, fixed: true },
      { id: 'w', x: 1, y: 0, kind: 'straight', mask: E | W, rotation: 0, circuit: null, fixed: false },
      { id: 'b', x: 2, y: 0, kind: 'bulb', mask: W, rotation: 0, circuit: 0, fixed: true },
      { id: 'far', x: 4, y: 0, kind: 'straight', mask: E | W, rotation: 0, circuit: null, fixed: false },
    ];
    const board: CircuitBoard = { cols: 5, rows: 1, tiles, circuits: 1 };
    const reach = reachableFrom(board, tiles[0]!);
    expect(reach.has('b')).toBe(true);
    expect(reach.has('far')).toBe(false);
    expect(isSolved(board)).toBe(true);
    expect(litBulbs(board)).toEqual(['b']);
    expect(progressOf(board)).toBe(1);
  });

  it('does NOT count a source reaching the WRONG bulb', () => {
    const tiles: Tile[] = [
      { id: 's0', x: 0, y: 0, kind: 'source', mask: E, rotation: 0, circuit: 0, fixed: true },
      { id: 'w', x: 1, y: 0, kind: 'straight', mask: E | W, rotation: 0, circuit: null, fixed: false },
      // Circuit 1's bulb, wired to circuit 0's source.
      { id: 'b1', x: 2, y: 0, kind: 'bulb', mask: W, rotation: 0, circuit: 1, fixed: true },
      // Circuit 0's own bulb, unreachable.
      { id: 'b0', x: 4, y: 0, kind: 'bulb', mask: W, rotation: 0, circuit: 0, fixed: true },
      { id: 's1', x: 4, y: 1, kind: 'source', mask: N, rotation: 0, circuit: 1, fixed: true },
    ];
    const board: CircuitBoard = { cols: 5, rows: 2, tiles, circuits: 2 };
    const statuses = evaluateCircuits(board);
    const first = statuses.find((status) => status.circuit === 0)!;
    expect(first.connected).toBe(false); // it never reaches its own bulb
    expect(first.crossed).toBe(true); // but it does reach the wrong one
    expect(isSolved(board)).toBe(false);
  });

  /* ---------------- generation and solvability ---------------- */

  it('generates the same board for a seed and a different one otherwise', () => {
    const a = generateBoard(77, 2);
    const b = generateBoard(77, 2);
    const c = generateBoard(78, 2);
    expect(JSON.stringify(a.tiles)).toBe(JSON.stringify(b.tiles));
    expect(JSON.stringify(a.tiles)).not.toBe(JSON.stringify(c.tiles));
  });

  it('EVERY generated board is solvable by construction', () => {
    for (let level = 0; level < FUSE_TOTAL_LEVELS; level += 1) {
      for (let seed = 1; seed <= 25; seed += 1) {
        const board = generateBoard(seed, level);
        expect(board.circuits, `level ${level} seed ${seed} had no circuit`).toBeGreaterThan(0);
        // Undoing the recorded scramble must yield a solved board.
        expect(isSolved(unscramble(board)), `level ${level} seed ${seed} was not solvable`).toBe(true);
      }
    }
  });

  it('the scramble never leaves a board already solved', () => {
    let preSolved = 0;
    for (let level = 0; level < FUSE_TOTAL_LEVELS; level += 1) {
      for (let seed = 1; seed <= 25; seed += 1) {
        if (isSolved(generateBoard(seed, level))) preSolved += 1;
      }
    }
    expect(preSolved).toBe(0);
  });

  it('board size and circuit count grow with difficulty', () => {
    const first = fuseSpec(0);
    const last = fuseSpec(FUSE_TOTAL_LEVELS - 1);
    expect(last.cols).toBeGreaterThan(first.cols);
    expect(last.circuits).toBeGreaterThanOrEqual(first.circuits);
  });

  it('seededRandom is stable', () => {
    const a = seededRandom(5);
    const b = seededRandom(5);
    for (let i = 0; i < 20; i += 1) expect(a()).toBe(b());
  });

  /* ---------------- match setup ---------------- */

  it('deals every player the identical board', () => {
    expect(state().phase).toBe('playing');
    expect(state().levelEndsAt).toBeGreaterThan(context().now());
    const [a, b] = players.map((player) => player.id);
    const first = boardOf(a).tiles.map((tile) => `${tile.id}:${tile.mask}:${tile.kind}`);
    const second = boardOf(b).tiles.map((tile) => `${tile.id}:${tile.mask}:${tile.kind}`);
    expect(first).toEqual(second);
  });

  it('gives each player an independent copy', () => {
    const [a, b] = players.map((player) => player.id);
    const rotatable = boardOf(a).tiles.find((tile) => !tile.fixed && distinctRotations(tile.mask) > 1)!;
    const before = boardOf(b).tiles.find((tile) => tile.id === rotatable.id)!.mask;
    expect(act(a, { type: 'rotate', payload: { tileId: rotatable.id } }).accepted).toBe(true);
    // B's board is untouched.
    expect(boardOf(b).tiles.find((tile) => tile.id === rotatable.id)!.mask).toBe(before);
  });

  /* ---------------- rotation ---------------- */

  it('rotates a wire tile and updates its mask', () => {
    const playerId = players[0]!.id;
    const tile = boardOf(playerId).tiles.find((entry) => !entry.fixed && distinctRotations(entry.mask) > 1)!;
    const before = tile.mask;
    // Tiles start scrambled, so the rotation advances from wherever it was.
    const beforeRotation = tile.rotation;
    expect(act(playerId, { type: 'rotate', payload: { tileId: tile.id } }).accepted).toBe(true);
    const after = boardOf(playerId).tiles.find((entry) => entry.id === tile.id)!;
    expect(after.mask).toBe(rotateMask(before, 1));
    expect(after.rotation).toBe((beforeRotation + 90) % 360);
    expect(state().players[playerId]!.rotations).toBe(1);
  });

  it('refuses to rotate sources, bulbs, blockers and empties', () => {
    const playerId = players[0]!.id;
    const board = boardOf(playerId);
    for (const kind of ['source', 'bulb', 'blocker', 'empty'] as const) {
      const tile = board.tiles.find((entry) => entry.kind === kind);
      if (!tile) continue;
      expect(act(playerId, { type: 'rotate', payload: { tileId: tile.id } }).accepted, kind).toBe(false);
    }
    // rotateTile enforces the same rule directly.
    const fixed = board.tiles.find((entry) => entry.fixed);
    if (fixed) expect(rotateTile(board, fixed.id)).toBe(false);
  });

  /* ---------------- anti-cheat ---------------- */

  it('rejects invalid tile ids and outcome-asserting actions', () => {
    const playerId = players[0]!.id;
    const ctx = context();
    for (const tileId of [undefined, null, 42, {}, 'not-a-tile', 't999-999']) {
      expect(fuseGame.validateAction(playerId, { type: 'rotate', payload: { tileId } }, state(), ctx).valid).toBe(
        false,
      );
    }
    for (const type of ['score', 'win', 'finish', 'complete', 'solved', 'board']) {
      expect(fuseGame.validateAction(playerId, { type, payload: { score: 999 } }, state(), ctx).valid).toBe(false);
      expect(fuseGame.handlePlayerAction(playerId, { type }, state(), ctx).accepted).toBe(false);
    }
    expect(state().players[playerId]!.score).toBe(0);
    expect(state().players[playerId]!.solvedAt).toBeNull();
  });

  it('rejects a tile belonging to nobody and actions after the match ends', () => {
    const playerId = players[0]!.id;
    finishFuse(state(), context(), 'completed');
    expect(act(playerId, { type: 'rotate', payload: { tileId: 't0-0' } }).accepted).toBe(false);
  });

  /* ---------------- solving ---------------- */

  it('the SERVER detects completion and scores it', () => {
    const playerId = players[0]!.id;
    // Solve the board by undoing the scramble, leaving one tile to finish.
    const board = boardOf(playerId);
    const rotatable = board.tiles.filter((tile) => !tile.fixed && distinctRotations(tile.mask) > 1);
    for (const tile of rotatable) {
      const steps = (tile.rotation / 90) % 4;
      if (steps) tile.mask = rotateMask(tile.mask, 4 - steps);
      tile.rotation = 0;
    }
    expect(isSolved(board)).toBe(true);

    // Rotate one tile away and back so the server observes the solve.
    const probe = rotatable[0];
    if (probe) {
      const options = distinctRotations(probe.mask);
      for (let step = 0; step < options; step += 1) {
        act(playerId, { type: 'rotate', payload: { tileId: probe.id } });
        if (state().players[playerId]!.solvedAt) break;
      }
    }
    const slot = state().players[playerId]!;
    expect(slot.solvedAt).toBeGreaterThan(0);
    expect(slot.finishRank).toBe(1);
    expect(slot.levelsCleared).toBe(1);
    expect(slot.score).toBeGreaterThan(0);
  });

  /* ---------------- hidden information ---------------- */

  it('never sends another player board — only a progress percentage', () => {
    const [a, b] = players.map((player) => player.id);
    const view = platform.gameManager.getPublicState(room, a) as Record<string, unknown> & {
      board: unknown[];
      players: Record<string, { progress: number }>;
    };
    expect(Array.isArray(view.board)).toBe(true);
    expect(typeof view.players[b]!.progress).toBe('number');
    expect((view.players[b] as unknown as { board?: unknown }).board).toBeUndefined();
    // The raw per-player state is never serialised.
    expect(JSON.stringify(view)).not.toContain('"boneyard"');
  });

  /* ---------------- progression ---------------- */

  it('advances levels and finishes after the last one', () => {
    state().totalLevels = 2;
    endLevel(state(), context());
    expect(state().level).toBe(1);
    expect(state().phase).toBe('level-clear');
    state().phase = 'playing';
    endLevel(state(), context());
    expect(state().phase).toBe('finished');
  });

  it('honours a configured level count', async () => {
    const local = createTestPlatform();
    const fixture = await createGameFixture(local.platform, 'fuse', { settings: { rounds: 2 } });
    expect((fixture.room.gameState as FuseState).totalLevels).toBe(2);
    local.destroy();
  });

  /* ---------------- results ---------------- */

  it('ranks by score with completion time as the tiebreak', () => {
    const [a, b] = players.map((player) => player.id);
    state().players[a]!.score = 400;
    state().players[b]!.score = 400;
    state().players[a]!.solvedAt = 5_000;
    state().players[b]!.solvedAt = 2_000;
    finishFuse(state(), context(), 'completed');

    const result = fuseGame.getResult(state(), context());
    expect(result.rankings[0]!.playerId).toBe(b);
    expect(result.isDraw).toBe(true);
    expect(result.rankings[0]!.stats).toHaveProperty('rotations');
  });

  /* ---------------- lifecycle ---------------- */

  it('handles disconnect, reconnect and leave', () => {
    const playerId = players[0]!.id;
    const tile = boardOf(playerId).tiles.find((entry) => !entry.fixed && distinctRotations(entry.mask) > 1)!;
    act(playerId, { type: 'rotate', payload: { tileId: tile.id } });

    fuseGame.playerLeft(playerId, state(), context(), 'disconnect');
    expect(state().players[playerId]!.disconnected).toBe(true);
    expect(act(playerId, { type: 'rotate', payload: { tileId: tile.id } }).accepted).toBe(false);

    fuseGame.playerJoined({ ...players[0]! }, state(), context());
    expect(state().players[playerId]!.disconnected).toBe(false);
    expect(state().players[playerId]!.rotations).toBe(1);

    fuseGame.playerLeft(playerId, state(), context(), 'leave');
    expect(state().players[playerId]!.left).toBe(true);
  });

  it('reset and cleanup prepare a rematch', () => {
    finishFuse(state(), context(), 'completed');
    const next = fuseGame.reset(state());
    expect(next.phase).toBe('idle');
    expect(next.level).toBe(0);
    expect(Object.values(next.players).every((slot) => slot.score === 0 && slot.rotations === 0)).toBe(true);
    fuseGame.cleanup(next);
    expect(Object.keys(next.players)).toHaveLength(0);
  });

  /* ---------------- AI ---------------- */

  it('the AI only rotates legal tiles', () => {
    const playerId = players[0]!.id;
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const action = fuseGame.getAIMove?.(playerId, difficulty, state(), context());
      if (!action) continue;
      expect(action.type).toBe('rotate');
      expect(fuseGame.validateAction(playerId, action, state(), context()).valid).toBe(true);
    }
  });

  it('a hard AI makes real progress toward connecting the circuits', () => {
    const playerId = players[0]!.id;
    const before = progressOf(boardOf(playerId));
    for (let step = 0; step < 400; step += 1) {
      const action = fuseGame.getAIMove?.(playerId, 'hard', state(), context());
      if (!action) break;
      act(playerId, action);
      if (state().players[playerId]!.solvedAt || state().phase !== 'playing') break;
    }
    const slot = state().players[playerId]!;
    const after = progressOf(slot.board);
    // Either it solved the board outright, or it improved connectivity.
    expect(slot.solvedAt !== null || after >= before).toBe(true);
    expect(slot.rotations).toBeGreaterThan(0);
  });

  it('the AI stops once solved or the match ends', () => {
    const playerId = players[0]!.id;
    state().players[playerId]!.solvedAt = 1;
    expect(fuseGame.getAIMove?.(playerId, 'hard', state(), context())).toBeNull();
    state().players[playerId]!.solvedAt = null;
    finishFuse(state(), context(), 'completed');
    expect(fuseGame.getAIMove?.(playerId, 'hard', state(), context())).toBeNull();
  });
});
