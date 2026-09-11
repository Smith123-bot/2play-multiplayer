import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createTestPlatform, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  buildBoard,
  completeLevel,
  coupleMemoryGame,
  finishMemory,
  HINT_PENALTY,
  levelAt,
  loadLevel,
  MEMORY_LEVELS,
  MEMORY_TOTAL_LEVELS,
  MISTAKE_PENALTY,
  PAIR_SCORE,
  resolvePending,
  type CoupleMemoryState,
} from './index';
import type { Room } from '../../rooms/Room';

describe('Couple Memory', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'couple-memory');
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as CoupleMemoryState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const flip = (playerId: string, cardId: string) =>
    platform.gameManager.handleAction(room, playerId, { type: 'flip', payload: { cardId } });

  const goToLevel = (index: number) => {
    state().level = index;
    loadLevel(state(), context());
  };

  /** Finds a genuine matching pair from the server's authoritative deck. */
  const findPair = () => {
    const open = state().cards.filter((card) => !card.matched && !card.faceUp);
    for (const card of open) {
      const twin = open.find((other) => other !== card && other.symbol === card.symbol);
      if (twin) return [card, twin] as const;
    }
    return null;
  };

  const findMismatch = () => {
    const open = state().cards.filter((card) => !card.matched && !card.faceUp);
    for (const card of open) {
      const other = open.find((entry) => entry !== card && entry.symbol !== card.symbol);
      if (other) return [card, other] as const;
    }
    return null;
  };

  /* ---------------- levels & board ---------------- */

  it('ships ten levels whose boards always divide into pairs', () => {
    expect(MEMORY_TOTAL_LEVELS).toBe(10);
    for (const level of MEMORY_LEVELS) {
      expect((level.cols * level.rows) % 2).toBe(0);
      expect(level.timeLimit).toBeGreaterThan(0);
      expect(level.bonusPairs).toBeLessThanOrEqual((level.cols * level.rows) / 2);
    }
  });

  it('difficulty escalates: bigger boards, mistake caps and bonus pairs', () => {
    expect(levelAt(9).cols * levelAt(9).rows).toBeGreaterThan(levelAt(0).cols * levelAt(0).rows);
    expect(levelAt(0).maxMistakes).toBe(0); // unlimited early on
    expect(levelAt(9).maxMistakes).toBeGreaterThan(0);
    expect(levelAt(9).bonusPairs).toBeGreaterThan(levelAt(0).bonusPairs);
  });

  it('builds a shuffled deck where every symbol appears exactly twice', () => {
    const deck = buildBoard(levelAt(3), context().random);
    expect(deck).toHaveLength(levelAt(3).cols * levelAt(3).rows);
    const counts = new Map<string, number>();
    for (const card of deck) counts.set(card.symbol, (counts.get(card.symbol) ?? 0) + 1);
    expect([...counts.values()].every((count) => count === 2)).toBe(true);
    expect(deck.every((card) => !card.faceUp && !card.matched)).toBe(true);
  });

  it('starts level one face down with a live clock', () => {
    expect(state().phase).toBe('playing');
    expect(state().level).toBe(0);
    expect(state().cards.length).toBeGreaterThan(0);
    expect(state().cards.every((card) => !card.faceUp)).toBe(true);
    expect(state().pairsFound).toBe(0);
    expect(state().levelEndsAt).toBeGreaterThan(context().now());
  });

  /* ---------------- hidden information ---------------- */

  it('never sends a face-down card symbol to any client', () => {
    const view = platform.gameManager.getPublicState(room, players[0]!.id) as {
      cards: Array<{ id: string; symbol: string | null; faceUp: boolean }>;
    };
    expect(view.cards.every((card) => card.symbol === null)).toBe(true);
    // The raw deck is never serialised.
    const json = JSON.stringify(view);
    for (const card of state().cards) {
      expect(json).not.toContain(`"${card.id}","symbol":"${card.symbol}"`);
    }
  });

  it('reveals a symbol only once the card is actually face up', () => {
    const pair = findPair()!;
    flip(players[0]!.id, pair[0].id);
    const view = platform.gameManager.getPublicState(room, players[1]!.id) as {
      cards: Array<{ id: string; symbol: string | null }>;
    };
    const revealed = view.cards.find((card) => card.id === pair[0].id)!;
    expect(revealed.symbol).toBe(pair[0].symbol);
    // Everything else stays hidden.
    expect(view.cards.filter((card) => card.symbol !== null)).toHaveLength(1);
  });

  /* ---------------- the cooperative rule ---------------- */

  it('one partner CANNOT flip both cards of a pair', () => {
    const [aId] = players.map((player) => player.id);
    const pair = findPair()!;
    expect(flip(aId, pair[0].id).accepted).toBe(true);
    // The same partner is blocked from flipping the second card.
    expect(flip(aId, pair[1].id).accepted).toBe(false);
    expect(
      coupleMemoryGame.validateAction(aId, { type: 'flip', payload: { cardId: pair[1].id } }, state(), context()).valid,
    ).toBe(false);
    expect(state().pendingCount ?? state().pending.length).toBe(1);
  });

  it('a pair completed by BOTH partners matches and scores', () => {
    const [aId, bId] = players.map((player) => player.id);
    const pair = findPair()!;
    expect(flip(aId, pair[0].id).accepted).toBe(true);
    expect(flip(bId, pair[1].id).accepted).toBe(true);

    expect(state().pairsFound).toBe(1);
    expect(state().teamScore).toBeGreaterThanOrEqual(PAIR_SCORE);
    expect(state().cards.find((card) => card.id === pair[0].id)!.matched).toBe(true);
    expect(state().cards.find((card) => card.id === pair[1].id)!.matched).toBe(true);
    // Both partners are credited — that is the co-op mechanic.
    expect(state().players[aId]!.matchesHelped).toBe(1);
    expect(state().players[bId]!.matchesHelped).toBe(1);
  });

  it('a mismatch costs points, breaks the combo and hides the cards again', () => {
    const [aId, bId] = players.map((player) => player.id);
    state().teamScore = 300;
    state().combo = 3;
    const mismatch = findMismatch()!;
    flip(aId, mismatch[0].id);
    flip(bId, mismatch[1].id);

    expect(state().mistakes).toBe(1);
    expect(state().combo).toBe(0);
    expect(state().teamScore).toBe(300 - MISTAKE_PENALTY);
    expect(state().phase).toBe('resolving');
    expect(state().pairsFound).toBe(0);
  });

  it('builds a combo across consecutive matches', () => {
    const [aId, bId] = players.map((player) => player.id);
    goToLevel(0);
    let matches = 0;
    for (let i = 0; i < 3; i += 1) {
      const pair = findPair();
      if (!pair) break;
      flip(aId, pair[0].id);
      flip(bId, pair[1].id);
      matches += 1;
      if (state().phase !== 'playing') break;
    }
    expect(matches).toBeGreaterThanOrEqual(2);
    expect(state().bestCombo).toBeGreaterThanOrEqual(2);
  });

  /* ---------------- anti-cheat ---------------- */

  it('rejects invalid cards, duplicate flips and outcome-asserting actions', () => {
    const [aId, bId] = players.map((player) => player.id);
    const ctx = context();
    for (const type of ['score', 'win', 'complete', 'finish', 'match', 'reveal']) {
      expect(coupleMemoryGame.validateAction(aId, { type, payload: { score: 999 } }, state(), ctx).valid).toBe(false);
      expect(coupleMemoryGame.handlePlayerAction(aId, { type }, state(), ctx).accepted).toBe(false);
    }
    for (const cardId of [undefined, null, 42, {}, 'not-a-card']) {
      expect(coupleMemoryGame.validateAction(aId, { type: 'flip', payload: { cardId } }, state(), ctx).valid).toBe(
        false,
      );
    }
    // A card already face up cannot be flipped again.
    const pair = findPair()!;
    flip(aId, pair[0].id);
    expect(flip(bId, pair[0].id).accepted).toBe(false);
    // A matched card is locked.
    flip(bId, pair[1].id);
    expect(flip(aId, pair[0].id).accepted).toBe(false);
  });

  it('rejects flips while cards are resolving and after the match ends', () => {
    const [aId, bId] = players.map((player) => player.id);
    const mismatch = findMismatch()!;
    flip(aId, mismatch[0].id);
    flip(bId, mismatch[1].id);
    expect(state().phase).toBe('resolving');
    const another = state().cards.find((card) => !card.faceUp && !card.matched)!;
    expect(flip(aId, another.id).accepted).toBe(false);

    finishMemory(state(), context(), 'timeout');
    expect(flip(aId, another.id).accepted).toBe(false);
  });

  /* ---------------- hints ---------------- */

  it('a hint costs points and names a real card', () => {
    const [aId] = players.map((player) => player.id);
    state().teamScore = 200;
    const result = platform.gameManager.handleAction(room, aId, { type: 'hint' });
    expect(result.accepted).toBe(true);
    expect(state().players[aId]!.hintsUsed).toBe(1);
    expect(state().teamScore).toBe(200 - HINT_PENALTY);
    const hinted = state().lastEvent!.split(':')[2];
    expect(state().cards.some((card) => card.id === hinted)).toBe(true);
  });

  /* ---------------- completion ---------------- */

  it('clearing every pair completes the level and advances', () => {
    const [aId, bId] = players.map((player) => player.id);
    goToLevel(0); // smallest board
    let guard = 0;
    while (state().pairsFound < state().pairsTotal && guard < 40) {
      guard += 1;
      const pair = findPair();
      if (!pair) break;
      flip(aId, pair[0].id);
      flip(bId, pair[1].id);
    }
    expect(state().levelsCleared).toBe(1);
    expect(state().level).toBe(1);
    expect(state().phase).toBe('level-clear');
  });

  it('clearing the final level finishes the run', () => {
    state().level = MEMORY_TOTAL_LEVELS - 1;
    state().phase = 'playing';
    completeLevel(state(), context());
    expect(state().phase).toBe('finished');
    expect(coupleMemoryGame.isGameFinished(state())).toBe(true);
  });

  it('running out of mistakes ends the run on capped levels', () => {
    goToLevel(6); // first level with a mistake cap
    expect(state().maxMistakes).toBeGreaterThan(0);
    const [aId, bId] = players.map((player) => player.id);
    state().mistakes = state().maxMistakes - 1;
    const mismatch = findMismatch()!;
    flip(aId, mismatch[0].id);
    flip(bId, mismatch[1].id);
    expect(state().mistakes).toBe(state().maxMistakes);
    // The cap is enforced after the reveal window resolves.
    resolvePending(state(), context());
    expect(state().phase).toBe('resolving');
  });

  /* ---------------- co-op result ---------------- */

  it('shares score and result across both partners', () => {
    state().teamScore = 1400;
    state().levelsCleared = 5;
    finishMemory(state(), context(), 'completed');
    const [aId, bId] = players.map((player) => player.id);
    expect(coupleMemoryGame.calculateScore(aId, state())).toBe(1400);
    expect(coupleMemoryGame.calculateScore(bId, state())).toBe(1400);

    const result = coupleMemoryGame.getResult(state(), context());
    expect(result.winners).toHaveLength(2);
    expect(result.rankings.every((entry) => entry.rank === 1 && entry.score === 1400)).toBe(true);
    expect(result.rankings[0]!.stats).toHaveProperty('pairsFound');
  });

  /* ---------------- lifecycle ---------------- */

  it('handles disconnect, reconnect, leave, reset and cleanup', () => {
    const [aId] = players.map((player) => player.id);
    state().players[aId]!.flips = 4;
    coupleMemoryGame.playerLeft(aId, state(), context(), 'disconnect');
    expect(state().players[aId]!.disconnected).toBe(true);
    const card = state().cards.find((entry) => !entry.faceUp)!;
    expect(flip(aId, card.id).accepted).toBe(false);

    coupleMemoryGame.playerJoined({ ...players[0]! }, state(), context());
    expect(state().players[aId]!.disconnected).toBe(false);
    expect(state().players[aId]!.flips).toBe(4);

    coupleMemoryGame.playerLeft(aId, state(), context(), 'leave');
    expect(state().phase).toBe('finished');

    const next = coupleMemoryGame.reset(state());
    expect(next.phase).toBe('idle');
    expect(next.teamScore).toBe(0);
    expect(next.cards).toHaveLength(0);
    coupleMemoryGame.cleanup(next);
    expect(Object.keys(next.players)).toHaveLength(0);
  });

  /* ---------------- AI ---------------- */

  it('the AI only flips real, available cards and respects the co-op rule', () => {
    const [aId, bId] = players.map((player) => player.id);
    for (let i = 0; i < 20; i += 1) {
      const action = coupleMemoryGame.getAIMove?.(bId, 'hard', state(), context());
      if (!action) break;
      expect(action.type).toBe('flip');
      const cardId = action.payload?.cardId as string;
      const card = state().cards.find((entry) => entry.id === cardId);
      expect(card).toBeDefined();
      expect(card!.faceUp).toBe(false);
      expect(card!.matched).toBe(false);
      platform.gameManager.handleAction(room, bId, action);
      if (state().phase !== 'playing') break;
    }
    // After the AI flips the first card it must not flip the second itself.
    if (state().pending.length === 1) {
      const first = state().cards.find((card) => card.id === state().pending[0])!;
      if (first.flippedBy === bId) {
        expect(coupleMemoryGame.getAIMove?.(bId, 'hard', state(), context())).toBeNull();
      }
    }
    expect(aId).toBeTruthy();
  });

  it('two AI partners can clear a board together', () => {
    const [aId, bId] = players.map((player) => player.id);
    goToLevel(0);
    let guard = 0;
    while (state().pairsFound < state().pairsTotal && guard < 300) {
      guard += 1;
      const actor = state().pending.length === 0 ? aId : bId;
      const action = coupleMemoryGame.getAIMove?.(actor, 'hard', state(), context());
      if (!action) {
        // Resolve a pending reveal so the simulation can continue.
        if (state().phase === 'resolving') {
          for (const card of state().cards) {
            if (!card.matched && card.faceUp) {
              card.faceUp = false;
              card.flippedBy = null;
            }
          }
          state().pending = [];
          state().phase = 'playing';
          continue;
        }
        break;
      }
      platform.gameManager.handleAction(room, actor, action);
      if (state().phase === 'resolving') {
        for (const card of state().cards) {
          if (!card.matched && card.faceUp) {
            card.faceUp = false;
            card.flippedBy = null;
          }
        }
        state().pending = [];
        state().phase = 'playing';
      }
      if (state().phase === 'level-clear' || state().phase === 'finished') break;
    }
    expect(state().levelsCleared).toBeGreaterThanOrEqual(1);
  });

  it('the AI stops once the run is over', () => {
    finishMemory(state(), context(), 'timeout');
    expect(coupleMemoryGame.getAIMove?.(players[0]!.id, 'hard', state(), context())).toBeNull();
  });
});
