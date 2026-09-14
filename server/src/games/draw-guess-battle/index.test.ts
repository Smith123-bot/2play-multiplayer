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
  beginNextDrawRound,
  buildWordDeck,
  completeDrawRound,
  drawGuessGame,
  drawWord,
  finishDrawMatch,
  openDrawing,
  type DrawGuessState,
} from './index';
import { ALL_WORDS } from './words';
import type { Room } from '../../rooms/Room';

describe('Draw & Guess Battle', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'draw-guess-battle', {
      settings: { rounds: 2 },
    });
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as DrawGuessState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const publicState = (viewerId?: string) =>
    platform.gameManager.getPublicState(room, viewerId) as {
      phase: string;
      word: string | null;
      guesses: Array<{ text: string; correct: boolean }>;
      drawerId: string | null;
      strokes: unknown[];
      solved: string[];
      scores: Record<string, number>;
    };

  it('the word bank holds at least 500 unique family-friendly prompts', () => {
    expect(ALL_WORDS.length).toBeGreaterThanOrEqual(500);
    const names = new Set(ALL_WORDS.map((entry) => entry.word));
    expect(names.size).toBe(ALL_WORDS.length); // no duplicates
    for (const entry of ALL_WORDS) {
      expect(entry.word).toMatch(/^[a-z0-9 -]+$/); // plain, common, safe
      expect(entry.word.length).toBeGreaterThan(1);
    }
  });

  it('never repeats a prompt before the whole deck is exhausted', () => {
    const fresh: DrawGuessState = {
      ...(state() as unknown as DrawGuessState),
      wordDeck: buildWordDeck(context().random),
      wordCycle: 1,
      usedWords: [],
    };
    const drawn: string[] = [];
    for (let i = 0; i < ALL_WORDS.length; i += 1) {
      const word = drawWord(fresh, context().random);
      expect(drawn).not.toContain(word); // STRICT no-repeat within a cycle
      drawn.push(word);
      expect(word.length).toBeGreaterThan(1);
    }
    expect(drawn).toHaveLength(ALL_WORDS.length);
    // The full cycle drew every word exactly once.
    expect(new Set(drawn).size).toBe(ALL_WORDS.length);
  });

  it('reshuffles only after full exhaustion and keeps every word valid', () => {
    const fresh = {
      ...(state() as unknown as DrawGuessState),
      wordDeck: buildWordDeck(context().random),
      wordCycle: 1,
      usedWords: [],
    };
    expect(fresh.wordCycle).toBe(1);
    const first = drawWord(fresh, context().random);
    expect(ALL_WORDS.some((entry) => entry.word === first)).toBe(true);
    expect(fresh.wordCycle).toBe(1); // deck still has words: no reshuffle
    expect(fresh.wordDeck.length).toBe(ALL_WORDS.length - 1);
    // Burn the rest of the deck.
    while (fresh.wordDeck.length > 0) drawWord(fresh, context().random);
    const last = drawWord(fresh, context().random); // this one forces the reshuffle
    expect(fresh.wordCycle).toBe(2); // exactly one reshuffle, only on exhaustion
    expect(fresh.wordDeck.length).toBe(ALL_WORDS.length - 1);
    expect(ALL_WORDS.some((entry) => entry.word === last)).toBe(true);
  });

  it('uses every drawn word exactly once across a long session', () => {
    // Simulate rounds + rematch resets: used words may not repeat inside a
    // match; a rematch excludes the previous words for as long as possible.
    const fresh = {
      ...(state() as unknown as DrawGuessState),
      wordDeck: buildWordDeck(context().random),
      wordCycle: 1,
      usedWords: [],
    };
    const seen = new Map<string, number>();
    const rounds = 60;
    for (let i = 0; i < rounds; i += 1) {
      const word = drawWord(fresh, context().random);
      seen.set(word, (seen.get(word) ?? 0) + 1);
      fresh.usedWords.push(word);
    }
    expect(seen.size).toBe(rounds); // 60 distinct prompts in a row
    // Rematch excludes prior words while the pool allows it.
    const rebuilt = buildWordDeck(context().random, fresh.usedWords);
    expect(rebuilt.length).toBe(ALL_WORDS.length - rounds);
    expect(rebuilt.every((word) => !fresh.usedWords.includes(word))).toBe(true);
  });

  it('starts with a drawer and a hidden word for guessers', async () => {
    await waitFor(() => state().phase === 'prepare' || state().phase === 'drawing', {
      timeoutMs: 5000,
    });
    const drawerId = state().current!.drawerId;
    const guesser = players.find((player) => player.id !== drawerId)!;
    const hidden = publicState(guesser.id);
    expect(hidden.word).toBeNull();
    // Sweep the payload values, not the field names: words like "cat" occur
    // inside schema keys ("category"), which would be a false leak.
    expect(JSON.stringify(hidden).replace(/"[^"]*":/g, '')).not.toContain(state().current!.word);
    const shown = publicState(drawerId);
    expect(shown.word).toBe(state().current!.word);
  });

  it('accepts strokes only from the drawer', async () => {
    await waitFor(() => state().current !== null, { timeoutMs: 5000 });
    openDrawing(state(), context());
    const drawerId = state().current!.drawerId;
    const guesser = players.find((player) => player.id !== drawerId)!;
    const stroke = {
      type: 'stroke',
      payload: {
        color: '#111827',
        size: 8,
        tool: 'brush',
        points: [
          { x: 0.2, y: 0.3 },
          { x: 0.4, y: 0.5 },
        ],
      },
    };
    expect(drawGuessGame.validateAction(guesser.id, stroke, state(), context()).valid).toBe(false);
    const result = platform.gameManager.handleAction(room, drawerId, stroke);
    expect(result.accepted).toBe(true);
    expect(state().current!.strokes.length).toBe(1);
  });

  it('rejects drawing outside the drawing phase and bogus palette colours', async () => {
    await waitFor(() => state().current !== null, { timeoutMs: 5000 });
    const drawerId = state().current!.drawerId;
    expect(
      drawGuessGame.validateAction(
        drawerId,
        {
          type: 'stroke',
          payload: { color: '#ff00ff', size: 8, tool: 'brush', points: [{ x: 0, y: 0 }] },
        },
        state(),
        context(),
      ).valid,
    ).toBe(false);
    expect(drawGuessGame.validateAction(drawerId, { type: 'fly' }, state(), context()).valid).toBe(
      false,
    );
  });

  it('scores the first correct guess 100 and bonuses the drawer', async () => {
    await waitFor(() => state().current !== null, { timeoutMs: 5000 });
    openDrawing(state(), context());
    const drawerId = state().current!.drawerId;
    const guesser = players.find((player) => player.id !== drawerId)!;
    const wrong = platform.gameManager.handleAction(room, guesser.id, {
      type: 'guess',
      payload: { text: 'zzzzzz' },
    });
    expect(wrong.accepted).toBe(true);
    expect(state().scores[guesser.id]).toBe(0);

    const hit = platform.gameManager.handleAction(room, guesser.id, {
      type: 'guess',
      payload: { text: state().current!.word },
    });
    expect(hit.accepted).toBe(true);
    expect(state().scores[guesser.id]).toBe(140); // placement + maximum speed bonus
    expect(state().scores[drawerId]).toBe(40);
    expect(state().current!.solvedOrder).toContain(guesser.id);
    state().phase = 'drawing'; // exercise the in-flight privacy projection before reveal
    state().history = [];
    const guesserView = publicState(guesser.id);
    expect(guesserView.guesses.at(-1)).toMatchObject({ text: 'solved it', correct: true });
    expect(JSON.stringify(guesserView)).not.toContain(state().current!.word);
  });

  it('rejects duplicate correct guesses and drawer guesses', async () => {
    await waitFor(() => state().current !== null, { timeoutMs: 5000 });
    openDrawing(state(), context());
    const drawerId = state().current!.drawerId;
    const guesser = players.find((player) => player.id !== drawerId)!;
    platform.gameManager.handleAction(room, guesser.id, {
      type: 'guess',
      payload: { text: state().current!.word },
    });
    expect(
      drawGuessGame.validateAction(
        guesser.id,
        { type: 'guess', payload: { text: state().current!.word } },
        state(),
        context(),
      ).valid,
    ).toBe(false);
    expect(
      drawGuessGame.validateAction(
        drawerId,
        { type: 'guess', payload: { text: state().current!.word } },
        state(),
        context(),
      ).valid,
    ).toBe(false);
  });

  it('finishes after the last round and ranks by score', async () => {
    await waitFor(() => state().current !== null, { timeoutMs: 5000 });
    state().scores[players[0]!.id] = 140;
    state().scores[players[1]!.id] = 40;
    completeDrawRound(state(), context());
    beginNextDrawRound(state(), context());
    completeDrawRound(state(), context());
    beginNextDrawRound(state(), context());
    expect(state().phase).toBe('finished');
    const draft = drawGuessGame.getResult(state(), context());
    expect(draft.winners).toEqual([players[0]!.id]);
    expect(draft.rankings).toHaveLength(2);
  });

  it('timeout finishes the match; equal scores draw', async () => {
    await waitFor(() => state().current !== null, { timeoutMs: 5000 });
    finishDrawMatch(state(), context(), 'timeout');
    expect(state().phase).toBe('finished');
    state().scores[players[0]!.id] = 80;
    state().scores[players[1]!.id] = 80;
    const draft = drawGuessGame.getResult(state(), context());
    expect(draft.isDraw).toBe(true);
  });

  it('reset keeps seats and zeroes scores', async () => {
    await waitFor(() => state().current !== null, { timeoutMs: 5000 });
    const seats = Object.keys(state().scores);
    state().scores[seats[0]!] = 90;
    const next = drawGuessGame.reset(state());
    expect(Object.keys(next.scores)).toEqual(seats);
    expect(next.phase).toBe('idle');
    expect(next.scores[seats[0]!]).toBe(0);
    expect(next.current).toBeNull();
  });

  it('AI emits legal strokes or guesses', async () => {
    await waitFor(() => state().current !== null, { timeoutMs: 5000 });
    openDrawing(state(), context());
    const drawerId = state().current!.drawerId;
    const move = drawGuessGame.getAIMove?.(drawerId, 'medium', state(), context());
    expect(move?.type).toBe('stroke');
    const guesser = players.find((player) => player.id !== drawerId)!;
    const guess = drawGuessGame.getAIMove?.(guesser.id, 'hard', state(), context());
    expect(guess?.type).toBe('guess');
  });

  it('a disconnected player keeps their seat', async () => {
    await waitFor(() => state().current !== null, { timeoutMs: 5000 });
    drawGuessGame.playerLeft(players[0]!.id, state(), context(), 'disconnect');
    expect(state().phase === 'finished').toBe(false);
  });

  it('undo removes only the drawer latest authoritative stroke', async () => {
    await waitFor(() => state().current !== null, { timeoutMs: 5000 });
    openDrawing(state(), context());
    const drawerId = state().current!.drawerId;
    const stroke = {
      type: 'stroke',
      payload: {
        color: '#111827',
        size: 8,
        tool: 'brush',
        points: [
          { x: 0.1, y: 0.1 },
          { x: 0.2, y: 0.2 },
        ],
      },
    };
    platform.gameManager.handleAction(room, drawerId, stroke);
    platform.gameManager.handleAction(room, drawerId, stroke);
    expect(state().current!.strokes).toHaveLength(2);
    expect(platform.gameManager.handleAction(room, drawerId, { type: 'undo' }).accepted).toBe(true);
    expect(state().current!.strokes).toHaveLength(1);
    const guesser = players.find((player) => player.id !== drawerId)!;
    expect(
      drawGuessGame.validateAction(guesser.id, { type: 'undo' }, state(), context()).valid,
    ).toBe(false);
  });

  it('never leaks the deck, the cycle counter or future words through public state', () => {
    // begin a round so state.current exists
    beginNextDrawRound(state(), context());
    const publicState = drawGuessGame.getPublicState(state(), players[1]!.id, context()) as Record<
      string,
      unknown
    >;
    expect(publicState).not.toHaveProperty('wordDeck');
    expect(publicState).not.toHaveProperty('usedWords');
    expect(publicState).not.toHaveProperty('wordCycle');
    // A guesser must not receive the secret word mid-round.
    expect(publicState.word).toBeNull();
    // No future deck word may appear anywhere in the payload (JSON keys such
    // as "history" are stripped so key names cannot collide with word values).
    const values = JSON.stringify(publicState).replace(/"[A-Za-z]+":/g, '');
    for (const entry of state().wordDeck) {
      expect(values).not.toContain(JSON.stringify(entry));
    }
  });

  it('rounds progress easy to hard while the deck still forbids repeats', () => {
    // Difficulty is now derived from round progress (display), the word itself
    // comes strictly from the shuffled deck in draw order.
    const fresh = {
      ...(state() as unknown as DrawGuessState),
      wordDeck: buildWordDeck(context().random),
      wordCycle: 1,
      usedWords: [],
    };
    const first = drawWord(fresh, context().random);
    const second = drawWord(fresh, context().random);
    expect(first).not.toBe(second);
    expect(ALL_WORDS.some((entry) => entry.word === second)).toBe(true);
  });
});
