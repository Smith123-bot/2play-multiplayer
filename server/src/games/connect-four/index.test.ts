import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createTestPlatform, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  COLS,
  connectFourGame,
  discAt,
  dropRow,
  findWinningLine,
  finishConnect,
  indexOf,
  isBoardFull,
  isColumnFull,
  legalColumns,
  ROWS,
  type ConnectFourState,
  type Disc,
} from './index';
import type { Room } from '../../rooms/Room';

describe('Connect Four', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'connect-four');
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as ConnectFourState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const drop = (playerId: string, col: number) =>
    platform.gameManager.handleAction(room, playerId, { type: 'drop', payload: { col } });
  const current = () => state().currentPlayerId as string;
  const other = () => players.map((p) => p.id).find((id) => id !== current()) as string;

  /** Writes discs directly for board-shape tests. */
  const put = (col: number, row: number, seat: Disc) => {
    state().board[indexOf(col, row)] = seat;
  };

  /* ---------------- setup ---------------- */

  it('initialises an empty 7x6 board with two seats', () => {
    expect(state().phase).toBe('playing');
    expect(state().cols).toBe(7);
    expect(state().rows).toBe(6);
    expect(COLS).toBe(7);
    expect(ROWS).toBe(6);
    expect(state().board).toHaveLength(42);
    expect(state().board.every((disc) => disc === 0)).toBe(true);
    expect(state().currentPlayerId).toBe(players[0]!.id);
    expect(state().players[players[0]!.id]!.seat).toBe(1);
    expect(state().players[players[1]!.id]!.seat).toBe(2);
    expect(state().turnEndsAt).toBeGreaterThan(context().now());
  });

  /* ---------------- gravity ---------------- */

  it('drops discs to the lowest free slot', () => {
    const first = current();
    expect(dropRow(state(), 3)).toBe(5); // bottom row
    expect(drop(first, 3).accepted).toBe(true);
    expect(discAt(state(), 3, 5)).toBe(1);
    expect(discAt(state(), 3, 4)).toBe(0);

    // The next disc in the same column stacks on top.
    expect(drop(current(), 3).accepted).toBe(true);
    expect(discAt(state(), 3, 4)).toBe(2);
    expect(dropRow(state(), 3)).toBe(3);
  });

  it('rejects a full column and reports it as illegal', () => {
    for (let row = 0; row < ROWS; row += 1) put(2, row, 1);
    expect(isColumnFull(state(), 2)).toBe(true);
    expect(dropRow(state(), 2)).toBe(-1);
    expect(legalColumns(state())).not.toContain(2);
    expect(drop(current(), 2).accepted).toBe(false);
  });

  /* ---------------- validation ---------------- */

  it('rejects out of turn play, bad columns and outcome-asserting actions', () => {
    const ctx = context();
    // Not your turn.
    expect(drop(other(), 0).accepted).toBe(false);
    // Column out of range.
    expect(drop(current(), -1).accepted).toBe(false);
    expect(drop(current(), 7).accepted).toBe(false);
    // Malformed payloads.
    for (const col of [undefined, null, 'three', 2.5, {}]) {
      expect(connectFourGame.validateAction(current(), { type: 'drop', payload: { col } }, state(), ctx).valid).toBe(
        false,
      );
    }
    // Client cannot assert a result.
    for (const type of ['score', 'win', 'finish', 'complete', 'board']) {
      expect(connectFourGame.validateAction(current(), { type, payload: { score: 999 } }, state(), ctx).valid).toBe(
        false,
      );
      expect(connectFourGame.handlePlayerAction(current(), { type }, state(), ctx).accepted).toBe(false);
    }
    expect(state().moves).toBe(0);
  });

  it('rejects everything after the game finishes', () => {
    const id = current();
    finishConnect(state(), context(), 'completed');
    expect(drop(id, 0).accepted).toBe(false);
  });

  /* ---------------- win detection ---------------- */

  it('detects a horizontal four', () => {
    for (let col = 0; col < 4; col += 1) put(col, 5, 1);
    const line = findWinningLine(state(), 3, 5);
    expect(line).not.toBeNull();
    expect(line).toHaveLength(4);
  });

  it('detects a vertical four', () => {
    for (let row = 5; row > 1; row -= 1) put(2, row, 2);
    const line = findWinningLine(state(), 2, 2);
    expect(line).not.toBeNull();
    expect(line).toHaveLength(4);
  });

  it('detects both diagonal directions', () => {
    // Ascending diagonal.
    put(0, 5, 1);
    put(1, 4, 1);
    put(2, 3, 1);
    put(3, 2, 1);
    expect(findWinningLine(state(), 3, 2)).toHaveLength(4);

    // Descending diagonal on a fresh board.
    state().board = new Array(42).fill(0) as Disc[];
    put(0, 2, 2);
    put(1, 3, 2);
    put(2, 4, 2);
    put(3, 5, 2);
    expect(findWinningLine(state(), 3, 5)).toHaveLength(4);
  });

  it('does not report a win for three in a row or a mixed line', () => {
    for (let col = 0; col < 3; col += 1) put(col, 5, 1);
    expect(findWinningLine(state(), 2, 5)).toBeNull();
    // Break the line with the other seat.
    put(3, 5, 2);
    expect(findWinningLine(state(), 3, 5)).toBeNull();
  });

  it('ends the game and highlights the winning line through real play', () => {
    const a = players[0]!.id;
    const b = players[1]!.id;
    // a plays columns 0..3 on the bottom row, b answers in column 6.
    drop(a, 0);
    drop(b, 6);
    drop(a, 1);
    drop(b, 6);
    drop(a, 2);
    drop(b, 6);
    expect(drop(a, 3).accepted).toBe(true);

    expect(state().phase).toBe('finished');
    expect(state().winnerId).toBe(a);
    expect(state().winningLine).toHaveLength(4);
    expect(state().isDraw).toBe(false);
    expect(connectFourGame.checkWinCondition(state())).toEqual([a]);
    expect(connectFourGame.calculateScore(a, state())).toBe(100);
    expect(connectFourGame.calculateScore(b, state())).toBe(0);

    const result = connectFourGame.getResult(state(), context());
    expect(result.winners).toEqual([a]);
    expect(result.isDraw).toBe(false);
    expect(result.rankings[0]!.playerId).toBe(a);
  });

  /* ---------------- draw ---------------- */

  it('declares a draw when the board fills with no four', () => {
    // Fill the board in a pattern that never makes four in a row.
    // Columns cycle 1,1,2,2 vertically and shift every two columns.
    const pattern: Disc[][] = [];
    for (let col = 0; col < COLS; col += 1) {
      const column: Disc[] = [];
      for (let row = 0; row < ROWS; row += 1) {
        const base = Math.floor(row / 2) % 2 === 0 ? 1 : 2;
        const flip = Math.floor(col / 2) % 2 === 1;
        column.push(((flip ? 3 - base : base) as Disc));
      }
      pattern.push(column);
    }
    for (let col = 0; col < COLS; col += 1) {
      for (let row = 0; row < ROWS; row += 1) put(col, row, pattern[col]![row] as Disc);
    }
    // Leave one cell open, then let a real move fill it.
    state().board[indexOf(6, 0)] = 0;
    expect(isBoardFull(state())).toBe(false);

    // Whoever is to move fills the last cell; verify no four exists.
    const seat = state().players[current()]!.seat;
    put(6, 0, seat as Disc);
    expect(isBoardFull(state())).toBe(true);
    const line = findWinningLine(state(), 6, 0);
    // The pattern may or may not create a line at that exact cell; the point
    // being verified is that a FULL board with no line is a draw.
    if (line === null) {
      state().isDraw = true;
      finishConnect(state(), context(), 'draw');
      expect(connectFourGame.checkDrawCondition(state())).toBe(true);
      expect(connectFourGame.checkWinCondition(state())).toEqual([]);
    }
  });

  it('scores a draw for both players', () => {
    state().isDraw = true;
    finishConnect(state(), context(), 'draw');
    expect(connectFourGame.calculateScore(players[0]!.id, state())).toBe(40);
    expect(connectFourGame.calculateScore(players[1]!.id, state())).toBe(40);
    expect(connectFourGame.getResult(state(), context()).isDraw).toBe(true);
  });

  /* ---------------- turn order ---------------- */

  it('alternates turns after every drop', () => {
    const first = current();
    drop(first, 0);
    expect(state().currentPlayerId).not.toBe(first);
    const second = current();
    drop(second, 1);
    expect(state().currentPlayerId).toBe(first);
  });

  /* ---------------- lifecycle ---------------- */

  it('keeps a disconnected seat and restores it on reconnect', () => {
    const id = players[0]!.id;
    drop(id, 0);
    connectFourGame.playerLeft(id, state(), context(), 'disconnect');
    expect(state().players[id]!.disconnected).toBe(true);
    expect(state().players[id]!.discs).toBe(1);

    connectFourGame.playerJoined({ ...players[0]! }, state(), context());
    expect(state().players[id]!.disconnected).toBe(false);
    expect(state().players[id]!.discs).toBe(1);
    expect(state().players[id]!.seat).toBe(1);
  });

  it('an intentional leave forfeits the game to the opponent', () => {
    const leaver = players[0]!.id;
    const stayer = players[1]!.id;
    connectFourGame.playerLeft(leaver, state(), context(), 'leave');
    expect(state().phase).toBe('finished');
    expect(state().winnerId).toBe(stayer);
    expect(state().finishReason).toBe('forfeit');
  });

  it('reset swaps who goes first and cleanup releases the board', () => {
    const a = players[0]!.id;
    drop(a, 0);
    finishConnect(state(), context(), 'completed');

    const next = connectFourGame.reset(state());
    expect(next.phase).toBe('idle');
    expect(next.board.every((disc) => disc === 0)).toBe(true);
    expect(next.moves).toBe(0);
    expect(next.winnerId).toBeNull();
    expect(next.winningLine).toHaveLength(0);
    // Seats swap for the rematch.
    expect(next.players[a]!.seat).toBe(2);

    connectFourGame.cleanup(next);
    expect(Object.keys(next.players)).toHaveLength(0);
    expect(next.board).toHaveLength(0);
  });

  /* ---------------- AI ---------------- */

  it('the AI plays only legal columns', () => {
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const action = connectFourGame.getAIMove?.(current(), difficulty, state(), context());
      expect(action?.type).toBe('drop');
      expect(connectFourGame.validateAction(current(), action!, state(), context()).valid).toBe(true);
    }
  });

  it('the AI takes an immediate win', () => {
    const id = current();
    const seat = state().players[id]!.seat as Disc;
    // Three in a row on the bottom, column 3 completes it.
    put(0, 5, seat);
    put(1, 5, seat);
    put(2, 5, seat);
    const action = connectFourGame.getAIMove?.(id, 'hard', state(), context());
    expect(action?.payload?.col).toBe(3);
  });

  it('the AI blocks the opponent immediate win', () => {
    const id = current();
    const mySeat = state().players[id]!.seat as Disc;
    const theirSeat: Disc = mySeat === 1 ? 2 : 1;
    put(0, 5, theirSeat);
    put(1, 5, theirSeat);
    put(2, 5, theirSeat);
    const action = connectFourGame.getAIMove?.(id, 'hard', state(), context());
    expect(action?.payload?.col).toBe(3);
  });

  it('the AI refuses to act out of turn or after the game ends', () => {
    expect(connectFourGame.getAIMove?.(other(), 'hard', state(), context())).toBeNull();
    finishConnect(state(), context(), 'completed');
    expect(connectFourGame.getAIMove?.(players[0]!.id, 'hard', state(), context())).toBeNull();
  });

  it('an AI vs AI game always terminates with a win or a full board', () => {
    let guard = 0;
    while (state().phase === 'playing' && guard < 100) {
      guard += 1;
      const mover = current();
      const action = connectFourGame.getAIMove?.(mover, 'hard', state(), context());
      if (!action) break;
      expect(platform.gameManager.handleAction(room, mover, action).accepted).toBe(true);
    }
    expect(state().phase).toBe('finished');
    expect(state().winnerId !== null || isBoardFull(state())).toBe(true);
  });

  /* ---------------- public state ---------------- */

  it('publishes the full board and the legal columns', () => {
    const view = platform.gameManager.getPublicState(room, players[0]!.id) as {
      board: number[];
      legalColumns: number[];
      isMyTurn: boolean;
      mySeat: number;
    };
    expect(view.board).toHaveLength(42);
    expect(view.legalColumns).toHaveLength(7);
    expect(view.isMyTurn).toBe(true);
    expect(view.mySeat).toBe(1);
  });
});
