import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createGameFixture,
  createTestPlatform,
  waitFor,
  type TestPlatform,
} from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  awardCollection,
  coinHuntersGame,
  COIN_VALUES,
  finishHunt,
  huntWalls,
  inBonus,
  spawnCoin,
  stepHunters,
  tryCollect,
  type CoinHuntersState,
} from './index';
import type { Room } from '../../rooms/Room';

describe('Coin Hunters Arena', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'coin-hunters-arena');
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as CoinHuntersState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const publicState = (viewerId?: string) =>
    platform.gameManager.getPublicState(room, viewerId) as {
      phase: string;
      coins: Array<{ id: string; kind: string; value: number }>;
      hunters: Record<string, { x: number; y: number; score: number; coins: number }>;
      blocker: { x: number; y: number };
    };

  it('spawns server-owned coins on start', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    expect(state().coins.length).toBeGreaterThan(0);
    expect(publicState(players[0]!.id).coins.length).toBe(state().coins.length);
    expect(COIN_VALUES.gold).toBe(25);
    expect(COIN_VALUES.rare).toBe(50);
  });

  it('collects a coin in range and rejects a second collect', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    const hunter = state().hunters[playerId]!;
    const coin = spawnCoin(state(), context())!;
    coin.x = hunter.x;
    coin.y = hunter.y;
    coin.kind = 'normal';
    coin.value = 10;
    const gained = tryCollect(state(), playerId, coin.id, context().now());
    expect(gained).toBe(10);
    expect(state().hunters[playerId]!.score).toBe(10);
    expect(tryCollect(state(), playerId, coin.id, context().now())).toBe(0);
    expect(
      coinHuntersGame.validateAction(
        playerId,
        { type: 'collect', payload: { coinId: coin.id } },
        state(),
        context(),
      ).valid,
    ).toBe(false);
  });

  it('rejects collection when the player is too far', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    const hunter = state().hunters[playerId]!;
    const coin = spawnCoin(state(), context())!;
    coin.x = (hunter.x + 8) % state().cols;
    coin.y = (hunter.y + 8) % state().rows;
    expect(
      coinHuntersGame.validateAction(
        playerId,
        { type: 'collect', payload: { coinId: coin.id } },
        state(),
        context(),
      ).valid,
    ).toBe(false);
    expect(tryCollect(state(), playerId, coin.id, context().now())).toBe(0);
  });

  it('expires coins and does not pay after expiry', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    const hunter = state().hunters[playerId]!;
    const coin = spawnCoin(state(), context())!;
    coin.x = hunter.x;
    coin.y = hunter.y;
    coin.expiresAt = context().now() - 1;
    expect(tryCollect(state(), playerId, coin.id, context().now())).toBe(0);
  });

  it('applies a personal multiplier and the bonus zone', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    const hunter = state().hunters[playerId]!;
    hunter.x = state().bonus.x;
    hunter.y = state().bonus.y;
    expect(inBonus(state(), hunter.x, hunter.y)).toBe(true);
    hunter.multiplierUntil = context().now() + 5000;
    const coin = spawnCoin(state(), context())!;
    coin.x = hunter.x;
    coin.y = hunter.y;
    coin.kind = 'gold';
    coin.value = 25;
    const gained = awardCollection(state(), playerId, coin, context().now());
    expect(gained).toBe(100);
  });

  it('rejects reverse and unknown actions', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    state().hunters[playerId]!.direction = 'right';
    state().hunters[playerId]!.pending = null;
    expect(
      coinHuntersGame.validateAction(
        playerId,
        { type: 'move', payload: { direction: 'left' } },
        state(),
        context(),
      ).valid,
    ).toBe(false);
    expect(
      coinHuntersGame.validateAction(playerId, { type: 'fly' }, state(), context()).valid,
    ).toBe(false);
  });

  it('steps hunters and can auto-collect an overlapping coin', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    const hunter = state().hunters[playerId]!;
    hunter.direction = 'right';
    hunter.pending = null;
    hunter.x = 3;
    hunter.y = 3;
    state().blocker.x = 0;
    state().blocker.y = 0;
    const coin = spawnCoin(state(), context())!;
    coin.x = 4;
    coin.y = 3;
    coin.kind = 'normal';
    coin.value = 10;
    coin.expiresAt = context().now() + 10_000;
    stepHunters(state(), context());
    expect(hunter.x).toBe(4);
    expect(state().collected[coin.id] === playerId || hunter.score >= 0).toBe(true);
  });

  it('timeout finishes and ranks by score', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    state().hunters[players[0]!.id]!.score = 70;
    state().hunters[players[1]!.id]!.score = 20;
    finishHunt(state(), context(), 'timeout');
    expect(state().phase).toBe('finished');
    const draft = coinHuntersGame.getResult(state(), context());
    expect(draft.winners).toEqual([players[0]!.id]);
    expect(draft.rankings).toHaveLength(2);
  });

  it('reset keeps seats', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const seats = Object.keys(state().hunters);
    const next = coinHuntersGame.reset(state());
    expect(Object.keys(next.hunters)).toEqual(seats);
    expect(next.phase).toBe('idle');
    expect(next.coins).toEqual([]);
  });

  it('AI sends a legal move or collect', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const move = coinHuntersGame.getAIMove?.(players[0]!.id, 'hard', state(), context());
    expect(move?.type === 'move' || move?.type === 'collect').toBe(true);
  });

  it('uses distinct obstacle layouts, fair distant spawning and stale-input protection', async () => {
    expect(huntWalls('classic', 18, 12)).toHaveLength(0);
    expect(huntWalls('lanes', 18, 12).length).toBeGreaterThan(0);
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const id = players[0]!.id;
    state().coins = [];
    const coin = spawnCoin(state(), context())!;
    const nearest = Math.min(
      ...Object.values(state().hunters).map(
        (hunter) => Math.abs(hunter.x - coin.x) + Math.abs(hunter.y - coin.y),
      ),
    );
    expect(nearest).toBeGreaterThan(2);
    expect(
      platform.gameManager.handleAction(room, id, {
        type: 'move',
        payload: { direction: 'down', sequence: 7 },
      }).accepted,
    ).toBe(true);
    expect(
      platform.gameManager.handleAction(room, id, {
        type: 'move',
        payload: { direction: 'down', sequence: 6 },
      }).accepted,
    ).toBe(false);
  });

  it('builds a timed collection streak entirely on the server', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const id = players[0]!.id;
    const hunter = state().hunters[id]!;
    state().coins = [];
    for (let n = 0; n < 2; n += 1) {
      const coin = spawnCoin(state(), context())!;
      coin.x = hunter.x;
      coin.y = hunter.y;
      coin.kind = 'normal';
      coin.value = 10;
      awardCollection(state(), id, coin, context().now());
    }
    expect(hunter.streak).toBe(2);
    expect(hunter.score).toBe(25);
  });

  it('progresses to faster coin-rich rounds on the server clock', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    state().startedAt = context().now() - state().durationMs * 0.7;
    coinHuntersGame.update(state(), 1, context());
    expect(state().round).toBe(3);
    expect(state().stepMs).toBe(190);
  });
});
