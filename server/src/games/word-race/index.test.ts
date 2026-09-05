import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createTestPlatform, waitFor, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import { wordRaceGame, type WordRaceState } from './index';
import { isValidWord, normalizeWord } from './words';
import type { Room } from '../../rooms/Room';

describe('Word Race', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'word-race', { settings: { rounds: 1 } });
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as WordRaceState;
  const context = (): GameContext => platform.gameManager.getContext(room);

  it('owns the dictionary on the server', () => {
    expect(isValidWord('Animals', 'lion')).toBe(true);
    expect(isValidWord('Animals', 'Lion ')).toBe(true);
    expect(isValidWord('Animals', 'table')).toBe(false);
    expect(normalizeWord('  GiRaffe!! ')).toBe('giraffe');
  });

  it('starts with an intro then opens the typing phase', async () => {
    expect(['intro', 'typing']).toContain(state().phase);
    await waitFor(() => state().phase === 'typing', { timeoutMs: 6000 });
    expect(state().category).toBeTruthy();
    expect(state().roundEndsAt).toBeGreaterThan(Date.now());
  });

  it('scores unique valid words and rejects duplicates or unknown words', async () => {
    await waitFor(() => state().phase === 'typing', { timeoutMs: 6000 });
    const category = state().category!;
    const playerId = players[0]!.id;
    const otherPlayerId = players[1]!.id;

    // Find two words that belong to the current category.
    const { wordsFor } = await import('./words');
    const [wordA, wordB] = wordsFor(category);

    platform.gameManager.handleAction(room, playerId, { type: 'submit', payload: { word: wordA! } });
    expect(state().scores[playerId]).toBe(1);
    expect(state().usedWords).toContain(wordA!);

    // Duplicate by another player: no points.
    platform.gameManager.handleAction(room, otherPlayerId, {
      type: 'submit',
      payload: { word: wordA! },
    });
    expect(state().scores[otherPlayerId]).toBe(0);
    expect(state().submissions.at(-1)?.reason).toBe('duplicate');

    // Invalid word: no points.
    platform.gameManager.handleAction(room, otherPlayerId, {
      type: 'submit',
      payload: { word: 'zzznotaword' },
    });
    expect(state().scores[otherPlayerId]).toBe(0);
    expect(state().submissions.at(-1)?.reason).toBe('invalid');

    // Second valid word scores again.
    platform.gameManager.handleAction(room, otherPlayerId, {
      type: 'submit',
      payload: { word: wordB! },
    });
    expect(state().scores[otherPlayerId]).toBe(1);
  });

  it('rejects empty submissions and out-of-phase submissions', async () => {
    await waitFor(() => state().phase === 'typing', { timeoutMs: 6000 });
    const playerId = players[0]!.id;
    expect(
      wordRaceGame.validateAction(playerId, { type: 'submit', payload: { word: ' ' } }, state(), context())
        .valid,
    ).toBe(false);

    state().phase = 'roundResult';
    expect(
      wordRaceGame.validateAction(playerId, { type: 'submit', payload: { word: 'lion' } }, state(), context())
        .valid,
    ).toBe(false);
  });

  it('AI submits real words from the dictionary', async () => {
    await waitFor(() => state().phase === 'typing', { timeoutMs: 6000 });
    const move = wordRaceGame.getAIMove?.(players[0]!.id, 'hard', state(), context());
    expect(move?.type).toBe('submit');
    const word = String(move?.payload?.word);
    expect(isValidWord(state().category!, word)).toBe(true);
  });

  it('produces rankings after the final round', async () => {
    await waitFor(() => state().phase === 'typing', { timeoutMs: 6000 });
    const { wordsFor } = await import('./words');
    const word = wordsFor(state().category!)[0]!;
    platform.gameManager.handleAction(room, players[0]!.id, {
      type: 'submit',
      payload: { word },
    });

    state().phase = 'finished';
    const draft = wordRaceGame.getResult(state(), context());
    expect(draft.rankings).toHaveLength(2);
    expect(draft.winners).toContain(players[0]!.id);
  });
});
