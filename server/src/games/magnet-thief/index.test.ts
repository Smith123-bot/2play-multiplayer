import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createPlayer, createTestPlatform, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  finishMagnet,
  inSafeCorner,
  MAGNET_COOLDOWN,
  MAGNET_RANGE,
  magnetThiefGame,
  pullGems,
  SAFE_CORNERS,
  type MagnetState,
} from './index';
import type { Room } from '../../rooms/Room';

describe('Magnet Thief', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'magnet-thief');
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as MagnetState;
  const context = (): GameContext => platform.gameManager.getContext(room);

  async function startWithPlayers(count: 3 | 4): Promise<void> {
    const local = createTestPlatform();
    const ids = [];
    for (let i = 0; i < count; i += 1) ids.push(await createPlayer(local.platform, `Mt${count}${i}`));
    const extra = local.platform.roomManager.createRoom({
      gameId: 'magnet-thief',
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

  it('starts with gems, distinct safe corners and a live clock', () => {
    expect(state().phase).toBe('playing');
    expect(state().gems.length).toBeGreaterThan(0);
    expect(MAGNET_RANGE).toBe(3);
    expect(MAGNET_COOLDOWN).toBe(2_000);
    const keys = new Set(Object.values(state().players).map((player) => `${player.x},${player.y}`));
    expect(keys.size).toBe(2);
    expect(inSafeCorner(SAFE_CORNERS[0]!.x, SAFE_CORNERS[0]!.y)).toBe(true);
  });

  it('accepts movement, pulls in range, and rejects self-grant / score cheats', () => {
    const playerId = players[0]!.id;
    const moved = platform.gameManager.handleAction(room, playerId, { type: 'move', payload: { dx: 1, dy: 0 } });
    expect(moved.accepted).toBe(true);
    expect(magnetThiefGame.validateAction(playerId, { type: 'grant' }, state(), context()).valid).toBe(false);
    expect(magnetThiefGame.validateAction(playerId, { type: 'own' }, state(), context()).valid).toBe(false);
    expect(magnetThiefGame.validateAction(playerId, { type: 'score', payload: { score: 99 } }, state(), context()).valid).toBe(
      false,
    );
    expect(magnetThiefGame.handlePlayerAction(playerId, { type: 'grant' }, state(), context()).accepted).toBe(false);
  });

  it('attracts an unowned gem in range and enforces cooldown', () => {
    const playerId = players[0]!.id;
    const player = state().players[playerId]!;
    const gem = state().gems[0]!;
    player.x = gem.x;
    player.y = gem.y;
    const pulled = pullGems(playerId, state(), context());
    expect(pulled.ok).toBe(true);
    expect(gem.ownerId).toBe(playerId);
    expect(player.score).toBeGreaterThanOrEqual(gem.value);
    expect(player.carrying).toContain(gem.id);
    expect(magnetThiefGame.validateAction(playerId, { type: 'pull' }, state(), context()).valid).toBe(false);
  });

  it('steals a gem outside a safe corner and refuses a steal inside one', () => {
    const [thief, owner] = players.map((player) => player.id);
    const gem = state().gems[0]!;
    gem.ownerId = owner;
    state().players[owner]!.carrying = [gem.id];
    state().players[owner]!.score = gem.value;
    state().players[owner]!.x = 9;
    state().players[owner]!.y = 6;
    gem.x = 9;
    gem.y = 6;
    const thiefPlayer = state().players[thief]!;
    thiefPlayer.x = 9;
    thiefPlayer.y = 6;
    thiefPlayer.lastPullAt = -MAGNET_COOLDOWN;
    expect(pullGems(thief, state(), context()).ok).toBe(true);
    expect(gem.ownerId).toBe(thief);
    expect(state().players[thief]!.stolen).toBe(1);
    expect(state().players[owner]!.carrying).not.toContain(gem.id);

    gem.ownerId = owner;
    state().players[owner]!.carrying = [gem.id];
    state().players[owner]!.x = SAFE_CORNERS[0]!.x;
    state().players[owner]!.y = SAFE_CORNERS[0]!.y;
    gem.x = SAFE_CORNERS[0]!.x;
    gem.y = SAFE_CORNERS[0]!.y;
    thiefPlayer.x = SAFE_CORNERS[0]!.x;
    thiefPlayer.y = SAFE_CORNERS[0]!.y;
    thiefPlayer.lastPullAt = -MAGNET_COOLDOWN;
    pullGems(thief, state(), context());
    expect(gem.ownerId).toBe(owner);
  });

  it('timeout ranks by score; reset keeps seats; cleanup empties players', () => {
    const seats = Object.keys(state().players);
    state().players[seats[0]!]!.score = 55;
    finishMagnet(state(), context(), 'timeout');
    expect(state().finishReason).toBe('timeout');
    const next = magnetThiefGame.reset(state());
    expect(Object.keys(next.players)).toEqual(seats);
    expect(next.phase).toBe('idle');
    magnetThiefGame.cleanup(next);
    expect(Object.keys(next.players)).toHaveLength(0);
  });

  it('disconnect, reconnect and leave', () => {
    const [first, second] = players.map((player) => player.id);
    magnetThiefGame.playerLeft(first, state(), context(), 'disconnect');
    expect(state().players[first]!.disconnected).toBe(true);
    magnetThiefGame.playerJoined({ ...players[0]!, id: first }, state(), context());
    expect(state().players[first]!.disconnected).toBe(false);
    magnetThiefGame.playerLeft(first, state(), context(), 'leave');
    magnetThiefGame.playerLeft(second, state(), context(), 'leave');
    expect(state().phase).toBe('finished');
  });

  it('AI returns a legal move or pull', () => {
    const move = magnetThiefGame.getAIMove?.(players[0]!.id, 'hard', state(), context());
    expect(move?.type === 'move' || move?.type === 'pull').toBe(true);
    if (move) expect(magnetThiefGame.validateAction(players[0]!.id, move, state(), context()).valid).toBe(true);
  });

  it('initialises 3 and 4 player matches with distinct corners', async () => {
    for (const count of [3, 4] as const) {
      await startWithPlayers(count);
      expect(Object.keys(state().players)).toHaveLength(count);
      const keys = new Set(Object.values(state().players).map((player) => `${player.x},${player.y}`));
      expect(keys.size).toBe(count);
    }
  });
});
