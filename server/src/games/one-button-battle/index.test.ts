import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createPlayer, createTestPlatform, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  advanceCues,
  CONTEXTS,
  finishOneButton,
  HIT_BASE,
  oneButtonGame,
  resolveTap,
  type OneButtonState,
} from './index';
import type { Room } from '../../rooms/Room';
import { buildSequence, EVENT_COUNT, GAP_MS, LEAD_MS, MATCH_MS, WINDOW_MS } from './index';
import { createRandom } from '@2play/shared';

describe('One Button Battle', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'one-button-battle');
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as OneButtonState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const publicState = (viewerId?: string) =>
    platform.gameManager.getPublicState(room, viewerId) as {
      current: { context: string } | null;
      events?: unknown;
      players: Record<string, { score: number }>;
    };

  async function startWithPlayers(count: 3 | 4): Promise<void> {
    const local = createTestPlatform();
    const ids = [];
    for (let i = 0; i < count; i += 1) ids.push(await createPlayer(local.platform, `Ob${count}${i}`));
    const extra = local.platform.roomManager.createRoom({
      gameId: 'one-button-battle',
      maxPlayers: count,
      isPrivate: false,
      host: ids[0]!,
    });
    for (let i = 1; i < count; i += 1) local.platform.roomManager.joinRoom({ roomId: extra.id, player: ids[i]! });
    extra.status = 'PLAYING';
    extra.gameStartedAt = Date.now();
    local.platform.gameManager.createState(extra);
    local.platform.gameManager.start(extra);
    harness.destroy();
    harness = local;
    platform = local.platform;
    room = extra;
    players = platform.gameManager.playerViews(room);
  }

  it('starts a context sequence with a live clock and no future-event leak', () => {
    expect(state().phase).toBe('playing');
    expect(state().events.length).toBeGreaterThan(4);
    expect(CONTEXTS).toContain(state().events[0]!.context);
    expect(state().endsAt).toBeGreaterThan(context().now());
    const view = publicState(players[0]!.id);
    expect(view.current?.context).toBe(state().events[0]!.context);
    expect(view.events).toBeUndefined();
  });

  it('scores a tap inside the window and misses an early press', () => {
    const playerId = players[0]!.id;
    const cue = state().events[0]!;
    expect(resolveTap(state(), playerId, cue.windowStart + 10)).toBe('hit');
    expect(state().players[playerId]!.score).toBe(HIT_BASE);
    expect(state().players[playerId]!.hits).toBe(1);
    expect(state().players[playerId]!.streak).toBe(1);

    const other = players[1]!.id;
    expect(resolveTap(state(), other, cue.appearAt + 10)).toBe('miss');
    expect(state().players[other]!.score).toBe(0);
    expect(state().players[other]!.misses).toBe(1);
    expect(state().players[other]!.streak).toBe(0);
  });

  it('accepts tap through the manager and rejects client-owned hits / scores', () => {
    const playerId = players[0]!.id;
    const cue = state().events[0]!;
    state().startedAt = context().now() - (cue.windowStart + 20);
    const tapped = platform.gameManager.handleAction(room, playerId, { type: 'tap' });
    expect(tapped.accepted).toBe(true);
    expect(state().players[playerId]!.hits).toBe(1);

    expect(oneButtonGame.validateAction(playerId, { type: 'score', payload: { score: 99 } }, state(), context()).valid).toBe(
      false,
    );
    expect(oneButtonGame.validateAction(playerId, { type: 'hit' }, state(), context()).valid).toBe(false);
    expect(oneButtonGame.validateAction(playerId, { type: 'context' }, state(), context()).valid).toBe(false);
    expect(oneButtonGame.handlePlayerAction(playerId, { type: 'score' }, state(), context()).accepted).toBe(false);
    expect(oneButtonGame.validateAction(playerId, { type: 'tap' }, state(), context()).valid).toBe(false);
  });

  it('advances past a closed window, then timeout ranks by score', () => {
    const cue = state().events[0]!;
    advanceCues(state(), cue.windowEnd + 1);
    expect(state().currentIndex).toBe(1);
    expect(state().players[players[0]!.id]!.misses).toBe(1);

    const seats = Object.keys(state().players);
    state().players[seats[0]!]!.score = 80;
    finishOneButton(state(), context(), 'timeout');
    expect(state().finishReason).toBe('timeout');
    const draft = oneButtonGame.getResult(state(), context());
    expect(draft.winners).toEqual([seats[0]]);
    expect(draft.isDraw).toBe(false);
    state().players[seats[1]!]!.score = 80;
    expect(oneButtonGame.getResult(state(), context()).isDraw).toBe(true);
    const next = oneButtonGame.reset(state());
    expect(Object.keys(next.players)).toEqual(seats);
    expect(next.phase).toBe('idle');
    expect(next.players[seats[0]!]!.score).toBe(0);
    oneButtonGame.cleanup(next);
    expect(Object.keys(next.players)).toHaveLength(0);
  });

  it('disconnect, reconnect and leave', () => {
    const [first, second] = players.map((player) => player.id);
    oneButtonGame.playerLeft(first, state(), context(), 'disconnect');
    expect(state().players[first]!.disconnected).toBe(true);
    oneButtonGame.playerJoined({ ...players[0]!, id: first }, state(), context());
    expect(state().players[first]!.disconnected).toBe(false);
    oneButtonGame.playerLeft(first, state(), context(), 'leave');
    oneButtonGame.playerLeft(second, state(), context(), 'leave');
    expect(state().phase).toBe('finished');
  });

  it('AI taps only inside the live window', () => {
    const cue = state().events[0]!;
    state().startedAt = context().now() - (cue.windowStart + 30);
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const move = oneButtonGame.getAIMove?.(players[0]!.id, difficulty, state(), context());
      if (!move) continue;
      expect(move.type).toBe('tap');
      expect(oneButtonGame.validateAction(players[0]!.id, move, state(), context()).valid).toBe(true);
    }
  });

  it('initialises 3 and 4 player matches', async () => {
    for (const count of [3, 4] as const) {
      await startWithPlayers(count);
      expect(Object.keys(state().players)).toHaveLength(count);
      expect(state().phase).toBe('playing');
      expect(state().events[0]!.resolved[players[0]!.id]).toBe('pending');
    }
  });
});

describe('One Button Battle cue variety', () => {
  const ids = ['p1', 'p2'];

  it('deals a different cue chart for every match', () => {
    const charts = new Set<string>();
    for (let seed = 1; seed <= 60; seed += 1) {
      const ev = buildSequence(ids, EVENT_COUNT, createRandom(seed * 7717));
      charts.add(ev.map((e) => `${e.context}@${e.appearAt}`).join('|'));
    }
    // The chart used to be a fixed round-robin at fixed 2400ms spacing.
    expect(charts.size).toBeGreaterThan(50);
  });

  it('keeps every context in rotation without consecutive repeats', () => {
    const frequency = new Map<string, number>();
    for (let seed = 1; seed <= 120; seed += 1) {
      const ev = buildSequence(ids, EVENT_COUNT, createRandom(seed * 6151));
      for (let i = 0; i < ev.length; i += 1) {
        frequency.set(ev[i]!.context, (frequency.get(ev[i]!.context) ?? 0) + 1);
        if (i > 0) expect(ev[i]!.context).not.toBe(ev[i - 1]!.context);
      }
    }
    // The shuffled bag preserves the even spread the round-robin guaranteed.
    expect(frequency.size).toBe(CONTEXTS.length);
    const counts = [...frequency.values()];
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThan(counts[0]! * 0.25);
  });

  it('never overlaps hit windows and always fits inside the match', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const ev = buildSequence(ids, EVENT_COUNT, createRandom(seed * 5297));
      expect(ev).toHaveLength(EVENT_COUNT);
      for (let i = 1; i < ev.length; i += 1) {
        // A cue must not appear before the previous window has closed.
        expect(ev[i]!.appearAt).toBeGreaterThanOrEqual(ev[i - 1]!.windowEnd);
        expect(ev[i]!.appearAt - ev[i - 1]!.appearAt).toBeGreaterThanOrEqual(LEAD_MS + WINDOW_MS);
      }
      // sequenceMs is the last window plus 800ms; it must fit MATCH_MS.
      expect(ev[ev.length - 1]!.windowEnd + 800).toBeLessThanOrEqual(MATCH_MS);
    }
  });

  it('keeps the original deterministic chart when no random source is given', () => {
    const det = buildSequence(ids);
    expect(det.map((e) => e.context)).toEqual(
      Array.from({ length: EVENT_COUNT }, (_v, i) => CONTEXTS[i % CONTEXTS.length]),
    );
    expect(det[1]!.appearAt - det[0]!.appearAt).toBe(GAP_MS);
  });
});
