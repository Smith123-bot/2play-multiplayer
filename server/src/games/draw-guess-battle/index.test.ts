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
  completeDrawRound,
  drawGuessGame,
  finishDrawMatch,
  openDrawing,
  pickPrompt,
  type DrawGuessState,
} from './index';
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

  it('picks a non-empty prompt from the bank', () => {
    const used: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      const prompt = pickPrompt(used, () => 0.3);
      expect(prompt.word.length).toBeGreaterThan(1);
      used.push(prompt.word);
    }
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

  it('selects genuinely harder prompt pools as rounds progress', () => {
    for (let index = 0; index < 30; index += 1) {
      expect(pickPrompt([], context().random, 'easy').word.length).toBeLessThanOrEqual(5);
      expect(pickPrompt([], context().random, 'hard').word.length).toBeGreaterThan(5);
    }
  });
});
