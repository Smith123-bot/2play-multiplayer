import type { AIDifficulty, GameAction, GameConfig, GameFinishReason } from '@2play/shared';
import { SPLIT_WORLD_METADATA } from '@2play/shared';
export { SPLIT_WORLD_METADATA };
import type {
  ActionResult,
  GameContext,
  GameModule,
  GamePlayerView,
  GameResultDraft,
  RankingDraft,
  ValidationResult,
} from '../GameModule';
import { actionAccepted, actionRejected } from '../GameModule';
import { SPLIT_ARENAS, SPLIT_TOTAL_ROUNDS, type ArenaDefinition, type ObjectiveKind } from './arenas';

export { SPLIT_ARENAS, SPLIT_TOTAL_ROUNDS };
export type { ArenaDefinition, ObjectiveKind };

/**
 * Split World — one shared, server-owned 2D world; every seat sees a different
 * projection of it.
 *
 * The true layout, the hidden switch order and the key sequence NEVER leave the
 * server: `getPublicState` builds a per-viewer projection through that seat's
 * "lens". Clients only ever send `move` / `interact` intents; the server decides
 * collisions, objectives, scores, round progression and the winner.
 */

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type SplitPhase = 'idle' | 'prep' | 'playing' | 'intermission' | 'finished';
export type SplitDirection = 'up' | 'down' | 'left' | 'right';

/** Truth, server-only. */
export type TrueTile = 'wall' | 'floor' | 'switch' | 'door' | 'goal' | 'key' | 'hazard' | 'plate' | 'decoy';
/** What a client may be told about a tile. */
export type ViewTile =
  | 'wall'
  | 'floor'
  | 'switch'
  | 'door'
  | 'goal'
  | 'key'
  | 'hazard'
  | 'plate'
  | 'unknown';

/** Four complementary information roles. */
export type SplitLens = 'warden' | 'gatekeeper' | 'scout' | 'archivist';

export const LENS_ORDER: SplitLens[] = ['warden', 'gatekeeper', 'scout', 'archivist'];

export const LENS_LABEL: Record<SplitLens, string> = {
  warden: 'Warden — switches, plates, keys, exit',
  gatekeeper: 'Gatekeeper — hazards and the gate',
  scout: 'Scout — plates, keys, hazards',
  archivist: 'Archivist — switches, the gate, exit',
};

interface LensReveal {
  switches: boolean;
  plates: boolean;
  keys: boolean;
  hazards: boolean;
  door: boolean;
  goal: boolean;
  /** How a decoy tile is drawn for this lens (never the truth: it is floor). */
  decoyAs: ViewTile;
}

/**
 * Lens 0 ∪ lens 1 covers every object type, so even a 2 player match can be
 * solved — but only by talking. Lenses 2/3 add partial overlap for 3-4 seats.
 */
export const LENS_REVEAL: Record<SplitLens, LensReveal> = {
  warden: { switches: true, plates: true, keys: true, hazards: false, door: false, goal: true, decoyAs: 'wall' },
  gatekeeper: { switches: false, plates: false, keys: false, hazards: true, door: true, goal: false, decoyAs: 'switch' },
  scout: { switches: false, plates: true, keys: true, hazards: true, door: false, goal: false, decoyAs: 'wall' },
  archivist: { switches: true, plates: false, keys: false, hazards: false, door: true, goal: true, decoyAs: 'key' },
};

export interface SplitSwitch {
  id: string;
  x: number;
  y: number;
  triggered: boolean;
  /** Required position in the secret order (0-based); -1 when order is irrelevant. */
  order: number;
}

export interface SplitPlate {
  id: string;
  x: number;
  y: number;
  pressed: boolean;
}

export interface SplitKey {
  id: string;
  x: number;
  y: number;
  /** Required position in the secret sequence (0-based); -1 when any order works. */
  seq: number;
  taken: boolean;
  takenBy: string | null;
}

export interface SplitPlayer {
  x: number;
  y: number;
  /** Cumulative match score. */
  score: number;
  /** Score earned inside the current round (used to pick the round winner). */
  roundScore: number;
  roundsWon: number;
  lens: SplitLens;
  seatIndex: number;
  finished: boolean;
  /** Server clock: the player cannot act before this. */
  stunUntil: number;
  keysTaken: number;
  switchesTriggered: number;
  disconnected: boolean;
  left: boolean;
}

export interface SplitState {
  phase: SplitPhase;
  round: number;
  totalRounds: number;
  arenaId: string;
  arenaName: string;
  objective: ObjectiveKind;
  objectiveText: string;
  cols: number;
  rows: number;
  /** SERVER ONLY. Never projected raw. */
  trueTiles: TrueTile[][];
  switches: SplitSwitch[];
  plates: SplitPlate[];
  keys: SplitKey[];
  door: { x: number; y: number } | null;
  goal: { x: number; y: number } | null;
  spawns: Array<{ x: number; y: number }>;
  keysRequired: number;
  /** How far the team is through the secret switch order / key sequence. */
  orderProgress: number;
  doorOpen: boolean;
  objectiveComplete: boolean;
  players: Record<string, SplitPlayer>;
  prepUntil: number | null;
  endsAt: number | null;
  startedAt: number | null;
  finishReason: GameFinishReason | null;
  lastEvent: string | null;
  nextAIRequestAt: Record<string, number>;
}

/* ------------------------------------------------------------------ */
/* Tunables                                                            */
/* ------------------------------------------------------------------ */

export const PREP_MS = 4_000;
export const INTERMISSION_MS = 3_000;
export const HAZARD_STUN_MS = 1_200;
export const MIN_PLATES_REQUIRED = 2;

export const SWITCH_SCORE = 30;
export const KEY_SCORE = 25;
export const PLATE_SCORE = 20;
export const GOAL_SCORE = 100;
export const ROUND_WIN_SCORE = 25;
export const HAZARD_PENALTY = 15;
export const WRONG_ORDER_PENALTY = 10;
/** Max speed bonus for finishing early (scaled by remaining round time). */
export const SPEED_BONUS_MAX = 50;

const DELTA: Record<SplitDirection, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};
const ALL_DIRS: SplitDirection[] = ['up', 'down', 'left', 'right'];
const AI_INTERVAL: Record<AIDifficulty, number> = { easy: 520, medium: 300, hard: 170 };
/** Chance the AI deliberately plays a random legal step instead of the best one. */
const AI_NOISE: Record<AIDifficulty, number> = { easy: 0.45, medium: 0.18, hard: 0.04 };

/* ------------------------------------------------------------------ */
/* Pure helpers (exported for tests)                                   */
/* ------------------------------------------------------------------ */

export function isSplitDirection(value: unknown): value is SplitDirection {
  return value === 'up' || value === 'down' || value === 'left' || value === 'right';
}

export function lensForSeat(seatIndex: number): SplitLens {
  const lens = LENS_ORDER[((seatIndex % LENS_ORDER.length) + LENS_ORDER.length) % LENS_ORDER.length];
  return lens ?? 'warden';
}

export function arenaForRound(round: number): ArenaDefinition {
  const arena = SPLIT_ARENAS[((round % SPLIT_ARENAS.length) + SPLIT_ARENAS.length) % SPLIT_ARENAS.length];
  // SPLIT_ARENAS is a non-empty literal, so this fallback is unreachable in practice.
  return arena ?? (SPLIT_ARENAS[0] as ArenaDefinition);
}

export interface BuiltArena {
  definition: ArenaDefinition;
  cols: number;
  rows: number;
  tiles: TrueTile[][];
  switches: SplitSwitch[];
  plates: SplitPlate[];
  keys: SplitKey[];
  hazards: Array<{ x: number; y: number }>;
  decoys: Array<{ x: number; y: number }>;
  door: { x: number; y: number } | null;
  goal: { x: number; y: number } | null;
  spawns: Array<{ x: number; y: number }>;
}

/**
 * Parses an arena character map into the authoritative world.
 *
 * `random` comes from the seeded platform PRNG, so the secret switch order and
 * key sequence are deterministic per match but unpredictable to players.
 */
export function buildArena(definition: ArenaDefinition, random: () => number): BuiltArena {
  const tiles: TrueTile[][] = [];
  const switches: SplitSwitch[] = [];
  const plates: SplitPlate[] = [];
  const keys: SplitKey[] = [];
  const hazards: Array<{ x: number; y: number }> = [];
  const decoys: Array<{ x: number; y: number }> = [];
  const spawnSlots: Array<{ index: number; x: number; y: number }> = [];
  let door: { x: number; y: number } | null = null;
  let goal: { x: number; y: number } | null = null;

  definition.layout.forEach((line, y) => {
    const row: TrueTile[] = [];
    [...line].forEach((char, x) => {
      switch (char) {
        case '#':
          row.push('wall');
          break;
        case 'S':
          row.push('switch');
          switches.push({ id: `sw-${switches.length}`, x, y, triggered: false, order: -1 });
          break;
        case 'P':
          row.push('plate');
          plates.push({ id: `pl-${plates.length}`, x, y, pressed: false });
          break;
        case 'K':
          row.push('key');
          keys.push({ id: `key-${keys.length}`, x, y, seq: -1, taken: false, takenBy: null });
          break;
        case 'H':
          row.push('hazard');
          hazards.push({ x, y });
          break;
        case 'D':
          row.push('door');
          door = { x, y };
          break;
        case 'G':
          row.push('goal');
          goal = { x, y };
          break;
        case 'X':
          // A decoy is plain floor in truth — it only exists to mislead a lens.
          row.push('decoy');
          decoys.push({ x, y });
          break;
        case '1':
        case '2':
        case '3':
        case '4':
          row.push('floor');
          spawnSlots.push({ index: Number(char) - 1, x, y });
          break;
        default:
          row.push('floor');
      }
    });
    tiles.push(row);
  });

  // Secret orderings, drawn from the seeded PRNG.
  if (definition.objective === 'switch-order') {
    const order = shuffleIndices(switches.length, random);
    switches.forEach((entry, index) => {
      entry.order = order.indexOf(index);
    });
  }
  if (definition.objective === 'sequence-keys') {
    const order = shuffleIndices(keys.length, random);
    keys.forEach((entry, index) => {
      entry.seq = order.indexOf(index);
    });
  }

  const spawns = spawnSlots.sort((a, b) => a.index - b.index).map(({ x, y }) => ({ x, y }));

  return {
    definition,
    cols: tiles[0]?.length ?? 0,
    rows: tiles.length,
    tiles,
    switches,
    plates,
    keys,
    hazards,
    decoys,
    door,
    goal,
    spawns,
  };
}

function shuffleIndices(length: number, random: () => number): number[] {
  const values = Array.from({ length }, (_unused, index) => index);
  for (let i = values.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = values[i] as number;
    const b = values[j] as number;
    values[i] = b;
    values[j] = a;
  }
  return values;
}

/** Projects one true tile through a lens. Truth is never returned verbatim. */
export function viewTile(tile: TrueTile, lens: SplitLens): ViewTile {
  const reveal = LENS_REVEAL[lens];
  switch (tile) {
    case 'wall':
      return 'wall';
    case 'floor':
      return 'floor';
    case 'switch':
      return reveal.switches ? 'switch' : 'floor';
    case 'plate':
      return reveal.plates ? 'plate' : 'floor';
    case 'key':
      return reveal.keys ? 'key' : 'floor';
    case 'hazard':
      return reveal.hazards ? 'hazard' : 'floor';
    case 'door':
      return reveal.door ? 'door' : 'floor';
    case 'goal':
      return reveal.goal ? 'goal' : 'floor';
    case 'decoy':
      return reveal.decoyAs;
    default:
      return 'unknown';
  }
}

export function viewTiles(trueTiles: TrueTile[][], lens: SplitLens): ViewTile[][] {
  return trueTiles.map((row) => row.map((tile) => viewTile(tile, lens)));
}

export function inBounds(state: SplitState, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < state.cols && y < state.rows;
}

export function tileAt(state: SplitState, x: number, y: number): TrueTile {
  if (!inBounds(state, x, y)) return 'wall';
  return state.trueTiles[y]?.[x] ?? 'wall';
}

/** The single source of truth for collisions. Clients never decide this. */
export function blockedByTruth(state: SplitState, x: number, y: number): boolean {
  if (!inBounds(state, x, y)) return true;
  const tile = tileAt(state, x, y);
  if (tile === 'wall') return true;
  if (tile === 'door' && !state.doorOpen) return true;
  return false;
}

function activePlayers(state: SplitState): SplitPlayer[] {
  return Object.values(state.players).filter((player) => !player.left);
}

/** Plates are "live": they are pressed only while a player is standing on them. */
export function refreshPlates(state: SplitState): void {
  for (const plate of state.plates) {
    plate.pressed = activePlayers(state).some(
      (player) => !player.disconnected && player.x === plate.x && player.y === plate.y,
    );
  }
}

/** Recomputes the gate from the arena objective. Called after every mutation. */
export function evaluateObjective(state: SplitState): void {
  refreshPlates(state);
  let complete = false;
  switch (state.objective) {
    case 'reach-exit':
      complete = state.switches.length > 0 && state.switches.every((entry) => entry.triggered);
      break;
    case 'collect-keys':
      complete = state.keys.filter((entry) => entry.taken).length >= state.keysRequired;
      break;
    case 'switch-order':
      complete = state.switches.length > 0 && state.orderProgress >= state.switches.length;
      break;
    case 'pressure-plates': {
      const pressed = state.plates.filter((plate) => plate.pressed).length;
      const required = Math.min(MIN_PLATES_REQUIRED, state.plates.length);
      complete = required > 0 && pressed >= required;
      break;
    }
    case 'sequence-keys':
      complete = state.orderProgress >= Math.min(state.keysRequired, state.keys.length);
      break;
    default:
      complete = false;
  }
  state.objectiveComplete = complete;
  // Pressure plates must be *held*; every other gate latches open.
  state.doorOpen = state.objective === 'pressure-plates' ? complete : state.doorOpen || complete;
}

function makePlayer(seatIndex: number, spawn: { x: number; y: number }): SplitPlayer {
  return {
    x: spawn.x,
    y: spawn.y,
    score: 0,
    roundScore: 0,
    roundsWon: 0,
    lens: lensForSeat(seatIndex),
    seatIndex,
    finished: false,
    stunUntil: 0,
    keysTaken: 0,
    switchesTriggered: 0,
    disconnected: false,
    left: false,
  };
}

function spawnFor(state: SplitState, seatIndex: number): { x: number; y: number } {
  const spawns = state.spawns;
  if (spawns.length === 0) return { x: 1, y: 1 };
  return spawns[seatIndex % spawns.length] ?? { x: 1, y: 1 };
}

/* ------------------------------------------------------------------ */
/* Round flow                                                          */
/* ------------------------------------------------------------------ */

/** Loads the arena for `state.round` and puts everyone back on their spawn. */
export function loadRound(state: SplitState, ctx: GameContext): void {
  const built = buildArena(arenaForRound(state.round), ctx.random);
  state.arenaId = built.definition.id;
  state.arenaName = built.definition.name;
  state.objective = built.definition.objective;
  state.objectiveText = built.definition.objectiveText;
  state.cols = built.cols;
  state.rows = built.rows;
  state.trueTiles = built.tiles;
  state.switches = built.switches;
  state.plates = built.plates;
  state.keys = built.keys;
  state.door = built.door;
  state.goal = built.goal;
  state.spawns = built.spawns;
  state.keysRequired = Math.min(built.definition.keysRequired ?? built.keys.length, built.keys.length);
  state.orderProgress = 0;
  state.doorOpen = false;
  state.objectiveComplete = false;

  for (const player of Object.values(state.players)) {
    const spawn = spawnFor(state, player.seatIndex);
    player.x = spawn.x;
    player.y = spawn.y;
    player.finished = false;
    player.stunUntil = 0;
    player.roundScore = 0;
    player.keysTaken = 0;
    player.switchesTriggered = 0;
  }
  evaluateObjective(state);
}

/** Round preparation window: players can read their view but cannot move yet. */
export function beginRound(state: SplitState, ctx: GameContext): void {
  if (state.phase === 'finished') return;
  loadRound(state, ctx);
  const arena = arenaForRound(state.round);
  state.phase = 'prep';
  state.prepUntil = ctx.now() + PREP_MS;
  state.endsAt = ctx.now() + PREP_MS + arena.roundMs;
  state.lastEvent = `prep:${state.round}`;
  ctx.markStateChanged();
  ctx.schedule(PREP_MS, () => openRound(state, ctx), 'turn', `prep-${state.round}`);
}

export function openRound(state: SplitState, ctx: GameContext): void {
  if (state.phase !== 'prep') return;
  const arena = arenaForRound(state.round);
  state.phase = 'playing';
  state.prepUntil = null;
  state.endsAt = ctx.now() + arena.roundMs;
  state.lastEvent = `round:${state.round}`;
  ctx.markStateChanged();
  ctx.schedule(arena.roundMs, () => endRound(state, ctx, 'timeout'), 'turn', `round-${state.round}`);
  for (const player of ctx.players) {
    if (player.isAI) ctx.requestAI(player.id, 240);
  }
}

/** Awards the round bonus, then either starts the next round or finishes. */
export function endRound(state: SplitState, ctx: GameContext, reason: 'timeout' | 'completed'): void {
  if (state.phase !== 'playing' && state.phase !== 'prep') return;

  const contenders = activePlayers(state);
  if (contenders.length > 0) {
    const best = Math.max(...contenders.map((player) => player.roundScore));
    if (best > 0) {
      for (const player of contenders) {
        if (player.roundScore === best) {
          player.roundsWon += 1;
          player.score += ROUND_WIN_SCORE;
        }
      }
    }
  }

  state.lastEvent = `round-end:${state.round}:${reason}`;

  if (state.round + 1 >= state.totalRounds) {
    finishSplit(state, ctx, 'completed');
    return;
  }

  state.round += 1;
  state.phase = 'intermission';
  state.endsAt = ctx.now() + INTERMISSION_MS;
  ctx.markStateChanged();
  ctx.schedule(
    INTERMISSION_MS,
    () => {
      if (state.phase !== 'intermission') return;
      beginRound(state, ctx);
    },
    'turn',
    `intermission-${state.round}`,
  );
}

export function finishSplit(state: SplitState, ctx: GameContext, reason: GameFinishReason): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.finishReason = reason;
  state.prepUntil = null;
  state.endsAt = null;
  state.lastEvent = reason === 'timeout' ? 'timeout' : 'finished';
  ctx.markStateChanged();
  ctx.finish(reason);
}

/* ------------------------------------------------------------------ */
/* Interaction resolution (server authoritative)                       */
/* ------------------------------------------------------------------ */

interface StepOutcome {
  event: string;
  points: number;
}

/**
 * Resolves everything that happens because `player` now stands on (x, y).
 * This is the only place scores are ever changed by gameplay.
 */
function resolveTile(state: SplitState, playerId: string, player: SplitPlayer, ctx: GameContext): StepOutcome {
  const tile = tileAt(state, player.x, player.y);
  let points = 0;
  let event = `move:${playerId}`;

  if (tile === 'hazard') {
    points -= HAZARD_PENALTY;
    player.stunUntil = ctx.now() + HAZARD_STUN_MS;
    event = `hazard:${playerId}`;
  }

  if (tile === 'switch') {
    const entry = state.switches.find((candidate) => candidate.x === player.x && candidate.y === player.y);
    if (entry && !entry.triggered) {
      if (state.objective === 'switch-order') {
        if (entry.order === state.orderProgress) {
          entry.triggered = true;
          state.orderProgress += 1;
          player.switchesTriggered += 1;
          points += SWITCH_SCORE;
          event = `switch:${playerId}`;
        } else {
          // Wrong switch: the whole sequence resets. Communication matters.
          points -= WRONG_ORDER_PENALTY;
          state.orderProgress = 0;
          for (const candidate of state.switches) candidate.triggered = false;
          event = `wrong:${playerId}`;
        }
      } else {
        entry.triggered = true;
        player.switchesTriggered += 1;
        points += SWITCH_SCORE;
        event = `switch:${playerId}`;
      }
    }
  }

  if (tile === 'key') {
    const entry = state.keys.find((candidate) => candidate.x === player.x && candidate.y === player.y);
    // `taken` makes a key a one-time reward — no duplicate scoring.
    if (entry && !entry.taken) {
      if (state.objective === 'sequence-keys') {
        if (entry.seq === state.orderProgress) {
          entry.taken = true;
          entry.takenBy = playerId;
          state.orderProgress += 1;
          player.keysTaken += 1;
          points += KEY_SCORE;
          event = `key:${playerId}`;
        } else {
          points -= WRONG_ORDER_PENALTY;
          event = `wrong:${playerId}`;
        }
      } else {
        entry.taken = true;
        entry.takenBy = playerId;
        player.keysTaken += 1;
        points += KEY_SCORE;
        event = `key:${playerId}`;
      }
    }
  }

  if (tile === 'plate') {
    const plate = state.plates.find((candidate) => candidate.x === player.x && candidate.y === player.y);
    if (plate && !plate.pressed) {
      points += PLATE_SCORE;
      event = `plate:${playerId}`;
    }
  }

  evaluateObjective(state);

  if (tile === 'goal' && state.doorOpen && !player.finished) {
    player.finished = true;
    points += GOAL_SCORE;
    const arena = arenaForRound(state.round);
    const remaining = Math.max(0, (state.endsAt ?? ctx.now()) - ctx.now());
    points += Math.round(SPEED_BONUS_MAX * Math.min(1, remaining / arena.roundMs));
    event = `goal:${playerId}`;
  }

  return { event, points };
}

function award(player: SplitPlayer, points: number): void {
  if (points === 0) return;
  player.score = Math.max(0, player.score + points);
  player.roundScore = Math.max(0, player.roundScore + points);
}

/* ------------------------------------------------------------------ */
/* AI                                                                  */
/* ------------------------------------------------------------------ */

/** Breadth-first step towards `target`, respecting the true world. */
function stepToward(
  state: SplitState,
  from: { x: number; y: number },
  target: { x: number; y: number },
  avoidHazards: boolean,
): SplitDirection | null {
  if (from.x === target.x && from.y === target.y) return null;
  const seen = new Set<string>([`${from.x}:${from.y}`]);
  const queue: Array<{ x: number; y: number; first: SplitDirection }> = [];

  for (const direction of ALL_DIRS) {
    const nx = from.x + DELTA[direction].dx;
    const ny = from.y + DELTA[direction].dy;
    if (blockedByTruth(state, nx, ny)) continue;
    if (avoidHazards && tileAt(state, nx, ny) === 'hazard') continue;
    if (nx === target.x && ny === target.y) return direction;
    seen.add(`${nx}:${ny}`);
    queue.push({ x: nx, y: ny, first: direction });
  }

  while (queue.length > 0) {
    const node = queue.shift() as { x: number; y: number; first: SplitDirection };
    for (const direction of ALL_DIRS) {
      const nx = node.x + DELTA[direction].dx;
      const ny = node.y + DELTA[direction].dy;
      const key = `${nx}:${ny}`;
      if (seen.has(key)) continue;
      if (blockedByTruth(state, nx, ny)) continue;
      if (avoidHazards && tileAt(state, nx, ny) === 'hazard') continue;
      if (nx === target.x && ny === target.y) return node.first;
      seen.add(key);
      queue.push({ x: nx, y: ny, first: node.first });
    }
  }
  return null;
}

/** What this bot should walk to next, given the arena objective. */
function aiTarget(state: SplitState, player: SplitPlayer): { x: number; y: number } | null {
  if (state.objectiveComplete && state.goal) return state.goal;

  switch (state.objective) {
    case 'switch-order': {
      const next = state.switches.find((entry) => entry.order === state.orderProgress && !entry.triggered);
      if (next) return { x: next.x, y: next.y };
      break;
    }
    case 'sequence-keys': {
      const next = state.keys.find((entry) => entry.seq === state.orderProgress && !entry.taken);
      if (next) return { x: next.x, y: next.y };
      break;
    }
    case 'collect-keys': {
      const open = state.keys.filter((entry) => !entry.taken);
      if (open.length > 0) return nearest(player, open);
      break;
    }
    case 'pressure-plates': {
      const free = state.plates.filter(
        (plate) =>
          !activePlayers(state).some(
            (other) => other !== player && other.x === plate.x && other.y === plate.y,
          ),
      );
      if (free.length > 0) return nearest(player, free);
      break;
    }
    case 'reach-exit':
    default: {
      const open = state.switches.filter((entry) => !entry.triggered);
      if (open.length > 0) return nearest(player, open);
      break;
    }
  }
  return state.goal;
}

function nearest(
  player: SplitPlayer,
  candidates: Array<{ x: number; y: number }>,
): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const distance = Math.abs(candidate.x - player.x) + Math.abs(candidate.y - player.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { x: candidate.x, y: candidate.y };
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Module                                                              */
/* ------------------------------------------------------------------ */

function resolveTotalRounds(config: GameConfig): number {
  if (typeof config.rounds === 'number' && Number.isFinite(config.rounds)) {
    return Math.min(SPLIT_TOTAL_ROUNDS, Math.max(1, Math.round(config.rounds)));
  }
  return SPLIT_TOTAL_ROUNDS;
}

function viewerLens(state: SplitState, viewerId: string | undefined, ctx: GameContext): SplitLens {
  if (viewerId) {
    const player = state.players[viewerId];
    if (player) return player.lens;
    const seat = ctx.players.find((entry) => entry.id === viewerId)?.seatIndex;
    if (typeof seat === 'number') return lensForSeat(seat);
  }
  return 'warden';
}

export const splitWorldGame: GameModule<SplitState> = {
  metadata: SPLIT_WORLD_METADATA,

  initialize(): void {
    // Stateless module: all state lives in the room's SplitState.
  },

  createInitialState(players: readonly GamePlayerView[], config: GameConfig): SplitState {
    const state: SplitState = {
      phase: 'idle',
      round: 0,
      totalRounds: resolveTotalRounds(config),
      arenaId: '',
      arenaName: '',
      objective: 'reach-exit',
      objectiveText: '',
      cols: 0,
      rows: 0,
      trueTiles: [],
      switches: [],
      plates: [],
      keys: [],
      door: null,
      goal: null,
      spawns: [],
      keysRequired: 0,
      orderProgress: 0,
      doorOpen: false,
      objectiveComplete: false,
      players: {},
      prepUntil: null,
      endsAt: null,
      startedAt: null,
      finishReason: null,
      lastEvent: null,
      nextAIRequestAt: {},
    };
    players.forEach((player, index) => {
      const seat = typeof player.seatIndex === 'number' ? player.seatIndex : index;
      state.players[player.id] = makePlayer(seat, { x: 1, y: 1 });
    });
    return state;
  },

  playerJoined(player, state): void {
    const existing = state.players[player.id];
    if (existing) {
      // Reconnection: the seat, lens, score and progress are all preserved.
      existing.disconnected = false;
      return;
    }
    const seat =
      typeof player.seatIndex === 'number' ? player.seatIndex : Object.keys(state.players).length;
    const created = makePlayer(seat, { x: 1, y: 1 });
    const spawn = spawnFor(state, seat);
    created.x = spawn.x;
    created.y = spawn.y;
    state.players[player.id] = created;
  },

  playerReady(): void {
    // Readiness is a lobby concern.
  },

  playerLeft(playerId, state, ctx, reason): void {
    const player = state.players[playerId];
    if (!player) return;
    if (reason === 'disconnect') {
      // Held plates must drop immediately, but the seat is kept for 120s.
      player.disconnected = true;
      evaluateObjective(state);
      return;
    }
    player.left = true;
    evaluateObjective(state);
    if (activePlayers(state).length <= 1) finishSplit(state, ctx, 'abandoned');
  },

  start(state, ctx): void {
    if (state.phase === 'playing' || state.phase === 'prep') return;
    state.players = {};
    ctx.players.forEach((player, index) => {
      const seat = typeof player.seatIndex === 'number' ? player.seatIndex : index;
      state.players[player.id] = makePlayer(seat, { x: 1, y: 1 });
    });
    state.round = 0;
    state.finishReason = null;
    state.startedAt = ctx.now();
    state.nextAIRequestAt = {};
    beginRound(state, ctx);
  },

  validateAction(playerId, action, state, ctx): ValidationResult {
    // The client may never assert an outcome — only an intent.
    if (['score', 'reveal', 'open', 'world', 'win', 'complete', 'finish'].includes(action.type)) {
      return { valid: false, reason: 'The server owns the true world.' };
    }
    if (action.type !== 'move') return { valid: false, reason: 'Unknown action.' };
    if (!isSplitDirection(action.payload?.direction)) {
      return { valid: false, reason: 'Use up, down, left or right.' };
    }
    if (state.phase === 'prep') return { valid: false, reason: 'Study your view — the round has not opened.' };
    if (state.phase !== 'playing') return { valid: false, reason: 'The world is not live.' };

    const player = state.players[playerId];
    if (!player || player.left) return { valid: false, reason: 'You are not in this world.' };
    if (player.disconnected) return { valid: false, reason: 'Reconnect to keep moving.' };
    if (player.finished) return { valid: false, reason: 'You already reached the exit.' };
    if (ctx.now() < player.stunUntil) return { valid: false, reason: 'You are still recovering.' };

    const delta = DELTA[action.payload.direction as SplitDirection];
    if (blockedByTruth(state, player.x + delta.dx, player.y + delta.dy)) {
      return { valid: false, reason: 'A real wall or a closed gate blocks that way.' };
    }
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    if (action.type !== 'move') return actionRejected('The server owns the true world.');
    const direction = action.payload?.direction;
    if (!isSplitDirection(direction)) return actionRejected('Invalid direction.');

    const player = state.players[playerId];
    if (!player || state.phase !== 'playing' || player.left || player.finished) {
      return actionRejected('You cannot move.');
    }
    if (player.disconnected) return actionRejected('Reconnect to keep moving.');
    if (ctx.now() < player.stunUntil) return actionRejected('You are still recovering.');

    const delta = DELTA[direction];
    const nx = player.x + delta.dx;
    const ny = player.y + delta.dy;
    if (blockedByTruth(state, nx, ny)) return actionRejected('Blocked.');

    const previous = { x: player.x, y: player.y };
    player.x = nx;
    player.y = ny;

    const outcome = resolveTile(state, playerId, player, ctx);
    award(player, outcome.points);
    state.lastEvent = outcome.event;

    // A hazard bounces you back to the tile you came from.
    if (outcome.event.startsWith('hazard:')) {
      player.x = previous.x;
      player.y = previous.y;
      evaluateObjective(state);
    }

    ctx.markStateChanged();

    const living = activePlayers(state);
    if (living.length > 0 && living.every((entry) => entry.finished)) {
      endRound(state, ctx, 'completed');
    }
    return actionAccepted();
  },

  update(state, _deltaTimeMs, ctx): void {
    if (state.phase !== 'playing') return;
    // Plates are held, not latched, so the gate is re-evaluated every tick.
    evaluateObjective(state);
    const now = ctx.now();
    for (const player of ctx.players) {
      if (!player.isAI) continue;
      const body = state.players[player.id];
      if (!body || body.left || body.finished) continue;
      if (now < body.stunUntil) continue;
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
    return state.players[playerId]?.score ?? 0;
  },

  checkWinCondition(state): string[] | null {
    if (state.phase !== 'finished') return null;
    const entries = Object.entries(state.players).filter(([, player]) => !player.left);
    if (entries.length === 0) return [];
    const best = Math.max(...entries.map(([, player]) => player.score));
    return entries.filter(([, player]) => player.score === best).map(([id]) => id);
  },

  checkDrawCondition(state): boolean {
    return (this.checkWinCondition(state)?.length ?? 0) > 1;
  },

  isGameFinished(state): boolean {
    return state.phase === 'finished';
  },

  finish(state): void {
    state.phase = 'finished';
    state.prepUntil = null;
    state.endsAt = null;
  },

  getResult(state, ctx): GameResultDraft {
    const ranked = [...ctx.players].sort((a, b) => {
      const left = state.players[a.id];
      const right = state.players[b.id];
      const scoreDelta = (right?.score ?? 0) - (left?.score ?? 0);
      if (scoreDelta !== 0) return scoreDelta;
      return (right?.roundsWon ?? 0) - (left?.roundsWon ?? 0);
    });
    const best = ranked.length > 0 ? state.players[ranked[0]?.id ?? '']?.score ?? 0 : 0;
    const winners = ranked
      .filter((player) => (state.players[player.id]?.score ?? 0) === best)
      .map((player) => player.id);
    const rankings: RankingDraft[] = ranked.map((player, index) => {
      const entry = state.players[player.id];
      return {
        playerId: player.id,
        rank: index + 1,
        score: entry?.score ?? 0,
        isWinner: winners.includes(player.id),
        isDraw: winners.length > 1,
        stats: {
          roundsWon: entry?.roundsWon ?? 0,
          keys: entry?.keysTaken ?? 0,
          switches: entry?.switchesTriggered ?? 0,
        },
      };
    });
    return { winners, isDraw: winners.length > 1, rankings, reason: state.finishReason ?? 'completed' };
  },

  reset(state): SplitState {
    // Rematch: the same seats and lenses, a fresh match from round 1.
    const next: SplitState = {
      ...state,
      phase: 'idle',
      round: 0,
      arenaId: '',
      arenaName: '',
      objective: 'reach-exit',
      objectiveText: '',
      cols: 0,
      rows: 0,
      trueTiles: [],
      switches: [],
      plates: [],
      keys: [],
      door: null,
      goal: null,
      spawns: [],
      keysRequired: 0,
      orderProgress: 0,
      doorOpen: false,
      objectiveComplete: false,
      players: Object.fromEntries(
        Object.entries(state.players).map(([id, player]) => [id, makePlayer(player.seatIndex, { x: 1, y: 1 })]),
      ),
      prepUntil: null,
      endsAt: null,
      startedAt: null,
      finishReason: null,
      lastEvent: null,
      nextAIRequestAt: {},
    };
    return next;
  },

  cleanup(state): void {
    state.players = {};
    state.trueTiles = [];
    state.switches = [];
    state.plates = [];
    state.keys = [];
    state.phase = 'finished';
  },

  /**
   * Per-viewer projection. This is the privacy boundary: `trueTiles`, the secret
   * switch order and the key sequence are never included, and object positions
   * are only listed when the viewer's lens reveals that object type.
   */
  getPublicState(state, viewerId, ctx) {
    const lens = viewerLens(state, viewerId, ctx);
    const reveal = LENS_REVEAL[lens];
    const me = viewerId ? state.players[viewerId] : undefined;

    return {
      phase: state.phase,
      round: state.round,
      totalRounds: state.totalRounds,
      arenaName: state.arenaName,
      objective: state.objective,
      objectiveText: state.objectiveText,
      cols: state.cols,
      rows: state.rows,
      lens,
      lensLabel: LENS_LABEL[lens],
      tiles: viewTiles(state.trueTiles, lens),
      // Aggregate progress is public: it is what the team is allowed to know.
      doorOpen: state.doorOpen,
      objectiveComplete: state.objectiveComplete,
      switchesTotal: state.switches.length,
      switchesTriggered: state.switches.filter((entry) => entry.triggered).length,
      platesTotal: state.plates.length,
      platesPressed: state.plates.filter((plate) => plate.pressed).length,
      platesRequired: Math.min(MIN_PLATES_REQUIRED, state.plates.length),
      keysTotal: state.keys.length,
      keysRequired: state.keysRequired,
      keysTaken: state.keys.filter((entry) => entry.taken).length,
      orderProgress: state.orderProgress,
      // Only this seat's slice of the secret ordering — never the whole solution.
      orderHints: buildOrderHints(state, lens, me?.seatIndex ?? 0),
      goal: reveal.goal && state.goal ? { ...state.goal } : null,
      door: reveal.door && state.door ? { ...state.door } : null,
      prepUntil: state.prepUntil,
      endsAt: state.endsAt,
      finishReason: state.finishReason,
      lastEvent: state.lastEvent,
      serverTime: ctx.now(),
      players: Object.fromEntries(
        Object.entries(state.players).map(([id, player]) => [
          id,
          {
            x: player.x,
            y: player.y,
            score: player.score,
            roundScore: player.roundScore,
            roundsWon: player.roundsWon,
            lens: player.lens,
            finished: player.finished,
            stunned: player.stunUntil > ctx.now(),
            disconnected: player.disconnected,
          },
        ]),
      ),
    };
  },

  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'playing') return null;
    const player = state.players[playerId];
    if (!player || player.left || player.finished) return null;
    if (ctx.now() < player.stunUntil) return null;

    const legal = ALL_DIRS.filter(
      (direction) => !blockedByTruth(state, player.x + DELTA[direction].dx, player.y + DELTA[direction].dy),
    );
    if (legal.length === 0) return null;

    const randomStep = (): GameAction => ({
      type: 'move',
      payload: { direction: legal[Math.floor(ctx.random() * legal.length)] as SplitDirection },
    });

    if (ctx.random() < AI_NOISE[difficulty]) return randomStep();

    const target = aiTarget(state, player);
    if (!target) return randomStep();
    // Only the hard bot reliably dodges hazards.
    const step = stepToward(state, player, target, difficulty !== 'easy');
    if (step && legal.includes(step)) return { type: 'move', payload: { direction: step } };
    return randomStep();
  },

  needsUpdateLoop: true,
  maxDurationMs: 10 * 60 * 1000,
};

/**
 * Splits the secret ordering across seats: seat `i` learns the position of the
 * switches/keys where `index % seats === i`. Nobody ever holds the full answer,
 * which is what forces players to talk.
 */
function buildOrderHints(state: SplitState, lens: SplitLens, seatIndex: number): Array<{ x: number; y: number; order: number }> {
  const reveal = LENS_REVEAL[lens];
  const seats = Math.max(1, Object.keys(state.players).length);
  const slot = ((seatIndex % seats) + seats) % seats;

  if (state.objective === 'switch-order' && reveal.switches) {
    return state.switches
      .filter((entry) => entry.order >= 0 && entry.order % seats === slot)
      .map((entry) => ({ x: entry.x, y: entry.y, order: entry.order }));
  }
  if (state.objective === 'sequence-keys' && reveal.keys) {
    return state.keys
      .filter((entry) => entry.seq >= 0 && entry.seq % seats === slot)
      .map((entry) => ({ x: entry.x, y: entry.y, order: entry.seq }));
  }
  return [];
}
