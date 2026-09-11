import type { AIDifficulty, GameAction, GameConfig, GameFinishReason } from '@2play/shared';
import { HANGMAN_METADATA } from '@2play/shared';
export { HANGMAN_METADATA };
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
import { HANGMAN_WORDS, type HangmanCategory } from './words';

export * from './words';

/**
 * Hangman — competitive multiplayer word guessing.
 *
 * The secret word is chosen by the SERVER and never leaves it until the round
 * is over. Clients receive only the masked pattern, the letters already tried
 * and the attempts remaining, so the answer cannot be read off the wire.
 *
 * Both players race on the same word: every guess is shared, so a wrong guess
 * costs the guesser points while a correct one banks them.
 */

export type HangmanPhase = 'idle' | 'playing' | 'reveal' | 'finished';

export interface HangmanPlayerSlot {
  score: number;
  correct: number;
  wrong: number;
  roundsWon: number;
  /** Consecutive correct guesses, for the streak bonus. */
  streak: number;
  bestStreak: number;
  disconnected: boolean;
  left: boolean;
}

export interface HangmanState {
  phase: HangmanPhase;
  round: number;
  totalRounds: number;
  /** SERVER ONLY — never projected to a client while the round is live. */
  secret: string;
  category: HangmanCategory | '';
  hint: string;
  /** Letters guessed this round, in order. */
  guessed: string[];
  wrongLetters: string[];
  attemptsLeft: number;
  maxAttempts: number;
  players: Record<string, HangmanPlayerSlot>;
  turnOrder: string[];
  currentPlayerId: string | null;
  turnEndsAt: number | null;
  turnMs: number;
  roundEndsAt: number | null;
  /** Filled in only once a round is over. */
  revealedWord: string | null;
  roundWonBy: string | null;
  finishReason: GameFinishReason | null;
  lastEvent: string | null;
}

/* ------------------------------------------------------------------ */
/* Tunables                                                            */
/* ------------------------------------------------------------------ */

export const DEFAULT_ROUNDS = 5;
export const MAX_ATTEMPTS = 6;
export const TURN_MS = 20_000;
export const REVEAL_MS = 3_000;

export const CORRECT_LETTER_SCORE = 15;
export const WRONG_LETTER_PENALTY = 8;
export const STREAK_BONUS = 10;
/** Awarded to the player whose guess completes the word. */
export const COMPLETE_BONUS = 100;
/** Scaled by how many attempts the team had left. */
export const ATTEMPTS_BONUS = 15;

const AI_DELAY: Record<AIDifficulty, number> = { easy: 1_600, medium: 1_100, hard: 700 };
/** English letter frequency, best first — used by the AI. */
const FREQUENCY = 'ETAOINSHRDLCUMWFGYPBVKJXQZ'.split('');

export const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export function isLetter(value: unknown): value is string {
  return typeof value === 'string' && value.length === 1 && /^[A-Za-z]$/.test(value);
}

/** The masked word a client is allowed to see: `_ A _ _ E _`. */
export function maskWord(secret: string, guessed: string[]): string {
  return [...secret]
    .map((char) => (guessed.includes(char) ? char : '_'))
    .join('');
}

export function isSolved(secret: string, guessed: string[]): boolean {
  return [...secret].every((char) => guessed.includes(char));
}

/** Distinct letters remaining in the secret. */
export function remainingLetters(secret: string, guessed: string[]): string[] {
  return [...new Set([...secret])].filter((char) => !guessed.includes(char));
}

function activePlayers(state: HangmanState): Array<[string, HangmanPlayerSlot]> {
  return Object.entries(state.players).filter(([, slot]) => !slot.left);
}

function makeSlot(): HangmanPlayerSlot {
  return {
    score: 0,
    correct: 0,
    wrong: 0,
    roundsWon: 0,
    streak: 0,
    bestStreak: 0,
    disconnected: false,
    left: false,
  };
}

function resolveRounds(config: GameConfig): number {
  if (typeof config.rounds === 'number' && Number.isFinite(config.rounds)) {
    return Math.min(10, Math.max(1, Math.round(config.rounds)));
  }
  return DEFAULT_ROUNDS;
}

export function finishHangman(state: HangmanState, ctx: GameContext, reason: GameFinishReason): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.finishReason = reason;
  state.currentPlayerId = null;
  state.turnEndsAt = null;
  state.roundEndsAt = null;
  // Safe to reveal now that the match is over.
  state.revealedWord = state.secret;
  state.lastEvent = reason === 'timeout' ? 'timeout' : 'finished';
  ctx.markStateChanged();
  ctx.finish(reason);
}

/** Picks a fresh secret word and opens the round. */
export function beginRound(state: HangmanState, ctx: GameContext): void {
  if (state.phase === 'finished') return;
  const categories = Object.keys(HANGMAN_WORDS) as HangmanCategory[];
  const category = categories[Math.floor(ctx.random() * categories.length)] as HangmanCategory;
  const entries = HANGMAN_WORDS[category];
  const entry = entries[Math.floor(ctx.random() * entries.length)];

  state.secret = (entry?.word ?? 'PUZZLE').toUpperCase();
  state.category = category;
  state.hint = entry?.hint ?? '';
  state.guessed = [];
  state.wrongLetters = [];
  state.attemptsLeft = state.maxAttempts;
  state.revealedWord = null;
  state.roundWonBy = null;
  state.phase = 'playing';
  state.lastEvent = `round:${state.round}`;
  ctx.markStateChanged();

  const first = state.turnOrder.find((id) => !state.players[id]?.left) ?? state.turnOrder[0];
  if (!first) {
    finishHangman(state, ctx, 'abandoned');
    return;
  }
  beginTurn(state, ctx, first);
}

export function beginTurn(state: HangmanState, ctx: GameContext, playerId: string): void {
  if (state.phase !== 'playing') return;
  state.currentPlayerId = playerId;
  state.turnEndsAt = ctx.now() + state.turnMs;
  ctx.markStateChanged();

  ctx.schedule(
    state.turnMs,
    () => {
      if (state.phase !== 'playing' || state.currentPlayerId !== playerId) return;
      // A missed turn costs an attempt and passes play on — no stalling.
      state.attemptsLeft = Math.max(0, state.attemptsLeft - 1);
      state.lastEvent = `timeout:${playerId}`;
      if (state.attemptsLeft <= 0) {
        endRound(state, ctx, null);
        return;
      }
      advanceTurn(state, ctx);
    },
    'turn',
    'turn-timeout',
  );

  const view = ctx.players.find((entry) => entry.id === playerId);
  if (view?.isAI) ctx.requestAI(playerId, AI_DELAY[view.aiDifficulty ?? 'medium']);
}

export function advanceTurn(state: HangmanState, ctx: GameContext): void {
  if (state.phase !== 'playing') return;
  const seats = state.turnOrder.filter((id) => {
    const slot = state.players[id];
    return slot && !slot.left && ctx.players.some((entry) => entry.id === id);
  });
  if (seats.length === 0) {
    finishHangman(state, ctx, 'abandoned');
    return;
  }
  const index = state.currentPlayerId ? state.turnOrder.indexOf(state.currentPlayerId) : -1;
  for (let hop = 1; hop <= state.turnOrder.length; hop += 1) {
    const candidate = state.turnOrder[(index + hop) % state.turnOrder.length];
    if (candidate && seats.includes(candidate)) {
      beginTurn(state, ctx, candidate);
      return;
    }
  }
  finishHangman(state, ctx, 'abandoned');
}

/** Closes the round, reveals the word, then starts the next one or finishes. */
export function endRound(state: HangmanState, ctx: GameContext, winnerId: string | null): void {
  if (state.phase !== 'playing') return;
  state.phase = 'reveal';
  state.revealedWord = state.secret; // now safe to disclose
  state.roundWonBy = winnerId;
  state.currentPlayerId = null;
  state.turnEndsAt = null;
  state.roundEndsAt = ctx.now() + REVEAL_MS;
  state.lastEvent = winnerId ? `round-win:${winnerId}` : 'round-lost';

  if (winnerId) {
    const slot = state.players[winnerId];
    if (slot) {
      slot.roundsWon += 1;
      slot.score += COMPLETE_BONUS;
      // Reward finishing with attempts to spare.
      slot.score += state.attemptsLeft * ATTEMPTS_BONUS;
    }
  }
  ctx.markStateChanged();

  ctx.schedule(
    REVEAL_MS,
    () => {
      if (state.phase !== 'reveal') return;
      if (state.round + 1 >= state.totalRounds) {
        finishHangman(state, ctx, 'completed');
        return;
      }
      state.round += 1;
      beginRound(state, ctx);
    },
    'turn',
    `reveal-${state.round}`,
  );
}

export const hangmanGame: GameModule<HangmanState> = {
  metadata: HANGMAN_METADATA,

  initialize(): void {
    // Stateless module.
  },

  createInitialState(players: readonly GamePlayerView[], config: GameConfig): HangmanState {
    const state: HangmanState = {
      phase: 'idle',
      round: 0,
      totalRounds: resolveRounds(config),
      secret: '',
      category: '',
      hint: '',
      guessed: [],
      wrongLetters: [],
      attemptsLeft: MAX_ATTEMPTS,
      maxAttempts: MAX_ATTEMPTS,
      players: {},
      turnOrder: players.map((player) => player.id),
      currentPlayerId: null,
      turnEndsAt: null,
      turnMs: TURN_MS,
      roundEndsAt: null,
      revealedWord: null,
      roundWonBy: null,
      finishReason: null,
      lastEvent: null,
    };
    for (const player of players) state.players[player.id] = makeSlot();
    return state;
  },

  playerJoined(player, state): void {
    const existing = state.players[player.id];
    if (existing) {
      existing.disconnected = false;
      return;
    }
    state.players[player.id] = makeSlot();
    if (!state.turnOrder.includes(player.id)) state.turnOrder.push(player.id);
  },

  playerReady(): void {
    // Lobby concern.
  },

  playerLeft(playerId, state, ctx, reason): void {
    const slot = state.players[playerId];
    if (!slot) return;
    if (reason === 'disconnect') {
      slot.disconnected = true;
      if (state.currentPlayerId === playerId && state.phase === 'playing') advanceTurn(state, ctx);
      return;
    }
    slot.left = true;
    if (activePlayers(state).length < 2) {
      finishHangman(state, ctx, 'abandoned');
      return;
    }
    if (state.currentPlayerId === playerId && state.phase === 'playing') advanceTurn(state, ctx);
  },

  start(state, ctx): void {
    if (state.phase === 'playing') return;
    state.players = {};
    state.turnOrder = ctx.players.map((player) => player.id);
    for (const player of ctx.players) state.players[player.id] = makeSlot();
    state.round = 0;
    state.finishReason = null;
    beginRound(state, ctx);
  },

  validateAction(playerId, action, state): ValidationResult {
    // A client can never assert the word, a score or the result.
    if (['score', 'win', 'finish', 'complete', 'word', 'reveal', 'secret'].includes(action.type)) {
      return { valid: false, reason: 'The server owns the word.' };
    }
    if (state.phase === 'reveal') return { valid: false, reason: 'The round is over.' };
    if (state.phase !== 'playing') return { valid: false, reason: 'No round is live.' };

    const slot = state.players[playerId];
    if (!slot || slot.left) return { valid: false, reason: 'You are not in this game.' };
    if (slot.disconnected) return { valid: false, reason: 'Reconnect to keep playing.' };
    if (state.currentPlayerId !== playerId) return { valid: false, reason: 'It is not your turn.' };

    if (action.type !== 'guess') return { valid: false, reason: 'Unknown action.' };
    const letter = action.payload?.letter;
    if (!isLetter(letter)) return { valid: false, reason: 'Guess a single letter A to Z.' };
    if (state.guessed.includes(letter.toUpperCase())) {
      return { valid: false, reason: 'That letter has already been guessed.' };
    }
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    if (state.phase !== 'playing') return actionRejected('No round is live.');
    if (action.type !== 'guess') return actionRejected('Unknown action.');
    const slot = state.players[playerId];
    if (!slot || slot.left || slot.disconnected) return actionRejected('You cannot guess.');
    if (state.currentPlayerId !== playerId) return actionRejected('It is not your turn.');

    const raw = action.payload?.letter;
    if (!isLetter(raw)) return actionRejected('Guess a single letter A to Z.');
    const letter = raw.toUpperCase();
    // Duplicate guesses are rejected outright and never cost an attempt.
    if (state.guessed.includes(letter)) return actionRejected('That letter has already been guessed.');

    state.guessed.push(letter);
    const hit = state.secret.includes(letter);

    if (hit) {
      // Score once per occurrence, plus a streak bonus.
      const occurrences = [...state.secret].filter((char) => char === letter).length;
      slot.correct += 1;
      slot.streak += 1;
      slot.bestStreak = Math.max(slot.bestStreak, slot.streak);
      slot.score += occurrences * CORRECT_LETTER_SCORE + (slot.streak - 1) * STREAK_BONUS;
      state.lastEvent = `hit:${playerId}:${letter}`;

      if (isSolved(state.secret, state.guessed)) {
        endRound(state, ctx, playerId);
        return actionAccepted();
      }
      ctx.markStateChanged();
      // A correct guess keeps the turn — that is the incentive to guess well.
      beginTurn(state, ctx, playerId);
      return actionAccepted();
    }

    slot.wrong += 1;
    slot.streak = 0;
    slot.score = Math.max(0, slot.score - WRONG_LETTER_PENALTY);
    state.wrongLetters.push(letter);
    state.attemptsLeft -= 1;
    state.lastEvent = `miss:${playerId}:${letter}`;

    if (state.attemptsLeft <= 0) {
      endRound(state, ctx, null);
      return actionAccepted();
    }

    ctx.markStateChanged();
    advanceTurn(state, ctx);
    return actionAccepted();
  },

  update(): void {
    // Turn based.
  },

  tick(): void {
    // Not used.
  },

  calculateScore(playerId, state): number {
    return state.players[playerId]?.score ?? 0;
  },

  checkWinCondition(state): string[] | null {
    if (state.phase !== 'finished') return null;
    const entries = activePlayers(state);
    if (entries.length === 0) return [];
    const best = Math.max(...entries.map(([, slot]) => slot.score));
    return entries.filter(([, slot]) => slot.score === best).map(([id]) => id);
  },

  checkDrawCondition(state): boolean {
    return (this.checkWinCondition(state)?.length ?? 0) > 1;
  },

  isGameFinished(state): boolean {
    return state.phase === 'finished';
  },

  finish(state): void {
    state.phase = 'finished';
    state.currentPlayerId = null;
    state.turnEndsAt = null;
    state.revealedWord = state.secret;
  },

  getResult(state, ctx): GameResultDraft {
    const ranked = [...ctx.players].sort((a, b) => {
      const byScore = (state.players[b.id]?.score ?? 0) - (state.players[a.id]?.score ?? 0);
      if (byScore !== 0) return byScore;
      return (state.players[b.id]?.roundsWon ?? 0) - (state.players[a.id]?.roundsWon ?? 0);
    });
    const best = ranked.length > 0 ? state.players[ranked[0]?.id ?? '']?.score ?? 0 : 0;
    const winners = ranked
      .filter((player) => (state.players[player.id]?.score ?? 0) === best)
      .map((player) => player.id);
    const isDraw = winners.length > 1;

    const rankings: RankingDraft[] = ranked.map((player, index) => {
      const slot = state.players[player.id];
      return {
        playerId: player.id,
        rank: isDraw ? 1 : index + 1,
        score: slot?.score ?? 0,
        isWinner: winners.includes(player.id),
        isDraw,
        stats: {
          roundsWon: slot?.roundsWon ?? 0,
          correct: slot?.correct ?? 0,
          wrong: slot?.wrong ?? 0,
          bestStreak: slot?.bestStreak ?? 0,
        },
      };
    });
    return { winners, isDraw, rankings, reason: state.finishReason ?? 'completed' };
  },

  reset(state): HangmanState {
    const ids = Object.keys(state.players);
    return {
      ...state,
      phase: 'idle',
      round: 0,
      secret: '',
      category: '',
      hint: '',
      guessed: [],
      wrongLetters: [],
      attemptsLeft: state.maxAttempts,
      players: Object.fromEntries(ids.map((id) => [id, makeSlot()])),
      currentPlayerId: null,
      turnEndsAt: null,
      roundEndsAt: null,
      revealedWord: null,
      roundWonBy: null,
      finishReason: null,
      lastEvent: null,
    };
  },

  cleanup(state): void {
    state.players = {};
    state.turnOrder = [];
    state.secret = '';
    state.guessed = [];
    state.phase = 'finished';
  },

  /**
   * The privacy boundary. While a round is live the client receives ONLY the
   * masked pattern — never `secret`, never the unrevealed letters. The word is
   * disclosed exclusively in the `reveal` phase or once the match is over.
   */
  getPublicState(state, viewerId, ctx) {
    const revealed = state.phase === 'reveal' || state.phase === 'finished';
    const slot = viewerId ? state.players[viewerId] : undefined;
    return {
      phase: state.phase,
      round: state.round,
      totalRounds: state.totalRounds,
      category: state.category,
      hint: state.hint,
      // Masked pattern only. `_` for every letter still hidden.
      masked: state.secret ? maskWord(state.secret, state.guessed) : '',
      wordLength: state.secret.length,
      guessed: [...state.guessed],
      wrongLetters: [...state.wrongLetters],
      attemptsLeft: state.attemptsLeft,
      maxAttempts: state.maxAttempts,
      currentPlayerId: state.currentPlayerId,
      isMyTurn: Boolean(viewerId) && state.currentPlayerId === viewerId,
      turnEndsAt: state.turnEndsAt,
      roundEndsAt: state.roundEndsAt,
      // Only ever populated after the round has ended.
      revealedWord: revealed ? state.revealedWord : null,
      roundWonBy: state.roundWonBy,
      finishReason: state.finishReason,
      lastEvent: state.lastEvent,
      serverTime: ctx.now(),
      me: slot ? { score: slot.score, streak: slot.streak } : null,
      players: Object.fromEntries(
        Object.entries(state.players).map(([id, entry]) => [
          id,
          {
            score: entry.score,
            correct: entry.correct,
            wrong: entry.wrong,
            roundsWon: entry.roundsWon,
            streak: entry.streak,
            disconnected: entry.disconnected,
          },
        ]),
      ),
    };
  },

  /**
   * AI opponent. It guesses from letter frequency and the revealed pattern —
   * it does NOT read the secret, so it misses like a human would.
   */
  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'playing' || state.currentPlayerId !== playerId) return null;

    const untried = ALPHABET.filter((letter) => !state.guessed.includes(letter));
    if (untried.length === 0) return null;

    // Easy bots often just stab at a random letter.
    if (difficulty === 'easy' && ctx.random() < 0.55) {
      const pick = untried[Math.floor(ctx.random() * untried.length)] as string;
      return { type: 'guess', payload: { letter: pick } };
    }

    // Otherwise walk the frequency table — fair, and uses only public info.
    const ordered = FREQUENCY.filter((letter) => untried.includes(letter));
    const pool = ordered.length > 0 ? ordered : untried;
    // Medium adds a little noise so it is not deterministic.
    const window = difficulty === 'hard' ? 1 : Math.min(3, pool.length);
    const pick = pool[Math.floor(ctx.random() * window)] ?? pool[0] as string;
    return { type: 'guess', payload: { letter: pick } };
  },

  maxDurationMs: 30 * 60 * 1000,
};
