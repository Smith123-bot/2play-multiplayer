import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createTestPlatform, waitFor, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  applyMove,
  battle2048Game,
  chooseAIDirection,
  emptyBoard,
  finishBattleOnTimeout,
  hasLegalMove,
  spawnTile,
  type Battle2048State,
  type MoveDirection,
} from './index';
import type { Room } from '../../rooms/Room';

describe('2048 Battle', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, '2048-battle');
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as Battle2048State;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const publicState = (viewerId?: string) =>
    platform.gameManager.getPublicState(room, viewerId) as {
      phase: string;
      boards: Record<string, { tiles: number[]; score: number; locked: boolean } | null>;
      endsAt: number | null;
    };

  const makeBoard = (tiles: number[]): ReturnType<typeof emptyBoard> => {
    const board = emptyBoard();
    board.tiles = tiles;
    return board;
  };

  /* ---------------------------------------------------------------- */
  /* Initial state                                                     */
  /* ---------------------------------------------------------------- */

  it('starts playing with two seeded boards and a shared clock', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    expect(Object.keys(state().boards)).toHaveLength(2);
    for (const player of players) {
      const tiles = state().boards[player.id]!.tiles;
      expect(tiles).toHaveLength(16);
      expect(tiles.filter((value) => value !== 0)).toHaveLength(2);
      expect([2, 4]).toContain(tiles[0] === 0 ? 2 : tiles[0]);
    }
    expect(state().startedAt).toBeGreaterThan(0);
    expect(state().endsAt).toBe(state()!.startedAt! + state()!.durationMs);
  });

  /* ---------------------------------------------------------------- */
  /* Core 2048 mechanics                                               */
  /* ---------------------------------------------------------------- */

  it('slides tiles left and merges equal neighbours once per move', () => {
    const board = makeBoard([
      2, 2, 0, 0,
      4, 2, 2, 0,
      0, 0, 0, 0,
      2, 0, 0, 2,
    ]);
    const result = applyMove(board, 'left');
    expect(result.moved).toBe(true);
    expect(result.merges).toBe(3);
    expect(result.mergePoints).toBe(12); // 4 + 4 + 4
    expect(board.tiles.slice(0, 4)).toEqual([4, 0, 0, 0]);
    expect(board.tiles.slice(4, 8)).toEqual([4, 4, 0, 0]);
    expect(board.tiles.slice(12, 16)).toEqual([4, 0, 0, 0]);
    expect(board.score).toBe(12);
    expect(board.moves).toBe(1);
  });

  it('never merges a tile twice in one move ([2,2,2,2] → [4,4])', () => {
    const board = makeBoard([2, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const result = applyMove(board, 'left');
    expect(board.tiles.slice(0, 4)).toEqual([4, 4, 0, 0]);
    expect(result.mergePoints).toBe(8);
  });

  it('merges across gaps but keeps partial merges separate ([4,2,2,0] → [4,4])', () => {
    const board = makeBoard([4, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    applyMove(board, 'left');
    expect(board.tiles.slice(0, 4)).toEqual([4, 4, 0, 0]);
  });

  it('supports all four directions', () => {
    const right = makeBoard([2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    applyMove(right, 'right');
    expect(right.tiles.slice(0, 4)).toEqual([0, 0, 0, 4]);

    const up = makeBoard([0, 2, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    applyMove(up, 'up');
    expect(up.tiles[1]).toBe(4);
    expect(up.tiles[5]).toBe(0);

    const down = makeBoard([0, 2, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    applyMove(down, 'down');
    expect(down.tiles[13]).toBe(4);
    expect(down.tiles[1]).toBe(0);
  });

  it('reports moves that change nothing', () => {
    const board = makeBoard([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(applyMove(board, 'left').moved).toBe(false);
    expect(applyMove(board, 'up').moved).toBe(false);
    expect(board.moves).toBe(0);
    expect(board.score).toBe(0);
  });

  it('detects when the board is full with no legal moves', () => {
    const board = makeBoard([
      2, 4, 2, 4,
      4, 2, 4, 2,
      2, 4, 2, 4,
      4, 2, 4, 2,
    ]);
    expect(hasLegalMove(board)).toBe(false);
    expect(applyMove(board, 'left').moved).toBe(false);
  });

  it('detects legal moves while the board is full but fusable', () => {
    const board = makeBoard([
      2, 4, 2, 4,
      4, 2, 4, 2,
      2, 4, 2, 4,
      4, 2, 2, 2,
    ]);
    expect(hasLegalMove(board)).toBe(true);
  });

  it('spawns exactly one new tile on a random empty cell', () => {
    const board = makeBoard([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    let calls = 0;
    const rng = () => {
      calls += 1;
      return 0.5;
    };
    const before = board.tiles.reduce((sum, value) => sum + value, 0);
    spawnTile(board, rng);
    const filled = board.tiles.filter((value) => value !== 0);
    expect(filled).toHaveLength(2);
    const after = board.tiles.reduce((sum, value) => sum + value, 0);
    expect(after - before).toBeGreaterThanOrEqual(2);
    expect(after - before).toBeLessThanOrEqual(4);
    expect(calls).toBeGreaterThanOrEqual(1);
  });

  /* ---------------------------------------------------------------- */
  /* Actions through the real pipeline                                 */
  /* ---------------------------------------------------------------- */

  it('accepts valid moves, spawns a tile and updates the score', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    const board = state().boards[playerId]!;

    let direction: MoveDirection | null = null;
    for (const candidate of ['left', 'up', 'right', 'down'] as MoveDirection[]) {
      if (applyMove({ ...board, tiles: [...board.tiles] }, candidate).moved) {
        direction = candidate;
        break;
      }
    }
    expect(direction).not.toBeNull();

    const before = [...board.tiles];
    const result = platform.gameManager.handleAction(room, playerId, {
      type: 'move',
      payload: { direction: direction! },
    });

    expect(result.accepted).toBe(true);
    const after = state().boards[playerId]!.tiles;
    expect(after).not.toEqual(before);
    expect(state().scores[playerId]).toBe(state().boards[playerId]!.score);
  });

  it('rejects unknown actions, bad directions and no-op moves', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;

    expect(
      battle2048Game.validateAction(playerId, { type: 'spin' }, state(), context()).valid,
    ).toBe(false);
    expect(
      battle2048Game.validateAction(
        playerId,
        { type: 'move', payload: { direction: 'diagonal' } },
        state(),
        context(),
      ).valid,
    ).toBe(false);
    expect(
      battle2048Game.validateAction(
        playerId,
        { type: 'move', payload: { direction: 42 } },
        state(),
        context(),
      ).valid,
    ).toBe(false);
    expect(
      battle2048Game.validateAction(playerId, { type: 'move' }, state(), context()).valid,
    ).toBe(false);

    // A move that changes nothing is rejected by the module.
    const board = state().boards[playerId]!;
    const stub = { ...board, tiles: [...board.tiles] } as typeof board;
    let noChange: MoveDirection | null = null;
    for (const candidate of ['left', 'up', 'right', 'down'] as MoveDirection[]) {
      if (!applyMove(stub, candidate).moved) {
        noChange = candidate;
        break;
      }
      // reset stub between attempts
      stub.tiles = [...board.tiles];
    }
    if (noChange) {
      const result = platform.gameManager.handleAction(room, playerId, {
        type: 'move',
        payload: { direction: noChange },
      });
      expect(result.accepted).toBe(false);
      expect(result.reason).toBeTruthy();
    }
  });

  it('rejects actions from players without a board and locks finished boards', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const ghost = 'player-that-does-not-exist';
    expect(
      battle2048Game.validateAction(ghost, { type: 'move', payload: { direction: 'left' } }, state(), context())
        .valid,
    ).toBe(false);

    const playerId = players[0]!.id;
    state().boards[playerId]!.locked = true;
    expect(
      battle2048Game.validateAction(playerId, { type: 'move', payload: { direction: 'left' } }, state(), context())
        .valid,
    ).toBe(false);
  });

  it('locks a full board but lets the other player keep playing', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const [a, b] = players.map((player) => player.id);

    // Kill board A with an unmergeable full grid.
    state().boards[a]!.tiles = [
      2, 4, 2, 4,
      4, 2, 4, 2,
      2, 4, 2, 4,
      4, 2, 4, 2,
    ];
    state().boards[a]!.locked = true;

    const result = platform.gameManager.handleAction(room, b, {
      type: 'move',
      payload: { direction: 'up' },
    });
    expect(result.accepted).toBe(true);
    expect(state().phase).toBe('playing'); // B may continue
    expect(state().boards[a]!.locked).toBe(true);
  });

  it('ends the match when every board is locked', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    for (const player of players) {
      state().boards[player.id]!.locked = true;
    }
    // Triggering through the same path handlePlayerAction uses.
    battle2048Game.playerLeft(players[0]!.id, state(), context(), 'leave');
    expect(state().phase).toBe('finished');
    expect(state().finishReason).toBe('completed');
  });

  /* ---------------------------------------------------------------- */
  /* Timeout / result / draw                                           */
  /* ---------------------------------------------------------------- */

  it('finishes with reason timeout when the clock expires', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    state().scores[players[0]!.id] = 100;
    finishBattleOnTimeout(state(), context());
    expect(state().phase).toBe('finished');
    expect(state().finishReason).toBe('timeout');
    expect(battle2048Game.isGameFinished(state())).toBe(true);
  });

  it('ranks by score, awards the win and detects draws', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    state().phase = 'finished';
    state().scores[players[0]!.id] = 120;
    state().scores[players[1]!.id] = 80;

    const draft = battle2048Game.getResult(state(), context());
    expect(draft.winners).toEqual([players[0]!.id]);
    expect(draft.isDraw).toBe(false);
    expect(draft.rankings[0]!.rank).toBe(1);
    expect(draft.rankings[0]!.score).toBe(120);
    expect(draft.rankings[1]!.score).toBe(80);
    expect(draft.rankings[0]!.stats.bestTile).toBeGreaterThanOrEqual(0);

    state().scores[players[1]!.id] = 120;
    const drawn = battle2048Game.getResult(state(), context());
    expect(drawn.winners).toHaveLength(2);
    expect(drawn.isDraw).toBe(true);
    expect(drawn.rankings.every((entry) => entry.isDraw)).toBe(true);
  });

  it('calculates live scores', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    state().scores[playerId] = 44;
    expect(battle2048Game.calculateScore(playerId, state())).toBe(44);
    expect(battle2048Game.calculateScore('unknown', state())).toBe(0);
  });

  /* ---------------------------------------------------------------- */
  /* Reset / rematch compatibility                                     */
  /* ---------------------------------------------------------------- */

  it('reset keeps every seat and zeroes all game state', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const seats = Object.keys(state().boards);
    state().scores[seats[0]!] = 999;
    state().phase = 'finished';

    const next = battle2048Game.reset(state());
    expect(Object.keys(next.boards)).toEqual(seats);
    expect(Object.keys(next.scores)).toEqual(seats);
    for (const board of Object.values(next.boards)) {
      expect(board.tiles.every((value) => value === 0)).toBe(true);
      expect(board.score).toBe(0);
      expect(board.locked).toBe(false);
    }
    expect(next.scores[seats[0]!]).toBe(0);
    expect(next.phase).toBe('idle');
    expect(battle2048Game.isGameFinished(next)).toBe(false);
  });

  /* ---------------------------------------------------------------- */
  /* AI                                                                */
  /* ---------------------------------------------------------------- */

  it('AI only proposes legal moves and stops on locked boards', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    const board = state().boards[playerId]!;

    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      for (let attempt = 0; attempt < 15; attempt += 1) {
        const move = battle2048Game.getAIMove?.(playerId, difficulty, state(), context());
        expect(move?.type).toBe('move');
        const direction = move?.payload?.direction as MoveDirection;
        expect(['up', 'down', 'left', 'right']).toContain(direction);
        const probe = { ...board, tiles: [...board.tiles] } as typeof board;
        expect(applyMove(probe, direction).moved).toBe(true);
      }
    }

    board.locked = true;
    expect(battle2048Game.getAIMove?.(playerId, 'hard', state(), context())).toBeNull();

    state().phase = 'finished';
    expect(battle2048Game.getAIMove?.(playerId, 'hard', state(), context())).toBeNull();
  });

  it('stronger difficulties prefer merging moves', () => {
    const board = makeBoard([
      2, 2, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]);
    for (const difficulty of ['medium', 'hard'] as const) {
      const direction = chooseAIDirection(board, difficulty, () => 0.99);
      const probe = { ...board, tiles: [...board.tiles] } as typeof board;
      expect(applyMove(probe, direction!).mergePoints).toBeGreaterThan(0);
    }
  });

  /* ---------------------------------------------------------------- */
  /* Public state                                                      */
  /* ---------------------------------------------------------------- */

  it('exposes both boards through getPublicState with a server clock', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const view = publicState(players[0]!.id);
    expect(view.phase).toBe('playing');
    expect(Object.keys(view.boards)).toHaveLength(2);
    for (const player of players) {
      expect(view.boards[player.id]!.tiles).toHaveLength(16);
      expect(view.boards[player.id]!.score).toBe(0);
    }
    expect(view.endsAt).toBeGreaterThan(0);
  });

  /* ---------------------------------------------------------------- */
  /* Disconnect behaviour                                              */
  /* ---------------------------------------------------------------- */

  it('keeps a disconnected player’s board alive but locks a leaver’s board', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;

    battle2048Game.playerLeft(playerId, state(), context(), 'disconnect');
    expect(state().boards[playerId]!.locked).toBe(false); // grace period keeps the seat

    battle2048Game.playerLeft(playerId, state(), context(), 'leave');
    expect(state().boards[playerId]!.locked).toBe(true);
    expect(state().boards[playerId]!.lockedAt).toBeGreaterThan(0);
  });
});
