import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createPlayer, createTestPlatform, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  beginReverseRound,
  canStep,
  finishReverse,
  OBJECTIVES,
  reverseRaceGame,
  scoreReverseRound,
  TARGET_COINS,
  TARGET_TIME_MS,
  type ReverseState,
} from './index';
import type { Room } from '../../rooms/Room';

describe('Reverse Race', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'reverse-race', { settings: { rounds: 4 } });
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as ReverseState;
  const context = (): GameContext => platform.gameManager.getContext(room);

  async function startWithPlayers(count: 3 | 4): Promise<void> {
    const local = createTestPlatform();
    const ids = [];
    for (let i = 0; i < count; i += 1) ids.push(await createPlayer(local.platform, `Rr${count}${i}`));
    const extra = local.platform.roomManager.createRoom({
      gameId: 'reverse-race',
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

  it('starts on a live track with a published objective and a clock', () => {
    expect(state().phase).toBe('playing');
    expect(state().totalRounds).toBe(4);
    expect(state().objective.kind).toBe('finish-first');
    expect(state().grid).toHaveLength(6);
    expect(state().endsAt).toBeGreaterThan(context().now());
    expect(OBJECTIVES.map((entry) => entry.kind)).toEqual([
      'finish-first',
      'collect-exact',
      'stop-zone',
      'exact-time',
      'second-place',
    ]);
  });

  it('accepts a legal step, collects a personal token, and rejects walls / client-owned results', () => {
    const playerId = players[0]!.id;
    const player = state().players[playerId]!;
    const legal = (['up', 'down', 'left', 'right'] as const).find((direction) => {
      const delta = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[direction];
      return canStep(state().grid, player.x + delta[0], player.y + delta[1]);
    });
    expect(legal).toBeTruthy();
    expect(platform.gameManager.handleAction(room, playerId, { type: 'move', payload: { direction: legal } }).accepted).toBe(
      true,
    );

    player.x = 3;
    player.y = 2;
    expect(platform.gameManager.handleAction(room, playerId, { type: 'move', payload: { direction: 'right' } }).accepted).toBe(
      true,
    );
    expect(player.coins).toBe(1);
    expect(player.collected).toContain('4,2');

    expect(reverseRaceGame.validateAction(playerId, { type: 'score', payload: { score: 999 } }, state(), context()).valid).toBe(
      false,
    );
    expect(reverseRaceGame.validateAction(playerId, { type: 'finish' }, state(), context()).valid).toBe(false);
    expect(reverseRaceGame.validateAction(playerId, { type: 'win' }, state(), context()).valid).toBe(false);
    expect(reverseRaceGame.handlePlayerAction(playerId, { type: 'score' }, state(), context()).accepted).toBe(false);
    player.x = 1;
    player.y = 1;
    expect(
      reverseRaceGame.validateAction(playerId, { type: 'move', payload: { direction: 'left' } }, state(), context()).valid,
    ).toBe(false);
  });

  it('scores finish-first, second-place, exact-time, collect-exact and stop-zone on the server', () => {
    const [first, second] = players.map((player) => player.id);
    state().finishOrder = [first, second];
    state().players[first]!.finished = true;
    state().players[second]!.finished = true;
    state().objective = OBJECTIVES[0]!;
    scoreReverseRound(state());
    expect(state().players[first]!.roundScore).toBe(100);
    expect(state().players[second]!.roundScore).toBe(60);

    state().players[first]!.score = 0;
    state().players[second]!.score = 0;
    state().objective = OBJECTIVES.find((entry) => entry.kind === 'second-place')!;
    scoreReverseRound(state());
    expect(state().players[second]!.roundScore).toBe(100);
    expect(state().players[first]!.roundScore).toBe(15);

    state().players[first]!.score = 0;
    state().players[first]!.finishMs = TARGET_TIME_MS;
    state().objective = OBJECTIVES.find((entry) => entry.kind === 'exact-time')!;
    scoreReverseRound(state());
    expect(state().players[first]!.roundScore).toBe(100);

    state().players[first]!.score = 0;
    state().players[first]!.coins = TARGET_COINS;
    state().players[second]!.coins = TARGET_COINS + 1;
    state().objective = OBJECTIVES.find((entry) => entry.kind === 'collect-exact')!;
    scoreReverseRound(state());
    expect(state().players[first]!.roundScore).toBe(100);
    expect(state().players[second]!.roundScore).toBe(40);

    state().players[first]!.score = 0;
    state().players[first]!.x = 7;
    state().players[first]!.y = 2;
    state().objective = OBJECTIVES.find((entry) => entry.kind === 'stop-zone')!;
    scoreReverseRound(state());
    expect(state().players[first]!.roundScore).toBe(100);
  });

  it('timeout ranks by score; reset keeps seats; cleanup empties players', () => {
    const seats = Object.keys(state().players);
    state().players[seats[0]!]!.score = 140;
    finishReverse(state(), context(), 'timeout');
    expect(state().finishReason).toBe('timeout');
    const draft = reverseRaceGame.getResult(state(), context());
    expect(draft.winners).toEqual([seats[0]]);
    expect(draft.isDraw).toBe(false);
    state().players[seats[1]!]!.score = 140;
    const draw = reverseRaceGame.getResult(state(), context());
    expect(draw.isDraw).toBe(true);
    const next = reverseRaceGame.reset(state());
    expect(Object.keys(next.players)).toEqual(seats);
    expect(next.phase).toBe('idle');
    expect(next.players[seats[0]!]!.score).toBe(0);
    reverseRaceGame.cleanup(next);
    expect(Object.keys(next.players)).toHaveLength(0);
  });

  it('disconnect, reconnect and leave', () => {
    const [first, second] = players.map((player) => player.id);
    reverseRaceGame.playerLeft(first, state(), context(), 'disconnect');
    expect(state().players[first]!.disconnected).toBe(true);
    reverseRaceGame.playerJoined({ ...players[0]!, id: first }, state(), context());
    expect(state().players[first]!.disconnected).toBe(false);
    reverseRaceGame.playerLeft(first, state(), context(), 'leave');
    reverseRaceGame.playerLeft(second, state(), context(), 'leave');
    expect(state().phase).toBe('finished');
  });

  it('AI returns a legal one-cell move', () => {
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const move = reverseRaceGame.getAIMove?.(players[0]!.id, difficulty, state(), context());
      expect(move?.type).toBe('move');
      expect(reverseRaceGame.validateAction(players[0]!.id, move!, state(), context()).valid).toBe(true);
    }
  });

  it('cycles objectives across rounds and initialises 3 and 4 player matches', async () => {
    beginReverseRound(state(), context(), 1);
    expect(state().objective.kind).toBe('collect-exact');
    beginReverseRound(state(), context(), 2);
    expect(state().objective.kind).toBe('stop-zone');
    for (const count of [3, 4] as const) {
      await startWithPlayers(count);
      expect(Object.keys(state().players)).toHaveLength(count);
      const keys = new Set(Object.values(state().players).map((player) => `${player.x},${player.y}`));
      expect(keys.size).toBe(count);
    }
  });
});
