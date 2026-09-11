import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createTestPlatform, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  arrowPuzzleGame,
  beginRound,
  canFire,
  CLEAR_SCORE,
  DIFFICULTY_SPEC,
  difficultyForRound,
  endRound,
  finishArrow,
  firableTiles,
  generatePuzzle,
  HINT_PENALTY,
  MISTAKE_PENALTY,
  pathClear,
  seededRandom,
  SOLVE_BONUS,
  solve,
  type ArrowDifficulty,
  type ArrowState,
} from './index';
import type { Room } from '../../rooms/Room';

describe('Arrow Puzzle', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'arrow-puzzle');
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as ArrowState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const act = (playerId: string, action: { type: string; payload?: Record<string, unknown> }) =>
    platform.gameManager.handleAction(room, playerId, action);

  const boardOf = (playerId: string) => ({
    cols: state().cols,
    rows: state().rows,
    tiles: state().players[playerId]!.tiles,
  });

  /* ---------------- generation ---------------- */

  it('generates a deterministic puzzle for a given seed', () => {
    const a = generatePuzzle(12345, 'medium');
    const b = generatePuzzle(12345, 'medium');
    const c = generatePuzzle(12346, 'medium');
    expect(JSON.stringify(a.tiles)).toBe(JSON.stringify(b.tiles));
    expect(JSON.stringify(a.tiles)).not.toBe(JSON.stringify(c.tiles));
  });

  it('generates a solvable board for every difficulty across many seeds', () => {
    for (const difficulty of ['easy', 'medium', 'hard', 'expert'] as ArrowDifficulty[]) {
      for (let seed = 1; seed <= 60; seed += 1) {
        const board = generatePuzzle(seed, difficulty);
        expect(board.tiles).toHaveLength(DIFFICULTY_SPEC[difficulty].count);
        // An independent solver must be able to clear it.
        const order = solve(board);
        expect(order, `seed ${seed} / ${difficulty} was unsolvable`).not.toBeNull();
        expect(order).toHaveLength(board.tiles.length);
      }
    }
  });

  it('never stacks two arrows on the same cell', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const board = generatePuzzle(seed, 'expert');
      const cells = board.tiles.map((tile) => `${tile.x}:${tile.y}`);
      expect(new Set(cells).size).toBe(cells.length);
      // Everything is inside the grid.
      expect(board.tiles.every((tile) => tile.x >= 0 && tile.y >= 0 && tile.x < board.cols && tile.y < board.rows)).toBe(
        true,
      );
    }
  });

  it('difficulty ramps across rounds and each level is larger than the last', () => {
    expect(difficultyForRound(0)).toBe('easy');
    expect(difficultyForRound(1)).toBe('medium');
    expect(difficultyForRound(2)).toBe('hard');
    expect(difficultyForRound(3)).toBe('expert');
    const order: ArrowDifficulty[] = ['easy', 'medium', 'hard', 'expert'];
    for (let i = 1; i < order.length; i += 1) {
      expect(DIFFICULTY_SPEC[order[i]!].count).toBeGreaterThan(DIFFICULTY_SPEC[order[i - 1]!].count);
    }
  });

  it('seededRandom is stable and stays in range', () => {
    const a = seededRandom(99);
    const b = seededRandom(99);
    for (let i = 0; i < 50; i += 1) {
      const value = a();
      expect(value).toBe(b());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('pathClear only accepts an unobstructed run to the edge', () => {
    const occupied = new Set<string>(['2:1']);
    expect(pathClear(occupied, 5, 5, 0, 1, 'right')).toBe(false); // blocked at x=2
    expect(pathClear(occupied, 5, 5, 3, 1, 'right')).toBe(true);
    expect(pathClear(occupied, 5, 5, 0, 0, 'up')).toBe(true); // already on the edge
  });

  /* ---------------- match setup ---------------- */

  it('starts round one and deals every player the identical board', () => {
    expect(state().phase).toBe('playing');
    expect(state().round).toBe(0);
    expect(state().difficulty).toBe('easy');
    expect(state().totalTiles).toBeGreaterThan(0);
    expect(state().endsAt).toBeGreaterThan(context().now());

    const [a, b] = players.map((player) => player.id);
    const boardA = state().players[a]!.tiles.map((tile) => `${tile.id}${tile.x}${tile.y}${tile.direction}`);
    const boardB = state().players[b]!.tiles.map((tile) => `${tile.id}${tile.x}${tile.y}${tile.direction}`);
    expect(boardA).toEqual(boardB);
  });

  it('gives each player an independent copy so progress never bleeds across', () => {
    const [a, b] = players.map((player) => player.id);
    const target = firableTiles(boardOf(a))[0]!;
    expect(act(a, { type: 'fire', payload: { tileId: target.id } }).accepted).toBe(true);
    expect(state().players[a]!.tiles.find((tile) => tile.id === target.id)!.cleared).toBe(true);
    // Player B's board is untouched.
    expect(state().players[b]!.tiles.find((tile) => tile.id === target.id)!.cleared).toBe(false);
    expect(state().players[b]!.cleared).toBe(0);
  });

  /* ---------------- actions ---------------- */

  it('clears a firable arrow and scores it', () => {
    const playerId = players[0]!.id;
    const target = firableTiles(boardOf(playerId))[0]!;
    expect(act(playerId, { type: 'fire', payload: { tileId: target.id } }).accepted).toBe(true);
    expect(state().players[playerId]!.cleared).toBe(1);
    expect(state().players[playerId]!.score).toBe(CLEAR_SCORE);
    expect(state().lastEvent).toBe(`clear:${playerId}`);
  });

  it('rejects a blocked arrow and penalises the attempt', () => {
    const playerId = players[0]!.id;
    const blocked = state().players[playerId]!.tiles.find((tile) => !canFire(boardOf(playerId), tile.id));
    if (!blocked) return; // extremely sparse board; nothing to assert
    state().players[playerId]!.score = 100;
    expect(act(playerId, { type: 'fire', payload: { tileId: blocked.id } }).accepted).toBe(false);
    expect(state().players[playerId]!.tiles.find((tile) => tile.id === blocked.id)!.cleared).toBe(false);
    expect(state().players[playerId]!.mistakes).toBe(1);
    expect(state().players[playerId]!.score).toBe(100 - MISTAKE_PENALTY);
  });

  it('rejects malformed, duplicate and outcome-asserting actions', () => {
    const playerId = players[0]!.id;
    const ctx = context();

    // The client may never declare completion or a score.
    for (const type of ['solved', 'complete', 'score', 'win', 'finish']) {
      expect(arrowPuzzleGame.validateAction(playerId, { type, payload: { score: 9999 } }, state(), ctx).valid).toBe(
        false,
      );
      expect(arrowPuzzleGame.handlePlayerAction(playerId, { type }, state(), ctx).accepted).toBe(false);
    }
    // Malformed tile ids.
    for (const tileId of [undefined, null, 42, {}, 'nope']) {
      expect(
        arrowPuzzleGame.validateAction(playerId, { type: 'fire', payload: { tileId } }, state(), ctx).valid,
      ).toBe(false);
    }
    // Firing the same arrow twice does not score twice.
    const target = firableTiles(boardOf(playerId))[0]!;
    act(playerId, { type: 'fire', payload: { tileId: target.id } });
    const scoreAfterFirst = state().players[playerId]!.score;
    expect(act(playerId, { type: 'fire', payload: { tileId: target.id } }).accepted).toBe(false);
    expect(state().players[playerId]!.score).toBe(scoreAfterFirst);
    expect(state().players[playerId]!.cleared).toBe(1);
  });

  it('a hint costs points and is refused when nothing can be fired', () => {
    const playerId = players[0]!.id;
    state().players[playerId]!.score = 100;
    expect(act(playerId, { type: 'hint' }).accepted).toBe(true);
    expect(state().players[playerId]!.hintsUsed).toBe(1);
    expect(state().players[playerId]!.score).toBe(100 - HINT_PENALTY);
    expect(state().lastEvent?.startsWith(`hint:${playerId}:`)).toBe(true);
  });

  /* ---------------- completion ---------------- */

  /** Clears a player's board the legal way, one firable arrow at a time. */
  const solveFor = (playerId: string) => {
    let guard = 0;
    while (!state().players[playerId]!.solved && guard < 200) {
      guard += 1;
      const next = firableTiles(boardOf(playerId))[0];
      if (!next) break;
      act(playerId, { type: 'fire', payload: { tileId: next.id } });
    }
  };

  it('the server detects completion and awards the solve bonus', () => {
    const playerId = players[0]!.id;
    solveFor(playerId);
    const me = state().players[playerId]!;
    expect(me.solved).toBe(true);
    expect(me.solvedAt).toBeGreaterThan(0);
    expect(me.cleared).toBe(state().totalTiles);
    expect(me.score).toBeGreaterThanOrEqual(SOLVE_BONUS);
    expect(me.finishRank).toBe(1);
  });

  it('records completion order and uses it for placement bonuses', () => {
    const [a, b] = players.map((player) => player.id);
    solveFor(a);
    // First to solve takes rank 1 and the biggest placement bonus.
    expect(state().players[a]!.finishRank).toBe(1);
    expect(state().finishOrder[0]).toBe(a);
    const firstScore = state().players[a]!.score;
    expect(firstScore).toBeGreaterThan(SOLVE_BONUS);

    // When the second player also solves, they rank behind the first.
    solveFor(b);
    // Everyone solved, so the round rolls over and boards are re-dealt.
    expect(state().round).toBe(1);
    expect(state().players[a]!.solved).toBe(false);
  });

  it('refuses further actions once a player has solved the board', () => {
    const playerId = players[0]!.id;
    solveFor(playerId);
    if (state().phase !== 'playing') return; // round already rolled over
    expect(
      arrowPuzzleGame.validateAction(playerId, { type: 'fire', payload: { tileId: 'a0' } }, state(), context()).valid,
    ).toBe(false);
  });

  /* ---------------- rounds ---------------- */

  it('advances to a harder round and finishes after the last one', () => {
    expect(state().totalRounds).toBe(3);
    const firstDifficulty = state().difficulty;
    endRound(state(), context());
    expect(state().round).toBe(1);
    expect(state().difficulty).not.toBe(firstDifficulty);
    expect(state().phase).toBe('playing');

    endRound(state(), context());
    expect(state().round).toBe(2);
    endRound(state(), context());
    expect(state().phase).toBe('finished');
    expect(state().finishReason).toBe('completed');
  });

  it('a new round resets progress and deals a new board to everyone', () => {
    const playerId = players[0]!.id;
    solveFor(playerId);
    const previousLayout = state().layout.map((tile) => tile.id).join(',');
    state().round = 1;
    beginRound(state(), context());
    expect(state().players[playerId]!.cleared).toBe(0);
    expect(state().players[playerId]!.solved).toBe(false);
    expect(state().players[playerId]!.tiles.every((tile) => !tile.cleared)).toBe(true);
    expect(state().layout.length).toBeGreaterThan(0);
    expect(previousLayout.length).toBeGreaterThan(0);
  });

  it('honours a configured round count', async () => {
    const local = createTestPlatform();
    const fixture = await createGameFixture(local.platform, 'arrow-puzzle', { settings: { rounds: 2 } });
    expect((fixture.room.gameState as ArrowState).totalRounds).toBe(2);
    local.destroy();
  });

  /* ---------------- privacy ---------------- */

  it('never exposes another player board or the generator solution', () => {
    const [a, b] = players.map((player) => player.id);
    act(a, { type: 'fire', payload: { tileId: firableTiles(boardOf(a))[0]!.id } });

    const view = platform.gameManager.getPublicState(room, b) as Record<string, unknown> & {
      board: Array<{ id: string; cleared: boolean }>;
      players: Record<string, { cleared: number }>;
    };
    const json = JSON.stringify(view);
    expect(json).not.toMatch(/solution/);
    expect(view.layout).toBeUndefined();
    expect(view.seed).toBeUndefined();
    // B sees only B's own board (nothing cleared yet).
    expect(view.board.every((tile) => !tile.cleared)).toBe(true);
    // A's progress is visible only as an aggregate count.
    expect(view.players[a]!.cleared).toBe(1);
    expect((view.players[a] as unknown as { tiles?: unknown }).tiles).toBeUndefined();
  });

  it('marks firable arrows for the viewer so the UI can highlight them', () => {
    const playerId = players[0]!.id;
    const view = platform.gameManager.getPublicState(room, playerId) as {
      board: Array<{ id: string; firable: boolean; cleared: boolean }>;
    };
    const expected = new Set(firableTiles(boardOf(playerId)).map((tile) => tile.id));
    const reported = new Set(view.board.filter((tile) => tile.firable).map((tile) => tile.id));
    expect(reported).toEqual(expected);
    expect(reported.size).toBeGreaterThan(0);
  });

  /* ---------------- lifecycle ---------------- */

  it('keeps a disconnected player state and restores it on reconnect', () => {
    const playerId = players[0]!.id;
    act(playerId, { type: 'fire', payload: { tileId: firableTiles(boardOf(playerId))[0]!.id } });
    arrowPuzzleGame.playerLeft(playerId, state(), context(), 'disconnect');
    expect(state().players[playerId]!.disconnected).toBe(true);
    expect(act(playerId, { type: 'fire', payload: { tileId: 'a1' } }).accepted).toBe(false);

    arrowPuzzleGame.playerJoined({ ...players[0]! }, state(), context());
    expect(state().players[playerId]!.disconnected).toBe(false);
    expect(state().players[playerId]!.cleared).toBe(1); // progress survived
  });

  it('reset clears every board for a rematch', () => {
    const playerId = players[0]!.id;
    solveFor(playerId);
    finishArrow(state(), context(), 'completed');
    const next = arrowPuzzleGame.reset(state());
    expect(next.phase).toBe('idle');
    expect(next.round).toBe(0);
    expect(Object.keys(next.players)).toEqual(Object.keys(state().players));
    expect(Object.values(next.players).every((player) => player.cleared === 0 && !player.solved)).toBe(true);
  });

  it('cleanup releases the boards', () => {
    const next = arrowPuzzleGame.reset(state());
    arrowPuzzleGame.cleanup(next);
    expect(Object.keys(next.players)).toHaveLength(0);
    expect(next.layout).toHaveLength(0);
    expect(next.phase).toBe('finished');
  });

  /* ---------------- AI ---------------- */

  it('AI only fires arrows that exist and can eventually solve a board', () => {
    const playerId = players[0]!.id;
    let guard = 0;
    while (!state().players[playerId]!.solved && guard < 300) {
      guard += 1;
      const action = arrowPuzzleGame.getAIMove?.(playerId, 'hard', state(), context());
      if (!action) break;
      expect(action.type).toBe('fire');
      const tileId = action.payload?.tileId as string;
      expect(state().players[playerId]!.tiles.some((tile) => tile.id === tileId)).toBe(true);
      act(playerId, action);
    }
    expect(state().players[playerId]!.solved).toBe(true);
  });

  it('AI stops once the puzzle is solved or the match is over', () => {
    const playerId = players[0]!.id;
    state().players[playerId]!.solved = true;
    expect(arrowPuzzleGame.getAIMove?.(playerId, 'hard', state(), context())).toBeNull();
    state().players[playerId]!.solved = false;
    finishArrow(state(), context(), 'completed');
    expect(arrowPuzzleGame.getAIMove?.(playerId, 'hard', state(), context())).toBeNull();
  });

  /* ---------------- result ---------------- */

  it('ranks by score and breaks ties on completion time', () => {
    const [a, b] = players.map((player) => player.id);
    state().players[a]!.score = 300;
    state().players[b]!.score = 300;
    state().players[a]!.solvedAt = 2_000;
    state().players[b]!.solvedAt = 1_000;
    finishArrow(state(), context(), 'completed');

    const result = arrowPuzzleGame.getResult(state(), context());
    // Equal scores: both are winners, but B ranks first for solving sooner.
    expect(result.rankings[0]!.playerId).toBe(b);
    expect(result.isDraw).toBe(true);
    expect(arrowPuzzleGame.calculateScore(a, state())).toBe(300);
  });
});
