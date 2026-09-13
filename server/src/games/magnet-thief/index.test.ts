import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createGameFixture,
  createPlayer,
  createTestPlatform,
  type TestPlatform,
} from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  activateMagnet,
  canMagnetMove,
  finishMagnet,
  inSafeCorner,
  MAGNET_COOLDOWN,
  MAGNET_RANGE,
  magnetThiefGame,
  pickPassableStep,
  pullGems,
  SAFE_CORNERS,
  tryMagnetMove,
  type MagnetState,
} from './index';
import type { Room } from '../../rooms/Room';
import { MAGNET_OBSTACLES, spawnGems } from './index';
import { createRandom } from '@2play/shared';

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
    for (let i = 0; i < count; i += 1)
      ids.push(await createPlayer(local.platform, `Mt${count}${i}`));
    const extra = local.platform.roomManager.createRoom({
      gameId: 'magnet-thief',
      maxPlayers: count,
      isPrivate: false,
      host: ids[0]!,
    });
    for (let i = 1; i < count; i += 1)
      local.platform.roomManager.joinRoom({ roomId: extra.id, player: ids[i]! });
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
    const moved = platform.gameManager.handleAction(room, playerId, {
      type: 'move',
      payload: { dx: 1, dy: 0 },
    });
    expect(moved.accepted).toBe(true);
    expect(
      magnetThiefGame.validateAction(playerId, { type: 'grant' }, state(), context()).valid,
    ).toBe(false);
    expect(
      magnetThiefGame.validateAction(playerId, { type: 'own' }, state(), context()).valid,
    ).toBe(false);
    expect(
      magnetThiefGame.validateAction(
        playerId,
        { type: 'score', payload: { score: 99 } },
        state(),
        context(),
      ).valid,
    ).toBe(false);
    expect(
      magnetThiefGame.handlePlayerAction(playerId, { type: 'grant' }, state(), context()).accepted,
    ).toBe(false);
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
    expect(
      magnetThiefGame.validateAction(playerId, { type: 'pull' }, state(), context()).valid,
    ).toBe(false);
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
    if (move)
      expect(magnetThiefGame.validateAction(players[0]!.id, move, state(), context()).valid).toBe(
        true,
      );
  });

  it('AI steers around an obstacle instead of freezing against it', () => {
    // Regression: with a gem directly behind an obstacle the AI used to answer
    // with the same blocked axis-aligned step forever, so it never moved again
    // for the rest of the match ("An obstacle blocks the way." on every intent).
    const [thief] = players.map((player) => player.id);
    const thiefState = state().players[thief]!;
    const gem = state().gems[0]!;

    // Obstacle #1 sits at (6, 4) with radius 1.05; park the thief to its left
    // and the gem to its right so the straight horizontal route is blocked.
    thiefState.x = 4.6;
    thiefState.y = 4;
    gem.x = 8;
    gem.y = 4;
    gem.ownerId = null;
    thiefState.carrying = [];
    thiefState.lastPullAt = Number.MAX_SAFE_INTEGER; // keep the magnet cooling

    // The direct step really is blocked...
    expect(tryMagnetMove({ ...thiefState }, 1, 0, state().obstacles)).toBe(false);
    expect(canMagnetMove(thiefState, 1, 0, state().obstacles)).toBe(false);

    // ...so the AI must pick a different direction the server will accept.
    const move = magnetThiefGame.getAIMove?.(thief, 'hard', state(), context());
    expect(move?.type).toBe('move');
    expect(magnetThiefGame.validateAction(thief, move!, state(), context()).valid).toBe(true);

    const dx = Number(move?.payload?.dx ?? 0);
    const dy = Number(move?.payload?.dy ?? 0);
    expect(tryMagnetMove(thiefState, dx, dy, state().obstacles)).toBe(true);
    // It must have actually gone somewhere.
    expect(thiefState.x !== 4.6 || thiefState.y !== 4).toBe(true);
  });

  it('pickPassableStep never returns a blocked direction and holds still only when boxed in', () => {
    const player = { ...state().players[players[0]!.id]!, x: 4.6, y: 4 };
    const step = pickPassableStep(player, { x: 8, y: 4 }, state().obstacles);
    expect(canMagnetMove(player, step.dx, step.dy, state().obstacles)).toBe(true);
    // Intent envelope limits: |dx|,|dy| <= 1.05 and hypot <= 1.1.
    expect(Math.abs(step.dx)).toBeLessThanOrEqual(1.05);
    expect(Math.abs(step.dy)).toBeLessThanOrEqual(1.05);
    expect(Math.hypot(step.dx, step.dy)).toBeLessThanOrEqual(1.1);

    // Surrounded on every side → hold position rather than emit a rejected move.
    const boxed = { ...player, x: 6, y: 4 };
    const ring = [
      { x: 6.45, y: 4, radius: 1.4 },
      { x: 5.55, y: 4, radius: 1.4 },
      { x: 6, y: 4.45, radius: 1.4 },
      { x: 6, y: 3.55, radius: 1.4 },
      { x: 6.32, y: 4.32, radius: 1.4 },
      { x: 6.32, y: 3.68, radius: 1.4 },
      { x: 5.68, y: 4.32, radius: 1.4 },
      { x: 5.68, y: 3.68, radius: 1.4 },
    ];
    expect(pickPassableStep(boxed, { x: 1, y: 1 }, ring)).toEqual({ dx: 0, dy: 0 });
  });

  it('initialises 3 and 4 player matches with distinct corners', async () => {
    for (const count of [3, 4] as const) {
      await startWithPlayers(count);
      expect(Object.keys(state().players)).toHaveLength(count);
      const keys = new Set(
        Object.values(state().players).map((player) => `${player.x},${player.y}`),
      );
      expect(keys.size).toBe(count);
    }
  });

  it('uses force over distance, blocks obstacle movement, and repels exposed loot', () => {
    const [thief, owner] = players.map((player) => player.id);
    const thiefState = state().players[thief]!;
    const ownerState = state().players[owner]!;
    const gem = state().gems[0]!;
    thiefState.x = 5;
    thiefState.y = 2;
    gem.x = 7.5;
    gem.y = 2;
    gem.ownerId = null;
    thiefState.lastPullAt = -MAGNET_COOLDOWN;
    const before = gem.x;
    expect(activateMagnet(thief, state(), context(), 'pull').affected).toContain(gem.id);
    expect(gem.x).toBeLessThan(before);
    expect(gem.ownerId).toBeNull();

    thiefState.x = 6;
    thiefState.y = 2.5;
    expect(tryMagnetMove(thiefState, 0, 1, state().obstacles)).toBe(false);

    ownerState.x = 7;
    ownerState.y = 2;
    ownerState.score = gem.value;
    ownerState.carrying = [gem.id];
    gem.x = ownerState.x;
    gem.y = ownerState.y;
    gem.ownerId = owner;
    thiefState.x = 5;
    thiefState.y = 2;
    thiefState.lastPullAt = -MAGNET_COOLDOWN;
    expect(activateMagnet(thief, state(), context(), 'repel').affected).toContain(gem.id);
    expect(gem.ownerId).toBeNull();
    expect(ownerState.score).toBe(0);
  });

  it('rejects stale movement sequences and advances difficulty stages', () => {
    const playerId = players[0]!.id;
    expect(
      platform.gameManager.handleAction(room, playerId, {
        type: 'move',
        payload: { dx: 0, dy: 1, sequence: 2 },
      }).accepted,
    ).toBe(true);
    expect(
      platform.gameManager.handleAction(room, playerId, {
        type: 'move',
        payload: { dx: 0, dy: 1, sequence: 1 },
      }).accepted,
    ).toBe(false);
    state().nextStageAt = context().now() - 1;
    magnetThiefGame.update(state(), 16, context());
    expect(state().stage).toBe(2);
  });
});

describe('Magnet Thief content variety', () => {
  /** Deterministic PRNG per case so a failure is reproducible. */
  const rng = (seed: number) => createRandom(seed);
  const blocked = (x: number, y: number) =>
    MAGNET_OBSTACLES.some((o) => Math.hypot(x - o.x, y - o.y) < o.radius + 0.38);

  it('scatters gems differently on every match', () => {
    const layouts = new Set<string>();
    for (let seed = 1; seed <= 60; seed += 1) {
      layouts.add(spawnGems(8, rng(seed * 7919)).map((g) => `${g.x.toFixed(3)},${g.y.toFixed(3)}`).sort().join('|'));
    }
    // Before randomization this was a single fixed layout derived from the index.
    expect(layouts.size).toBeGreaterThan(50);
  });

  it('always returns exactly 8 collectable, non-overlapping gems', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const gems = spawnGems(8, rng(seed));
      expect(gems).toHaveLength(8);

      const cells = new Set<string>();
      for (const gem of gems) {
        // A gem inside the blocked zone around an obstacle could never be
        // reached, which would make the round unfairly unwinnable.
        expect(blocked(gem.x, gem.y)).toBe(false);
        expect(inSafeCorner(gem.x, gem.y)).toBe(false);
        expect(gem.x).toBeGreaterThan(0.4);
        expect(gem.y).toBeGreaterThan(0.4);
        const key = `${Math.round(gem.x)}:${Math.round(gem.y)}`;
        expect(cells.has(key)).toBe(false);
        cells.add(key);
      }
      // Scoring is unchanged: the 10/15/20 rotation is positional.
      expect(gems.map((g) => g.value)).toEqual([10, 15, 20, 10, 15, 20, 10, 15]);
    }
  });

  it('still yields a full legal layout from a degenerate random source', () => {
    // A pathological PRNG must not stall or short-change the round; the
    // deterministic fallback tops the layout up.
    for (const value of [0, 0.9999]) {
      const gems = spawnGems(8, () => value);
      expect(gems).toHaveLength(8);
      expect(new Set(gems.map((g) => `${Math.round(g.x)}:${Math.round(g.y)}`)).size).toBe(8);
      expect(gems.every((g) => !blocked(g.x, g.y))).toBe(true);
    }
  });

  it('keeps the deterministic layout when no random source is supplied', () => {
    expect(spawnGems(8)).toHaveLength(8);
    expect(spawnGems(8).map((g) => `${g.x},${g.y}`).join('|')).toBe(
      spawnGems(8).map((g) => `${g.x},${g.y}`).join('|'),
    );
  });
});
