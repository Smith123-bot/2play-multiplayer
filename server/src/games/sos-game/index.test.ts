import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createTestPlatform, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  BOARD_SIZES,
  DEFAULT_SIZE,
  emptyCells,
  findNewLines,
  finishSos,
  idx,
  isBoardFull,
  scoreOfPlacement,
  sosGame,
  type SosLetter,
  type SosState,
} from './index';
import type { Room } from '../../rooms/Room';

describe('SOS Game', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'sos-game');
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as SosState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const place = (playerId: string, index: number, letter: SosLetter) =>
    platform.gameManager.handleAction(room, playerId, { type: 'place', payload: { index, letter } });
  const current = () => state().currentPlayerId as string;
  const other = () => players.map((p) => p.id).find((id) => id !== current()) as string;
  const at = (col: number, row: number) => idx(state(), col, row);
  /** Writes a letter directly, for detection tests. */
  const put = (col: number, row: number, letter: SosLetter) => {
    state().board[at(col, row)] = letter;
  };

  /* ---------------- setup ---------------- */

  it('initialises an empty 5x5 board', () => {
    expect(state().phase).toBe('playing');
    expect(state().size).toBe(DEFAULT_SIZE);
    expect(state().board).toHaveLength(25);
    expect(state().board.every((cell) => cell === null)).toBe(true);
    expect(state().lines).toHaveLength(0);
    expect(state().currentPlayerId).toBe(players[0]!.id);
    expect(state().turnEndsAt).toBeGreaterThan(context().now());
  });

  it('honours the lobby board size', async () => {
    const local = createTestPlatform();
    const fixture = await createGameFixture(local.platform, 'sos-game', { settings: { gridSize: '6x6' } });
    const s = fixture.room.gameState as SosState;
    expect(s.size).toBe(BOARD_SIZES['6x6']);
    expect(s.board).toHaveLength(36);
    local.destroy();
  });

  /* ---------------- placement ---------------- */

  it('places S and O on empty cells', () => {
    const first = current();
    expect(place(first, at(0, 0), 'S').accepted).toBe(true);
    expect(state().board[at(0, 0)]).toBe('S');
    expect(place(current(), at(1, 0), 'O').accepted).toBe(true);
    expect(state().board[at(1, 0)]).toBe('O');
    expect(state().moves).toBe(2);
  });

  it('rejects an occupied cell, a bad index, a bad letter and out of turn play', () => {
    const ctx = context();
    const first = current();
    place(first, at(2, 2), 'S');

    // Occupied.
    expect(place(current(), at(2, 2), 'O').accepted).toBe(false);
    // Out of turn.
    expect(place(other(), at(0, 0), 'S').accepted).toBe(false);
    // Bad index / letter.
    for (const payload of [
      { index: -1, letter: 'S' },
      { index: 999, letter: 'S' },
      { index: 0, letter: 'X' },
      { index: 0, letter: 5 },
      { index: 'a', letter: 'S' },
      {},
    ]) {
      expect(sosGame.validateAction(current(), { type: 'place', payload }, state(), ctx).valid).toBe(false);
    }
    // Client cannot assert a result.
    for (const type of ['score', 'win', 'finish', 'complete', 'board']) {
      expect(sosGame.validateAction(current(), { type, payload: { score: 99 } }, state(), ctx).valid).toBe(false);
      expect(sosGame.handlePlayerAction(current(), { type }, state(), ctx).accepted).toBe(false);
    }
  });

  it('rejects everything once the game is over', () => {
    const id = current();
    finishSos(state(), context(), 'completed');
    expect(place(id, at(0, 0), 'S').accepted).toBe(false);
  });

  /* ---------------- SOS detection ---------------- */

  it('detects a horizontal SOS', () => {
    put(0, 0, 'S');
    put(1, 0, 'O');
    put(2, 0, 'S');
    expect(findNewLines(state(), 2, 0)).toHaveLength(1);
    // Detected from the middle cell too.
    expect(findNewLines(state(), 1, 0)).toHaveLength(1);
  });

  it('detects a vertical SOS', () => {
    put(0, 0, 'S');
    put(0, 1, 'O');
    put(0, 2, 'S');
    expect(findNewLines(state(), 0, 2)).toHaveLength(1);
  });

  it('detects both diagonal SOS directions', () => {
    put(0, 0, 'S');
    put(1, 1, 'O');
    put(2, 2, 'S');
    expect(findNewLines(state(), 2, 2)).toHaveLength(1);

    state().board = new Array(25).fill(null);
    put(2, 0, 'S');
    put(1, 1, 'O');
    put(0, 2, 'S');
    expect(findNewLines(state(), 0, 2)).toHaveLength(1);
  });

  it('detects multiple SOS lines created by a single placement', () => {
    // Place an O at the centre with S on both sides horizontally AND vertically.
    put(1, 2, 'S');
    put(3, 2, 'S');
    put(2, 1, 'S');
    put(2, 3, 'S');
    put(2, 2, 'O');
    const lines = findNewLines(state(), 2, 2);
    expect(lines).toHaveLength(2); // horizontal + vertical
  });

  it('never counts the same three cells twice', () => {
    put(0, 0, 'S');
    put(1, 0, 'O');
    put(2, 0, 'S');
    const lines = findNewLines(state(), 1, 0);
    const keys = lines.map((line) => [...line].sort((a, b) => a - b).join(','));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('does not detect a partial or wrong pattern', () => {
    put(0, 0, 'S');
    put(1, 0, 'O');
    expect(findNewLines(state(), 1, 0)).toHaveLength(0);

    state().board = new Array(25).fill(null);
    put(0, 0, 'O');
    put(1, 0, 'S');
    put(2, 0, 'O');
    expect(findNewLines(state(), 1, 0)).toHaveLength(0); // O-S-O is not SOS
  });

  /* ---------------- scoring and extra turns ---------------- */

  it('scores an SOS and grants an extra turn', () => {
    const player = current();
    put(0, 0, 'S');
    put(1, 0, 'O');
    // Completing the pattern scores and keeps the turn.
    expect(place(player, at(2, 0), 'S').accepted).toBe(true);
    expect(state().players[player]!.score).toBe(1);
    expect(state().lines).toHaveLength(1);
    expect(state().currentPlayerId).toBe(player);
    expect(state().extraTurn).toBe(true);
    expect(state().players[player]!.extraTurns).toBe(1);
    expect(state().lastEvent).toBe(`sos:${player}:1`);
  });

  it('passes the turn when no SOS is created', () => {
    const player = current();
    expect(place(player, at(4, 4), 'S').accepted).toBe(true);
    expect(state().players[player]!.score).toBe(0);
    expect(state().currentPlayerId).not.toBe(player);
    expect(state().extraTurn).toBe(false);
  });

  it('awards a point for every line made by one placement', () => {
    const player = current();
    put(1, 2, 'S');
    put(3, 2, 'S');
    put(2, 1, 'S');
    put(2, 3, 'S');
    expect(place(player, at(2, 2), 'O').accepted).toBe(true);
    expect(state().players[player]!.score).toBe(2);
    expect(state().lines).toHaveLength(2);
  });

  /* ---------------- game end ---------------- */

  it('ends when the board is full and the higher score wins', () => {
    const a = players[0]!.id;
    const b = players[1]!.id;
    // Fill every cell except one, then let the current player finish it.
    for (let i = 0; i < state().board.length; i += 1) state().board[i] = 'O';
    state().board[at(4, 4)] = null;
    state().players[a]!.score = 3;
    state().players[b]!.score = 1;

    expect(place(current(), at(4, 4), 'O').accepted).toBe(true);
    expect(isBoardFull(state())).toBe(true);
    expect(state().phase).toBe('finished');
    expect(state().winnerId).toBe(a);
    expect(state().isDraw).toBe(false);
    expect(sosGame.checkWinCondition(state())).toEqual([a]);

    const result = sosGame.getResult(state(), context());
    expect(result.winners).toEqual([a]);
    expect(result.rankings[0]!.playerId).toBe(a);
    expect(result.rankings[0]!.stats).toHaveProperty('sosCreated');
  });

  it('declares a draw on equal scores', () => {
    const a = players[0]!.id;
    const b = players[1]!.id;
    for (let i = 0; i < state().board.length; i += 1) state().board[i] = 'O';
    state().board[at(4, 4)] = null;
    state().players[a]!.score = 2;
    state().players[b]!.score = 2;

    place(current(), at(4, 4), 'O');
    expect(state().phase).toBe('finished');
    expect(state().isDraw).toBe(true);
    expect(state().winnerId).toBeNull();
    expect(sosGame.checkDrawCondition(state())).toBe(true);
    expect(sosGame.getResult(state(), context()).isDraw).toBe(true);
  });

  /* ---------------- lifecycle ---------------- */

  it('handles disconnect, reconnect and leave', () => {
    const id = players[0]!.id;
    place(id, at(0, 0), 'S');
    sosGame.playerLeft(id, state(), context(), 'disconnect');
    expect(state().players[id]!.disconnected).toBe(true);
    expect(state().players[id]!.moves).toBe(1);

    sosGame.playerJoined({ ...players[0]! }, state(), context());
    expect(state().players[id]!.disconnected).toBe(false);
    expect(state().players[id]!.moves).toBe(1);

    sosGame.playerLeft(id, state(), context(), 'leave');
    expect(state().phase).toBe('finished');
    expect(state().winnerId).toBe(players[1]!.id);
    expect(state().finishReason).toBe('forfeit');
  });

  it('reset and cleanup prepare a rematch', () => {
    place(current(), at(0, 0), 'S');
    finishSos(state(), context(), 'completed');
    const next = sosGame.reset(state());
    expect(next.phase).toBe('idle');
    expect(next.board.every((cell) => cell === null)).toBe(true);
    expect(next.lines).toHaveLength(0);
    expect(next.moves).toBe(0);
    expect(Object.values(next.players).every((slot) => slot.score === 0)).toBe(true);

    sosGame.cleanup(next);
    expect(Object.keys(next.players)).toHaveLength(0);
    expect(next.board).toHaveLength(0);
  });

  /* ---------------- AI ---------------- */

  it('the AI only plays legal placements', () => {
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const action = sosGame.getAIMove?.(current(), difficulty, state(), context());
      expect(action?.type).toBe('place');
      expect(sosGame.validateAction(current(), action!, state(), context()).valid).toBe(true);
    }
  });

  it('the AI takes an available SOS', () => {
    const id = current();
    put(0, 0, 'S');
    put(1, 0, 'O');
    // Placing S at (2,0) scores.
    expect(scoreOfPlacement(state(), at(2, 0), 'S')).toBe(1);
    const action = sosGame.getAIMove?.(id, 'hard', state(), context());
    expect(action?.payload?.index).toBe(at(2, 0));
    expect(action?.payload?.letter).toBe('S');
  });

  it('the AI refuses to act out of turn or after the game ends', () => {
    expect(sosGame.getAIMove?.(other(), 'hard', state(), context())).toBeNull();
    finishSos(state(), context(), 'completed');
    expect(sosGame.getAIMove?.(players[0]!.id, 'hard', state(), context())).toBeNull();
  });

  it('an AI vs AI game fills the board and produces a result', () => {
    let guard = 0;
    while (state().phase === 'playing' && guard < 200) {
      guard += 1;
      const mover = current();
      const action = sosGame.getAIMove?.(mover, 'medium', state(), context());
      if (!action) break;
      expect(platform.gameManager.handleAction(room, mover, action).accepted).toBe(true);
    }
    expect(state().phase).toBe('finished');
    expect(isBoardFull(state())).toBe(true);
    expect(emptyCells(state())).toHaveLength(0);
    // Every recorded line must really be S-O-S on the final board.
    for (const line of state().lines) {
      const [a, b, c] = line.cells;
      expect(state().board[a]).toBe('S');
      expect(state().board[b]).toBe('O');
      expect(state().board[c]).toBe('S');
    }
  });

  /* ---------------- public state ---------------- */

  it('publishes the board, lines and scores', () => {
    const view = platform.gameManager.getPublicState(room, players[0]!.id) as {
      board: unknown[];
      lines: unknown[];
      isMyTurn: boolean;
      size: number;
    };
    expect(view.board).toHaveLength(25);
    expect(view.size).toBe(5);
    expect(view.isMyTurn).toBe(true);
    expect(view.lines).toHaveLength(0);
  });
});
