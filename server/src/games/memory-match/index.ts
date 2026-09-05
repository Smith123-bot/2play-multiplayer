import type { AIDifficulty, GameAction, GameConfig } from '@2play/shared';
import { shuffle } from '@2play/shared';
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
import { MEMORY_MATCH_METADATA } from '@2play/shared';
export { MEMORY_MATCH_METADATA };

export type MemoryPhase = 'idle' | 'playing' | 'resolving' | 'finished';

export interface MemoryCard {
  id: number;
  symbol: string;
  matchedBy: string | null;
}

export interface MemoryMatchState {
  cols: number;
  rows: number;
  /** Full layout — server side only. Never serialised wholesale. */
  cards: MemoryCard[];
  /** Cards flipped during the current turn (0, 1 or 2). */
  selection: number[];
  phase: MemoryPhase;
  turnOrder: string[];
  currentPlayerId: string | null;
  pairs: Record<string, number>;
  attempts: Record<string, number>;
  totalPairs: number;
  matchedPairs: number;
  /** What each AI has actually seen (models memory, not cheating). */
  aiMemory: Record<string, Record<number, string>>;
  lastEvent: string | null;
  resolveAt: number | null;
}


const SYMBOLS = [
  '🍎','🍌','🍇','🍓','🍑','🍍','🥝','🥑','🍩','🍕','🍔','🌮','⚽','🏀','🎾','🚀','🌟','🎸',
];

const GRIDS: Record<string, { cols: number; rows: number }> = {
  '4x4': { cols: 4, rows: 4 },
  '6x4': { cols: 6, rows: 4 },
  '6x6': { cols: 6, rows: 6 },
};

/** How much of what it sees an AI actually remembers. */
const MEMORY_QUALITY: Record<AIDifficulty, number> = { easy: 0.35, medium: 0.7, hard: 0.97 };

function gridFor(requested?: string): { cols: number; rows: number } {
  if (requested && GRIDS[requested]) return GRIDS[requested];
  return GRIDS['4x4'];
}

function nextTurn(state: MemoryMatchState, players: readonly GamePlayerView[]): void {
  if (state.turnOrder.length === 0) {
    state.turnOrder = players.map((player) => player.id);
  }
  const order = state.turnOrder.filter((id) => players.some((player) => player.id === id));
  state.turnOrder = order.length > 0 ? order : players.map((player) => player.id);
  if (state.turnOrder.length === 0) return;
  const index = state.currentPlayerId ? state.turnOrder.indexOf(state.currentPlayerId) : -1;
  state.currentPlayerId = state.turnOrder[(index + 1) % state.turnOrder.length];
}

function remember(state: MemoryMatchState, playerId: string, card: MemoryCard, ctx: GameContext): void {
  const player = ctx.players.find((candidate) => candidate.id === playerId);
  if (!player?.isAI) return;
  const difficulty = player.aiDifficulty ?? 'medium';
  if (ctx.random() > MEMORY_QUALITY[difficulty]) return;
  const memory = state.aiMemory[playerId] ?? {};
  memory[card.id] = card.symbol;
  state.aiMemory[playerId] = memory;
}

/** AI card choice driven purely by what that AI has observed. */
function chooseAICard(
  state: MemoryMatchState,
  playerId: string,
  ctx: GameContext,
): number | null {
  const memory = state.aiMemory[playerId] ?? {};
  const legal = state.cards.filter(
    (card) => card.matchedBy === null && !state.selection.includes(card.id),
  );
  if (legal.length === 0) return null;

  const byId = (id: number) => state.cards.find((card) => card.id === id);

  // 1) A known pair on the board? Take it.
  const known = Object.entries(memory)
    .map(([id, symbol]) => ({ id: Number(id), symbol }))
    .filter((entry) => legal.some((card) => card.id === entry.id));
  for (let i = 0; i < known.length; i += 1) {
    for (let j = i + 1; j < known.length; j += 1) {
      if (known[i].symbol === known[j].symbol) return known[i].id;
    }
  }

  // 2) Mid-turn: complete the pair if the partner is remembered.
  if (state.selection.length === 1) {
    const flipped = byId(state.selection[0]);
    if (flipped) {
      const partner = known.find((entry) => entry.symbol === flipped.symbol && entry.id !== flipped.id);
      if (partner) return partner.id;
    }
  }

  // 3) Otherwise explore: prefer cards never seen before.
  const unseen = legal.filter((card) => memory[card.id] === undefined);
  const pool = unseen.length > 0 ? unseen : legal;
  return pool[Math.floor(ctx.random() * pool.length)].id;
}

export const memoryMatchGame: GameModule<MemoryMatchState> = {
  metadata: MEMORY_MATCH_METADATA,

  initialize(): void {
    // Stateless module.
  },

  createInitialState(players, config): MemoryMatchState {
    const { cols, rows } = gridFor(config.gridSize);
    const pairCount = Math.floor((cols * rows) / 2);
    const symbols = shuffle(SYMBOLS, createSeededRandom(config.seed ?? 1)).slice(0, pairCount);
    const deck = shuffle([...symbols, ...symbols], createSeededRandom((config.seed ?? 1) + 7));

    return {
      cols,
      rows,
      cards: deck.map((symbol, index) => ({ id: index, symbol, matchedBy: null })),
      selection: [],
      phase: 'idle',
      turnOrder: players.map((player) => player.id),
      currentPlayerId: players[0]?.id ?? null,
      pairs: Object.fromEntries(players.map((player) => [player.id, 0])),
      attempts: Object.fromEntries(players.map((player) => [player.id, 0])),
      totalPairs: pairCount,
      matchedPairs: 0,
      aiMemory: {},
      lastEvent: null,
      resolveAt: null,
    };
  },

  playerJoined(player, state): void {
    if (state.pairs[player.id] === undefined) state.pairs[player.id] = 0;
    if (state.attempts[player.id] === undefined) state.attempts[player.id] = 0;
    if (!state.turnOrder.includes(player.id)) state.turnOrder.push(player.id);
  },

  playerReady(): void {
    // No per-player readiness behaviour.
  },

  playerLeft(playerId, state, ctx): void {
    if (state.currentPlayerId === playerId && state.phase === 'playing') {
      state.selection = [];
      nextTurn(state, ctx.players.filter((player) => player.id !== playerId));
      state.lastEvent = `skip:${playerId}`;
    }
    state.turnOrder = state.turnOrder.filter((id) => id !== playerId);
    if (ctx.players.filter((player) => player.isConnected).length < 2 && state.phase === 'playing') {
      ctx.finish('abandoned');
    }
  },

  start(state, ctx): void {
    state.phase = 'playing';
    if (!state.currentPlayerId || !state.turnOrder.includes(state.currentPlayerId)) {
      state.currentPlayerId = state.turnOrder[0] ?? null;
    }
    state.lastEvent = 'start';
    ctx.markStateChanged();
    scheduleAIIfNeeded(state, ctx);
  },

  validateAction(playerId, action, state): ValidationResult {
    if (action.type !== 'flip') return { valid: false, reason: 'Unknown action.' };
    if (state.phase !== 'playing') return { valid: false, reason: 'Wait for your turn.' };
    if (state.currentPlayerId !== playerId) return { valid: false, reason: 'It is not your turn.' };
    const cardId = action.payload?.cardId;
    if (typeof cardId !== 'number' || !Number.isInteger(cardId)) {
      return { valid: false, reason: 'Invalid card.' };
    }
    const card = state.cards.find((candidate) => candidate.id === cardId);
    if (!card) return { valid: false, reason: 'That card does not exist.' };
    if (card.matchedBy !== null) return { valid: false, reason: 'That pair is already taken.' };
    if (state.selection.includes(cardId)) return { valid: false, reason: 'That card is already flipped.' };
    if (state.selection.length >= 2) return { valid: false, reason: 'Two cards are already flipped.' };
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    if (action.type !== 'flip') return actionRejected('Unknown action.');
    const cardId = Number(action.payload?.cardId);
    const card = state.cards.find((candidate) => candidate.id === cardId);
    if (!card) return actionRejected('That card does not exist.');

    state.selection.push(cardId);
    state.attempts[playerId] = (state.attempts[playerId] ?? 0) + 1;
    state.lastEvent = `flip:${playerId}:${cardId}`;

    // Everyone sees the flip; AIs remember it with difficulty-scaled fidelity.
    for (const player of ctx.players) remember(state, player.id, card, ctx);
    ctx.markStateChanged();

    if (state.selection.length === 2) {
      state.phase = 'resolving';
      state.resolveAt = ctx.now() + RESOLVE_MS;
      ctx.schedule(RESOLVE_MS, () => resolveSelection(state, ctx), 'turn', 'resolve');
      return actionAccepted();
    }

    // AI takes its second flip after a believable pause.
    const player = ctx.players.find((candidate) => candidate.id === playerId);
    if (player?.isAI) ctx.requestAI(playerId, 500 + Math.floor(ctx.random() * 800));
    return actionAccepted();
  },

  update(): void {
    // Turn based: no simulation loop.
  },

  tick(): void {
    // Turn based.
  },

  calculateScore(playerId, state): number {
    return state.pairs[playerId] ?? 0;
  },

  checkWinCondition(state): string[] | null {
    if (state.phase !== 'finished') return null;
    const entries = Object.entries(state.pairs);
    if (entries.length === 0) return null;
    const best = Math.max(...entries.map(([, value]) => value));
    return entries.filter(([, value]) => value === best).map(([id]) => id);
  },

  checkDrawCondition(state): boolean {
    return (this.checkWinCondition(state)?.length ?? 0) > 1;
  },

  isGameFinished(state): boolean {
    return state.phase === 'finished';
  },

  finish(state): void {
    state.phase = 'finished';
    state.selection = [];
  },

  getResult(state, ctx): GameResultDraft {
    const ranked = [...ctx.players].sort((a, b) => {
      const diff = (state.pairs[b.id] ?? 0) - (state.pairs[a.id] ?? 0);
      return diff !== 0 ? diff : (state.attempts[a.id] ?? 0) - (state.attempts[b.id] ?? 0);
    });
    const top = state.pairs[ranked[0]?.id ?? ''] ?? 0;
    const winners = ranked.filter((player) => (state.pairs[player.id] ?? 0) === top).map((player) => player.id);

    const rankings: RankingDraft[] = ranked.map((player, index) => ({
      playerId: player.id,
      rank: index + 1,
      score: state.pairs[player.id] ?? 0,
      isWinner: winners.includes(player.id),
      isDraw: winners.length > 1,
      stats: {
        pairs: state.pairs[player.id] ?? 0,
        attempts: state.attempts[player.id] ?? 0,
        accuracy: Math.round(
          ((state.pairs[player.id] ?? 0) / Math.max(1, state.attempts[player.id] ?? 1)) * 100,
        ),
      },
    }));

    return { winners, isDraw: winners.length > 1, rankings, reason: 'completed' };
  },

  reset(state): MemoryMatchState {
    return {
      ...state,
      cards: state.cards.map((card) => ({ ...card, matchedBy: null })),
      selection: [],
      phase: 'idle',
      pairs: Object.fromEntries(Object.keys(state.pairs).map((id) => [id, 0])),
      attempts: Object.fromEntries(Object.keys(state.attempts).map((id) => [id, 0])),
      matchedPairs: 0,
      aiMemory: {},
      lastEvent: null,
      resolveAt: null,
    };
  },

  cleanup(state): void {
    state.cards = [];
    state.selection = [];
    state.phase = 'finished';
  },

  /** CRITICAL: hidden cards are stripped — only revealed/matched symbols are sent. */
  getPublicState(state, _viewerId, ctx) {
    return {
      cols: state.cols,
      rows: state.rows,
      phase: state.phase,
      currentPlayerId: state.currentPlayerId,
      turnOrder: [...state.turnOrder],
      pairs: { ...state.pairs },
      attempts: { ...state.attempts },
      totalPairs: state.totalPairs,
      matchedPairs: state.matchedPairs,
      selection: [...state.selection],
      lastEvent: state.lastEvent,
      serverTime: ctx.now(),
      cards: state.cards.map((card) => {
        const isRevealed = state.selection.includes(card.id) || card.matchedBy !== null;
        return {
          id: card.id,
          symbol: isRevealed ? card.symbol : null,
          matchedBy: card.matchedBy,
          revealed: isRevealed,
        };
      }),
    };
  },

  getAIMove(playerId, _difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'playing') return null;
    if (state.currentPlayerId !== playerId) return null;
    const cardId = chooseAICard(state, playerId, ctx);
    if (cardId === null) return null;
    return { type: 'flip', payload: { cardId } };
  },

  maxDurationMs: 20 * 60 * 1000,
};

const RESOLVE_MS = 1000;

function resolveSelection(state: MemoryMatchState, ctx: GameContext): void {
  if (state.phase !== 'resolving') return;
  const [firstId, secondId] = state.selection;
  const first = state.cards.find((card) => card.id === firstId);
  const second = state.cards.find((card) => card.id === secondId);
  const playerId = state.currentPlayerId;
  state.selection = [];
  state.phase = 'playing';

  if (!first || !second || !playerId) {
    state.phase = 'playing';
    ctx.markStateChanged();
    return;
  }

  if (first.symbol === second.symbol) {
    first.matchedBy = playerId;
    second.matchedBy = playerId;
    state.pairs[playerId] = (state.pairs[playerId] ?? 0) + 1;
    state.matchedPairs += 1;
    state.lastEvent = `match:${playerId}`;
  } else {
    state.lastEvent = `miss:${playerId}`;
    nextTurn(state, ctx.players);
  }

  ctx.markStateChanged();

  if (state.matchedPairs >= state.totalPairs) {
    state.phase = 'finished';
    ctx.markStateChanged();
    ctx.finish('completed');
    return;
  }

  scheduleAIIfNeeded(state, ctx);
}

function scheduleAIIfNeeded(state: MemoryMatchState, ctx: GameContext): void {
  const current = ctx.players.find((player) => player.id === state.currentPlayerId);
  if (current?.isAI && state.phase === 'playing') {
    ctx.requestAI(current.id, 700 + Math.floor(ctx.random() * 900));
  }
}

function createSeededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type { GameConfig };
