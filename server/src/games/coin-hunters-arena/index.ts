import type { AIDifficulty, GameAction, GameFinishReason } from '@2play/shared';
import { COIN_HUNTERS_METADATA } from '@2play/shared';
export { COIN_HUNTERS_METADATA };
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
 * Coin Hunters Arena — shared collection arena.
 *
 * Coins, multipliers, bonus/slow zones and a moving blocker are all server
 * owned. Clients send `move` and optional `collect` intents. Duplicate collects
 * never pay twice.
 */

export type HuntPhase = 'idle' | 'playing' | 'finished';
export type HuntDirection = 'up' | 'down' | 'left' | 'right';
export type CoinKind = 'normal' | 'gold' | 'rare' | 'multi';

export interface HuntCoin {
  id: string;
  x: number;
  y: number;
  kind: CoinKind;
  value: number;
  expiresAt: number;
}

export interface HuntHunter {
  x: number;
  y: number;
  direction: HuntDirection;
  pending: HuntDirection | null;
  score: number;
  coins: number;
  multiplierUntil: number;
  lastStepAt: number;
  streak: number;
  bestStreak: number;
  lastCollectAt: number;
  latestInputSeq: number;
  disconnected: boolean;
  left: boolean;
}

export interface HuntBlocker {
  x: number;
  y: number;
  direction: HuntDirection;
}

export interface CoinHuntersState {
  phase: HuntPhase;
  cols: number;
  rows: number;
  hunters: Record<string, HuntHunter>;
  coins: HuntCoin[];
  bonus: { x: number; y: number; w: number; h: number };
  slow: number[];
  blocker: HuntBlocker;
  walls: number[];
  layout: 'classic' | 'lanes' | 'corners';
  round: number;
  stepMs: number;
  stepIndex: number;
  accumulatorMs: number;
  startedAt: number | null;
  endsAt: number | null;
  durationMs: number;
  finishReason: GameFinishReason | null;
  lastEvent: string | null;
  nextAIRequestAt: Record<string, number>;
  coinSeq: number;
  collected: Record<string, string>;
}

export const HUNT_COLS = 18;
export const HUNT_ROWS = 12;
export const COIN_VALUES: Record<CoinKind, number> = { normal: 10, gold: 25, rare: 50, multi: 0 };
const STEP_MS = 250;
const MATCH_MS = 150_000;
const MAX_COINS = 10;
const STREAK_WINDOW_MS = 3_500;
const COIN_LIFE_MS = 8_000;
const MULTI_MS = 4_000;
const DELTA: Record<HuntDirection, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};
const REVERSE: Record<HuntDirection, HuntDirection> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
};
const ALL_DIRS: HuntDirection[] = ['up', 'down', 'left', 'right'];
const AI_INTERVAL: Record<AIDifficulty, number> = { easy: 380, medium: 220, hard: 110 };

export function isHuntDirection(value: unknown): value is HuntDirection {
  return value === 'up' || value === 'down' || value === 'left' || value === 'right';
}

function inBounds(cols: number, rows: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < cols && y < rows;
}

function spawnPoint(
  seat: number,
  cols: number,
  rows: number,
): { x: number; y: number; direction: HuntDirection } {
  if (seat === 0) return { x: 1, y: 1, direction: 'right' };
  if (seat === 1) return { x: cols - 2, y: 1, direction: 'left' };
  if (seat === 2) return { x: 1, y: rows - 2, direction: 'right' };
  return { x: cols - 2, y: rows - 2, direction: 'left' };
}

export function cellIndex(cols: number, x: number, y: number): number {
  return y * cols + x;
}

export function inBonus(state: CoinHuntersState, x: number, y: number): boolean {
  return (
    x >= state.bonus.x &&
    x < state.bonus.x + state.bonus.w &&
    y >= state.bonus.y &&
    y < state.bonus.y + state.bonus.h
  );
}

export function isSlow(state: CoinHuntersState, x: number, y: number): boolean {
  return state.slow.includes(cellIndex(state.cols, x, y));
}

function pickKind(rng: () => number): CoinKind {
  const roll = rng();
  if (roll < 0.08) return 'rare';
  if (roll < 0.18) return 'multi';
  if (roll < 0.38) return 'gold';
  return 'normal';
}

function blockedCells(state: CoinHuntersState): Set<string> {
  const set = new Set<string>([`${state.blocker.x},${state.blocker.y}`]);
  for (const index of state.walls)
    set.add(`${index % state.cols},${Math.floor(index / state.cols)}`);
  for (const coin of state.coins) set.add(`${coin.x},${coin.y}`);
  for (const hunter of Object.values(state.hunters)) {
    if (!hunter.left) set.add(`${hunter.x},${hunter.y}`);
  }
  return set;
}

export function spawnCoin(
  state: CoinHuntersState,
  ctx: GameContext,
  now = ctx.now(),
): HuntCoin | null {
  if (state.coins.length >= MAX_COINS) return null;
  const used = blockedCells(state);
  const free: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < state.rows; y += 1) {
    for (let x = 0; x < state.cols; x += 1) {
      if (!used.has(`${x},${y}`) && !isSlow(state, x, y)) free.push({ x, y });
    }
  }
  if (free.length === 0) return null;
  // Choose among the safest quartile by distance from all hunters. This prevents
  // lucky point-blank spawns while preserving seeded variation.
  const ranked = free.map((cell) => ({
    cell,
    distance: Math.min(
      ...Object.values(state.hunters)
        .filter((h) => !h.left)
        .map((h) => Math.abs(h.x - cell.x) + Math.abs(h.y - cell.y)),
      state.cols + state.rows,
    ),
  }));
  ranked.sort((a, b) => b.distance - a.distance);
  const fairPool = ranked.slice(0, Math.max(1, Math.ceil(ranked.length / 4)));
  const cell = fairPool[Math.floor(ctx.random() * fairPool.length)]!.cell;
  const kind = pickKind(ctx.random);
  state.coinSeq += 1;
  const coin: HuntCoin = {
    id: `c${state.coinSeq}`,
    x: cell.x,
    y: cell.y,
    kind,
    value: COIN_VALUES[kind],
    expiresAt: now + COIN_LIFE_MS,
  };
  state.coins.push(coin);
  return coin;
}

export function awardCollection(
  state: CoinHuntersState,
  playerId: string,
  coin: HuntCoin,
  now: number,
): number {
  if (state.collected[coin.id]) return 0;
  const hunter = state.hunters[playerId];
  if (!hunter) return 0;
  state.collected[coin.id] = playerId;
  state.coins = state.coins.filter((entry) => entry.id !== coin.id);
  if (coin.kind === 'multi') {
    hunter.multiplierUntil = now + MULTI_MS;
    hunter.coins += 1;
    state.lastEvent = `multi:${playerId}`;
    return 0;
  }
  hunter.streak = now - hunter.lastCollectAt <= STREAK_WINDOW_MS ? hunter.streak + 1 : 1;
  hunter.bestStreak = Math.max(hunter.bestStreak, hunter.streak);
  hunter.lastCollectAt = now;
  let points = coin.value;
  points += Math.min(20, (hunter.streak - 1) * 5);
  if (now < hunter.multiplierUntil) points *= 2;
  if (inBonus(state, hunter.x, hunter.y)) points *= 2;
  hunter.score += points;
  hunter.coins += 1;
  state.lastEvent = `collect:${playerId}:${coin.id}:${points}`;
  return points;
}

export function tryCollect(
  state: CoinHuntersState,
  playerId: string,
  coinId: string,
  now: number,
): number {
  const hunter = state.hunters[playerId];
  if (!hunter || hunter.left) return 0;
  const coin = state.coins.find((entry) => entry.id === coinId);
  if (!coin) return 0;
  if (coin.expiresAt <= now) {
    state.coins = state.coins.filter((entry) => entry.id !== coinId);
    return 0;
  }
  const dist = Math.abs(hunter.x - coin.x) + Math.abs(hunter.y - coin.y);
  if (dist > 1) return 0;
  return awardCollection(state, playerId, coin, now);
}

function moveBlocker(state: CoinHuntersState): void {
  const d = DELTA[state.blocker.direction];
  let nx = state.blocker.x + d.dx;
  let ny = state.blocker.y + d.dy;
  if (
    !inBounds(state.cols, state.rows, nx, ny) ||
    isSlow(state, nx, ny) ||
    state.walls.includes(cellIndex(state.cols, nx, ny))
  ) {
    state.blocker.direction = REVERSE[state.blocker.direction];
    nx = state.blocker.x + DELTA[state.blocker.direction].dx;
    ny = state.blocker.y + DELTA[state.blocker.direction].dy;
  }
  if (inBounds(state.cols, state.rows, nx, ny)) {
    state.blocker.x = nx;
    state.blocker.y = ny;
  }
}

export function stepHunters(state: CoinHuntersState, ctx: GameContext): { collected: string[] } {
  const outcome = { collected: [] as string[] };
  if (state.phase !== 'playing') return outcome;
  const now = ctx.now();
  state.coins = state.coins.filter((coin) => coin.expiresAt > now);

  if (state.stepIndex % 2 === 0) moveBlocker(state);

  for (const [id, hunter] of Object.entries(state.hunters)) {
    if (hunter.left) continue;
    if (hunter.pending) {
      hunter.direction = hunter.pending;
      hunter.pending = null;
    }
    const slow = isSlow(state, hunter.x, hunter.y);
    if (slow && state.stepIndex % 2 === 1) continue;
    const d = DELTA[hunter.direction];
    const nx = hunter.x + d.dx;
    const ny = hunter.y + d.dy;
    if (
      !inBounds(state.cols, state.rows, nx, ny) ||
      state.walls.includes(cellIndex(state.cols, nx, ny))
    )
      continue;
    if (nx === state.blocker.x && ny === state.blocker.y) {
      state.lastEvent = `block:${id}`;
      continue;
    }
    hunter.x = nx;
    hunter.y = ny;
    hunter.lastStepAt = now;
    const here = state.coins.filter((coin) => coin.x === nx && coin.y === ny);
    for (const coin of here) {
      const gained = awardCollection(state, id, coin, now);
      if (gained > 0 || coin.kind === 'multi') outcome.collected.push(coin.id);
    }
  }

  state.stepIndex += 1;
  if (state.coins.length < 4 + state.round) spawnCoin(state, ctx, now);
  return outcome;
}

export function finishHunt(
  state: CoinHuntersState,
  ctx: GameContext,
  reason: GameFinishReason,
): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.finishReason = reason;
  state.lastEvent = reason === 'timeout' ? 'timeout' : 'finished';
  ctx.markStateChanged();
  ctx.finish(reason);
}

function makeHunter(seat: number, cols: number, rows: number): HuntHunter {
  const spawn = spawnPoint(seat, cols, rows);
  return {
    x: spawn.x,
    y: spawn.y,
    direction: spawn.direction,
    pending: null,
    score: 0,
    coins: 0,
    multiplierUntil: 0,
    lastStepAt: 0,
    streak: 0,
    bestStreak: 0,
    lastCollectAt: 0,
    latestInputSeq: -1,
    disconnected: false,
    left: false,
  };
}

function layoutExtras(
  cols: number,
  rows: number,
  rng: () => number,
): { bonus: CoinHuntersState['bonus']; slow: number[] } {
  const bonus = { x: Math.floor(cols / 2) - 1, y: Math.floor(rows / 2) - 1, w: 3, h: 2 };
  const slow: number[] = [];
  for (let i = 0; i < 6; i += 1) {
    const x = 2 + Math.floor(rng() * (cols - 4));
    const y = 1 + Math.floor(rng() * (rows - 2));
    if (x >= bonus.x && x < bonus.x + bonus.w && y >= bonus.y && y < bonus.y + bonus.h) continue;
    slow.push(cellIndex(cols, x, y));
  }
  return { bonus, slow };
}

export function huntWalls(
  layout: CoinHuntersState['layout'],
  cols: number,
  rows: number,
): number[] {
  const result = new Set<number>();
  const add = (x: number, y: number) => result.add(cellIndex(cols, x, y));
  if (layout === 'lanes') {
    for (let y = 2; y < rows - 2; y += 1)
      if (y !== Math.floor(rows / 2)) {
        add(6, y);
        add(cols - 7, y);
      }
  } else if (layout === 'corners') {
    for (const x of [5, cols - 6])
      for (const y of [3, rows - 4]) {
        add(x, y);
        add(x + 1, y);
        add(x, y + 1);
      }
  }
  return [...result];
}

export const coinHuntersGame: GameModule<CoinHuntersState> = {
  metadata: COIN_HUNTERS_METADATA,

  initialize(): void {
    // Stateless module.
  },

  createInitialState(players): CoinHuntersState {
    const extras = layoutExtras(HUNT_COLS, HUNT_ROWS, () => 0.5);
    const hunters: Record<string, HuntHunter> = {};
    players.forEach((player, index) => {
      hunters[player.id] = makeHunter(index, HUNT_COLS, HUNT_ROWS);
    });
    return {
      phase: 'idle',
      cols: HUNT_COLS,
      rows: HUNT_ROWS,
      hunters,
      coins: [],
      bonus: extras.bonus,
      slow: extras.slow,
      blocker: { x: Math.floor(HUNT_COLS / 2), y: 1, direction: 'down' },
      walls: [],
      layout: 'classic',
      round: 1,
      stepMs: STEP_MS,
      stepIndex: 0,
      accumulatorMs: 0,
      startedAt: null,
      endsAt: null,
      durationMs: MATCH_MS,
      finishReason: null,
      lastEvent: null,
      nextAIRequestAt: {},
      coinSeq: 0,
      collected: {},
    };
  },

  playerJoined(player, state): void {
    if (!state.hunters[player.id]) {
      state.hunters[player.id] = makeHunter(
        Object.keys(state.hunters).length,
        state.cols,
        state.rows,
      );
    }
  },

  playerReady(): void {
    // No per-player readiness behaviour.
  },

  playerLeft(playerId, state, ctx, reason): void {
    const hunter = state.hunters[playerId];
    if (!hunter) return;
    if (reason === 'disconnect') {
      hunter.disconnected = true;
      return;
    }
    hunter.left = true;
    if (Object.values(state.hunters).every((entry) => entry.left))
      finishHunt(state, ctx, 'abandoned');
  },

  start(state, ctx): void {
    if (state.phase === 'playing') return;
    const extras = layoutExtras(HUNT_COLS, HUNT_ROWS, ctx.random);
    const hunters: Record<string, HuntHunter> = {};
    ctx.players.forEach((player, index) => {
      hunters[player.id] = makeHunter(index, HUNT_COLS, HUNT_ROWS);
    });
    state.hunters = hunters;
    state.bonus = extras.bonus;
    state.slow = extras.slow;
    state.layout = ctx.seed % 3 === 0 ? 'corners' : ctx.seed % 2 === 0 ? 'lanes' : 'classic';
    state.walls = huntWalls(state.layout, HUNT_COLS, HUNT_ROWS);
    state.round = 1;
    state.stepMs = STEP_MS;
    state.blocker = { x: Math.floor(HUNT_COLS / 2), y: 1, direction: 'down' };
    state.coins = [];
    state.collected = {};
    state.coinSeq = 0;
    state.stepIndex = 0;
    state.accumulatorMs = 0;
    state.phase = 'playing';
    state.startedAt = ctx.now();
    state.endsAt = state.startedAt + state.durationMs;
    state.finishReason = null;
    state.lastEvent = 'start';
    while (state.coins.length < 5) spawnCoin(state, ctx);
    ctx.markStateChanged();
    ctx.schedule(
      state.durationMs,
      () => finishHunt(state, ctx, 'timeout'),
      'gameDuration',
      'match-timeout',
    );
  },

  validateAction(playerId, action, state, ctx): ValidationResult {
    if (state.phase !== 'playing') return { valid: false, reason: 'The match is not running.' };
    const hunter = state.hunters[playerId];
    if (!hunter || hunter.left) return { valid: false, reason: 'You are not in this match.' };
    if (action.type === 'move') {
      const direction = action.payload?.direction;
      if (!isHuntDirection(direction))
        return { valid: false, reason: 'Use up, down, left or right.' };
      const effective = hunter.pending ?? hunter.direction;
      if (REVERSE[effective] === direction)
        return { valid: false, reason: 'You cannot reverse instantly.' };
      const sequence = action.payload?.sequence;
      if (
        sequence !== undefined &&
        (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 0)
      )
        return { valid: false, reason: 'Invalid input sequence.' };
      if (typeof sequence === 'number' && sequence <= hunter.latestInputSeq)
        return { valid: false, reason: 'Stale input.' };
      return { valid: true };
    }
    if (action.type === 'collect') {
      const coinId = action.payload?.coinId;
      if (typeof coinId !== 'string' || coinId.length === 0)
        return { valid: false, reason: 'Missing coin.' };
      if (state.collected[coinId])
        return { valid: false, reason: 'That coin is already collected.' };
      const coin = state.coins.find((entry) => entry.id === coinId);
      if (!coin) return { valid: false, reason: 'That coin is gone.' };
      if (coin.expiresAt <= ctx.now()) return { valid: false, reason: 'That coin expired.' };
      const dist = Math.abs(hunter.x - coin.x) + Math.abs(hunter.y - coin.y);
      if (dist > 1) return { valid: false, reason: 'You are too far from that coin.' };
      return { valid: true };
    }
    return { valid: false, reason: 'Unknown action.' };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    const hunter = state.hunters[playerId];
    if (!hunter || state.phase !== 'playing') return actionRejected('You cannot act right now.');
    if (action.type === 'move') {
      const direction = action.payload?.direction;
      if (!isHuntDirection(direction)) return actionRejected('Invalid direction.');
      const sequence = action.payload?.sequence;
      if (
        sequence !== undefined &&
        (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 0)
      )
        return actionRejected('Invalid input sequence.');
      if (typeof sequence === 'number' && sequence <= hunter.latestInputSeq)
        return actionRejected('Stale input.');
      if (typeof sequence === 'number') hunter.latestInputSeq = sequence;
      const effective = hunter.pending ?? hunter.direction;
      if (REVERSE[effective] === direction) return actionRejected('You cannot reverse instantly.');
      if (effective === direction) return actionAccepted(false);
      hunter.pending = direction;
      return actionAccepted(false);
    }
    if (action.type === 'collect') {
      const coinId = typeof action.payload?.coinId === 'string' ? action.payload.coinId : '';
      const before = hunter.coins;
      const gained = tryCollect(state, playerId, coinId, ctx.now());
      if (gained === 0 && hunter.coins === before) {
        return actionRejected('Collect rejected.');
      }
      ctx.markStateChanged();
      return actionAccepted();
    }
    return actionRejected('Unknown action.');
  },

  update(state, deltaTimeMs, ctx): void {
    if (state.phase !== 'playing') return;
    const elapsed = ctx.now() - (state.startedAt ?? ctx.now());
    const nextRound = Math.min(3, Math.floor(elapsed / (state.durationMs / 3)) + 1);
    if (nextRound > state.round) {
      state.round = nextRound;
      state.stepMs = nextRound === 2 ? 220 : 190;
      state.lastEvent = `round:${nextRound}`;
      ctx.markStateChanged();
    }
    for (const player of ctx.players) {
      if (!player.isAI) continue;
      const hunter = state.hunters[player.id];
      if (!hunter || hunter.left) continue;
      const now = ctx.now();
      const difficulty = player.aiDifficulty ?? 'medium';
      if (now >= (state.nextAIRequestAt[player.id] ?? 0)) {
        ctx.requestAI(player.id, 40);
        state.nextAIRequestAt[player.id] = now + AI_INTERVAL[difficulty];
      }
    }
    state.accumulatorMs += deltaTimeMs;
    let guard = 0;
    while (state.accumulatorMs >= state.stepMs && state.phase === 'playing' && guard < 4) {
      state.accumulatorMs -= state.stepMs;
      guard += 1;
      stepHunters(state, ctx);
      // Movement, blockers, expirations and spawns are all public gameplay state.
      ctx.markStateChanged();
    }
  },

  tick(): void {
    // Handled by update().
  },

  calculateScore(playerId, state): number {
    return state.hunters[playerId]?.score ?? 0;
  },

  checkWinCondition(state): string[] | null {
    if (state.phase !== 'finished') return null;
    const entries = Object.entries(state.hunters).map(
      ([id, hunter]) => [id, hunter.score] as const,
    );
    if (entries.length === 0) return [];
    const best = Math.max(...entries.map(([, n]) => n));
    return entries.filter(([, n]) => n === best).map(([id]) => id);
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
    const ranked = [...ctx.players].sort(
      (a, b) => (state.hunters[b.id]?.score ?? 0) - (state.hunters[a.id]?.score ?? 0),
    );
    const top = state.hunters[ranked[0]?.id ?? '']?.score ?? 0;
    const winners = ranked
      .filter((player) => (state.hunters[player.id]?.score ?? 0) === top)
      .map((player) => player.id);
    const rankings: RankingDraft[] = ranked.map((player, index) => ({
      playerId: player.id,
      rank: index + 1,
      score: state.hunters[player.id]?.score ?? 0,
      isWinner: winners.includes(player.id),
      isDraw: winners.length > 1,
      stats: {
        coins: state.hunters[player.id]?.coins ?? 0,
        bestStreak: state.hunters[player.id]?.bestStreak ?? 0,
      },
    }));
    return {
      winners,
      isDraw: winners.length > 1,
      rankings,
      reason: state.finishReason ?? 'completed',
    };
  },

  reset(state): CoinHuntersState {
    const seats = Object.keys(state.hunters);
    const hunters: Record<string, HuntHunter> = {};
    seats.forEach((id, index) => {
      hunters[id] = makeHunter(index, state.cols, state.rows);
    });
    return {
      ...state,
      phase: 'idle',
      hunters,
      coins: [],
      walls: [],
      layout: 'classic',
      round: 1,
      stepMs: STEP_MS,
      collected: {},
      coinSeq: 0,
      stepIndex: 0,
      accumulatorMs: 0,
      startedAt: null,
      endsAt: null,
      finishReason: null,
      lastEvent: null,
      nextAIRequestAt: {},
    };
  },

  cleanup(state): void {
    state.hunters = {};
    state.coins = [];
    state.phase = 'finished';
  },

  getPublicState(state, _viewerId, ctx) {
    const now = ctx.now();
    return {
      phase: state.phase,
      cols: state.cols,
      rows: state.rows,
      stepMs: state.stepMs,
      stepIndex: state.stepIndex,
      startedAt: state.startedAt,
      endsAt: state.endsAt,
      durationMs: state.durationMs,
      finishReason: state.finishReason,
      lastEvent: state.lastEvent,
      serverTime: now,
      bonus: { ...state.bonus },
      slow: [...state.slow],
      blocker: { ...state.blocker },
      walls: [...state.walls],
      layout: state.layout,
      round: state.round,
      coins: state.coins.map((coin) => ({
        id: coin.id,
        x: coin.x,
        y: coin.y,
        kind: coin.kind,
        value: coin.value,
        expiresAt: coin.expiresAt,
      })),
      hunters: Object.fromEntries(
        Object.entries(state.hunters).map(([id, hunter]) => [
          id,
          {
            x: hunter.x,
            y: hunter.y,
            direction: hunter.direction,
            score: hunter.score,
            coins: hunter.coins,
            multiplier: now < hunter.multiplierUntil,
            streak: hunter.streak,
            bestStreak: hunter.bestStreak,
            latestInputSeq: hunter.latestInputSeq,
            disconnected: hunter.disconnected,
          },
        ]),
      ),
    };
  },

  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'playing') return null;
    const hunter = state.hunters[playerId];
    if (!hunter || hunter.left) return null;
    const options = ALL_DIRS.filter((dir) => dir !== REVERSE[hunter.direction]);
    const safe = options.filter((dir) => {
      const n = { x: hunter.x + DELTA[dir].dx, y: hunter.y + DELTA[dir].dy };
      if (!inBounds(state.cols, state.rows, n.x, n.y)) return false;
      if (state.walls.includes(cellIndex(state.cols, n.x, n.y))) return false;
      if (n.x === state.blocker.x && n.y === state.blocker.y) return false;
      return true;
    });
    const pool = safe.length > 0 ? safe : options;
    const nearby = state.coins.find(
      (coin) => Math.abs(coin.x - hunter.x) + Math.abs(coin.y - hunter.y) <= 1,
    );
    if (nearby && difficulty !== 'easy') {
      return { type: 'collect', payload: { coinId: nearby.id } };
    }
    const target = state.coins.reduce<HuntCoin | null>((best, coin) => {
      if (!best) return coin;
      const d = Math.abs(coin.x - hunter.x) + Math.abs(coin.y - hunter.y);
      const bd = Math.abs(best.x - hunter.x) + Math.abs(best.y - hunter.y);
      const valueBias = difficulty === 'hard' ? coin.value - best.value : 0;
      return d - valueBias / 20 < bd ? coin : best;
    }, null);
    if (!target)
      return {
        type: 'move',
        payload: { direction: pool[Math.floor(ctx.random() * pool.length)]! },
      };
    const scored = pool.map((dir) => {
      const n = { x: hunter.x + DELTA[dir].dx, y: hunter.y + DELTA[dir].dy };
      return { dir, dist: Math.abs(n.x - target.x) + Math.abs(n.y - target.y) };
    });
    scored.sort((a, b) => a.dist - b.dist);
    return { type: 'move', payload: { direction: scored[0]!.dir } };
  },

  needsUpdateLoop: true,
  maxDurationMs: 6 * 60 * 1000,
};
