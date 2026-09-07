import type { AIDifficulty, GameAction, GameFinishReason } from '@2play/shared';
import { SHOP_RUSH_METADATA } from '@2play/shared';
export { SHOP_RUSH_METADATA };
import type {
  ActionResult,
  GameContext,
  GameModule,
  GameResultDraft,
  RankingDraft,
  ValidationResult,
} from '../GameModule';
import { actionAccepted, actionRejected } from '../GameModule';

/**
 * Shop Rush Battle — 2D supermarket race with private lists.
 *
 * Clients send move / pickup / checkout. The server owns inventory, lists
 * and score. Clients cannot submit a cart or a score.
 */

export type ShopPhase = 'idle' | 'playing' | 'finished';
export type ShopDirection = 'up' | 'down' | 'left' | 'right';
export type ShopItem = 'milk' | 'bread' | 'eggs' | 'apples' | 'cereal' | 'candy';

export interface ShopShelf {
  x: number;
  y: number;
  item: ShopItem;
}

export interface Shopper {
  x: number;
  y: number;
  inventory: ShopItem[];
  list: ShopItem[];
  score: number;
  checkouts: number;
  disconnected: boolean;
  left: boolean;
}

export interface ShopState {
  phase: ShopPhase;
  cols: number;
  rows: number;
  shelves: ShopShelf[];
  till: { x: number; y: number };
  shoppers: Record<string, Shopper>;
  startedAt: number | null;
  endsAt: number | null;
  durationMs: number;
  finishReason: GameFinishReason | null;
  lastEvent: string | null;
  nextAIRequestAt: Record<string, number>;
}

export const SHOP_COLS = 11;
export const SHOP_ROWS = 9;
export const SHOP_MATCH_MS = 120_000;
export const INVENTORY_CAP = 3;
export const LIST_SIZE = 3;
export const SCORE_LIST_ITEM = 40;
export const SCORE_CANDY = 25;
export const SCORE_COMPLETE = 50;
const CATALOGUE: ShopItem[] = ['milk', 'bread', 'eggs', 'apples', 'cereal'];
const DELTA: Record<ShopDirection, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};
const ALL_DIRS: ShopDirection[] = ['up', 'down', 'left', 'right'];
const AI_INTERVAL: Record<AIDifficulty, number> = { easy: 420, medium: 220, hard: 110 };

export function isShopDirection(value: unknown): value is ShopDirection {
  return value === 'up' || value === 'down' || value === 'left' || value === 'right';
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function inBounds(cols: number, rows: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < cols && y < rows;
}

export function makeShelves(): ShopShelf[] {
  return [
    { x: 2, y: 2, item: 'milk' },
    { x: 4, y: 2, item: 'bread' },
    { x: 6, y: 2, item: 'eggs' },
    { x: 8, y: 2, item: 'apples' },
    { x: 2, y: 5, item: 'cereal' },
    { x: 4, y: 5, item: 'candy' },
    { x: 6, y: 5, item: 'milk' },
    { x: 8, y: 5, item: 'bread' },
  ];
}

export function dealList(seed: number, salt: number): ShopItem[] {
  const rng = mulberry32((seed ^ (salt * 97_351)) >>> 0);
  const pool = CATALOGUE.slice();
  const list: ShopItem[] = [];
  while (list.length < LIST_SIZE && pool.length > 0) {
    const i = Math.floor(rng() * pool.length);
    list.push(pool.splice(i, 1)[0]!);
  }
  return list;
}

function spawnShopper(seat: number, seed: number): Shopper {
  return {
    x: 1 + (seat % 4) * 2,
    y: SHOP_ROWS - 2,
    inventory: [],
    list: dealList(seed, seat + 1),
    score: 0,
    checkouts: 0,
    disconnected: false,
    left: false,
  };
}

function blocked(state: ShopState, x: number, y: number, ignoreId?: string): boolean {
  if (!inBounds(state.cols, state.rows, x, y)) return true;
  if (state.shelves.some((shelf) => shelf.x === x && shelf.y === y)) return true;
  for (const [id, shopper] of Object.entries(state.shoppers)) {
    if (id === ignoreId || shopper.left) continue;
    if (shopper.x === x && shopper.y === y) return true;
  }
  return false;
}

function adjacentShelf(state: ShopState, shopper: Shopper): ShopShelf | undefined {
  return state.shelves.find((shelf) => Math.abs(shelf.x - shopper.x) + Math.abs(shelf.y - shopper.y) === 1);
}

export function checkoutCart(shopper: Shopper): { gained: number; remaining: ShopItem[] } {
  const remaining: ShopItem[] = [];
  const needed = shopper.list.slice();
  let gained = 0;
  let listed = 0;
  for (const item of shopper.inventory) {
    const idx = needed.indexOf(item);
    if (idx >= 0) {
      needed.splice(idx, 1);
      gained += SCORE_LIST_ITEM;
      listed += 1;
      continue;
    }
    if (item === 'candy') {
      gained += SCORE_CANDY;
      continue;
    }
    remaining.push(item);
  }
  if (listed === LIST_SIZE) gained += SCORE_COMPLETE;
  return { gained, remaining };
}

export function finishShop(state: ShopState, ctx: GameContext, reason: GameFinishReason): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.finishReason = reason;
  state.lastEvent = reason === 'timeout' ? 'timeout' : 'finished';
  ctx.markStateChanged();
  ctx.finish(reason);
}

export const shopRushGame: GameModule<ShopState> = {
  metadata: SHOP_RUSH_METADATA,

  initialize(): void {
    // Stateless module.
  },

  createInitialState(players, settings): ShopState {
    const seed = typeof settings.seed === 'number' ? settings.seed : 1;
    const shoppers: Record<string, Shopper> = {};
    players.forEach((player, index) => {
      shoppers[player.id] = spawnShopper(index, seed);
    });
    return {
      phase: 'idle',
      cols: SHOP_COLS,
      rows: SHOP_ROWS,
      shelves: makeShelves(),
      till: { x: Math.floor(SHOP_COLS / 2), y: SHOP_ROWS - 1 },
      shoppers,
      startedAt: null,
      endsAt: null,
      durationMs: SHOP_MATCH_MS,
      finishReason: null,
      lastEvent: null,
      nextAIRequestAt: {},
    };
  },

  playerJoined(player, state, ctx): void {
    const existing = state.shoppers[player.id];
    if (existing) {
      existing.disconnected = false;
      return;
    }
    state.shoppers[player.id] = spawnShopper(Object.keys(state.shoppers).length, ctx.seed);
  },

  playerReady(): void {
    // Lobby concern.
  },

  playerLeft(playerId, state, ctx, reason): void {
    const shopper = state.shoppers[playerId];
    if (!shopper) return;
    if (reason === 'disconnect') {
      shopper.disconnected = true;
      return;
    }
    shopper.left = true;
    const remaining = Object.values(state.shoppers).filter((entry) => !entry.left);
    if (remaining.length <= 1) finishShop(state, ctx, 'abandoned');
  },

  start(state, ctx): void {
    if (state.phase === 'playing') return;
    const shoppers: Record<string, Shopper> = {};
    ctx.players.forEach((player, index) => {
      shoppers[player.id] = spawnShopper(index, ctx.seed);
    });
    state.shoppers = shoppers;
    state.shelves = makeShelves();
    state.phase = 'playing';
    state.startedAt = ctx.now();
    state.endsAt = state.startedAt + state.durationMs;
    state.finishReason = null;
    state.lastEvent = 'start';
    ctx.markStateChanged();
    ctx.schedule(state.durationMs, () => finishShop(state, ctx, 'timeout'), 'gameDuration', 'match-timeout');
  },

  validateAction(playerId, action, state): ValidationResult {
    if (state.phase !== 'playing') return { valid: false, reason: 'The shop is closed.' };
    const shopper = state.shoppers[playerId];
    if (!shopper || shopper.left) return { valid: false, reason: 'You are not shopping.' };
    if (action.type === 'move') {
      if (!isShopDirection(action.payload?.direction)) return { valid: false, reason: 'Use up, down, left or right.' };
      const d = DELTA[action.payload.direction as ShopDirection];
      if (blocked(state, shopper.x + d.dx, shopper.y + d.dy, playerId)) return { valid: false, reason: 'Blocked.' };
      return { valid: true };
    }
    if (action.type === 'pickup') {
      if (shopper.inventory.length >= INVENTORY_CAP) return { valid: false, reason: 'Basket is full.' };
      if (!adjacentShelf(state, shopper)) return { valid: false, reason: 'Stand next to a shelf.' };
      return { valid: true };
    }
    if (action.type === 'checkout') {
      if (shopper.x !== state.till.x || shopper.y !== state.till.y) return { valid: false, reason: 'Stand on the till.' };
      if (shopper.inventory.length === 0) return { valid: false, reason: 'Basket is empty.' };
      return { valid: true };
    }
    return { valid: false, reason: 'Unknown action.' };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    const shopper = state.shoppers[playerId];
    if (!shopper || state.phase !== 'playing' || shopper.left) return actionRejected('You cannot shop.');
    if (action.type === 'move') {
      const direction = action.payload?.direction;
      if (!isShopDirection(direction)) return actionRejected('Invalid direction.');
      const d = DELTA[direction];
      const nx = shopper.x + d.dx;
      const ny = shopper.y + d.dy;
      if (blocked(state, nx, ny, playerId)) return actionRejected('Blocked.');
      shopper.x = nx;
      shopper.y = ny;
      state.lastEvent = `move:${playerId}`;
      ctx.markStateChanged();
      return actionAccepted();
    }
    if (action.type === 'pickup') {
      if (shopper.inventory.length >= INVENTORY_CAP) return actionRejected('Basket is full.');
      const shelf = adjacentShelf(state, shopper);
      if (!shelf) return actionRejected('No shelf.');
      shopper.inventory.push(shelf.item);
      state.lastEvent = `pickup:${playerId}:${shelf.item}`;
      ctx.markStateChanged();
      return actionAccepted();
    }
    if (action.type === 'checkout') {
      if (shopper.x !== state.till.x || shopper.y !== state.till.y) return actionRejected('Not at the till.');
      if (shopper.inventory.length === 0) return actionRejected('Empty basket.');
      const result = checkoutCart(shopper);
      shopper.score += result.gained;
      shopper.inventory = result.remaining;
      shopper.checkouts += 1;
      shopper.list = dealList(ctx.seed, shopper.checkouts * 17 + 3);
      state.lastEvent = `checkout:${playerId}:${result.gained}`;
      ctx.markStateChanged();
      return actionAccepted();
    }
    return actionRejected('Unknown action.');
  },

  update(state, _deltaTimeMs, ctx): void {
    if (state.phase !== 'playing') return;
    for (const player of ctx.players) {
      if (!player.isAI) continue;
      const shopper = state.shoppers[player.id];
      if (!shopper || shopper.left) continue;
      const now = ctx.now();
      const difficulty = player.aiDifficulty ?? 'medium';
      if (now >= (state.nextAIRequestAt[player.id] ?? 0)) {
        ctx.requestAI(player.id, 40);
        state.nextAIRequestAt[player.id] = now + AI_INTERVAL[difficulty];
      }
    }
  },

  tick(): void {
    // Handled by update().
  },

  calculateScore(playerId, state): number {
    return state.shoppers[playerId]?.score ?? 0;
  },

  checkWinCondition(state): string[] | null {
    if (state.phase !== 'finished') return null;
    const entries = Object.entries(state.shoppers).filter(([, shopper]) => !shopper.left);
    if (entries.length === 0) return [];
    const best = Math.max(...entries.map(([, shopper]) => shopper.score));
    return entries.filter(([, shopper]) => shopper.score === best).map(([id]) => id);
  },

  checkDrawCondition(state): boolean {
    return (this.checkWinCondition(state)?.length ?? 0) > 1;
  },

  isGameFinished(state): boolean {
    return state.phase === 'finished';
  },

  finish(state): void {
    state.phase = 'finished';
  },

  getResult(state, ctx): GameResultDraft {
    const ranked = [...ctx.players].sort((a, b) => (state.shoppers[b.id]?.score ?? 0) - (state.shoppers[a.id]?.score ?? 0));
    const best = ranked[0] ? state.shoppers[ranked[0].id]?.score ?? 0 : 0;
    const winners = ranked.filter((player) => (state.shoppers[player.id]?.score ?? 0) === best).map((player) => player.id);
    const rankings: RankingDraft[] = ranked.map((player, index) => {
      const shopper = state.shoppers[player.id];
      return {
        playerId: player.id,
        rank: index + 1,
        score: shopper?.score ?? 0,
        isWinner: winners.includes(player.id),
        isDraw: winners.length > 1,
        stats: { checkouts: shopper?.checkouts ?? 0, basket: shopper?.inventory.length ?? 0 },
      };
    });
    return { winners, isDraw: winners.length > 1, rankings, reason: state.finishReason ?? 'completed' };
  },

  reset(state): ShopState {
    const shoppers: Record<string, Shopper> = {};
    Object.keys(state.shoppers).forEach((id, index) => {
      shoppers[id] = spawnShopper(index, 1);
    });
    return {
      ...state,
      phase: 'idle',
      shoppers,
      shelves: makeShelves(),
      startedAt: null,
      endsAt: null,
      finishReason: null,
      lastEvent: null,
      nextAIRequestAt: {},
    };
  },

  cleanup(state): void {
    state.shoppers = {};
    state.phase = 'finished';
  },

  getPublicState(state, viewerId, ctx) {
    return {
      phase: state.phase,
      cols: state.cols,
      rows: state.rows,
      shelves: state.shelves.map((shelf) => ({ ...shelf })),
      till: { ...state.till },
      startedAt: state.startedAt,
      endsAt: state.endsAt,
      durationMs: state.durationMs,
      finishReason: state.finishReason,
      lastEvent: state.lastEvent,
      serverTime: ctx.now(),
      shoppers: Object.fromEntries(
        Object.entries(state.shoppers).map(([id, shopper]) => [
          id,
          {
            x: shopper.x,
            y: shopper.y,
            inventory: id === viewerId ? shopper.inventory.slice() : shopper.inventory.map(() => 'hidden' as const),
            list: id === viewerId ? shopper.list.slice() : [],
            score: shopper.score,
            checkouts: shopper.checkouts,
            disconnected: shopper.disconnected,
            basketSize: shopper.inventory.length,
          },
        ]),
      ),
    };
  },

  getAIMove(playerId, difficulty, state): GameAction | null {
    if (state.phase !== 'playing') return null;
    const shopper = state.shoppers[playerId];
    if (!shopper || shopper.left) return null;
    if (shopper.x === state.till.x && shopper.y === state.till.y && shopper.inventory.length > 0) {
      return { type: 'checkout' };
    }
    const need = shopper.list.find((item) => !shopper.inventory.includes(item));
    const shelf =
      shopper.inventory.length >= INVENTORY_CAP
        ? null
        : state.shelves.find((entry) => entry.item === (need ?? (difficulty === 'easy' ? 'candy' : shopper.list[0])));
    const target = shopper.inventory.length >= INVENTORY_CAP || !need ? state.till : shelf ?? state.till;
    if (shelf && Math.abs(shelf.x - shopper.x) + Math.abs(shelf.y - shopper.y) === 1 && shopper.inventory.length < INVENTORY_CAP) {
      return { type: 'pickup' };
    }
    const options = ALL_DIRS.filter((dir) => !blocked(state, shopper.x + DELTA[dir].dx, shopper.y + DELTA[dir].dy, playerId));
    if (options.length === 0) return null;
    const scored = options.map((dir) => {
      const n = { x: shopper.x + DELTA[dir].dx, y: shopper.y + DELTA[dir].dy };
      return { dir, dist: Math.abs(n.x - target.x) + Math.abs(n.y - target.y) };
    });
    scored.sort((a, b) => a.dist - b.dist);
    return { type: 'move', payload: { direction: scored[0]!.dir } };
  },

  needsUpdateLoop: true,
  maxDurationMs: 5 * 60 * 1000,
};
