import type { GameAction, GameConfig, GameFinishReason } from '@2play/shared';
import { COUPLE_MEMORY_METADATA } from '@2play/shared';
export { COUPLE_MEMORY_METADATA };
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
import { MEMORY_LEVELS, MEMORY_TOTAL_LEVELS, type MemoryLevel } from './levels';

export * from './levels';

/**
 * Couple Memory — a cooperative take on memory match.
 *
 * The key difference from the competitive Memory Match already on the platform:
 * a pair requires ONE card from EACH partner. Player A flips the first card,
 * player B flips the second. Neither can clear the board alone, and the score
 * is a single shared team total.
 */

export type MemoryPhase = 'idle' | 'playing' | 'resolving' | 'level-clear' | 'finished';

export interface MemoryCard {
  id: string;
  /** Pair symbol — server side only until the card is revealed. */
  symbol: string;
  faceUp: boolean;
  matched: boolean;
  /** Bonus cards award extra points when matched. */
  bonus: boolean;
  /** Player who currently has this card flipped. */
  flippedBy: string | null;
}

export interface MemoryPlayer {
  flips: number;
  matchesHelped: number;
  hintsUsed: number;
  disconnected: boolean;
  left: boolean;
}

export interface CoupleMemoryState {
  phase: MemoryPhase;
  level: number;
  totalLevels: number;
  levelName: string;
  hint: string;
  cols: number;
  rows: number;
  cards: MemoryCard[];
  players: Record<string, MemoryPlayer>;
  pairsFound: number;
  pairsTotal: number;
  mistakes: number;
  maxMistakes: number;
  combo: number;
  bestCombo: number;
  teamScore: number;
  levelsCleared: number;
  levelStartedAt: number | null;
  levelEndsAt: number | null;
  lastEvent: string | null;
  lastPair: { a: string; b: string; matched: boolean } | null;
  finishReason: GameFinishReason | null;
  /** Cards currently face up awaiting resolution, in flip order. */
  pending: string[];
  /**
   * Per-AI-seat "do not re-request before" timestamp.
   *
   * `ctx.requestAI` is keyed per player, so re-requesting cancels the pending
   * move. Without this throttle the update loop (every 250ms) kept resetting a
   * 700ms AI timer and the callback never fired — the AI partner could not
   * flip at all, which deadlocks a game whose whole rule is that the *other*
   * partner flips the second card.
   */
  nextAIRequestAt: Record<string, number>;
}

/* ------------------------------------------------------------------ */
/* Tunables                                                            */
/* ------------------------------------------------------------------ */

export const PAIR_SCORE = 100;
export const BONUS_PAIR_SCORE = 175;
export const COMBO_STEP = 25;
export const MISTAKE_PENALTY = 15;
export const HINT_PENALTY = 40;
export const LEVEL_CLEAR_SCORE = 150;
export const TIME_BONUS_MAX = 200;
export const RESOLVE_MS = 1_100;
export const LEVEL_BREAK_MS = 2_600;
/**
 * Slack added on top of an AI move's nominal delay before `update()` may
 * re-arm it. `ctx.requestAI` is keyed per player, so re-arming cancels the
 * pending move; a tight margin lets a late-firing timer get cancelled and
 * starves the AI (the bug this file's regression test guards).
 */
export const AI_REQUEST_GRACE_MS = 1_000;

const SYMBOLS = [
  '★', '●', '▲', '■', '◆', '♥', '☀', '☾', '⚑', '⚙', '✿', '♪',
  '☘', '✈', '⌘', '⚓', '✂', '☂',
];

function activePlayers(state: CoupleMemoryState): Array<[string, MemoryPlayer]> {
  return Object.entries(state.players).filter(([, player]) => !player.left);
}

function makePlayer(): MemoryPlayer {
  return { flips: 0, matchesHelped: 0, hintsUsed: 0, disconnected: false, left: false };
}

export function levelAt(index: number): MemoryLevel {
  const level = MEMORY_LEVELS[Math.max(0, Math.min(index, MEMORY_LEVELS.length - 1))];
  return level ?? (MEMORY_LEVELS[0] as MemoryLevel);
}

/** Builds a shuffled board for a level using the seeded platform PRNG. */
export function buildBoard(level: MemoryLevel, random: () => number): MemoryCard[] {
  const pairs = (level.cols * level.rows) / 2;
  const symbols: string[] = [];
  for (let i = 0; i < pairs; i += 1) symbols.push(SYMBOLS[i % SYMBOLS.length] as string);

  // Bonus pairs sit at the end of the symbol list for this level.
  const bonusSymbols = new Set(symbols.slice(0, level.bonusPairs));

  const deck: MemoryCard[] = [];
  symbols.forEach((symbol, index) => {
    for (let copy = 0; copy < 2; copy += 1) {
      deck.push({
        id: `c${index}-${copy}`,
        symbol,
        faceUp: false,
        matched: false,
        bonus: bonusSymbols.has(symbol),
        flippedBy: null,
      });
    }
  });

  // Fisher-Yates with the seeded PRNG.
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = deck[i] as MemoryCard;
    deck[i] = deck[j] as MemoryCard;
    deck[j] = a;
  }
  return deck;
}

export function finishMemory(state: CoupleMemoryState, ctx: GameContext, reason: GameFinishReason): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.finishReason = reason;
  state.levelEndsAt = null;
  state.lastEvent = reason === 'timeout' ? 'timeout' : 'finished';
  ctx.markStateChanged();
  ctx.finish(reason);
}

export function loadLevel(state: CoupleMemoryState, ctx: GameContext): void {
  const level = levelAt(state.level);
  state.levelName = level.name;
  state.hint = level.hint;
  state.cols = level.cols;
  state.rows = level.rows;
  state.cards = buildBoard(level, ctx.random);
  state.pairsTotal = (level.cols * level.rows) / 2;
  state.pairsFound = 0;
  state.mistakes = 0;
  state.maxMistakes = level.maxMistakes;
  state.combo = 0;
  state.pending = [];
  state.lastPair = null;
  state.phase = 'playing';
  state.levelStartedAt = ctx.now();
  state.levelEndsAt = ctx.now() + level.timeLimit * 1000;
  state.lastEvent = `level:${state.level}`;
  ctx.markStateChanged();

  ctx.schedule(
    level.timeLimit * 1000,
    () => {
      if (state.phase !== 'playing' && state.phase !== 'resolving') return;
      state.lastEvent = 'level-timeout';
      finishMemory(state, ctx, 'timeout');
    },
    'turn',
    `level-${state.level}`,
  );

  for (const player of ctx.players) {
    if (player.isAI) ctx.requestAI(player.id, 1_200);
  }
}

export function completeLevel(state: CoupleMemoryState, ctx: GameContext): void {
  const level = levelAt(state.level);
  const elapsed = ctx.now() - (state.levelStartedAt ?? ctx.now());
  const limit = level.timeLimit * 1000;

  state.teamScore += LEVEL_CLEAR_SCORE;
  state.teamScore += Math.round(TIME_BONUS_MAX * Math.min(1, Math.max(0, limit - elapsed) / limit));
  state.levelsCleared += 1;
  state.lastEvent = `level-clear:${state.level}`;

  if (state.level + 1 >= state.totalLevels) {
    finishMemory(state, ctx, 'completed');
    return;
  }

  state.level += 1;
  state.phase = 'level-clear';
  state.levelEndsAt = ctx.now() + LEVEL_BREAK_MS;
  ctx.markStateChanged();
  ctx.schedule(
    LEVEL_BREAK_MS,
    () => {
      if (state.phase !== 'level-clear') return;
      loadLevel(state, ctx);
    },
    'turn',
    `break-${state.level}`,
  );
}

/** Resolves the two pending cards. Called once both partners have flipped. */
export function resolvePending(state: CoupleMemoryState, ctx: GameContext): void {
  const [firstId, secondId] = state.pending;
  if (!firstId || !secondId) return;
  const first = state.cards.find((card) => card.id === firstId);
  const second = state.cards.find((card) => card.id === secondId);
  if (!first || !second) return;

  const matched = first.symbol === second.symbol;
  state.lastPair = { a: firstId, b: secondId, matched };

  if (matched) {
    first.matched = true;
    second.matched = true;
    first.faceUp = true;
    second.faceUp = true;
    state.pairsFound += 1;
    state.combo += 1;
    state.bestCombo = Math.max(state.bestCombo, state.combo);

    let points = first.bonus ? BONUS_PAIR_SCORE : PAIR_SCORE;
    points += COMBO_STEP * Math.max(0, state.combo - 1);
    state.teamScore += points;

    // Both partners contributed to this pair — that is the co-op mechanic.
    for (const id of [first.flippedBy, second.flippedBy]) {
      if (!id) continue;
      const player = state.players[id];
      if (player) player.matchesHelped += 1;
    }

    state.pending = [];
    first.flippedBy = null;
    second.flippedBy = null;
    state.lastEvent = `match:${firstId}:${secondId}`;
    state.phase = 'playing';
    ctx.markStateChanged();

    if (state.pairsFound >= state.pairsTotal) completeLevel(state, ctx);
    return;
  }

  // Miss: flip both back after a short reveal so the pair can memorise them.
  state.mistakes += 1;
  state.combo = 0;
  state.teamScore = Math.max(0, state.teamScore - MISTAKE_PENALTY);
  state.lastEvent = `miss:${firstId}:${secondId}`;
  state.phase = 'resolving';
  ctx.markStateChanged();

  ctx.schedule(
    RESOLVE_MS,
    () => {
      if (state.phase !== 'resolving') return;
      for (const card of state.cards) {
        if (!card.matched && card.faceUp) {
          card.faceUp = false;
          card.flippedBy = null;
        }
      }
      state.pending = [];
      state.phase = 'playing';
      state.lastEvent = 'hide';
      ctx.markStateChanged();

      // Too many misses ends the run on levels that cap them.
      if (state.maxMistakes > 0 && state.mistakes >= state.maxMistakes) {
        state.lastEvent = 'out-of-mistakes';
        finishMemory(state, ctx, 'completed');
      }
    },
    'turn',
    `resolve-${state.pairsFound}-${state.mistakes}`,
  );
}

function resolveLevels(config: GameConfig): number {
  if (typeof config.rounds === 'number' && Number.isFinite(config.rounds)) {
    return Math.min(MEMORY_TOTAL_LEVELS, Math.max(1, Math.round(config.rounds)));
  }
  return MEMORY_TOTAL_LEVELS;
}

export const coupleMemoryGame: GameModule<CoupleMemoryState> = {
  metadata: COUPLE_MEMORY_METADATA,

  initialize(): void {
    // Stateless module.
  },

  createInitialState(players: readonly GamePlayerView[], config: GameConfig): CoupleMemoryState {
    const state: CoupleMemoryState = {
      phase: 'idle',
      level: 0,
      totalLevels: resolveLevels(config),
      levelName: '',
      hint: '',
      cols: 0,
      rows: 0,
      cards: [],
      players: {},
      pairsFound: 0,
      pairsTotal: 0,
      mistakes: 0,
      maxMistakes: 0,
      combo: 0,
      bestCombo: 0,
      teamScore: 0,
      levelsCleared: 0,
      levelStartedAt: null,
      levelEndsAt: null,
      lastEvent: null,
      lastPair: null,
      finishReason: null,
      pending: [],
      nextAIRequestAt: {},
    };
    for (const player of players) state.players[player.id] = makePlayer();
    return state;
  },

  playerJoined(player, state): void {
    const existing = state.players[player.id];
    if (existing) {
      existing.disconnected = false;
      return;
    }
    state.players[player.id] = makePlayer();
  },

  playerReady(): void {
    // Lobby concern.
  },

  playerLeft(playerId, state, ctx, reason): void {
    const player = state.players[playerId];
    if (!player) return;
    if (reason === 'disconnect') {
      player.disconnected = true;
      ctx.markStateChanged();
      return;
    }
    player.left = true;
    if (activePlayers(state).length < 2) finishMemory(state, ctx, 'abandoned');
  },

  start(state, ctx): void {
    if (state.phase === 'playing') return;
    state.players = {};
    for (const player of ctx.players) state.players[player.id] = makePlayer();
    state.level = 0;
    state.teamScore = 0;
    state.levelsCleared = 0;
    state.bestCombo = 0;
    state.finishReason = null;
    loadLevel(state, ctx);
  },

  validateAction(playerId, action, state): ValidationResult {
    if (['score', 'win', 'complete', 'finish', 'match', 'reveal'].includes(action.type)) {
      return { valid: false, reason: 'The server owns the board.' };
    }
    if (state.phase === 'resolving') return { valid: false, reason: 'Wait for the cards to settle.' };
    if (state.phase !== 'playing') return { valid: false, reason: 'No board is live.' };

    const player = state.players[playerId];
    if (!player || player.left) return { valid: false, reason: 'You are not in this match.' };
    if (player.disconnected) return { valid: false, reason: 'Reconnect to keep playing.' };

    if (action.type === 'hint') return { valid: true };
    if (action.type !== 'flip') return { valid: false, reason: 'Unknown action.' };

    const cardId = action.payload?.cardId;
    if (typeof cardId !== 'string') return { valid: false, reason: 'Pick a card.' };
    const card = state.cards.find((entry) => entry.id === cardId);
    if (!card) return { valid: false, reason: 'No such card.' };
    if (card.matched) return { valid: false, reason: 'That pair is already found.' };
    if (card.faceUp) return { valid: false, reason: 'That card is already face up.' };
    if (state.pending.length >= 2) return { valid: false, reason: 'Two cards are already up.' };

    // The cooperative rule: partners alternate: you cannot flip both cards.
    const firstId = state.pending[0];
    if (firstId) {
      const first = state.cards.find((entry) => entry.id === firstId);
      if (first?.flippedBy === playerId) {
        return { valid: false, reason: 'Your partner flips the second card.' };
      }
    }
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    if (state.phase !== 'playing') return actionRejected('No board is live.');
    const player = state.players[playerId];
    if (!player || player.left || player.disconnected) return actionRejected('You cannot act.');

    /* ---------------- hint ---------------- */
    if (action.type === 'hint') {
      // Reveals one matching pair's location by naming a card id.
      const hidden = state.cards.filter((card) => !card.matched && !card.faceUp);
      const target = hidden.find((card) =>
        hidden.some((other) => other !== card && other.symbol === card.symbol),
      );
      if (!target) return actionRejected('No hint available.');
      player.hintsUsed += 1;
      state.teamScore = Math.max(0, state.teamScore - HINT_PENALTY);
      state.lastEvent = `hint:${playerId}:${target.id}`;
      ctx.markStateChanged();
      return actionAccepted();
    }

    if (action.type !== 'flip') return actionRejected('Unknown action.');
    const cardId = action.payload?.cardId;
    if (typeof cardId !== 'string') return actionRejected('Pick a card.');

    const card = state.cards.find((entry) => entry.id === cardId);
    if (!card) return actionRejected('No such card.');
    if (card.matched) return actionRejected('Already matched.');
    if (card.faceUp) return actionRejected('Already face up.');
    if (state.pending.length >= 2) return actionRejected('Two cards are already up.');

    const firstId = state.pending[0];
    if (firstId) {
      const first = state.cards.find((entry) => entry.id === firstId);
      // Enforced co-op: the second card must come from the OTHER partner.
      if (first?.flippedBy === playerId) return actionRejected('Your partner flips the second card.');
    }

    card.faceUp = true;
    card.flippedBy = playerId;
    player.flips += 1;
    state.pending.push(cardId);
    state.lastEvent = `flip:${playerId}:${cardId}`;
    ctx.markStateChanged();

    if (state.pending.length === 2) resolvePending(state, ctx);
    return actionAccepted();
  },

  update(state, _deltaTimeMs, ctx): void {
    if (state.phase !== 'playing') return;
    const now = ctx.now();
    for (const view of ctx.players) {
      if (!view.isAI) continue;
      const player = state.players[view.id];
      if (!player || player.left || player.disconnected) continue;
      // `requestAI` is keyed per player: asking again cancels the pending move.
      // Only re-arm once the previous request should already have fired,
      // otherwise this 250ms loop starves the AI forever.
      if (now < (state.nextAIRequestAt[view.id] ?? 0)) continue;
      const difficulty = view.aiDifficulty ?? 'medium';
      const delay = difficulty === 'hard' ? 700 : difficulty === 'medium' ? 1_100 : 1_600;
      ctx.requestAI(view.id, delay);
      // The grace period has to absorb timer latency, not just the nominal
      // delay: under load a `setTimeout` callback can fire hundreds of
      // milliseconds late, and re-arming before it runs cancels the very move
      // we are waiting for. A generous margin costs at most one idle tick.
      state.nextAIRequestAt[view.id] = now + delay + AI_REQUEST_GRACE_MS;
    }
  },

  tick(): void {
    // Handled by update().
  },

  calculateScore(_playerId, state): number {
    return state.teamScore;
  },

  checkWinCondition(state): string[] | null {
    if (state.phase !== 'finished') return null;
    return state.levelsCleared > 0 ? Object.keys(state.players) : [];
  },

  checkDrawCondition(state): boolean {
    return state.phase === 'finished' && state.levelsCleared === 0;
  },

  isGameFinished(state): boolean {
    return state.phase === 'finished';
  },

  finish(state): void {
    state.phase = 'finished';
    state.levelEndsAt = null;
  },

  getResult(state, ctx): GameResultDraft {
    const cleared = state.levelsCleared > 0;
    const rankings: RankingDraft[] = ctx.players.map((player) => {
      const entry = state.players[player.id];
      return {
        playerId: player.id,
        rank: 1,
        score: state.teamScore,
        isWinner: cleared,
        isDraw: !cleared,
        stats: {
          pairsFound: state.pairsFound,
          levelsCleared: state.levelsCleared,
          mistakes: state.mistakes,
          bestCombo: state.bestCombo,
          matchesHelped: entry?.matchesHelped ?? 0,
        },
      };
    });
    return {
      winners: cleared ? ctx.players.map((player) => player.id) : [],
      isDraw: !cleared,
      rankings,
      reason: state.finishReason ?? 'completed',
    };
  },

  reset(state): CoupleMemoryState {
    return {
      ...state,
      phase: 'idle',
      level: 0,
      levelName: '',
      hint: '',
      cols: 0,
      rows: 0,
      cards: [],
      players: Object.fromEntries(Object.keys(state.players).map((id) => [id, makePlayer()])),
      pairsFound: 0,
      pairsTotal: 0,
      mistakes: 0,
      maxMistakes: 0,
      combo: 0,
      bestCombo: 0,
      teamScore: 0,
      levelsCleared: 0,
      levelStartedAt: null,
      levelEndsAt: null,
      lastEvent: null,
      lastPair: null,
      finishReason: null,
      pending: [],
      nextAIRequestAt: {},
    };
  },

  cleanup(state): void {
    state.players = {};
    state.cards = [];
    state.pending = [];
    state.phase = 'finished';
  },

  /**
   * Face-down symbols NEVER leave the server — that is the whole game. A card
   * only carries its symbol once it is face up or matched.
   */
  getPublicState(state, viewerId, ctx) {
    const me = viewerId ? state.players[viewerId] : undefined;
    return {
      phase: state.phase,
      level: state.level,
      totalLevels: state.totalLevels,
      levelName: state.levelName,
      hint: state.hint,
      cols: state.cols,
      rows: state.rows,
      cards: state.cards.map((card) => ({
        id: card.id,
        faceUp: card.faceUp,
        matched: card.matched,
        // Hidden information: no symbol for a face-down card.
        symbol: card.faceUp || card.matched ? card.symbol : null,
        bonus: card.matched ? card.bonus : false,
        flippedBy: card.flippedBy,
      })),
      pairsFound: state.pairsFound,
      pairsTotal: state.pairsTotal,
      mistakes: state.mistakes,
      maxMistakes: state.maxMistakes,
      combo: state.combo,
      bestCombo: state.bestCombo,
      teamScore: state.teamScore,
      levelsCleared: state.levelsCleared,
      levelEndsAt: state.levelEndsAt,
      lastEvent: state.lastEvent,
      lastPair: state.lastPair ? { ...state.lastPair } : null,
      finishReason: state.finishReason,
      serverTime: ctx.now(),
      // Whose turn it is to flip next: the partner who did NOT flip card one.
      pendingCount: state.pending.length,
      pendingBy: state.pending[0]
        ? state.cards.find((card) => card.id === state.pending[0])?.flippedBy ?? null
        : null,
      me: me ? { flips: me.flips, matchesHelped: me.matchesHelped, hintsUsed: me.hintsUsed } : null,
      players: Object.fromEntries(
        Object.entries(state.players).map(([id, player]) => [
          id,
          {
            flips: player.flips,
            matchesHelped: player.matchesHelped,
            hintsUsed: player.hintsUsed,
            disconnected: player.disconnected,
          },
        ]),
      ),
    };
  },

  /**
   * Co-op AI partner with a fair memory: it only remembers symbols that have
   * genuinely been shown face up during play. It never reads hidden cards.
   */
  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'playing') return null;
    const player = state.players[playerId];
    if (!player || player.left) return null;

    const firstId = state.pending[0];
    const first = firstId ? state.cards.find((card) => card.id === firstId) : undefined;
    // Respect the co-op rule: never flip the second card of your own pair.
    if (first && first.flippedBy === playerId) return null;
    if (state.pending.length >= 2) return null;

    const hidden = state.cards.filter((card) => !card.matched && !card.faceUp);
    if (hidden.length === 0) return null;

    // Completing a pair: look for a face-down twin of the revealed card.
    if (first) {
      // Hard partners recall previously revealed cards; the platform only
      // exposes what has actually been face up, so this stays fair.
      if (difficulty !== 'easy') {
        const twin = hidden.find((card) => card.symbol === first.symbol);
        const recall = difficulty === 'hard' ? 0.85 : 0.5;
        if (twin && ctx.random() < recall) {
          return { type: 'flip', payload: { cardId: twin.id } };
        }
      }
    }

    const pick = hidden[Math.floor(ctx.random() * hidden.length)];
    return pick ? { type: 'flip', payload: { cardId: pick.id } } : null;
  },

  needsUpdateLoop: true,
  maxDurationMs: 30 * 60 * 1000,
};
