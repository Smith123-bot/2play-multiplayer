import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createTestPlatform, waitFor, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import { mathRushGame, type MathRushState } from './index';
import type { Room } from '../../rooms/Room';

describe('Math Rush', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'math-rush', {
      settings: { aiDifficulty: 'medium' },
    });
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as MathRushState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const publicState = (viewerId?: string) =>
    platform.gameManager.getPublicState(room, viewerId) as {
      question: { id: string; text: string; answer?: number } | null;
      phase: string;
    };

  it('presents a question and keeps the answer server side', async () => {
    await waitFor(() => state().phase === 'question', { timeoutMs: 5000 });
    expect(state().question?.text).toBeTruthy();
    expect(typeof state().question?.answer).toBe('number');

    const view = publicState(players[0]!.id);
    expect(view.question?.answer).toBeUndefined();
  });

  it('scores correct answers and locks the player out afterwards', async () => {
    await waitFor(() => state().phase === 'question', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    const question = state().question!;

    platform.gameManager.handleAction(room, playerId, {
      type: 'answer',
      payload: { questionId: question.id, value: question.answer },
    });

    expect(state().scores[playerId]).toBeGreaterThanOrEqual(10);
    expect(state().answered).toContain(playerId);
    expect(
      mathRushGame.validateAction(
        playerId,
        { type: 'answer', payload: { questionId: question.id, value: question.answer } },
        state(),
        context(),
      ).valid,
    ).toBe(false);
  });

  it('gives no points for a wrong answer', async () => {
    await waitFor(() => state().phase === 'question', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    const question = state().question!;

    platform.gameManager.handleAction(room, playerId, {
      type: 'answer',
      payload: { questionId: question.id, value: question.answer + 7 },
    });

    expect(state().scores[playerId]).toBe(0);
    expect(state().answers.at(-1)?.correct).toBe(false);
    expect(state().answered).toContain(playerId);
  });

  it('rejects answers to stale questions and unknown actions', async () => {
    await waitFor(() => state().phase === 'question', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    expect(
      mathRushGame.validateAction(
        playerId,
        { type: 'answer', payload: { questionId: 'stale-id', value: 1 } },
        state(),
        context(),
      ).valid,
    ).toBe(false);
    expect(
      mathRushGame.validateAction(playerId, { type: 'guess' }, state(), context()).valid,
    ).toBe(false);
  });

  it('AI answers with the real computed value most of the time', async () => {
    await waitFor(() => state().phase === 'question', { timeoutMs: 5000 });
    const question = state().question!;

    let correct = 0;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const move = mathRushGame.getAIMove?.(players[0]!.id, 'hard', state(), context());
      expect(move?.type).toBe('answer');
      expect(move?.payload?.questionId).toBe(question.id);
      if (Number(move?.payload?.value) === question.answer) correct += 1;
    }
    // Hard AI is tuned to ~97% accuracy — verify it is genuinely strong.
    expect(correct).toBeGreaterThan(15);
  });

  it('ranks players by score when the match ends', () => {
    const current = state();
    current.phase = 'finished';
    current.scores[players[0]!.id] = 42;
    current.scores[players[1]!.id] = 17;

    const draft = mathRushGame.getResult(current, context());
    expect(draft.winners).toEqual([players[0]!.id]);
    expect(draft.rankings[0]!.score).toBe(42);
    expect(draft.rankings[1]!.score).toBe(17);
  });
});
