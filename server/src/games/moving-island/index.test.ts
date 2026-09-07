import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createPlayer, createTestPlatform, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  applyFall,
  CHECKPOINT_SCORE,
  CHECKPOINTS,
  FALL_PENALTY,
  finishIsland,
  makePlatforms,
  MATCH_MS,
  movingIslandGame,
  onPlatform,
  START,
  tickPlatforms,
  tryIslandMove,
  type IslandState,
} from './index';
import type { Room } from '../../rooms/Room';

describe('Moving Island', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'moving-island');
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as IslandState;
  const context = (): GameContext => platform.gameManager.getContext(room);

  async function startWithPlayers(count: 3 | 4): Promise<void> {
    const local = createTestPlatform();
    const ids = [];
    for (let i = 0; i < count; i += 1) ids.push(await createPlayer(local.platform, `Mi${count}${i}`));
    const extra = local.platform.roomManager.createRoom({
      gameId: 'moving-island',
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

  it('builds sliding, blinking, spinning and static platforms', () => {
    const platforms = makePlatforms();
    expect(platforms.some((platform) => platform.kind === 'horiz')).toBe(true);
    expect(platforms.some((platform) => platform.kind === 'vert')).toBe(true);
    expect(platforms.some((platform) => platform.kind === 'blink')).toBe(true);
    expect(platforms.some((platform) => platform.kind === 'spin')).toBe(true);
    expect(onPlatform(START.x, START.y, platforms)).toBe(true);
    const moving = platforms.find((platform) => platform.kind === 'horiz')!;
    const before = moving.x;
    tickPlatforms(platforms, 800);
    expect(moving.x).not.toBe(before);
  });

  it('starts playing on the start island with a live clock', () => {
    expect(state().phase).toBe('playing');
    expect(Object.keys(state().players)).toHaveLength(2);
    expect(onPlatform(state().players[players[0]!.id]!.x, state().players[players[0]!.id]!.y, state().platforms)).toBe(true);
    expect(state().endsAt).toBe(state().startedAt! + MATCH_MS);
  });

  it('accepts a legal step and rejects teleport / client scores', () => {
    const playerId = players[0]!.id;
    const moved = platform.gameManager.handleAction(room, playerId, { type: 'move', payload: { dx: 1, dy: 0 } });
    expect(moved.accepted).toBe(true);
    expect(movingIslandGame.validateAction(playerId, { type: 'score', payload: { score: 9 } }, state(), context()).valid).toBe(
      false,
    );
    expect(movingIslandGame.validateAction(playerId, { type: 'finish' }, state(), context()).valid).toBe(false);
    expect(movingIslandGame.validateAction(playerId, { type: 'teleport' }, state(), context()).valid).toBe(false);
    expect(
      movingIslandGame.validateAction(playerId, { type: 'move', payload: { dx: 9, dy: 0 } }, state(), context()).valid,
    ).toBe(false);
  });

  it('falls back to the last checkpoint instead of eliminating', () => {
    const playerId = players[0]!.id;
    const player = state().players[playerId]!;
    player.checkpoint = 1;
    player.score = 40;
    player.x = 0.3;
    player.y = 0.3;
    applyFall(player, state());
    expect(player.fallen).toBe(1);
    expect(player.score).toBe(40 - FALL_PENALTY);
    expect(player.x).toBe(CHECKPOINTS[0]!.x);
    expect(player.y).toBe(CHECKPOINTS[0]!.y);
    expect(state().phase).toBe('playing');
  });

  it('awards a checkpoint and a finish on the server', () => {
    const playerId = players[0]!.id;
    const player = state().players[playerId]!;
    player.x = CHECKPOINTS[0]!.x - 0.1;
    player.y = CHECKPOINTS[0]!.y;
    expect(tryIslandMove(playerId, 1, 0, state(), context())).toBe(true);
    expect(player.checkpoint).toBeGreaterThanOrEqual(1);
    expect(player.score).toBeGreaterThanOrEqual(CHECKPOINT_SCORE);
    player.x = state().finish.x - 0.2;
    player.y = state().finish.y;
    tryIslandMove(playerId, 1, 0, state(), context());
    expect(player.finished).toBe(true);
    expect(player.score).toBeGreaterThan(CHECKPOINT_SCORE);
  });

  it('timeout ranks by score; reset keeps seats; cleanup empties players', () => {
    const seats = Object.keys(state().players);
    state().players[seats[0]!]!.score = 90;
    finishIsland(state(), context(), 'timeout');
    expect(state().finishReason).toBe('timeout');
    const next = movingIslandGame.reset(state());
    expect(Object.keys(next.players)).toEqual(seats);
    expect(next.phase).toBe('idle');
    movingIslandGame.cleanup(next);
    expect(Object.keys(next.players)).toHaveLength(0);
  });

  it('disconnect, reconnect and leave', () => {
    const [first, second] = players.map((player) => player.id);
    movingIslandGame.playerLeft(first, state(), context(), 'disconnect');
    expect(state().players[first]!.disconnected).toBe(true);
    movingIslandGame.playerJoined({ ...players[0]!, id: first }, state(), context());
    expect(state().players[first]!.disconnected).toBe(false);
    movingIslandGame.playerLeft(first, state(), context(), 'leave');
    movingIslandGame.playerLeft(second, state(), context(), 'leave');
    expect(state().phase).toBe('finished');
  });

  it('AI returns a legal move', () => {
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const move = movingIslandGame.getAIMove?.(players[0]!.id, difficulty, state(), context());
      expect(move?.type).toBe('move');
      expect(movingIslandGame.validateAction(players[0]!.id, move!, state(), context()).valid).toBe(true);
    }
  });

  it('initialises 3 and 4 player matches', async () => {
    for (const count of [3, 4] as const) {
      await startWithPlayers(count);
      expect(Object.keys(state().players)).toHaveLength(count);
      expect(state().phase).toBe('playing');
    }
  });
});
