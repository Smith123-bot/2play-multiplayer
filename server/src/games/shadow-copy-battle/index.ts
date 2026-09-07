import type { AIDifficulty, GameAction, GameConfig, GameFinishReason } from '@2play/shared';
import { SHADOW_COPY_METADATA } from '@2play/shared';
export { SHADOW_COPY_METADATA };
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
 * Shadow Copy Battle — plan this round so last round’s ghost holds a switch.
 *
 * Clients send one-cell move intents. The server records every legal step as
 * `{ tick, direction }` and, next round, replays that history as a Shadow Copy.
 * Clients cannot submit a path, a score, a collect or a round result.
 * Blocked shadow steps are skipped; later ticks still fire.
 */

export type ShadowPhase = 'idle' | 'playing' | 'between' | 'finished';
export type ShadowDirection = 'up' | 'down' | 'left' | 'right';
export type ShadowTile = 'wall' | 'floor' | 'plate' | 'gate' | 'hazard' | 'exit';
export type PickupKind = 'crystal' | 'shadow';

export interface ShadowStep {
  tick: number;
  direction: ShadowDirection;
}

export interface ShadowPickup {
  x: number;
  y: number;
  kind: PickupKind;
}

export interface ShadowRunner {
  x: number;
  y: number;
  spawnX: number;
  spawnY: number;
  score: number;
  history: ShadowStep[];
  previousHistory: ShadowStep[];
  crystals: number;
  shadowCrystals: number;
  exits: number;
  crystalsThisRound: number;
  exitedThisRound: boolean;
  freezeUntilTick: number;
  disconnected: boolean;
  left: boolean;
}

export interface ShadowGhost {
  ownerId: string;
  x: number;
  y: number;
  history: ShadowStep[];
  skipped: number;
  active: boolean;
  freezeUntilTick: number;
}

export interface ShadowArena {
  id: string;
  name: string;
  cols: number;
  rows: number;
  tiles: ShadowTile[];
  spawns: Array<{ x: number; y: number }>;
  plates: Array<{ x: number; y: number }>;
  pickups: ShadowPickup[];
}

export interface ShadowState {
  phase: ShadowPhase;
  round: number;
  totalRounds: number;
  roundTick: number;
  maxTicks: number;
  tickAcc: number;
  arenaId: string;
  arenaName: string;
  cols: number;
  rows: number;
  tiles: ShadowTile[];
  plates: Array<{ x: number; y: number }>;
  pickups: ShadowPickup[];
  gatesOpen: boolean;
  runners: Record<string, ShadowRunner>;
  shadows: ShadowGhost[];
  startedAt: number | null;
  endsAt: number | null;
  matchEndsAt: number | null;
  durationMs: number;
  finishReason: GameFinishReason | null;
  lastEvent: string | null;
  nextAIRequestAt: Record<string, number>;
}

export const STEP_MS = 200;
export const ROUND_MS = 16_000;
export const GAP_MS = 1_200;
export const MAX_TICKS = ROUND_MS / STEP_MS;
export const HAZARD_TICKS = 3;
export const DEFAULT_ROUNDS = 3;
export const SCORE_CRYSTAL = 100;
export const SCORE_SHADOW = 50;
export const SCORE_EXIT = 75;
export const SCORE_EFFICIENT = 20;
export const EFFICIENT_STEP_LIMIT = 16;

const DELTA: Record<ShadowDirection, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};
const ALL_DIRS: ShadowDirection[] = ['up', 'down', 'left', 'right'];
const AI_INTERVAL: Record<AIDifficulty, number> = { easy: 420, medium: 220, hard: 110 };
const FORBIDDEN_TYPES = new Set([
  'shadow',
  'replay',
  'path',
  'score',
  'collect',
  'finish',
  'round',
  'history',
  'teleport',
  'win',
]);

export const ARENA_LAYOUTS: Array<{ id: string; name: string; rows: string[] }> = [
  {
    id: 'twin-plates',
    name: 'Twin Plates',
    rows: [
      '#############',
      '#1.........2#',
      '#...........#',
      '#..C.....C..#',
      '#....P.P....#',
      '#...#####...#',
      '#...G.S.G...#',
      '#...#####...#',
      '#..C.....C..#',
      '#4.........3#',
      '#############',
    ],
  },
  {
    id: 'shadow-vault',
    name: 'Shadow Vault',
    rows: [
      '#############',
      '#1.........2#',
      '#...........#',
      '#.CCC.......#',
      '#........S..#',
      '#..P.P...S..#',
      '#........S..#',
      '#.CCC.......#',
      '#...........#',
      '#4.........3#',
      '#############',
    ],
  },
  {
    id: 'relay-gate',
    name: 'Relay Gate',
    rows: [
      '#############',
      '#1....#....2#',
      '#...........#',
      '#..P..#..C..#',
      '#.....#G....#',
      '#.....#.....#',
      '#.....#G....#',
      '#..P..#..C..#',
      '#...........#',
      '#4....#....3#',
      '#############',
    ],
  },
  {
    id: 'split-loops',
    name: 'Split Loops',
    rows: [
      '#############',
      '#1#.C.#.S.#2#',
      '#.#...#...#.#',
      '#.#...#...#.#',
      '#.#...#...#.#',
      '#....P.P....#',
      '#.#...#...#.#',
      '#.#...#...#.#',
      '#.#.C.#.S.#.#',
      '#4#...#...#3#',
      '#############',
    ],
  },
  {
    id: 'hazard-run',
    name: 'Hazard Run',
    rows: [
      '#############',
      '#1.........2#',
      '#...........#',
      '#..C.HHH.C..#',
      '#....P.P....#',
      '#...##G##...#',
      '#...#GSG#...#',
      '#...##G##...#',
      '#..C.HHH.C..#',
      '#4.........3#',
      '#############',
    ],
  },
];

export const ARENA_IDS = ARENA_LAYOUTS.map((arena) => arena.id);

export function isShadowDirection(value: unknown): value is ShadowDirection {
  return value === 'up' || value === 'down' || value === 'left' || value === 'right';
}

export function parseArena(layout: { id: string; name: string; rows: string[] }): ShadowArena {
  const rows = layout.rows;
  if (rows.length === 0) throw new Error(`Arena ${layout.id} is empty.`);
  const cols = rows[0]!.length;
  if (rows.some((row) => row.length !== cols)) {
    throw new Error(`Arena ${layout.id} has jagged rows.`);
  }
  const tiles: ShadowTile[] = [];
  const spawns: Array<{ x: number; y: number } | undefined> = [undefined, undefined, undefined, undefined];
  const plates: Array<{ x: number; y: number }> = [];
  const pickups: ShadowPickup[] = [];
  const floors: Array<{ x: number; y: number }> = [];

  for (let y = 0; y < rows.length; y += 1) {
    const line = rows[y]!;
    for (let x = 0; x < cols; x += 1) {
      const ch = line[x]!;
      let tile: ShadowTile = 'floor';
      if (ch === '#') tile = 'wall';
      else if (ch === 'P') {
        tile = 'plate';
        plates.push({ x, y });
      } else if (ch === 'G') tile = 'gate';
      else if (ch === 'H') tile = 'hazard';
      else if (ch === 'E') tile = 'exit';
      else if (ch === 'C') {
        pickups.push({ x, y, kind: 'crystal' });
      } else if (ch === 'S') {
        pickups.push({ x, y, kind: 'shadow' });
      } else if (ch === '1' || ch === '2' || ch === '3' || ch === '4') {
        spawns[Number(ch) - 1] = { x, y };
      } else if (ch !== '.') {
        throw new Error(`Arena ${layout.id} has unknown tile "${ch}" at ${x},${y}.`);
      }
      tiles.push(tile);
      if (tile !== 'wall') floors.push({ x, y });
    }
  }

  const resolved: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < 4; i += 1) {
    resolved.push(spawns[i] ?? floors[Math.min(i + 1, floors.length - 1)] ?? { x: 1, y: 1 });
  }

  return {
    id: layout.id,
    name: layout.name,
    cols,
    rows: rows.length,
    tiles,
    spawns: resolved,
    plates,
    pickups,
  };
}

export const PARSED_ARENAS: ShadowArena[] = ARENA_LAYOUTS.map(parseArena);

export function arenaById(id: string): ShadowArena {
  return PARSED_ARENAS.find((arena) => arena.id === id) ?? PARSED_ARENAS[0]!;
}

export function pickArenaId(gridSize: string | undefined, seed: number): string {
  if (gridSize && ARENA_IDS.includes(gridSize)) return gridSize;
  return ARENA_IDS[Math.abs(seed) % ARENA_IDS.length]!;
}

export function clampRounds(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_ROUNDS;
  return Math.min(5, Math.max(2, Math.round(value)));
}

function at(state: { cols: number }, x: number, y: number): number {
  return y * state.cols + x;
}

function inBounds(state: { cols: number; rows: number }, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < state.cols && y < state.rows;
}

export function tileAt(state: Pick<ShadowState, 'cols' | 'rows' | 'tiles'>, x: number, y: number): ShadowTile | null {
  if (!inBounds(state, x, y)) return null;
  return state.tiles[at(state, x, y)] ?? null;
}

function occupantAt(
  state: ShadowState,
  x: number,
  y: number,
  ignore?: { playerId?: string; shadowIndex?: number },
): boolean {
  for (const [id, runner] of Object.entries(state.runners)) {
    if (runner.left || id === ignore?.playerId) continue;
    if (runner.x === x && runner.y === y) return true;
  }
  for (let i = 0; i < state.shadows.length; i += 1) {
    if (i === ignore?.shadowIndex) continue;
    const ghost = state.shadows[i]!;
    if (!ghost.active) continue;
    if (ghost.x === x && ghost.y === y) return true;
  }
  return false;
}

export function platesHeld(state: ShadowState): boolean {
  if (state.plates.length === 0) return true;
  return state.plates.every((plate) => occupantAt(state, plate.x, plate.y));
}

export function gatesAreOpen(state: ShadowState): boolean {
  return platesHeld(state);
}

export function isWalkable(state: ShadowState, x: number, y: number, gatesOpen = state.gatesOpen): boolean {
  const tile = tileAt(state, x, y);
  if (!tile || tile === 'wall') return false;
  if (tile === 'gate' && !gatesOpen) return false;
  return true;
}

function refreshGates(state: ShadowState): void {
  state.gatesOpen = platesHeld(state);
}

function collectAt(
  state: ShadowState,
  x: number,
  y: number,
  collector: 'player' | 'shadow',
  ownerId: string,
): string | null {
  const index = state.pickups.findIndex((pickup) => pickup.x === x && pickup.y === y);
  if (index < 0) return null;
  const pickup = state.pickups[index]!;
  const runner = state.runners[ownerId];
  if (!runner) return null;
  if (collector === 'player' && pickup.kind === 'crystal') {
    state.pickups.splice(index, 1);
    runner.score += SCORE_CRYSTAL;
    runner.crystals += 1;
    runner.crystalsThisRound += 1;
    return `crystal:${ownerId}`;
  }
  if (collector === 'shadow' && pickup.kind === 'shadow') {
    state.pickups.splice(index, 1);
    runner.score += SCORE_SHADOW;
    runner.shadowCrystals += 1;
    return `shadow:${ownerId}`;
  }
  return null;
}

function applyCellEffects(
  state: ShadowState,
  x: number,
  y: number,
  collector: 'player' | 'shadow',
  ownerId: string,
): string | null {
  let event = collectAt(state, x, y, collector, ownerId);
  const runner = state.runners[ownerId];
  const tile = tileAt(state, x, y);
  if (collector === 'player' && runner && tile === 'exit' && !runner.exitedThisRound) {
    runner.exitedThisRound = true;
    runner.exits += 1;
    runner.score += SCORE_EXIT;
    event = `exit:${ownerId}`;
  }
  if (tile === 'hazard') {
    if (collector === 'player' && runner) runner.freezeUntilTick = state.roundTick + HAZARD_TICKS;
    event = `hazard:${ownerId}`;
  }
  return event;
}

function makeRunner(spawn: { x: number; y: number }): ShadowRunner {
  return {
    x: spawn.x,
    y: spawn.y,
    spawnX: spawn.x,
    spawnY: spawn.y,
    score: 0,
    history: [],
    previousHistory: [],
    crystals: 0,
    shadowCrystals: 0,
    exits: 0,
    crystalsThisRound: 0,
    exitedThisRound: false,
    freezeUntilTick: -1,
    disconnected: false,
    left: false,
  };
}

function applyArena(state: ShadowState, arena: ShadowArena, keepScores: boolean): void {
  state.arenaId = arena.id;
  state.arenaName = arena.name;
  state.cols = arena.cols;
  state.rows = arena.rows;
  state.tiles = arena.tiles.slice();
  state.plates = arena.plates.map((plate) => ({ ...plate }));
  state.pickups = arena.pickups.map((pickup) => ({ ...pickup }));
  const ids = Object.keys(state.runners);
  ids.forEach((id, index) => {
    const spawn = arena.spawns[index % arena.spawns.length]!;
    const previous = state.runners[id]!;
    state.runners[id] = {
      ...makeRunner(spawn),
      score: keepScores ? previous.score : 0,
      crystals: keepScores ? previous.crystals : 0,
      shadowCrystals: keepScores ? previous.shadowCrystals : 0,
      exits: keepScores ? previous.exits : 0,
      previousHistory: keepScores ? previous.previousHistory.slice() : [],
      disconnected: previous.disconnected,
      left: previous.left,
    };
  });
}

export function replayShadowsForTick(state: ShadowState, tick: number): void {
  if (state.phase !== 'playing') return;
  refreshGates(state);
  state.shadows.forEach((ghost, shadowIndex) => {
    if (!ghost.active) return;
    if (ghost.freezeUntilTick > tick) return;
    const steps = ghost.history.filter((step) => step.tick === tick);
    for (const step of steps) {
      const { dx, dy } = DELTA[step.direction];
      const nx = ghost.x + dx;
      const ny = ghost.y + dy;
      if (!isWalkable(state, nx, ny) || occupantAt(state, nx, ny, { shadowIndex })) {
        ghost.skipped += 1;
        continue;
      }
      ghost.x = nx;
      ghost.y = ny;
      const event = applyCellEffects(state, nx, ny, 'shadow', ghost.ownerId);
      if (event) state.lastEvent = event;
      if (tileAt(state, nx, ny) === 'hazard') ghost.freezeUntilTick = tick + HAZARD_TICKS;
      refreshGates(state);
    }
  });
  refreshGates(state);
}

function spawnShadows(state: ShadowState): void {
  state.shadows = [];
  for (const [id, runner] of Object.entries(state.runners)) {
    if (runner.left) continue;
    if (runner.previousHistory.length === 0) continue;
    state.shadows.push({
      ownerId: id,
      x: runner.spawnX,
      y: runner.spawnY,
      history: runner.previousHistory.map((step) => ({ ...step })),
      skipped: 0,
      active: true,
      freezeUntilTick: -1,
    });
  }
}

export function beginRound(state: ShadowState, ctx: GameContext, round: number): void {
  if (state.phase === 'finished') return;
  const arena = arenaById(state.arenaId);
  applyArena(state, arena, true);
  state.round = round;
  state.roundTick = 0;
  state.tickAcc = 0;
  state.maxTicks = MAX_TICKS;
  state.phase = 'playing';
  state.durationMs = ROUND_MS;
  state.endsAt = ctx.now() + ROUND_MS;
  state.lastEvent = round === 0 ? 'start' : `round:${round}`;
  spawnShadows(state);
  refreshGates(state);
  replayShadowsForTick(state, 0);
  if (state.shadows.length > 0) state.lastEvent = 'shadow-born';
  ctx.markStateChanged();
  ctx.schedule(ROUND_MS, () => endRound(state, ctx), 'turn', 'round-timeout');
  for (const player of ctx.players) {
    if (player.isAI) ctx.requestAI(player.id, 80);
  }
}

export function endRound(state: ShadowState, ctx: GameContext): void {
  if (state.phase !== 'playing') return;
  for (const runner of Object.values(state.runners)) {
    if (runner.left) continue;
    if (runner.crystalsThisRound >= 1 && runner.history.length <= EFFICIENT_STEP_LIMIT) {
      runner.score += SCORE_EFFICIENT;
    }
    runner.previousHistory = runner.history.map((step) => ({ ...step }));
    runner.history = [];
  }
  if (state.round + 1 >= state.totalRounds) {
    finishShadow(state, ctx, 'completed');
    return;
  }
  state.phase = 'between';
  state.lastEvent = 'round-end';
  state.endsAt = ctx.now() + GAP_MS;
  ctx.markStateChanged();
  ctx.schedule(GAP_MS, () => beginRound(state, ctx, state.round + 1), 'turn', 'next-round');
}

export function finishShadow(state: ShadowState, ctx: GameContext, reason: GameFinishReason): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.finishReason = reason;
  state.lastEvent = reason === 'timeout' ? 'timeout' : 'finished';
  ctx.markStateChanged();
  ctx.finish(reason);
}

export function advanceTick(state: ShadowState, ctx: GameContext): void {
  if (state.phase !== 'playing') return;
  state.roundTick += 1;
  replayShadowsForTick(state, state.roundTick);
  refreshGates(state);
  ctx.markStateChanged();
  if (state.roundTick >= state.maxTicks) endRound(state, ctx);
}

export function canMovePlayer(
  state: ShadowState,
  playerId: string,
  direction: ShadowDirection,
): { ok: boolean; reason?: string } {
  const runner = state.runners[playerId];
  if (!runner || runner.left) return { ok: false, reason: 'You are not in this match.' };
  if (state.phase !== 'playing') return { ok: false, reason: 'Wait for the next round.' };
  if (runner.disconnected) return { ok: false, reason: 'Reconnect to keep moving.' };
  if (runner.freezeUntilTick > state.roundTick) return { ok: false, reason: 'A hazard froze you.' };
  if (runner.history.some((step) => step.tick === state.roundTick)) {
    return { ok: false, reason: 'Wait for the next beat.' };
  }
  const { dx, dy } = DELTA[direction];
  const nx = runner.x + dx;
  const ny = runner.y + dy;
  if (!isWalkable(state, nx, ny, gatesAreOpen(state))) return { ok: false, reason: 'Blocked.' };
  if (occupantAt(state, nx, ny, { playerId })) return { ok: false, reason: 'That cell is occupied.' };
  return { ok: true };
}

export function tryMovePlayer(
  state: ShadowState,
  playerId: string,
  direction: ShadowDirection,
): { ok: boolean; reason?: string } {
  const allowed = canMovePlayer(state, playerId, direction);
  if (!allowed.ok) return allowed;
  const runner = state.runners[playerId]!;
  const { dx, dy } = DELTA[direction];
  const nx = runner.x + dx;
  const ny = runner.y + dy;
  runner.x = nx;
  runner.y = ny;
  runner.history.push({ tick: state.roundTick, direction });
  const event = applyCellEffects(state, nx, ny, 'player', playerId);
  refreshGates(state);
  const onPlate = state.plates.some((plate) => plate.x === nx && plate.y === ny);
  if (onPlate && state.gatesOpen) state.lastEvent = event ?? `plate:${playerId}`;
  else state.lastEvent = event ?? `move:${playerId}`;
  return { ok: true };
}

function emptyState(players: ReadonlyArray<{ id: string }>, config: GameConfig): ShadowState {
  const seed = typeof config.seed === 'number' ? config.seed : 1;
  const arena = arenaById(pickArenaId(config.gridSize, seed));
  const runners: Record<string, ShadowRunner> = {};
  players.forEach((player, index) => {
    runners[player.id] = makeRunner(arena.spawns[index % arena.spawns.length]!);
  });
  return {
    phase: 'idle',
    round: 0,
    totalRounds: clampRounds(config.rounds),
    roundTick: 0,
    maxTicks: MAX_TICKS,
    tickAcc: 0,
    arenaId: arena.id,
    arenaName: arena.name,
    cols: arena.cols,
    rows: arena.rows,
    tiles: arena.tiles.slice(),
    plates: arena.plates.map((plate) => ({ ...plate })),
    pickups: arena.pickups.map((pickup) => ({ ...pickup })),
    gatesOpen: false,
    runners,
    shadows: [],
    startedAt: null,
    endsAt: null,
    matchEndsAt: null,
    durationMs: ROUND_MS,
    finishReason: null,
    lastEvent: null,
    nextAIRequestAt: {},
  };
}

function bfsStep(
  state: ShadowState,
  from: { x: number; y: number },
  target: { x: number; y: number },
  playerId: string,
): ShadowDirection | null {
  const key = (x: number, y: number) => `${x},${y}`;
  const dist = new Map<string, number>();
  const queue: Array<{ x: number; y: number }> = [target];
  dist.set(key(target.x, target.y), 0);
  while (queue.length > 0) {
    const cell = queue.shift()!;
    const here = dist.get(key(cell.x, cell.y)) ?? 0;
    for (const direction of ALL_DIRS) {
      const nx = cell.x + DELTA[direction].dx;
      const ny = cell.y + DELTA[direction].dy;
      if (!isWalkable(state, nx, ny)) continue;
      const id = key(nx, ny);
      if (dist.has(id)) continue;
      dist.set(id, here + 1);
      queue.push({ x: nx, y: ny });
    }
  }
  const origin = dist.get(key(from.x, from.y));
  if (origin === undefined) return null;
  let best: ShadowDirection | null = null;
  let bestDist = origin;
  for (const direction of ALL_DIRS) {
    const nx = from.x + DELTA[direction].dx;
    const ny = from.y + DELTA[direction].dy;
    if (!isWalkable(state, nx, ny)) continue;
    if (occupantAt(state, nx, ny, { playerId })) continue;
    const d = dist.get(key(nx, ny));
    if (d !== undefined && d < bestDist) {
      bestDist = d;
      best = direction;
    }
  }
  return best;
}

function pickAITarget(state: ShadowState, runner: ShadowRunner): { x: number; y: number } | null {
  const crystals = state.pickups.filter((pickup) => pickup.kind === 'crystal');
  if (crystals.length > 0) return crystals[0]!;
  if (!state.gatesOpen && state.plates.length > 0) return state.plates[0]!;
  for (let y = 0; y < state.rows; y += 1) {
    for (let x = 0; x < state.cols; x += 1) {
      if (tileAt(state, x, y) === 'exit' && !runner.exitedThisRound) return { x, y };
    }
  }
  const shadows = state.pickups.filter((pickup) => pickup.kind === 'shadow');
  if (shadows.length > 0) return state.plates[0] ?? shadows[0]!;
  return null;
}

export const shadowCopyGame: GameModule<ShadowState> = {
  metadata: SHADOW_COPY_METADATA,

  initialize(): void {
    // Stateless module.
  },

  createInitialState(players, config): ShadowState {
    return emptyState(players, config);
  },

  playerJoined(player, state): void {
    const existing = state.runners[player.id];
    if (existing) {
      existing.disconnected = false;
      return;
    }
    const spawn = arenaById(state.arenaId).spawns[Object.keys(state.runners).length % 4]!;
    state.runners[player.id] = makeRunner(spawn);
  },

  playerReady(): void {
    // Lobby concern.
  },

  playerLeft(playerId, state, ctx, reason): void {
    const runner = state.runners[playerId];
    if (!runner) return;
    if (reason === 'disconnect') {
      runner.disconnected = true;
      return;
    }
    runner.left = true;
    state.shadows = state.shadows.filter((ghost) => ghost.ownerId !== playerId);
    const remaining = Object.values(state.runners).filter((entry) => !entry.left);
    if (remaining.length <= 1 && state.phase !== 'finished') {
      finishShadow(state, ctx, 'abandoned');
    }
  },

  start(state, ctx): void {
    if (state.phase === 'playing') return;
    const arena = arenaById(pickArenaId(ctx.config.gridSize, ctx.seed));
    const runners: Record<string, ShadowRunner> = {};
    ctx.players.forEach((player, index) => {
      runners[player.id] = makeRunner(arena.spawns[index % arena.spawns.length]!);
    });
    state.runners = runners;
    state.arenaId = arena.id;
    state.totalRounds = clampRounds(ctx.config.rounds);
    state.startedAt = ctx.now();
    state.matchEndsAt = state.startedAt + state.totalRounds * (ROUND_MS + GAP_MS) + 2_000;
    state.finishReason = null;
    state.nextAIRequestAt = {};
    applyArena(state, arena, false);
    beginRound(state, ctx, 0);
    ctx.schedule(
      Math.max(1_000, (state.matchEndsAt ?? ctx.now()) - ctx.now()),
      () => {
        if (state.phase !== 'finished') finishShadow(state, ctx, 'timeout');
      },
      'gameDuration',
      'match-timeout',
    );
  },

  validateAction(playerId, action, state): ValidationResult {
    if (FORBIDDEN_TYPES.has(action.type)) {
      return { valid: false, reason: 'The server owns Shadow Copies and scores.' };
    }
    if (action.type !== 'move') return { valid: false, reason: 'Unknown action.' };
    if (!isShadowDirection(action.payload?.direction)) {
      return { valid: false, reason: 'Use up, down, left or right.' };
    }
    const attempt = canMovePlayer(state, playerId, action.payload.direction);
    if (!attempt.ok) return { valid: false, reason: attempt.reason };
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    if (FORBIDDEN_TYPES.has(action.type) || action.type !== 'move') {
      return actionRejected('The server owns Shadow Copies and scores.');
    }
    const direction = action.payload?.direction;
    if (!isShadowDirection(direction)) return actionRejected('Invalid direction.');
    const attempt = tryMovePlayer(state, playerId, direction);
    if (!attempt.ok) return actionRejected(attempt.reason);
    ctx.markStateChanged();
    return actionAccepted();
  },

  update(state, deltaTimeMs, ctx): void {
    if (state.phase !== 'playing') return;
    state.tickAcc += deltaTimeMs;
    while (state.tickAcc >= STEP_MS && state.phase === 'playing') {
      state.tickAcc -= STEP_MS;
      advanceTick(state, ctx);
    }
    if (state.phase !== 'playing') return;
    for (const player of ctx.players) {
      if (!player.isAI) continue;
      const runner = state.runners[player.id];
      if (!runner || runner.left) continue;
      const now = ctx.now();
      const difficulty = player.aiDifficulty ?? 'medium';
      if (now >= (state.nextAIRequestAt[player.id] ?? 0)) {
        ctx.requestAI(player.id, 40);
        state.nextAIRequestAt[player.id] = now + AI_INTERVAL[difficulty];
      }
    }
  },

  tick(): void {
    // Shadow replay lives in update()/advanceTick().
  },

  calculateScore(playerId, state): number {
    return state.runners[playerId]?.score ?? 0;
  },

  checkWinCondition(state): string[] | null {
    if (state.phase !== 'finished') return null;
    const entries = Object.entries(state.runners).filter(([, runner]) => !runner.left);
    if (entries.length === 0) return [];
    const best = Math.max(...entries.map(([, runner]) => runner.score));
    return entries.filter(([, runner]) => runner.score === best).map(([id]) => id);
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
    const ranked = [...ctx.players].sort((a, b) => {
      const aRunner = state.runners[a.id];
      const bRunner = state.runners[b.id];
      const scoreDiff = (bRunner?.score ?? 0) - (aRunner?.score ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
      const crystalDiff = (bRunner?.crystals ?? 0) - (aRunner?.crystals ?? 0);
      if (crystalDiff !== 0) return crystalDiff;
      return (bRunner?.shadowCrystals ?? 0) - (aRunner?.shadowCrystals ?? 0);
    });
    const best = ranked[0] ? state.runners[ranked[0].id]?.score ?? 0 : 0;
    const winners = ranked.filter((player) => (state.runners[player.id]?.score ?? 0) === best).map((player) => player.id);
    const draw = winners.length > 1;
    const rankings: RankingDraft[] = ranked.map((player, index) => {
      const runner = state.runners[player.id];
      return {
        playerId: player.id,
        rank: index + 1,
        score: runner?.score ?? 0,
        isWinner: winners.includes(player.id),
        isDraw: draw,
        stats: {
          crystals: runner?.crystals ?? 0,
          shadowCrystals: runner?.shadowCrystals ?? 0,
          exits: runner?.exits ?? 0,
        },
      };
    });
    return { winners, isDraw: draw, rankings, reason: state.finishReason ?? 'completed' };
  },

  reset(state): ShadowState {
    const ids = Object.keys(state.runners);
    const next = emptyState(
      ids.map((id) => ({ id })),
      { playerCount: ids.length, humanCount: ids.length, aiOpponents: 0, aiDifficulty: 'medium', gridSize: state.arenaId },
    );
    next.arenaId = state.arenaId;
    const arena = arenaById(state.arenaId);
    applyArena(next, arena, false);
    return next;
  },

  cleanup(state): void {
    state.runners = {};
    state.shadows = [];
    state.phase = 'finished';
  },

  getPublicState(state, _viewerId, ctx) {
    return {
      phase: state.phase,
      round: state.round,
      totalRounds: state.totalRounds,
      roundTick: state.roundTick,
      maxTicks: state.maxTicks,
      arenaId: state.arenaId,
      arenaName: state.arenaName,
      cols: state.cols,
      rows: state.rows,
      tiles: state.tiles.slice(),
      plates: state.plates.map((plate) => ({ ...plate })),
      pickups: state.pickups.map((pickup) => ({ ...pickup })),
      gatesOpen: platesHeld(state),
      startedAt: state.startedAt,
      endsAt: state.endsAt,
      durationMs: state.durationMs,
      finishReason: state.finishReason,
      lastEvent: state.lastEvent,
      serverTime: ctx.now(),
      runners: Object.fromEntries(
        Object.entries(state.runners).map(([id, runner]) => [
          id,
          {
            x: runner.x,
            y: runner.y,
            score: runner.score,
            crystals: runner.crystals,
            shadowCrystals: runner.shadowCrystals,
            exits: runner.exits,
            frozen: runner.freezeUntilTick > state.roundTick,
            disconnected: runner.disconnected,
          },
        ]),
      ),
      shadows: state.shadows.map((ghost) => ({
        ownerId: ghost.ownerId,
        x: ghost.x,
        y: ghost.y,
        skipped: ghost.skipped,
      })),
    };
  },

  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'playing') return null;
    const runner = state.runners[playerId];
    if (!runner || runner.left || runner.disconnected) return null;
    if (runner.freezeUntilTick > state.roundTick) return null;
    if (runner.history.some((step) => step.tick === state.roundTick)) return null;
    const legal = ALL_DIRS.filter((direction) => {
      const nx = runner.x + DELTA[direction].dx;
      const ny = runner.y + DELTA[direction].dy;
      return isWalkable(state, nx, ny) && !occupantAt(state, nx, ny, { playerId });
    });
    if (legal.length === 0) return null;
    if (difficulty === 'easy' && ctx.random() < 0.45) {
      return { type: 'move', payload: { direction: legal[Math.floor(ctx.random() * legal.length)]! } };
    }
    const target = pickAITarget(state, runner);
    const chosen = target ? bfsStep(state, runner, target, playerId) : null;
    if (chosen && legal.includes(chosen)) return { type: 'move', payload: { direction: chosen } };
    if (difficulty === 'hard' && chosen && isWalkable(state, runner.x + DELTA[chosen].dx, runner.y + DELTA[chosen].dy)) {
      return { type: 'move', payload: { direction: chosen } };
    }
    return { type: 'move', payload: { direction: legal[0]! } };
  },

  needsUpdateLoop: true,
  maxDurationMs: 5 * 60 * 1000,
};
