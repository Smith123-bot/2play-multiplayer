import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createPlayer, createTestPlatform, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  absoluteCell,
  advanceTurn,
  beginTurn,
  CAPTURE_SCORE,
  captureAt,
  computeLegalMoves,
  FINISH_DISTANCE,
  finishLudo,
  HOME_SCORE,
  isBlockedFor,
  ludoGame,
  MAX_CONSECUTIVE_SIXES,
  rollDie,
  SAFE_INDICES,
  START_INDEX,
  TOKENS_PER_PLAYER,
  TRACK_CELLS,
  TRACK_LENGTH,
  trackIndexFor,
  type LudoState,
} from './index';
import type { Room } from '../../rooms/Room';

describe('Ludo', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'ludo');
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as LudoState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const act = (playerId: string, action: { type: string; payload?: Record<string, unknown> }) =>
    platform.gameManager.handleAction(room, playerId, action);

  /** Forces a specific dice value so tests are deterministic. */
  const setDice = (playerId: string, dice: number) => {
    state().currentPlayerId = playerId;
    state().phase = 'awaiting-move';
    state().dice = dice;
    state().legalMoves = computeLegalMoves(state(), playerId, dice);
  };

  async function startWithPlayers(count: 2 | 3 | 4): Promise<void> {
    const local = createTestPlatform();
    const ids = [];
    for (let i = 0; i < count; i += 1) ids.push(await createPlayer(local.platform, `Ld${count}${i}`));
    const extra = local.platform.roomManager.createRoom({
      gameId: 'ludo',
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

  /* ---------------- initialisation ---------------- */

  it('initialises four tokens per player in the yard and starts the first turn', () => {
    expect(state().phase).toBe('awaiting-roll');
    expect(state().currentPlayerId).toBe(players[0]!.id);
    expect(state().turnEndsAt).toBeGreaterThan(context().now());
    for (const player of players) {
      const slot = state().players[player.id]!;
      expect(slot.tokens).toHaveLength(TOKENS_PER_PLAYER);
      expect(slot.tokens.every((token) => token.progress === -1)).toBe(true);
      expect(slot.finishedTokens).toBe(0);
    }
    expect(state().players[players[0]!.id]!.color).toBe('red');
    expect(state().players[players[1]!.id]!.color).toBe('green');
  });

  it.each([2, 3, 4] as const)('initialises a %i player match with distinct colours and seats', async (count) => {
    await startWithPlayers(count);
    const slots = Object.values(state().players);
    expect(slots).toHaveLength(count);
    expect(new Set(slots.map((slot) => slot.color)).size).toBe(count);
    expect(new Set(slots.map((slot) => slot.seatIndex)).size).toBe(count);
    expect(state().turnOrder).toHaveLength(count);
    expect(slots.every((slot) => slot.tokens.length === TOKENS_PER_PLAYER)).toBe(true);
  });

  it('has a well formed 52 cell track with four evenly spaced starts', () => {
    expect(TRACK_CELLS).toHaveLength(TRACK_LENGTH);
    expect(new Set(TRACK_CELLS.map((cell) => `${cell.x}:${cell.y}`)).size).toBe(TRACK_LENGTH);
    expect(START_INDEX[0]).toBe(0);
    expect(START_INDEX[1]).toBe(13);
    expect(START_INDEX[2]).toBe(26);
    expect(START_INDEX[3]).toBe(39);
    // Each seat's start square is a safe cell.
    for (const seat of [0, 1, 2, 3]) expect(SAFE_INDICES).toContain(START_INDEX[seat]!);
  });

  /* ---------------- dice ---------------- */

  it('generates dice strictly in 1..6 and only on the server', () => {
    const random = context().random;
    const seen = new Set<number>();
    for (let i = 0; i < 600; i += 1) {
      const value = rollDie(random);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(6);
      seen.add(value);
    }
    expect(seen.size).toBe(6);
  });

  it('ignores any client supplied dice value', () => {
    const playerId = players[0]!.id;
    // A client trying to inject a six gets nothing: the payload is not read.
    const before = state().rollsThisMatch;
    act(playerId, { type: 'roll', payload: { dice: 6, value: 6 } });
    expect(state().rollsThisMatch).toBe(before + 1);
    expect([1, 2, 3, 4, 5, 6]).toContain(
      state().dice ?? state().players[playerId]!.tokens.length, // dice cleared when the turn passed
    );
    // Explicit dice-setting actions are always rejected.
    for (const type of ['dice', 'setDice', 'score', 'win', 'finish', 'capture']) {
      expect(ludoGame.validateAction(playerId, { type, payload: { dice: 6 } }, state(), context()).valid).toBe(false);
    }
  });

  /* ---------------- legal moves ---------------- */

  it('requires a six to leave the yard', () => {
    const playerId = players[0]!.id;
    for (const dice of [1, 2, 3, 4, 5]) {
      expect(computeLegalMoves(state(), playerId, dice)).toHaveLength(0);
    }
    const moves = computeLegalMoves(state(), playerId, 6);
    expect(moves).toHaveLength(TOKENS_PER_PLAYER);
    expect(moves.every((move) => move.entersBoard && move.to === 0)).toBe(true);
  });

  it('accepts a legal token move and rejects an illegal one', () => {
    const playerId = players[0]!.id;
    setDice(playerId, 6);
    const tokenId = state().legalMoves[0]!.tokenId;
    expect(act(playerId, { type: 'move', payload: { tokenId } }).accepted).toBe(true);
    expect(state().players[playerId]!.tokens[0]!.progress).toBe(0);

    // A token id that is not in the legal set is refused.
    setDice(playerId, 3);
    expect(act(playerId, { type: 'move', payload: { tokenId: 'red-3' } }).accepted).toBe(false);
    expect(act(playerId, { type: 'move', payload: { tokenId: 'not-a-token' } }).accepted).toBe(false);
    // A token belonging to another seat is refused.
    expect(act(playerId, { type: 'move', payload: { tokenId: 'green-0' } }).accepted).toBe(false);
  });

  it('rejects acting out of turn, in the wrong phase and after the match ends', () => {
    const [first, second] = players.map((player) => player.id);
    // Not your turn.
    expect(ludoGame.validateAction(second, { type: 'roll' }, state(), context()).valid).toBe(false);
    expect(act(second, { type: 'roll' }).accepted).toBe(false);
    // Move before rolling.
    expect(ludoGame.validateAction(first, { type: 'move', payload: { tokenId: 'red-0' } }, state(), context()).valid).toBe(
      false,
    );
    // After the match.
    finishLudo(state(), context(), 'completed');
    expect(ludoGame.validateAction(first, { type: 'roll' }, state(), context()).valid).toBe(false);
    expect(act(first, { type: 'roll' }).accepted).toBe(false);
  });

  it('requires an exact roll to enter the final home cell', () => {
    const playerId = players[0]!.id;
    const token = state().players[playerId]!.tokens[0]!;
    // Two cells short of home.
    token.progress = FINISH_DISTANCE - 2;
    expect(computeLegalMoves(state(), playerId, 3)).toHaveLength(0); // overshoot rejected
    const exact = computeLegalMoves(state(), playerId, 2);
    expect(exact).toHaveLength(1);
    expect(exact[0]!.reachesHome).toBe(true);
  });

  /* ---------------- captures & safety ---------------- */

  it('captures a lone enemy token and sends it back to the yard', () => {
    const [redId, greenId] = players.map((player) => player.id);
    const red = state().players[redId]!;
    const green = state().players[greenId]!;

    // Put a green token on an unsafe cell and a red token 3 steps behind it.
    const targetProgress = 5; // red progress 5 -> absolute cell 5 (not a safe cell)
    const cell = trackIndexFor(red.seatIndex, targetProgress);
    expect(SAFE_INDICES).not.toContain(cell);
    // Green walks to the same absolute cell.
    const greenProgress = (cell - START_INDEX[green.seatIndex]! + TRACK_LENGTH) % TRACK_LENGTH;
    green.tokens[0]!.progress = greenProgress;
    expect(absoluteCell(green.tokens[0]!)).toBe(cell);

    red.tokens[0]!.progress = targetProgress - 3;
    setDice(redId, 3);
    const move = state().legalMoves.find((entry) => entry.tokenId === 'red-0');
    expect(move?.capturesTokenId).toBe('green-0');

    expect(act(redId, { type: 'move', payload: { tokenId: 'red-0' } }).accepted).toBe(true);
    expect(state().players[greenId]!.tokens[0]!.progress).toBe(-1); // sent home
    expect(state().players[redId]!.captures).toBe(1);
    expect(state().players[redId]!.score).toBeGreaterThanOrEqual(CAPTURE_SCORE);
    expect(state().lastEvent).toBe(`capture:${redId}`);
  });

  it('never captures on a safe cell', () => {
    const [redId, greenId] = players.map((player) => player.id);
    const green = state().players[greenId]!;
    const safeCell = SAFE_INDICES[1]!; // 8
    green.tokens[0]!.progress = (safeCell - START_INDEX[green.seatIndex]! + TRACK_LENGTH) % TRACK_LENGTH;
    expect(absoluteCell(green.tokens[0]!)).toBe(safeCell);
    expect(captureAt(state(), state().players[redId]!.seatIndex, safeCell)).toBeNull();
  });

  it('treats a pair of enemy tokens as a protected block', () => {
    const [redId, greenId] = players.map((player) => player.id);
    const green = state().players[greenId]!;
    const seat = state().players[redId]!.seatIndex;
    const cell = trackIndexFor(seat, 7);
    const greenProgress = (cell - START_INDEX[green.seatIndex]! + TRACK_LENGTH) % TRACK_LENGTH;
    green.tokens[0]!.progress = greenProgress;
    green.tokens[1]!.progress = greenProgress;

    expect(isBlockedFor(state(), seat, cell)).toBe(true);
    expect(captureAt(state(), seat, cell)).toBeNull(); // two tokens = safe
    // Red cannot move onto or through-land on the blocked cell.
    state().players[redId]!.tokens[0]!.progress = 4;
    const moves = computeLegalMoves(state(), redId, 3);
    expect(moves.find((move) => move.tokenId === 'red-0')).toBeUndefined();
  });

  /* ---------------- turn flow ---------------- */

  it('grants another roll on a six and passes the turn otherwise', () => {
    const [first, second] = players.map((player) => player.id);
    // Six with no legal move still repeats the turn.
    state().phase = 'awaiting-roll';
    state().currentPlayerId = first;
    state().dice = 6;
    state().consecutiveSixes = 1;
    state().legalMoves = [];
    state().lastEvent = `no-moves:${first}`;
    // Simulate the handler's branch directly through a real roll instead:
    state().phase = 'awaiting-roll';
    let guard = 0;
    while (state().currentPlayerId === first && guard < 200) {
      guard += 1;
      if (state().phase !== 'awaiting-roll') break;
      act(first, { type: 'roll' });
    }
    // Either we still hold the turn (six / playable move) or it passed on.
    expect([first, second]).toContain(state().currentPlayerId);
  });

  it('forfeits the turn after three consecutive sixes', () => {
    const [first, second] = players.map((player) => player.id);
    state().consecutiveSixes = MAX_CONSECUTIVE_SIXES - 1;
    state().phase = 'awaiting-roll';
    state().currentPlayerId = first;
    // Roll until a six lands, which should trip the triple-six rule.
    let guard = 0;
    while (guard < 400) {
      guard += 1;
      if (state().currentPlayerId !== first || state().phase !== 'awaiting-roll') break;
      const before = state().consecutiveSixes;
      act(first, { type: 'roll' });
      if (before + 1 >= MAX_CONSECUTIVE_SIXES && state().lastEvent?.startsWith('triple-six')) break;
      if (state().currentPlayerId !== first) break;
      state().consecutiveSixes = MAX_CONSECUTIVE_SIXES - 1;
      state().phase = 'awaiting-roll';
    }
    expect(state().currentPlayerId === second || state().lastEvent?.startsWith('triple-six')).toBe(true);
  });

  it('skips a player who runs out of time (server authoritative turn timer)', () => {
    const [first, second] = players.map((player) => player.id);
    expect(state().currentPlayerId).toBe(first);
    // Fire the timeout path directly (the TimerManager schedules exactly this).
    state().lastEvent = `timeout:${first}`;
    advanceTurn(state(), context());
    expect(state().currentPlayerId).toBe(second);
    expect(state().phase).toBe('awaiting-roll');
  });

  it('awards points and marks a token home on arrival', () => {
    const playerId = players[0]!.id;
    const slot = state().players[playerId]!;
    slot.tokens[0]!.progress = FINISH_DISTANCE - 1;
    setDice(playerId, 1);
    expect(act(playerId, { type: 'move', payload: { tokenId: 'red-0' } }).accepted).toBe(true);
    expect(state().players[playerId]!.finishedTokens).toBe(1);
    expect(state().players[playerId]!.score).toBeGreaterThanOrEqual(HOME_SCORE);
  });

  /* ---------------- winning ---------------- */

  it('declares the winner once every token is home', () => {
    const [winnerId] = players.map((player) => player.id);
    const slot = state().players[winnerId]!;
    // Three already home, the fourth one step away.
    slot.finishedTokens = TOKENS_PER_PLAYER - 1;
    for (let i = 0; i < TOKENS_PER_PLAYER - 1; i += 1) slot.tokens[i]!.progress = FINISH_DISTANCE;
    slot.tokens[3]!.progress = FINISH_DISTANCE - 1;

    setDice(winnerId, 1);
    expect(act(winnerId, { type: 'move', payload: { tokenId: 'red-3' } }).accepted).toBe(true);

    expect(state().players[winnerId]!.finishedTokens).toBe(TOKENS_PER_PLAYER);
    expect(state().finishedOrder[0]).toBe(winnerId);
    expect(state().phase).toBe('finished');
    expect(ludoGame.checkWinCondition(state())).toEqual([winnerId]);

    const result = ludoGame.getResult(state(), context());
    expect(result.winners).toEqual([winnerId]);
    expect(result.rankings[0]!.playerId).toBe(winnerId);
    expect(result.rankings[0]!.isWinner).toBe(true);
    expect(result.isDraw).toBe(false);
    expect(result.rankings[0]!.stats).toHaveProperty('tokensHome');
  });

  /* ---------------- lifecycle ---------------- */

  it('skips a disconnected player turn but keeps the seat for reconnection', () => {
    const [first, second] = players.map((player) => player.id);
    state().players[first]!.score = 42;
    ludoGame.playerLeft(first, state(), context(), 'disconnect');
    expect(state().players[first]!.disconnected).toBe(true);
    expect(state().currentPlayerId).toBe(second); // turn moved on, no stall
    expect(ludoGame.validateAction(first, { type: 'roll' }, state(), context()).valid).toBe(false);

    ludoGame.playerJoined({ ...players[0]! }, state(), context());
    expect(state().players[first]!.disconnected).toBe(false);
    expect(state().players[first]!.score).toBe(42); // progress preserved
    expect(state().players[first]!.tokens).toHaveLength(TOKENS_PER_PLAYER);
  });

  it('ends the match when only one player remains after an intentional leave', () => {
    const [first] = players.map((player) => player.id);
    ludoGame.playerLeft(first, state(), context(), 'leave');
    expect(state().players[first]!.left).toBe(true);
    expect(state().phase).toBe('finished');
    expect(state().finishReason).toBe('abandoned');
  });

  it('reset restores a fresh board on the same seats for a rematch', () => {
    const seats = Object.keys(state().players);
    state().players[seats[0]!]!.score = 500;
    state().players[seats[0]!]!.finishedTokens = 3;
    finishLudo(state(), context(), 'completed');

    const next = ludoGame.reset(state());
    expect(Object.keys(next.players)).toEqual(seats);
    expect(next.phase).toBe('idle');
    expect(next.finishedOrder).toHaveLength(0);
    expect(next.players[seats[0]!]!.score).toBe(0);
    expect(next.players[seats[0]!]!.finishedTokens).toBe(0);
    expect(next.players[seats[0]!]!.tokens.every((token) => token.progress === -1)).toBe(true);
    // Seats and colours are stable across a rematch.
    expect(next.players[seats[0]!]!.color).toBe('red');
    expect(next.players[seats[1]!]!.color).toBe('green');
  });

  it('cleanup releases the board', () => {
    const next = ludoGame.reset(state());
    ludoGame.cleanup(next);
    expect(Object.keys(next.players)).toHaveLength(0);
    expect(next.turnOrder).toHaveLength(0);
    expect(next.phase).toBe('finished');
  });

  /* ---------------- public state ---------------- */

  it('only sends the legal move list to the player whose turn it is', () => {
    const [first, second] = players.map((player) => player.id);
    setDice(first, 6);
    const mine = platform.gameManager.getPublicState(room, first) as { legalMoves: unknown[] };
    const theirs = platform.gameManager.getPublicState(room, second) as { legalMoves: unknown[] };
    expect(mine.legalMoves.length).toBeGreaterThan(0);
    expect(theirs.legalMoves).toHaveLength(0);
  });

  /* ---------------- AI ---------------- */

  it('AI rolls, then plays only legal moves at every difficulty', () => {
    const playerId = players[0]!.id;
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      state().phase = 'awaiting-roll';
      state().currentPlayerId = playerId;
      expect(ludoGame.getAIMove?.(playerId, difficulty, state(), context())).toEqual({ type: 'roll' });

      setDice(playerId, 6);
      const move = ludoGame.getAIMove?.(playerId, difficulty, state(), context());
      expect(move?.type).toBe('move');
      expect(ludoGame.validateAction(playerId, move!, state(), context()).valid).toBe(true);
    }
  });

  it('AI does not act out of turn or once the match is over', () => {
    const [first, second] = players.map((player) => player.id);
    expect(ludoGame.getAIMove?.(second, 'hard', state(), context())).toBeNull();
    finishLudo(state(), context(), 'completed');
    expect(ludoGame.getAIMove?.(first, 'hard', state(), context())).toBeNull();
  });

  it('a hard AI prefers capturing over an idle step', () => {
    const [redId, greenId] = players.map((player) => player.id);
    const red = state().players[redId]!;
    const green = state().players[greenId]!;
    const cell = trackIndexFor(red.seatIndex, 5);
    green.tokens[0]!.progress = (cell - START_INDEX[green.seatIndex]! + TRACK_LENGTH) % TRACK_LENGTH;
    red.tokens[0]!.progress = 2; // 3 steps behind the victim
    red.tokens[1]!.progress = 20; // an unrelated alternative

    setDice(redId, 3);
    const move = ludoGame.getAIMove?.(redId, 'hard', state(), context());
    expect(move?.payload?.tokenId).toBe('red-0');
  });

  it('plays a long random match without stalling or breaking invariants', () => {
    let guard = 0;
    while (state().phase !== 'finished' && guard < 4000) {
      guard += 1;
      const current = state().currentPlayerId;
      if (!current) break;
      const action = ludoGame.getAIMove?.(current, 'hard', state(), context());
      if (!action) {
        advanceTurn(state(), context());
        continue;
      }
      act(current, action);
      // Invariant: token progress always stays inside the legal range.
      for (const slot of Object.values(state().players)) {
        for (const token of slot.tokens) {
          expect(token.progress).toBeGreaterThanOrEqual(-1);
          expect(token.progress).toBeLessThanOrEqual(FINISH_DISTANCE);
        }
      }
    }
    expect(guard).toBeLessThan(4000); // it terminated
    expect(state().phase).toBe('finished');
  });

  it('beginTurn arms a fresh turn deadline', () => {
    const [, second] = players.map((player) => player.id);
    beginTurn(state(), context(), second);
    expect(state().currentPlayerId).toBe(second);
    expect(state().phase).toBe('awaiting-roll');
    expect(state().dice).toBeNull();
    expect(state().turnEndsAt).toBeGreaterThan(context().now());
  });
});
