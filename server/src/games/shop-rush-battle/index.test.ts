import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createTestPlatform, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  checkoutCart,
  finishShop,
  INVENTORY_CAP,
  SCORE_CANDY,
  SCORE_COMPLETE,
  SCORE_LIST_ITEM,
  shopRushGame,
  type ShopItem,
  type ShopState,
} from './index';
import type { Room } from '../../rooms/Room';

describe('Shop Rush Battle', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'shop-rush-battle');
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as ShopState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const publicState = (viewerId?: string) =>
    platform.gameManager.getPublicState(room, viewerId) as {
      phase: string;
      shoppers: Record<
        string,
        {
          x: number;
          y: number;
          list: ShopItem[];
          inventory: unknown[];
          score: number;
          basketSize: number;
        }
      >;
    };

  it('starts with private lists, empty baskets and a live clock', () => {
    expect(state().phase).toBe('playing');
    expect(Object.keys(state().shoppers)).toHaveLength(2);
    for (const shopper of Object.values(state().shoppers)) {
      expect(shopper.list).toHaveLength(2);
      expect(shopper.inventory).toEqual([]);
      expect(shopper.score).toBe(0);
    }
    expect(state().endsAt).toBe(state().startedAt! + state().durationMs);
  });

  it('hides the other shopper list and inventory from the public view', () => {
    const [me, other] = players.map((player) => player.id);
    state().shoppers[other]!.inventory = ['milk'];
    const view = publicState(me);
    expect(view.shoppers[me]!.list).toEqual(state().shoppers[me]!.list);
    expect(view.shoppers[other]!.list).toEqual([]);
    expect(view.shoppers[other]!.inventory).toEqual(['hidden']);
    expect(view.shoppers[other]!.basketSize).toBe(1);
  });

  it('accepts a legal move and rejects blocked or unknown actions', () => {
    const playerId = players[0]!.id;
    const shopper = state().shoppers[playerId]!;
    const moved = platform.gameManager.handleAction(room, playerId, {
      type: 'move',
      payload: { direction: 'up' },
    });
    expect(moved.accepted).toBe(true);
    expect(shopper.y).toBeLessThan(state().rows - 2 + 1);
    expect(shopRushGame.validateAction(playerId, { type: 'steal' }, state(), context()).valid).toBe(
      false,
    );
    expect(
      shopRushGame.validateAction(
        playerId,
        { type: 'move', payload: { direction: 'north' } },
        state(),
        context(),
      ).valid,
    ).toBe(false);
    expect(
      shopRushGame.validateAction(playerId, { type: 'pickup' }, state(), context()).valid,
    ).toBe(false);
    expect(
      shopRushGame.validateAction(playerId, { type: 'checkout' }, state(), context()).valid,
    ).toBe(false);
  });

  it('picks up only when adjacent to a shelf and respects the inventory cap', () => {
    const playerId = players[0]!.id;
    const shopper = state().shoppers[playerId]!;
    const shelf = state().shelves[0]!;
    shopper.x = shelf.x + 1;
    shopper.y = shelf.y;
    const picked = platform.gameManager.handleAction(room, playerId, { type: 'pickup' });
    expect(picked.accepted).toBe(true);
    expect(shopper.inventory).toEqual([shelf.item]);

    shopper.inventory = ['milk', 'bread', 'eggs', 'rice'];
    expect(shopper.inventory).toHaveLength(INVENTORY_CAP);
    expect(
      shopRushGame.validateAction(playerId, { type: 'pickup' }, state(), context()).valid,
    ).toBe(false);
  });

  it('checkouts only on the till; the server scores the cart', () => {
    const playerId = players[0]!.id;
    const shopper = state().shoppers[playerId]!;
    shopper.list = ['milk', 'bread', 'eggs'];
    shopper.inventory = ['milk', 'bread', 'eggs'];
    expect(
      shopRushGame.validateAction(playerId, { type: 'checkout' }, state(), context()).valid,
    ).toBe(false);
    shopper.x = state().till.x;
    shopper.y = state().till.y;
    const paid = platform.gameManager.handleAction(room, playerId, { type: 'checkout' });
    expect(paid.accepted).toBe(true);
    expect(shopper.score).toBeGreaterThan(SCORE_LIST_ITEM * 3 + SCORE_COMPLETE);
    expect(shopper.inventory).toEqual([]);
    expect(shopper.list).toHaveLength(2);
    expect(shopper.checkouts).toBe(1);
  });

  it('keeps wrong items, pays candy, and never trusts a client cart', () => {
    const shopper = {
      x: 0,
      y: 0,
      inventory: ['candy', 'milk', 'cereal'] as ShopItem[],
      list: ['milk', 'bread', 'eggs'] as ShopItem[],
      score: 0,
      checkouts: 0,
      combo: 0,
      bestCombo: 0,
      correctItems: 0,
      wrongItems: 0,
      missedOrders: 0,
      orderNumber: 1,
      orderDeadline: 0,
      latestInputSeq: -1,
      disconnected: false,
      left: false,
    };
    const result = checkoutCart(shopper);
    expect(result.gained).toBe(SCORE_LIST_ITEM + SCORE_CANDY);
    expect(result.remaining).toEqual(['cereal']);
  });

  it('timeout ranks by checkout score; equal scores are a draw', () => {
    const [a, b] = players.map((player) => player.id);
    state().shoppers[a]!.score = 80;
    state().shoppers[b]!.score = 80;
    finishShop(state(), context(), 'timeout');
    expect(state().finishReason).toBe('timeout');
    const draft = shopRushGame.getResult(state(), context());
    expect(draft.isDraw).toBe(true);
    state().shoppers[a]!.score = 120;
    const win = shopRushGame.getResult(state(), context());
    expect(win.winners).toEqual([a]);
  });

  it('reset keeps seats and cleanup empties shoppers', () => {
    const seats = Object.keys(state().shoppers);
    state().shoppers[seats[0]!]!.score = 200;
    const next = shopRushGame.reset(state());
    expect(Object.keys(next.shoppers)).toEqual(seats);
    expect(next.phase).toBe('idle');
    expect(next.shoppers[seats[0]!]!.score).toBe(0);
    shopRushGame.cleanup(next);
    expect(Object.keys(next.shoppers)).toHaveLength(0);
  });

  it('disconnect, reconnect and leave', () => {
    const [first, second] = players.map((player) => player.id);
    shopRushGame.playerLeft(first, state(), context(), 'disconnect');
    expect(state().shoppers[first]!.disconnected).toBe(true);
    shopRushGame.playerJoined({ ...players[0]!, id: first }, state(), context());
    expect(state().shoppers[first]!.disconnected).toBe(false);
    shopRushGame.playerLeft(first, state(), context(), 'leave');
    shopRushGame.playerLeft(second, state(), context(), 'leave');
    expect(state().phase).toBe('finished');
  });

  it('AI returns a legal move, pickup or checkout', () => {
    const move = shopRushGame.getAIMove?.(players[0]!.id, 'hard', state(), context());
    expect(move).toBeTruthy();
    expect(['move', 'pickup', 'checkout']).toContain(move!.type);
  });

  it('progresses order size, accuracy and combo from authoritative checkout contents', () => {
    const id = players[0]!.id;
    const shopper = state().shoppers[id]!;
    shopper.list = ['milk', 'bread'];
    shopper.inventory = ['milk', 'bread'];
    shopper.x = state().till.x;
    shopper.y = state().till.y;
    const before = shopper.score;
    expect(platform.gameManager.handleAction(room, id, { type: 'checkout' }).accepted).toBe(true);
    expect(shopper.score).toBeGreaterThan(before);
    expect(shopper.combo).toBe(1);
    expect(shopper.correctItems).toBe(2);
    shopper.list = ['milk', 'bread'];
    shopper.inventory = ['milk', 'cereal'];
    platform.gameManager.handleAction(room, id, { type: 'checkout' });
    expect(shopper.combo).toBe(0);
    expect(shopper.wrongItems).toBe(1);
  });

  it('rejects stale movement sequences', () => {
    const id = players[0]!.id;
    expect(
      platform.gameManager.handleAction(room, id, {
        type: 'move',
        payload: { direction: 'up', sequence: 3 },
      }).accepted,
    ).toBe(true);
    expect(
      platform.gameManager.handleAction(room, id, {
        type: 'move',
        payload: { direction: 'down', sequence: 2 },
      }).accepted,
    ).toBe(false);
  });

  it('expires an unattended customer order and resets its combo', () => {
    const id = players[0]!.id;
    const shopper = state().shoppers[id]!;
    shopper.combo = 3;
    shopper.inventory = ['milk'];
    shopper.orderDeadline = context().now() - 1;
    const previousOrder = shopper.orderNumber;
    shopRushGame.update(state(), 1, context());
    expect(shopper.missedOrders).toBe(1);
    expect(shopper.orderNumber).toBe(previousOrder + 1);
    expect(shopper.combo).toBe(0);
    expect(shopper.inventory).toEqual([]);
  });
});
