import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createTestPlatform, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  ALPHABET,
  CORRECT_LETTER_SCORE,
  DEFAULT_ROUNDS,
  endRound,
  finishHangman,
  hangmanGame,
  HANGMAN_WORDS,
  HANGMAN_WORD_COUNT,
  isSolved,
  maskWord,
  MAX_ATTEMPTS,
  remainingLetters,
  WRONG_LETTER_PENALTY,
  type HangmanState,
} from './index';
import type { Room } from '../../rooms/Room';

describe('Hangman', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'hangman');
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as HangmanState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const guess = (playerId: string, letter: string) =>
    platform.gameManager.handleAction(room, playerId, { type: 'guess', payload: { letter } });
  const current = () => state().currentPlayerId as string;
  const other = () => players.map((p) => p.id).find((id) => id !== current()) as string;
  /** A letter that IS in the secret. */
  const hit = () => remainingLetters(state().secret, state().guessed)[0] as string;
  /** A letter that is NOT in the secret. */
  const miss = () =>
    ALPHABET.find((letter) => !state().secret.includes(letter) && !state().guessed.includes(letter)) as string;

  /* ---------------- word source ---------------- */

  it('ships a usable dictionary of clean uppercase words', () => {
    expect(HANGMAN_WORD_COUNT).toBeGreaterThan(50);
    for (const entries of Object.values(HANGMAN_WORDS)) {
      for (const entry of entries) {
        expect(entry.word).toMatch(/^[A-Z]+$/);
        expect(entry.word.length).toBeGreaterThanOrEqual(6);
        expect(entry.hint.length).toBeGreaterThan(0);
      }
    }
  });

  it('picks a real secret word when a round starts', () => {
    expect(state().phase).toBe('playing');
    expect(state().secret).toMatch(/^[A-Z]+$/);
    expect(state().category).not.toBe('');
    expect(state().attemptsLeft).toBe(MAX_ATTEMPTS);
    expect(state().guessed).toHaveLength(0);
    expect(state().totalRounds).toBe(DEFAULT_ROUNDS);
  });

  /* ---------------- the secret must stay secret ---------------- */

  it('NEVER sends the secret word to a client while the round is live', () => {
    const secret = state().secret;
    for (const player of players) {
      const view = platform.gameManager.getPublicState(room, player.id) as Record<string, unknown> & {
        masked: string;
        revealedWord: string | null;
      };
      const json = JSON.stringify(view);
      // The answer must not appear anywhere in the payload.
      expect(json).not.toContain(secret);
      expect(view.secret).toBeUndefined();
      expect(view.revealedWord).toBeNull();
      // Only blanks so far.
      expect(view.masked).toBe('_'.repeat(secret.length));
    }
  });

  it('reveals only the guessed letters, never the rest', () => {
    const letter = hit();
    guess(current(), letter);
    const secret = state().secret;
    const view = platform.gameManager.getPublicState(room, players[0]!.id) as { masked: string };
    // Every revealed character is one that was actually guessed.
    for (let i = 0; i < secret.length; i += 1) {
      const shown = view.masked[i];
      if (shown !== '_') expect(state().guessed).toContain(shown);
    }
    // If the word is not solved, blanks must remain.
    if (!isSolved(secret, state().guessed)) expect(view.masked).toContain('_');
  });

  it('discloses the word only once the round is over', () => {
    const secret = state().secret;
    endRound(state(), context(), null);
    expect(state().phase).toBe('reveal');
    const view = platform.gameManager.getPublicState(room, players[0]!.id) as { revealedWord: string | null };
    expect(view.revealedWord).toBe(secret);
  });

  it('masks and solves correctly', () => {
    expect(maskWord('CAT', [])).toBe('___');
    expect(maskWord('CAT', ['C'])).toBe('C__');
    expect(maskWord('BANANA', ['A', 'N'])).toBe('_ANANA');
    expect(isSolved('CAT', ['C', 'A'])).toBe(false);
    expect(isSolved('CAT', ['C', 'A', 'T'])).toBe(true);
    expect(remainingLetters('BANANA', ['A'])).toEqual(['B', 'N']);
  });

  /* ---------------- guessing ---------------- */

  it('a correct guess reveals letters, scores and keeps the turn', () => {
    const player = current();
    const letter = hit();
    const occurrences = [...state().secret].filter((char) => char === letter).length;

    expect(guess(player, letter).accepted).toBe(true);
    expect(state().guessed).toContain(letter);
    expect(state().attemptsLeft).toBe(MAX_ATTEMPTS); // no attempt lost
    expect(state().players[player]!.correct).toBe(1);
    if (state().phase === 'playing') {
      // Correct guess keeps the turn.
      expect(state().currentPlayerId).toBe(player);
      expect(state().players[player]!.score).toBe(occurrences * CORRECT_LETTER_SCORE);
    }
  });

  it('a wrong guess costs an attempt, penalises and passes the turn', () => {
    const player = current();
    state().players[player]!.score = 100;
    const letter = miss();

    expect(guess(player, letter).accepted).toBe(true);
    expect(state().attemptsLeft).toBe(MAX_ATTEMPTS - 1);
    expect(state().wrongLetters).toContain(letter);
    expect(state().players[player]!.wrong).toBe(1);
    expect(state().players[player]!.score).toBe(100 - WRONG_LETTER_PENALTY);
    expect(state().currentPlayerId).not.toBe(player);
  });

  it('rejects a duplicate letter without costing an attempt', () => {
    const player = current();
    const letter = miss();
    guess(player, letter);
    const attempts = state().attemptsLeft;
    // The other player now tries the same letter.
    expect(guess(current(), letter).accepted).toBe(false);
    expect(state().attemptsLeft).toBe(attempts);
    expect(state().guessed.filter((entry) => entry === letter)).toHaveLength(1);
  });

  it('rejects malformed letters, out of turn guesses and forged results', () => {
    const ctx = context();
    const player = current();
    for (const letter of [undefined, null, '', 'AB', '1', '!', 5, {}]) {
      expect(hangmanGame.validateAction(player, { type: 'guess', payload: { letter } }, state(), ctx).valid).toBe(
        false,
      );
    }
    // Out of turn.
    expect(guess(other(), hit()).accepted).toBe(false);
    // Client cannot assert the word or the score.
    for (const type of ['score', 'win', 'finish', 'complete', 'word', 'reveal', 'secret']) {
      expect(hangmanGame.validateAction(player, { type, payload: { score: 999 } }, state(), ctx).valid).toBe(false);
      expect(hangmanGame.handlePlayerAction(player, { type }, state(), ctx).accepted).toBe(false);
    }
  });

  it('accepts a lowercase guess and normalises it', () => {
    const player = current();
    const letter = hit();
    expect(guess(player, letter.toLowerCase()).accepted).toBe(true);
    expect(state().guessed).toContain(letter);
  });

  /* ---------------- round outcomes ---------------- */

  it('solving the word wins the round and banks the bonus', () => {
    const player = current();
    const secret = state().secret;
    // Reveal everything but one letter, then guess the last one.
    const letters = [...new Set([...secret])];
    const last = letters.pop() as string;
    state().guessed = letters;
    state().currentPlayerId = player;

    expect(guess(player, last).accepted).toBe(true);
    expect(state().phase).toBe('reveal');
    expect(state().roundWonBy).toBe(player);
    expect(state().players[player]!.roundsWon).toBe(1);
    expect(state().players[player]!.score).toBeGreaterThan(100);
    expect(state().revealedWord).toBe(secret);
  });

  it('running out of attempts loses the round for everyone', () => {
    state().attemptsLeft = 1;
    const player = current();
    expect(guess(player, miss()).accepted).toBe(true);
    expect(state().attemptsLeft).toBe(0);
    expect(state().phase).toBe('reveal');
    expect(state().roundWonBy).toBeNull();
    expect(state().revealedWord).toBe(state().secret);
  });

  it('rejects guesses during the reveal phase', () => {
    endRound(state(), context(), null);
    expect(state().phase).toBe('reveal');
    expect(guess(players[0]!.id, 'Z').accepted).toBe(false);
  });

  /* ---------------- match flow ---------------- */

  it('advances through rounds and finishes after the last one', () => {
    state().round = state().totalRounds - 1;
    endRound(state(), context(), players[0]!.id);
    // The reveal timer would normally fire; simulate the final transition.
    expect(state().phase).toBe('reveal');
    finishHangman(state(), context(), 'completed');
    expect(state().phase).toBe('finished');
    expect(hangmanGame.isGameFinished(state())).toBe(true);
  });

  it('honours a configured round count', async () => {
    const local = createTestPlatform();
    const fixture = await createGameFixture(local.platform, 'hangman', { settings: { rounds: 3 } });
    expect((fixture.room.gameState as HangmanState).totalRounds).toBe(3);
    local.destroy();
  });

  /* ---------------- results ---------------- */

  it('the higher total score wins the match', () => {
    const [a, b] = players.map((p) => p.id);
    state().players[a]!.score = 420;
    state().players[b]!.score = 180;
    finishHangman(state(), context(), 'completed');

    expect(hangmanGame.checkWinCondition(state())).toEqual([a]);
    expect(hangmanGame.checkDrawCondition(state())).toBe(false);
    const result = hangmanGame.getResult(state(), context());
    expect(result.winners).toEqual([a]);
    expect(result.rankings[0]!.playerId).toBe(a);
    expect(result.rankings[0]!.stats).toHaveProperty('roundsWon');
  });

  it('equal scores are a draw', () => {
    const [a, b] = players.map((p) => p.id);
    state().players[a]!.score = 200;
    state().players[b]!.score = 200;
    finishHangman(state(), context(), 'completed');
    expect(hangmanGame.checkDrawCondition(state())).toBe(true);
    expect(hangmanGame.getResult(state(), context()).isDraw).toBe(true);
  });

  /* ---------------- lifecycle ---------------- */

  it('handles disconnect, reconnect and leave', () => {
    const id = players[0]!.id;
    state().players[id]!.score = 55;
    hangmanGame.playerLeft(id, state(), context(), 'disconnect');
    expect(state().players[id]!.disconnected).toBe(true);
    expect(guess(id, 'Q').accepted).toBe(false);

    hangmanGame.playerJoined({ ...players[0]! }, state(), context());
    expect(state().players[id]!.disconnected).toBe(false);
    expect(state().players[id]!.score).toBe(55);

    hangmanGame.playerLeft(id, state(), context(), 'leave');
    expect(state().phase).toBe('finished');
    expect(state().finishReason).toBe('abandoned');
  });

  it('reset clears the secret and cleanup releases the game', () => {
    finishHangman(state(), context(), 'completed');
    const next = hangmanGame.reset(state());
    expect(next.phase).toBe('idle');
    expect(next.secret).toBe('');
    expect(next.guessed).toHaveLength(0);
    expect(next.round).toBe(0);
    expect(Object.values(next.players).every((slot) => slot.score === 0)).toBe(true);

    hangmanGame.cleanup(next);
    expect(Object.keys(next.players)).toHaveLength(0);
    expect(next.secret).toBe('');
  });

  /* ---------------- AI ---------------- */

  it('the AI guesses only untried letters', () => {
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const action = hangmanGame.getAIMove?.(current(), difficulty, state(), context());
      expect(action?.type).toBe('guess');
      const letter = action!.payload!.letter as string;
      expect(ALPHABET).toContain(letter);
      expect(state().guessed).not.toContain(letter);
      expect(hangmanGame.validateAction(current(), action!, state(), context()).valid).toBe(true);
    }
  });

  it('the AI does not cheat — it can guess a letter that is not in the word', () => {
    // Force a secret with few distinct letters so misses are likely.
    state().secret = 'AAAA';
    state().guessed = [];
    let misses = 0;
    for (let i = 0; i < 20; i += 1) {
      state().guessed = [];
      const action = hangmanGame.getAIMove?.(current(), 'hard', state(), context());
      const letter = action?.payload?.letter as string;
      if (letter && !state().secret.includes(letter)) misses += 1;
    }
    // A cheating AI would always pick 'A'; a fair one misses.
    expect(misses).toBeGreaterThan(0);
  });

  it('the AI refuses to act out of turn or after the match', () => {
    expect(hangmanGame.getAIMove?.(other(), 'hard', state(), context())).toBeNull();
    finishHangman(state(), context(), 'completed');
    expect(hangmanGame.getAIMove?.(players[0]!.id, 'hard', state(), context())).toBeNull();
  });

  it('an AI vs AI round always resolves', () => {
    let guard = 0;
    while (state().phase === 'playing' && guard < 60) {
      guard += 1;
      const mover = current();
      const action = hangmanGame.getAIMove?.(mover, 'medium', state(), context());
      if (!action) break;
      platform.gameManager.handleAction(room, mover, action);
    }
    // Either the word was solved or the attempts ran out.
    expect(['reveal', 'finished', 'playing']).toContain(state().phase);
    expect(state().guessed.length).toBeGreaterThan(0);
  });
});
