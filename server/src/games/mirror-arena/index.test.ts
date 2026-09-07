import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createPlayer, createTestPlatform, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  CRYSTAL_SCORE,
  EXIT_SCORE,
  finishMirror,
  FREEZE_MS,
  mirrorArenaGame,
  mirrorX,
  refreshPlates,
  type MirrorState,
} from './index';
import type { Room } from '../../rooms/Room';

describe('Mirror Arena', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'mirror-arena');
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as MirrorState;
  const context = (): GameContext => platform.gameManager.getContext(room);

  async function startWithPlayers(count: 3 | 4): Promise<void> {
    const local = createTestPlatform();
    const ids = [];
    for (let i = 0; i < count; i += 1) ids.push(await createPlayer(local.platform, `Ma${count}${i}`));
    const extra = local.platform.roomManager.createRoom({
      gameId: 'mirror-arena',
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

  it('starts with a symmetric arena, a live clock and mirrored starts', () => {
    expect(state().phase).toBe('playing');
    expect(state().cols).toBe(11);
    expect(mirrorX(2)).toBe(8);
    expect(mirrorX(5)).toBe(5);
    const player = state().players[players[0]!.id]!;
    expect(player.mx).toBe(mirrorX(player.x));
    expect(player.my).toBe(player.y);
    expect(state().endsAt).toBeGreaterThan(context().now());
    expect(state().gatesOpen).toBe(false);
  });

  it('mirrors a step, collects with the twin, and rejects client-owned results', () => {
    const playerId = players[0]!.id;
    const player = state().players[playerId]!;
    expect(platform.gameManager.handleAction(room, playerId, { type: 'move', payload: { direction: 'right' } }).accepted).toBe(
      true,
    );
    expect(player.x).toBe(2);
    expect(player.y).toBe(1);
    expect(player.mx).toBe(mirrorX(player.x));
    expect(player.my).toBe(player.y);
    expect(player.crystals).toBeGreaterThanOrEqual(1);
    expect(player.score).toBeGreaterThanOrEqual(CRYSTAL_SCORE);

    expect(mirrorArenaGame.validateAction(playerId, { type: 'score', payload: { score: 99 } }, state(), context()).valid).toBe(
      false,
    );
    expect(mirrorArenaGame.validateAction(playerId, { type: 'mirror' }, state(), context()).valid).toBe(false);
    expect(mirrorArenaGame.validateAction(playerId, { type: 'open' }, state(), context()).valid).toBe(false);
    expect(mirrorArenaGame.handlePlayerAction(playerId, { type: 'open' }, state(), context()).accepted).toBe(false);
  });

  it('holds both plates with one body plus its mirror, then scores an open-gate exit', () => {
    const [runnerId, holderId] = players.map((player) => player.id);
    const holder = state().players[holderId]!;
    holder.x = 2;
    holder.y = 3;
    holder.mx = mirrorX(2);
    holder.my = 3;
    refreshPlates(state());
    expect(state().plates.every((plate) => plate.held)).toBe(true);
    expect(state().gatesOpen).toBe(true);
    const runner = state().players[runnerId]!;
    runner.x = 1;
    runner.y = 2;
    runner.mx = mirrorX(1);
    runner.my = 2;
    expect(platform.gameManager.handleAction(room, runnerId, { type: 'move', payload: { direction: 'down' } }).accepted).toBe(
      true,
    );
    expect(runner.exited).toBe(true);
    expect(runner.score).toBeGreaterThanOrEqual(EXIT_SCORE);
  });

  it('freezes on a hazard and refuses a closed-gate step', () => {
    const playerId = players[0]!.id;
    const player = state().players[playerId]!;
    player.x = 3;
    player.y = 3;
    player.mx = mirrorX(3);
    player.my = 3;
    state().gatesOpen = false;
    expect(
      mirrorArenaGame.validateAction(playerId, { type: 'move', payload: { direction: 'right' } }, state(), context()).valid,
    ).toBe(false);
    player.x = 4;
    player.y = 4;
    player.mx = mirrorX(4);
    player.my = 4;
    expect(platform.gameManager.handleAction(room, playerId, { type: 'move', payload: { direction: 'down' } }).accepted).toBe(
      true,
    );
    expect(player.frozenUntil).toBeGreaterThan(context().now());
    expect(player.frozenUntil - context().now()).toBeGreaterThanOrEqual(FREEZE_MS - 5);
  });

  it('timeout ranks by score; reset keeps seats; cleanup empties players', () => {
    const seats = Object.keys(state().players);
    state().players[seats[0]!]!.score = 80;
    finishMirror(state(), context(), 'timeout');
    expect(state().finishReason).toBe('timeout');
    const next = mirrorArenaGame.reset(state());
    expect(Object.keys(next.players)).toEqual(seats);
    expect(next.phase).toBe('idle');
    expect(next.players[seats[0]!]!.score).toBe(0);
    mirrorArenaGame.cleanup(next);
    expect(Object.keys(next.players)).toHaveLength(0);
  });

  it('disconnect, reconnect and leave', () => {
    const [first, second] = players.map((player) => player.id);
    mirrorArenaGame.playerLeft(first, state(), context(), 'disconnect');
    expect(state().players[first]!.disconnected).toBe(true);
    mirrorArenaGame.playerJoined({ ...players[0]!, id: first }, state(), context());
    expect(state().players[first]!.disconnected).toBe(false);
    mirrorArenaGame.playerLeft(first, state(), context(), 'leave');
    mirrorArenaGame.playerLeft(second, state(), context(), 'leave');
    expect(state().phase).toBe('finished');
  });

  it('AI returns a legal mirrored step', () => {
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const move = mirrorArenaGame.getAIMove?.(players[0]!.id, difficulty, state(), context());
      expect(move?.type).toBe('move');
      expect(mirrorArenaGame.validateAction(players[0]!.id, move!, state(), context()).valid).toBe(true);
    }
  });

  it('initialises 3 and 4 player matches with distinct starts', async () => {
    for (const count of [3, 4] as const) {
      await startWithPlayers(count);
      expect(Object.keys(state().players)).toHaveLength(count);
      const keys = new Set(Object.values(state().players).map((player) => `${player.x},${player.y}`));
      expect(keys.size).toBe(count);
    }
  });
});
