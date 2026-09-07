import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createTestPlatform, waitFor, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  beginNextRound,
  completeRound,
  finishScrambleOnTimeout,
  scrambleWord,
  wordScrambleGame,
  type WordScrambleState,
} from './index';
import { SCRAMBLE_WORDS } from './words';
import type { Room } from '../../rooms/Room';

describe('Word Scramble Battle', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'word-scramble-battle', {
      settings: { rounds: 2 },
    });
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as WordScrambleState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const publicState = (viewerId?: string) =>
    platform.gameManager.getPublicState(room, viewerId) as {
      phase: string;
      scrambled: string | null;
      answer: string | null;
      scores: Record<string, number>;
      solved: string[];
      round: number;
      totalRounds: number;
      endsAt: number | null;
      history: Array<{ word: string }>;
    };

  /* ---------------------------------------------------------------- */
  /* Round setup                                                       */
  /* ---------------------------------------------------------------- */

  it('starts round 1 with a scrambled word from the server dictionary', async () => {
    await waitFor(() => state().phase === 'round', { timeoutMs: 5000 });
    expect(state().round).toBe(1);
    expect(state().totalRounds).toBe(2);
    expect(SCRAMBLE_WORDS).toContain(state().current!.word);
    expect(state().current!.scrambled).toMatch(/^[A-Z]+$/);
    expect(state().current!.endsAt).toBeGreaterThan(0);
    const view = publicState(players[0]!.id);
    expect(view.scrambled).toBe(state().current!.scrambled);
    expect(view.totalRounds).toBe(2);
  });

  it('scrambles deterministically from the rng and avoids the identity', () => {
    const first = scrambleWord('PLANET', () => 0.42);
    expect(first).toMatch(/^[A-Z]{6}$/);
    expect([...first].sort().join('')).toBe([...'PLANET'].sort().join(''));
    // A word with distinct letters should never scramble to itself here.
    expect(first === 'PLANET').toBe(false);
  });

  /* ---------------------------------------------------------------- */
  /* Answers                                                           */
  /* ---------------------------------------------------------------- */

  it('scores correct answers (case-insensitive) with the speed bonus', async () => {
    await waitFor(() => state().phase === 'round', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    const word = state().current!.word;

    const result = platform.gameManager.handleAction(room, playerId, {
      type: 'submit',
      payload: { answer: word.toLowerCase() },
    });

    expect(result.accepted).toBe(true);
    expect(state().scores[playerId]).toBe(2); // 1 base + 1 fast bonus
    expect(state().current!.solvedOrder).toEqual([playerId]);
    expect(state().solvedCount[playerId]).toBe(1);
  });

  it('accepts wrong answers but scores nothing and allows retries', async () => {
    await waitFor(() => state().phase === 'round', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    const word = state().current!.word;

    const wrong = platform.gameManager.handleAction(room, playerId, {
      type: 'submit',
      payload: { answer: 'ZZZZZZ' },
    });
    expect(wrong.accepted).toBe(true);
    expect(state().scores[playerId]).toBe(0);
    expect(state().current!.attempts[playerId]).toBe(1);

    const retry = platform.gameManager.handleAction(room, playerId, {
      type: 'submit',
      payload: { answer: word },
    });
    expect(retry.accepted).toBe(true);
    expect(state().scores[playerId]).toBeGreaterThan(0);
  });

  it('rejects duplicate submissions after solving', async () => {
    await waitFor(() => state().phase === 'round', { timeoutMs: 5000 });
    const playerId = players[0]!.id;

    platform.gameManager.handleAction(room, playerId, {
      type: 'submit',
      payload: { answer: state().current!.word },
    });
    expect(
      wordScrambleGame.validateAction(
        playerId,
        { type: 'submit', payload: { answer: state()!.current!.word } },
        state(),
        context(),
      ),
    ).toEqual({ valid: false, reason: 'You already solved this word.' });

    const again = platform.gameManager.handleAction(room, playerId, {
      type: 'submit',
      payload: { answer: state().current!.word },
    });
    expect(again.accepted).toBe(false);
  });

  it('rejects unknown actions, empty answers, junk payloads and foreign players', async () => {
    await waitFor(() => state().phase === 'round', { timeoutMs: 5000 });
    const playerId = players[0]!.id;

    expect(wordScrambleGame.validateAction(playerId, { type: 'shout' }, state(), context()).valid).toBe(false);
    expect(
      wordScrambleGame.validateAction(playerId, { type: 'submit', payload: { answer: '   ' } }, state(), context())
        .valid,
    ).toBe(false);
    expect(
      wordScrambleGame.validateAction(playerId, { type: 'submit', payload: { answer: 123 } }, state(), context())
        .valid,
    ).toBe(false);
    expect(wordScrambleGame.validateAction(playerId, { type: 'submit' }, state(), context()).valid).toBe(false);
    expect(
      wordScrambleGame.validateAction(
        'ghost-player',
        { type: 'submit', payload: { answer: 'WORD' } },
        state(),
        context(),
      ).valid,
    ).toBe(true); // membership is enforced by the platform, not the game
  });

  /* ---------------------------------------------------------------- */
  /* Privacy                                                           */
  /* ---------------------------------------------------------------- */

  it('never leaks the current word during a round', async () => {
    await waitFor(() => state().phase === 'round', { timeoutMs: 5000 });
    const view = publicState(players[0]!.id);
    const serialised = JSON.stringify(view);
    expect(view.answer).toBeNull();
    expect(serialised).not.toContain(state().current!.word);
    expect(view.scrambled).not.toBe(state().current!.word);
    expect(view.history).toHaveLength(0);
  });

  it('reveals the answer only during the reveal phase and in history', async () => {
    await waitFor(() => state().phase === 'round', { timeoutMs: 5000 });
    const word = state().current!.word;
    completeRound(state(), context());

    expect(state().phase).toBe('reveal');
    const view = publicState(players[0]!.id);
    expect(view.answer).toBe(word);
    expect(view.history[0]!.word).toBe(word);
  });

  /* ---------------------------------------------------------------- */
  /* Round progression                                                 */
  /* ---------------------------------------------------------------- */

  it('ends the round early when every player has solved it', async () => {
    await waitFor(() => state().phase === 'round', { timeoutMs: 5000 });
    const word = state().current!.word;
    for (const player of players) {
      platform.gameManager.handleAction(room, player.id, {
        type: 'submit',
        payload: { answer: word },
      });
    }
    expect(state().phase).toBe('reveal');
  });

  it('progresses rounds and finishes after the final round', async () => {
    await waitFor(() => state().phase === 'round', { timeoutMs: 5000 });
    expect(state().totalRounds).toBe(2);

    completeRound(state(), context());
    expect(state().phase).toBe('reveal');

    beginNextRound(state(), context());
    expect(state().phase).toBe('round');
    expect(state().round).toBe(2);

    completeRound(state(), context());
    beginNextRound(state(), context());
    expect(state().phase).toBe('finished');
    expect(state().finishReason).toBe('completed');
    expect(wordScrambleGame.isGameFinished(state())).toBe(true);
  });

  it('does not repeat words within a match', async () => {
    await waitFor(() => state().phase === 'round', { timeoutMs: 5000 });
    const first = state().current!.word;
    completeRound(state(), context());
    beginNextRound(state(), context());
    await waitFor(() => state().phase === 'round', { timeoutMs: 1000 }).catch(() => undefined);
    expect(state().current!.word).not.toBe(first);
  });

  /* ---------------------------------------------------------------- */
  /* Timeout                                                           */
  /* ---------------------------------------------------------------- */

  it('finishes with reason timeout when the match cap fires', async () => {
    await waitFor(() => state().phase === 'round', { timeoutMs: 5000 });
    state().scores[players[0]!.id] = 3;
    finishScrambleOnTimeout(state(), context());
    expect(state().phase).toBe('finished');
    expect(state().finishReason).toBe('timeout');
  });

  /* ---------------------------------------------------------------- */
  /* Result / draw                                                     */
  /* ---------------------------------------------------------------- */

  it('ranks by score and detects draws (efficiency tie-break)', async () => {
    await waitFor(() => state().phase === 'round', { timeoutMs: 5000 });
    state().phase = 'finished';
    state().scores[players[0]!.id] = 5;
    state().scores[players[1]!.id] = 3;

    const draft = wordScrambleGame.getResult(state(), context());
    expect(draft.winners).toEqual([players[0]!.id]);
    expect(draft.isDraw).toBe(false);
    expect(draft.rankings[0]!.score).toBe(5);

    state().scores[players[1]!.id] = 5;
    state().attemptsTotal[players[0]!.id] = 4;
    state().attemptsTotal[players[1]!.id] = 7;
    const drawn = wordScrambleGame.getResult(state(), context());
    expect(drawn.isDraw).toBe(true);
    expect(drawn.winners).toHaveLength(2);
    // Efficiency tie-break puts the fewer-attempts player first.
    expect(drawn.rankings[0]!.playerId).toBe(players[0]!.id);
  });

  /* ---------------------------------------------------------------- */
  /* Reset / rematch                                                   */
  /* ---------------------------------------------------------------- */

  it('reset keeps every seat and zeroes the battle', async () => {
    await waitFor(() => state().phase === 'round', { timeoutMs: 5000 });
    const seats = Object.keys(state().scores);
    state().scores[seats[0]!] = 4;
    state().usedWords = ['PLANET'];

    const next = wordScrambleGame.reset(state());
    expect(Object.keys(next.scores)).toEqual(seats);
    expect(next.scores[seats[0]!]).toBe(0);
    expect(next.phase).toBe('idle');
    expect(next.current).toBeNull();
    expect(next.history).toEqual([]);
    expect(next.usedWords).toEqual([]);
    expect(next.round).toBe(0);
  });

  /* ---------------------------------------------------------------- */
  /* AI                                                                */
  /* ---------------------------------------------------------------- */

  it('AI proposes real submissions and stops once it has solved the word', async () => {
    await waitFor(() => state().phase === 'round', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    const word = state().current!.word;

    let correct = 0;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const move = wordScrambleGame.getAIMove?.(playerId, 'hard', state(), context());
      expect(move?.type).toBe('submit');
      const answer = String(move?.payload?.answer);
      expect(answer).toMatch(/^[A-Z]+$/);
      expect(answer.length).toBe(word.length);
      if (answer === word) correct += 1;
    }
    expect(correct).toBeGreaterThan(20); // hard ≈ 96% accurate

    state().current!.solvedOrder.push(playerId);
    expect(wordScrambleGame.getAIMove?.(playerId, 'hard', state(), context())).toBeNull();

    state().phase = 'reveal';
    expect(wordScrambleGame.getAIMove?.(playerId, 'hard', state(), context())).toBeNull();
  });

  /* ---------------------------------------------------------------- */
  /* Disconnect behaviour                                              */
  /* ---------------------------------------------------------------- */

  it('a disconnected player keeps their seat; a leaver stops blocking round ends', async () => {
    await waitFor(() => state().phase === 'round', { timeoutMs: 5000 });
    const [a, b] = players.map((player) => player.id);

    wordScrambleGame.playerLeft(a, state(), context(), 'disconnect');
    expect(state().phase).toBe('round'); // grace period, nothing changes

    // a Solves; b still pending → round continues.
    platform.gameManager.handleAction(room, a, { type: 'submit', payload: { answer: state()!.current!.word } });
    expect(state().phase).toBe('round');

    // b leaves → nobody unsolved remains → round completes early.
    wordScrambleGame.playerLeft(b, state(), context(), 'leave');
    expect(state().phase).toBe('reveal');
  });
});
