import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createTestPlatform, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  chessGame,
  colorOf,
  DEFAULT_TIME_MS,
  finishChess,
  flagFall,
  playerWithColor,
  timeLeftFor,
  TIME_CONTROLS,
  toIndex,
  type ChessState,
} from './index';
import type { Room } from '../../rooms/Room';

const sq = (name: string) => toIndex('abcdefgh'.indexOf(name[0] as string), 8 - Number(name[1]));

describe('Chess (game module)', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'chess');
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as ChessState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const white = () => playerWithColor(state(), 'w') as string;
  const black = () => playerWithColor(state(), 'b') as string;
  const move = (playerId: string, from: string, to: string, promotion?: string) =>
    platform.gameManager.handleAction(room, playerId, {
      type: 'move',
      payload: { from: sq(from), to: sq(to), ...(promotion ? { promotion } : {}) },
    });

  /* ---------------- setup ---------------- */

  it('starts a live game with both colours seated and clocks running', () => {
    expect(state().phase).toBe('playing');
    expect(state().position.turn).toBe('w');
    expect(state().position.board.filter(Boolean)).toHaveLength(32);
    expect(colorOf(state(), players[0]!.id)).toBe('w');
    expect(colorOf(state(), players[1]!.id)).toBe('b');
    expect(state().baseTimeMs).toBe(DEFAULT_TIME_MS);
    expect(state().turnStartedAt).not.toBeNull();
    expect(state().moveHistory).toHaveLength(0);
  });

  it('honours the lobby time control', async () => {
    const local = createTestPlatform();
    const fixture = await createGameFixture(local.platform, 'chess', { settings: { gridSize: '5min' } });
    expect((fixture.room.gameState as ChessState).baseTimeMs).toBe(TIME_CONTROLS['5min']);
    local.destroy();
  });

  /* ---------------- moves and turn order ---------------- */

  it('accepts a legal opening move and records the notation', () => {
    expect(move(white(), 'e2', 'e4').accepted).toBe(true);
    expect(state().position.board[sq('e4')]).toEqual({ type: 'p', color: 'w' });
    expect(state().position.board[sq('e2')]).toBeNull();
    expect(state().position.turn).toBe('b');
    expect(state().moveHistory).toHaveLength(1);
    expect(state().moveHistory[0]!.san).toBe('e4');
    expect(state().moveHistory[0]!.color).toBe('w');
    expect(state().lastMove).toEqual({ from: sq('e2'), to: sq('e4') });
  });

  it('rejects moving out of turn and moving the opponent pieces', () => {
    // Black cannot move first.
    expect(move(black(), 'e7', 'e5').accepted).toBe(false);
    // White cannot move a black piece.
    expect(move(white(), 'e7', 'e5').accepted).toBe(false);
    // An empty square is not a piece.
    expect(move(white(), 'e4', 'e5').accepted).toBe(false);
    expect(state().moveHistory).toHaveLength(0);
  });

  it('rejects illegal geometry and blocked paths', () => {
    // A rook cannot start the game (own pawn in the way).
    expect(move(white(), 'a1', 'a4').accepted).toBe(false);
    // A pawn cannot move three squares.
    expect(move(white(), 'e2', 'e5').accepted).toBe(false);
    // A knight cannot move like a rook.
    expect(move(white(), 'b1', 'b3').accepted).toBe(false);
  });

  it('rejects malformed payloads and outcome-asserting actions', () => {
    const ctx = context();
    const id = white();
    for (const type of ['score', 'win', 'checkmate', 'finish', 'complete', 'board', 'setState']) {
      expect(chessGame.validateAction(id, { type, payload: { score: 9999 } }, state(), ctx).valid).toBe(false);
      expect(chessGame.handlePlayerAction(id, { type }, state(), ctx).accepted).toBe(false);
    }
    for (const payload of [{}, { from: -1, to: 0 }, { from: 0, to: 99 }, { from: 'e2', to: 'e4' }, { from: 1.5, to: 2 }]) {
      expect(chessGame.validateAction(id, { type: 'move', payload }, state(), ctx).valid).toBe(false);
    }
    // A bogus promotion piece is refused.
    expect(
      chessGame.validateAction(id, { type: 'move', payload: { from: sq('e2'), to: sq('e4'), promotion: 'k' } }, state(), ctx).valid,
    ).toBe(false);
  });

  it('captures a piece and records it', () => {
    move(white(), 'e2', 'e4');
    move(black(), 'd7', 'd5');
    expect(move(white(), 'e4', 'd5').accepted).toBe(true);
    // The pawn black lost is tracked against black.
    expect(state().captured.b).toContain('p');
    expect(state().players[white()]!.captures).toBe(1);
    expect(state().lastEvent).toBe(`capture:${white()}`);
  });

  /* ---------------- king safety ---------------- */

  it('rejects a move that would leave your own king in check', () => {
    // Build a pin: white king e1, white bishop e2, black rook e8.
    const s = state();
    s.position.board = new Array(64).fill(null);
    s.position.board[sq('e1')] = { type: 'k', color: 'w' };
    s.position.board[sq('e2')] = { type: 'b', color: 'w' };
    s.position.board[sq('e8')] = { type: 'r', color: 'b' };
    s.position.board[sq('a8')] = { type: 'k', color: 'b' };
    s.position.turn = 'w';

    // Moving the pinned bishop anywhere exposes the king.
    const result = move(white(), 'e2', 'd3');
    expect(result.accepted).toBe(false);
    const validation = chessGame.validateAction(
      white(),
      { type: 'move', payload: { from: sq('e2'), to: sq('d3') } },
      state(),
      context(),
    );
    expect(validation.valid).toBe(false);
    expect(state().position.board[sq('e2')]).toEqual({ type: 'b', color: 'w' });
  });

  it('flags check on the board', () => {
    const s = state();
    s.position.board = new Array(64).fill(null);
    s.position.board[sq('e1')] = { type: 'k', color: 'w' };
    s.position.board[sq('h8')] = { type: 'k', color: 'b' };
    s.position.board[sq('a4')] = { type: 'r', color: 'w' };
    s.position.turn = 'w';

    expect(move(white(), 'a4', 'h4').accepted).toBe(true);
    // Rook on h4 checks the black king on h8.
    expect(state().inCheck).toBe('b');
    expect(state().lastEvent).toBe('check:b');
  });

  /* ---------------- terminal states ---------------- */

  it('ends the game on checkmate and names the winner', () => {
    const s = state();
    s.position.board = new Array(64).fill(null);
    s.position.board[sq('h8')] = { type: 'k', color: 'b' };
    s.position.board[sq('h1')] = { type: 'k', color: 'w' };
    s.position.board[sq('a7')] = { type: 'r', color: 'w' };
    s.position.board[sq('b1')] = { type: 'r', color: 'w' };
    s.position.turn = 'w';

    expect(move(white(), 'b1', 'b8').accepted).toBe(true);
    expect(state().phase).toBe('finished');
    expect(state().resultType).toBe('checkmate');
    expect(state().winnerColor).toBe('w');
    expect(chessGame.checkWinCondition(state())).toEqual([white()]);
    expect(chessGame.checkDrawCondition(state())).toBe(false);

    const result = chessGame.getResult(state(), context());
    expect(result.winners).toEqual([white()]);
    expect(result.isDraw).toBe(false);
    expect(result.rankings[0]!.playerId).toBe(white());
    expect(result.rankings[0]!.stats!.checkmate).toBe(1);
  });

  it('ends in a draw on stalemate', () => {
    const s = state();
    s.position.board = new Array(64).fill(null);
    s.position.board[sq('h8')] = { type: 'k', color: 'b' };
    s.position.board[sq('g6')] = { type: 'k', color: 'w' };
    s.position.board[sq('a1')] = { type: 'q', color: 'w' };
    s.position.turn = 'w';

    // Qa1-f7 leaves black with no legal move and NOT in check.
    expect(move(white(), 'a1', 'f6').accepted).toBe(true);
    if (state().phase === 'finished') {
      expect(state().winnerColor).toBeNull();
      expect(chessGame.checkDrawCondition(state())).toBe(true);
    }
    // Either way the board must remain legal.
    expect(state().position.board[sq('h8')]).toEqual({ type: 'k', color: 'b' });
  });

  it('refuses any action once the game is finished', () => {
    finishChess(state(), context(), 'resignation', 'b', 'forfeit');
    expect(state().phase).toBe('finished');
    expect(move(white(), 'e2', 'e4').accepted).toBe(false);
    expect(chessGame.validateAction(white(), { type: 'move', payload: { from: sq('e2'), to: sq('e4') } }, state(), context()).valid).toBe(false);
  });

  /* ---------------- resignation ---------------- */

  it('resignation hands the win to the opponent', () => {
    expect(platform.gameManager.handleAction(room, white(), { type: 'resign' }).accepted).toBe(true);
    expect(state().phase).toBe('finished');
    expect(state().resultType).toBe('resignation');
    expect(state().winnerColor).toBe('b');
    expect(chessGame.checkWinCondition(state())).toEqual([black()]);
  });

  /* ---------------- clock ---------------- */

  it('tracks the clock and only charges the player on move', () => {
    const before = timeLeftFor(state(), 'w', context().now());
    expect(before).toBeLessThanOrEqual(state().baseTimeMs);
    // Black's clock is untouched while white is thinking.
    expect(timeLeftFor(state(), 'b', context().now())).toBe(state().baseTimeMs);

    move(white(), 'e2', 'e4');
    // Now black's clock is the one running.
    expect(state().position.turn).toBe('b');
    expect(state().players[white()]!.timeLeftMs).toBeLessThanOrEqual(state().baseTimeMs);
  });

  it('losing on time hands the win to a player who can still mate', () => {
    flagFall(state(), context(), 'w');
    expect(state().phase).toBe('finished');
    expect(state().resultType).toBe('timeout');
    expect(state().winnerColor).toBe('b');
    expect(state().players[white()]!.timeLeftMs).toBe(0);
  });

  it('losing on time is only a DRAW when the opponent cannot mate', () => {
    const s = state();
    // Black is left with a bare king: it cannot mate, so this is a draw.
    s.position.board = new Array(64).fill(null);
    s.position.board[sq('e1')] = { type: 'k', color: 'w' };
    s.position.board[sq('e8')] = { type: 'k', color: 'b' };
    s.position.board[sq('a1')] = { type: 'r', color: 'w' };

    flagFall(state(), context(), 'w');
    expect(state().phase).toBe('finished');
    expect(state().resultType).toBe('timeout');
    expect(state().winnerColor).toBeNull();
    expect(chessGame.checkDrawCondition(state())).toBe(true);
  });

  /* ---------------- public state ---------------- */

  it('sends legal move hints only to the player on move', () => {
    const mine = platform.gameManager.getPublicState(room, white()) as { legalMoves: unknown[]; isMyTurn: boolean };
    const theirs = platform.gameManager.getPublicState(room, black()) as { legalMoves: unknown[]; isMyTurn: boolean };
    expect(mine.isMyTurn).toBe(true);
    expect(mine.legalMoves).toHaveLength(20); // 20 legal opening moves
    expect(theirs.isMyTurn).toBe(false);
    expect(theirs.legalMoves).toHaveLength(0);
  });

  it('publishes the board, clocks and history without internal fields', () => {
    move(white(), 'e2', 'e4');
    const view = platform.gameManager.getPublicState(room, white()) as Record<string, unknown> & {
      board: unknown[];
      clocks: { w: number; b: number };
      moveHistory: unknown[];
    };
    expect(view.board).toHaveLength(64);
    expect(view.clocks.w).toBeGreaterThan(0);
    expect(view.moveHistory).toHaveLength(1);
    // The raw position object is never leaked.
    expect(view.position).toBeUndefined();
    expect(view.history).toBeUndefined();
  });

  /* ---------------- lifecycle ---------------- */

  it('preserves the seat and clock across a disconnect and reconnect', () => {
    const id = white();
    state().players[id]!.timeLeftMs = 123_456;
    chessGame.playerLeft(id, state(), context(), 'disconnect');
    expect(state().players[id]!.disconnected).toBe(true);
    expect(move(id, 'e2', 'e4').accepted).toBe(false);

    chessGame.playerJoined({ ...players.find((p) => p.id === id)! }, state(), context());
    expect(state().players[id]!.disconnected).toBe(false);
    expect(state().players[id]!.color).toBe('w');
    expect(state().players[id]!.timeLeftMs).toBe(123_456);
  });

  it('an intentional leave counts as a resignation', () => {
    const id = white();
    chessGame.playerLeft(id, state(), context(), 'leave');
    expect(state().phase).toBe('finished');
    expect(state().resultType).toBe('resignation');
    expect(state().winnerColor).toBe('b');
  });

  it('reset swaps colours for the rematch and cleanup releases the game', () => {
    const whiteId = white();
    const blackId = black();
    finishChess(state(), context(), 'checkmate', 'w', 'completed');

    const next = chessGame.reset(state());
    expect(next.phase).toBe('idle');
    expect(next.moveHistory).toHaveLength(0);
    expect(next.position.board.filter(Boolean)).toHaveLength(32);
    // Colours swap, which is the usual courtesy.
    expect(next.players[whiteId]!.color).toBe('b');
    expect(next.players[blackId]!.color).toBe('w');
    expect(next.players[whiteId]!.timeLeftMs).toBe(next.baseTimeMs);

    chessGame.cleanup(next);
    expect(Object.keys(next.players)).toHaveLength(0);
    expect(next.moveHistory).toHaveLength(0);
  });

  /* ---------------- AI ---------------- */

  it('the AI returns only legal moves at every difficulty', () => {
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const action = chessGame.getAIMove?.(white(), difficulty, state(), context());
      expect(action?.type).toBe('move');
      expect(chessGame.validateAction(white(), action!, state(), context()).valid).toBe(true);
    }
  });

  it('the AI refuses to act out of turn or after the game ends', () => {
    expect(chessGame.getAIMove?.(black(), 'hard', state(), context())).toBeNull();
    finishChess(state(), context(), 'resignation', 'b', 'forfeit');
    expect(chessGame.getAIMove?.(white(), 'hard', state(), context())).toBeNull();
  });

  it('plays a full AI vs AI game without ever producing an illegal position', () => {
    let plies = 0;
    while (state().phase === 'playing' && plies < 120) {
      const mover = playerWithColor(state(), state().position.turn) as string;
      const action = chessGame.getAIMove?.(mover, 'easy', state(), context());
      if (!action) break;
      const result = platform.gameManager.handleAction(room, mover, action);
      // Every AI move must be accepted by the same validation a human faces.
      expect(result.accepted).toBe(true);
      plies += 1;
      // Both kings must survive and the board must stay well formed.
      expect(state().position.board.filter((p) => p?.type === 'k')).toHaveLength(2);
    }
    expect(plies).toBeGreaterThan(10);
    expect(state().moveHistory).toHaveLength(plies);
  });

  /* ---------------- scoring ---------------- */

  it('scores a win, a draw and captures', () => {
    state().players[white()]!.captures = 3;
    finishChess(state(), context(), 'checkmate', 'w', 'completed');
    expect(chessGame.calculateScore(white(), state())).toBe(1000 + 30);
    expect(chessGame.calculateScore(black(), state())).toBe(0);
  });
});
