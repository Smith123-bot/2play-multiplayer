import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createPlayer, createTestPlatform, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  buildDeck,
  cardPoints,
  drawCards,
  endRound,
  finishUno,
  handPoints,
  isPlayable,
  isWild,
  shuffle,
  STARTING_HAND,
  topCard,
  unoGame,
  type UnoCard,
  type UnoColor,
  type UnoState,
} from './index';
import type { Room } from '../../rooms/Room';

describe('Uno', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'uno');
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as UnoState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const act = (playerId: string, action: { type: string; payload?: Record<string, unknown> }) =>
    platform.gameManager.handleAction(room, playerId, action);
  const current = () => state().currentPlayerId as string;
  const other = () => players.map((p) => p.id).find((id) => id !== current()) as string;

  /** Forces a specific top card + colour so tests are deterministic. */
  const setTop = (card: UnoCard, color: UnoColor) => {
    state().discardPile = [card];
    state().activeColor = color;
  };
  /** Gives a player an exact hand. */
  const setHand = (playerId: string, hand: UnoCard[]) => {
    state().players[playerId]!.hand = hand;
  };

  /* ---------------- deck ---------------- */

  it('builds a correct 108 card deck', () => {
    const deck = buildDeck();
    expect(deck).toHaveLength(108);
    expect(new Set(deck.map((card) => card.id)).size).toBe(108);
    const count = (predicate: (card: UnoCard) => boolean) => deck.filter(predicate).length;
    expect(count((card) => card.value === '0')).toBe(4); // one zero per colour
    expect(count((card) => card.value === '7')).toBe(8); // two of each 1-9
    expect(count((card) => card.value === 'skip')).toBe(8);
    expect(count((card) => card.value === 'reverse')).toBe(8);
    expect(count((card) => card.value === 'draw-two')).toBe(8);
    expect(count((card) => card.value === 'wild')).toBe(4);
    expect(count((card) => card.value === 'wild-draw-four')).toBe(4);
  });

  it('scores cards by the documented values', () => {
    expect(cardPoints({ id: 'x', color: 'red', value: '7' })).toBe(7);
    expect(cardPoints({ id: 'x', color: 'red', value: '0' })).toBe(0);
    expect(cardPoints({ id: 'x', color: 'red', value: 'skip' })).toBe(20);
    expect(cardPoints({ id: 'x', color: 'red', value: 'reverse' })).toBe(20);
    expect(cardPoints({ id: 'x', color: 'red', value: 'draw-two' })).toBe(20);
    expect(cardPoints({ id: 'x', color: 'wild', value: 'wild' })).toBe(50);
    expect(cardPoints({ id: 'x', color: 'wild', value: 'wild-draw-four' })).toBe(50);
  });

  it('shuffles deterministically from a seed and changes the order', () => {
    const deck = buildDeck();
    const seeded = (seed: number) => {
      let value = seed;
      return () => {
        value = (value * 1103515245 + 12345) % 2147483648;
        return value / 2147483648;
      };
    };
    const a = shuffle(deck, seeded(7)).map((card) => card.id);
    const b = shuffle(deck, seeded(7)).map((card) => card.id);
    expect(a).toEqual(b);
    expect(a).not.toEqual(deck.map((card) => card.id));
  });

  /* ---------------- dealing ---------------- */

  it('deals seven cards each and opens a non-wild discard', () => {
    expect(state().phase).toBe('playing');
    // A `draw-two` opener is applied immediately, so the first player draws
    // two extra cards before the match begins (official rule). Everyone else
    // holds a full starting hand.
    const handSizes = players.map((player) => state().players[player.id]!.hand.length);
    expect(Math.min(...handSizes)).toBe(STARTING_HAND);
    expect(handSizes.every((size) => size >= STARTING_HAND)).toBe(true);
    expect(handSizes.filter((size) => size > STARTING_HAND).length).toBeLessThanOrEqual(1);
    const top = topCard(state());
    expect(top).toBeDefined();
    expect(isWild(top!)).toBe(false); // an opener must set a colour
    expect(state().activeColor).toBe(top!.color);
    // 108 cards = the hands + the pile + the single opened discard.
    const dealt = handSizes.reduce((sum, size) => sum + size, 0);
    expect(state().drawPile.length).toBe(108 - dealt - 1);
    expect(state().turnEndsAt).toBeGreaterThan(context().now());
  });

  it('never deals the same card to two players', () => {
    const all = Object.values(state().players).flatMap((slot) => slot.hand.map((card) => card.id));
    const pile = state().drawPile.map((card) => card.id);
    const discard = state().discardPile.map((card) => card.id);
    const every = [...all, ...pile, ...discard];
    expect(every).toHaveLength(108);
    expect(new Set(every).size).toBe(108);
  });

  /* ---------------- hidden information ---------------- */

  it('never reveals another player hand or the draw pile order', () => {
    const [a, b] = players.map((player) => player.id);
    const view = platform.gameManager.getPublicState(room, a) as Record<string, unknown> & {
      myHand: UnoCard[];
      players: Record<string, { cardCount: number }>;
      drawPileCount: number;
    };
    // The viewer sees only their own hand.
    expect(view.myHand.map((card) => card.id).sort()).toEqual(
      state().players[a]!.hand.map((card) => card.id).sort(),
    );
    // Opponents are a count only.
    expect(view.players[b]!.cardCount).toBe(STARTING_HAND);
    expect((view.players[b] as unknown as { hand?: unknown }).hand).toBeUndefined();
    // The pile is a size, never its contents.
    expect(view.drawPileCount).toBe(state().drawPile.length);
    expect(view.drawPile).toBeUndefined();

    // Not one of B's card ids may appear anywhere in A's payload.
    const json = JSON.stringify(view);
    for (const card of state().players[b]!.hand) {
      expect(json).not.toContain(`"${card.id}"`);
    }
  });

  /* ---------------- legality ---------------- */

  it('accepts a card matching the colour or the value, and rejects others', () => {
    const top: UnoCard = { id: 'top', color: 'red', value: '5' };
    expect(isPlayable({ id: 'a', color: 'red', value: '9' }, top, 'red')).toBe(true); // colour
    expect(isPlayable({ id: 'b', color: 'blue', value: '5' }, top, 'red')).toBe(true); // value
    expect(isPlayable({ id: 'c', color: 'wild', value: 'wild' }, top, 'red')).toBe(true); // wild
    expect(isPlayable({ id: 'd', color: 'blue', value: '9' }, top, 'red')).toBe(false);
  });

  it('plays a legal card and rejects an illegal one', () => {
    const playerId = current();
    setTop({ id: 'top', color: 'red', value: '5' }, 'red');
    setHand(playerId, [
      { id: 'good', color: 'red', value: '9' },
      { id: 'bad', color: 'blue', value: '2' },
    ]);

    expect(act(playerId, { type: 'play', payload: { cardId: 'bad' } }).accepted).toBe(false);
    expect(act(playerId, { type: 'play', payload: { cardId: 'good' } }).accepted).toBe(true);
    expect(topCard(state())!.id).toBe('good');
    expect(state().activeColor).toBe('red');
  });

  /* ---------------- anti-cheat ---------------- */

  it('rejects a card that is not in your hand, including an opponent card', () => {
    const [a, b] = players.map((player) => player.id);
    state().currentPlayerId = a;
    setTop({ id: 'top', color: 'red', value: '5' }, 'red');
    const opponentCard = state().players[b]!.hand[0] as UnoCard;

    // Another player's real card id must be refused.
    expect(act(a, { type: 'play', payload: { cardId: opponentCard.id } }).accepted).toBe(false);
    // A completely invented id too.
    expect(act(a, { type: 'play', payload: { cardId: 'not-a-real-card' } }).accepted).toBe(false);
    // The opponent still holds it.
    expect(state().players[b]!.hand.some((card) => card.id === opponentCard.id)).toBe(true);
  });

  it('rejects playing out of turn and after the game finishes', () => {
    const outsider = other();
    expect(act(outsider, { type: 'draw' }).accepted).toBe(false);

    const playerId = current();
    finishUno(state(), context(), 'completed');
    expect(act(playerId, { type: 'draw' }).accepted).toBe(false);
  });

  it('rejects malformed payloads and outcome-asserting actions', () => {
    const playerId = current();
    const ctx = context();
    for (const type of ['score', 'win', 'finish', 'complete', 'deck', 'draw-card', 'setHand']) {
      expect(unoGame.validateAction(playerId, { type, payload: { score: 9999 } }, state(), ctx).valid).toBe(false);
      expect(unoGame.handlePlayerAction(playerId, { type }, state(), ctx).accepted).toBe(false);
    }
    for (const cardId of [undefined, null, 42, {}]) {
      expect(unoGame.validateAction(playerId, { type: 'play', payload: { cardId } }, state(), ctx).valid).toBe(false);
    }
    // A client cannot invent a drawn card.
    expect(
      unoGame.validateAction(playerId, { type: 'draw', payload: { drawnCard: 'wild' } }, state(), ctx).valid,
    ).toBe(true); // the payload is simply ignored
    const before = state().players[playerId]!.hand.length;
    act(playerId, { type: 'draw', payload: { drawnCard: 'wild' } });
    // Exactly one real card was drawn from the server's pile.
    expect(state().players[playerId]!.hand.length).toBe(before + 1);
  });

  it('requires a valid colour when playing a wild', () => {
    const playerId = current();
    setTop({ id: 'top', color: 'red', value: '5' }, 'red');
    setHand(playerId, [{ id: 'w', color: 'wild', value: 'wild' }]);
    const ctx = context();

    expect(unoGame.validateAction(playerId, { type: 'play', payload: { cardId: 'w' } }, state(), ctx).valid).toBe(
      false,
    );
    expect(
      unoGame.validateAction(playerId, { type: 'play', payload: { cardId: 'w', color: 'purple' } }, state(), ctx).valid,
    ).toBe(false);
    expect(
      unoGame.validateAction(playerId, { type: 'play', payload: { cardId: 'w', color: 'green' } }, state(), ctx).valid,
    ).toBe(true);
  });

  /* ---------------- special cards ---------------- */

  it('wild sets the active colour', () => {
    const playerId = current();
    setTop({ id: 'top', color: 'red', value: '5' }, 'red');
    setHand(playerId, [
      { id: 'w', color: 'wild', value: 'wild' },
      { id: 'keep', color: 'red', value: '1' },
    ]);
    expect(act(playerId, { type: 'play', payload: { cardId: 'w', color: 'green' } }).accepted).toBe(true);
    expect(state().activeColor).toBe('green');
    expect(topCard(state())!.color).toBe('green');
  });

  it('skip makes the next player lose their turn (two players: play again)', () => {
    const [a, b] = players.map((player) => player.id);
    state().currentPlayerId = a;
    setTop({ id: 'top', color: 'red', value: '5' }, 'red');
    setHand(a, [
      { id: 's', color: 'red', value: 'skip' },
      { id: 'keep', color: 'red', value: '1' },
    ]);
    expect(act(a, { type: 'play', payload: { cardId: 's' } }).accepted).toBe(true);
    // With two seats a skip returns the turn to the same player.
    expect(state().currentPlayerId).toBe(a);
    expect(b).toBeTruthy();
  });

  it('reverse acts as a skip with two players (documented rule)', () => {
    const [a] = players.map((player) => player.id);
    state().currentPlayerId = a;
    setTop({ id: 'top', color: 'red', value: '5' }, 'red');
    setHand(a, [
      { id: 'r', color: 'red', value: 'reverse' },
      { id: 'keep', color: 'red', value: '1' },
    ]);
    expect(act(a, { type: 'play', payload: { cardId: 'r' } }).accepted).toBe(true);
    expect(state().currentPlayerId).toBe(a);
  });

  it('draw two forces the next player to take two cards and lose their turn', () => {
    const [a, b] = players.map((player) => player.id);
    state().currentPlayerId = a;
    setTop({ id: 'top', color: 'red', value: '5' }, 'red');
    setHand(a, [
      { id: 'd2', color: 'red', value: 'draw-two' },
      { id: 'keep', color: 'red', value: '1' },
    ]);
    const before = state().players[b]!.hand.length;

    expect(act(a, { type: 'play', payload: { cardId: 'd2' } }).accepted).toBe(true);
    expect(state().players[b]!.hand.length).toBe(before + 2);
    // Two players: the victim is skipped, so it returns to A.
    expect(state().currentPlayerId).toBe(a);
    expect(state().pendingDraw).toBe(0);
  });

  it('wild draw four forces four cards and sets the colour', () => {
    const [a, b] = players.map((player) => player.id);
    state().currentPlayerId = a;
    setTop({ id: 'top', color: 'red', value: '5' }, 'red');
    setHand(a, [
      { id: 'w4', color: 'wild', value: 'wild-draw-four' },
      { id: 'keep', color: 'red', value: '1' },
    ]);
    const before = state().players[b]!.hand.length;

    expect(act(a, { type: 'play', payload: { cardId: 'w4', color: 'blue' } }).accepted).toBe(true);
    expect(state().players[b]!.hand.length).toBe(before + 4);
    expect(state().activeColor).toBe('blue');
  });

  it('does NOT allow stacking a draw card on a draw card', () => {
    // The pending draw is always applied immediately in advanceTurn, so the
    // victim never gets a chance to counter — that is the documented ruleset.
    const [a, b] = players.map((player) => player.id);
    state().currentPlayerId = a;
    setTop({ id: 'top', color: 'red', value: '5' }, 'red');
    setHand(a, [
      { id: 'd2', color: 'red', value: 'draw-two' },
      { id: 'keep', color: 'red', value: '1' },
    ]);
    setHand(b, [{ id: 'counter', color: 'blue', value: 'draw-two' }]);

    act(a, { type: 'play', payload: { cardId: 'd2' } });
    // B was forced to draw rather than being offered a counter.
    expect(state().players[b]!.hand.length).toBe(3);
    expect(state().pendingDraw).toBe(0);
  });

  /* ---------------- drawing ---------------- */

  it('drawing an unplayable card ends the turn', () => {
    const [a, b] = players.map((player) => player.id);
    state().currentPlayerId = a;
    setTop({ id: 'top', color: 'red', value: '5' }, 'red');
    setHand(a, [{ id: 'nope', color: 'blue', value: '9' }]);
    // Stack the pile so the draw is definitely unplayable.
    state().drawPile = [{ id: 'drawn', color: 'green', value: '2' }];

    expect(act(a, { type: 'draw' }).accepted).toBe(true);
    expect(state().players[a]!.hand.some((card) => card.id === 'drawn')).toBe(true);
    expect(state().currentPlayerId).toBe(b); // turn passed
  });

  it('after drawing a playable card you may only play that card', () => {
    const playerId = current();
    setTop({ id: 'top', color: 'red', value: '5' }, 'red');
    setHand(playerId, [{ id: 'other', color: 'red', value: '1' }]);
    state().drawPile = [{ id: 'drawn', color: 'red', value: '3' }];

    act(playerId, { type: 'draw' });
    expect(state().drawnCardId).toBe('drawn');
    // The pre-existing card is now locked out.
    expect(act(playerId, { type: 'play', payload: { cardId: 'other' } }).accepted).toBe(false);
    expect(act(playerId, { type: 'play', payload: { cardId: 'drawn' } }).accepted).toBe(true);
  });

  it('reshuffles the discard pile when the draw pile is exhausted', () => {
    const playerId = current();
    const top: UnoCard = { id: 'top', color: 'red', value: '5' };
    state().drawPile = [];
    state().discardPile = [
      { id: 'old1', color: 'blue', value: '1' },
      { id: 'old2', color: 'green', value: '2' },
      top,
    ];
    const drawn = drawCards(state(), context(), playerId, 1);
    expect(drawn).toHaveLength(1);
    // The active top card stays in play and is never dealt out.
    expect(topCard(state())!.id).toBe('top');
    expect(drawn[0]!.id).not.toBe('top');
  });

  /* ---------------- winning and scoring ---------------- */

  it('emptying your hand wins the round and scores opponents cards', () => {
    const [a, b] = players.map((player) => player.id);
    state().currentPlayerId = a;
    setTop({ id: 'top', color: 'red', value: '5' }, 'red');
    setHand(a, [{ id: 'last', color: 'red', value: '9' }]);
    setHand(b, [
      { id: 'x', color: 'blue', value: '7' }, // 7
      { id: 'y', color: 'blue', value: 'skip' }, // 20
      { id: 'z', color: 'wild', value: 'wild' }, // 50
    ]);

    expect(act(a, { type: 'play', payload: { cardId: 'last' } }).accepted).toBe(true);
    expect(state().players[a]!.hand).toHaveLength(0);
    expect(state().roundWinnerId).toBe(a);
    expect(state().players[a]!.score).toBe(77);
    expect(state().players[a]!.roundsWon).toBe(1);
  });

  it('sets the UNO flag at one card', () => {
    const playerId = current();
    setTop({ id: 'top', color: 'red', value: '5' }, 'red');
    setHand(playerId, [
      { id: 'p', color: 'red', value: '1' },
      { id: 'q', color: 'red', value: '2' },
    ]);
    act(playerId, { type: 'play', payload: { cardId: 'p' } });
    expect(state().players[playerId]!.uno).toBe(true);
    expect(state().players[playerId]!.hand).toHaveLength(1);
  });

  it('computes hand points correctly', () => {
    expect(
      handPoints([
        { id: '1', color: 'red', value: '9' },
        { id: '2', color: 'red', value: 'draw-two' },
        { id: '3', color: 'wild', value: 'wild-draw-four' },
      ]),
    ).toBe(9 + 20 + 50);
  });

  it('finishes the match and ranks by score', () => {
    const [a, b] = players.map((player) => player.id);
    state().players[a]!.score = 240;
    state().players[b]!.score = 80;
    state().matchWinnerId = a;
    finishUno(state(), context(), 'completed');

    expect(unoGame.checkWinCondition(state())).toEqual([a]);
    const result = unoGame.getResult(state(), context());
    expect(result.winners).toEqual([a]);
    expect(result.rankings[0]!.playerId).toBe(a);
    expect(result.rankings[0]!.stats).toHaveProperty('roundsWon');
  });

  it('ends the round through endRound and advances or finishes', () => {
    const [a] = players.map((player) => player.id);
    state().totalRounds = 1;
    endRound(state(), context(), a);
    expect(state().phase).toBe('finished');
  });

  /* ---------------- lifecycle ---------------- */

  it('handles disconnect, reconnect and leave', () => {
    const [a] = players.map((player) => player.id);
    state().players[a]!.score = 42;
    const hand = state().players[a]!.hand.length;

    unoGame.playerLeft(a, state(), context(), 'disconnect');
    expect(state().players[a]!.disconnected).toBe(true);
    expect(act(a, { type: 'draw' }).accepted).toBe(false);

    unoGame.playerJoined({ ...players[0]! }, state(), context());
    expect(state().players[a]!.disconnected).toBe(false);
    expect(state().players[a]!.score).toBe(42);
    expect(state().players[a]!.hand).toHaveLength(hand);

    unoGame.playerLeft(a, state(), context(), 'leave');
    expect(state().phase).toBe('finished');
  });

  it('reset and cleanup prepare a rematch', () => {
    finishUno(state(), context(), 'completed');
    const next = unoGame.reset(state());
    expect(next.phase).toBe('idle');
    expect(next.round).toBe(0);
    expect(next.drawPile).toHaveLength(0);
    expect(Object.values(next.players).every((slot) => slot.hand.length === 0 && slot.score === 0)).toBe(true);

    unoGame.cleanup(next);
    expect(Object.keys(next.players)).toHaveLength(0);
  });

  /* ---------------- AI ---------------- */

  it('the AI only ever plays a legal card from its own hand', () => {
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const playerId = current();
      const action = unoGame.getAIMove?.(playerId, difficulty, state(), context());
      expect(action).not.toBeNull();
      expect(['play', 'draw', 'pass']).toContain(action!.type);
      if (action!.type === 'play') {
        const cardId = action!.payload!.cardId as string;
        expect(state().players[playerId]!.hand.some((card) => card.id === cardId)).toBe(true);
        expect(unoGame.validateAction(playerId, action!, state(), context()).valid).toBe(true);
      }
    }
  });

  it('the AI draws when it has nothing playable', () => {
    const playerId = current();
    setTop({ id: 'top', color: 'red', value: '5' }, 'red');
    setHand(playerId, [{ id: 'nope', color: 'blue', value: '9' }]);
    const action = unoGame.getAIMove?.(playerId, 'hard', state(), context());
    expect(action?.type).toBe('draw');
  });

  it('the AI chooses a colour it actually holds when playing a wild', () => {
    const playerId = current();
    setTop({ id: 'top', color: 'red', value: '5' }, 'red');
    setHand(playerId, [
      { id: 'w', color: 'wild', value: 'wild' },
      { id: 'g1', color: 'green', value: '1' },
      { id: 'g2', color: 'green', value: '2' },
      { id: 'g3', color: 'green', value: '3' },
    ]);
    // With only the wild legal it must pick it, and green is the majority.
    state().activeColor = 'red';
    const action = unoGame.getAIMove?.(playerId, 'hard', state(), context());
    if (action?.type === 'play' && action.payload?.color) {
      expect(action.payload.color).toBe('green');
    }
  });

  it('an AI vs AI round always terminates with a winner', () => {
    let guard = 0;
    while (state().phase === 'playing' && guard < 2000) {
      guard += 1;
      const mover = current();
      const action = unoGame.getAIMove?.(mover, 'hard', state(), context());
      if (!action) break;
      const result = act(mover, action);
      // Every AI action must survive the same validation a human faces.
      if (!result.accepted && action.type === 'play') {
        throw new Error(`AI produced an illegal play: ${JSON.stringify(action)}`);
      }
    }
    expect(guard).toBeLessThan(2000);
    expect(['round-over', 'finished']).toContain(state().phase);
    expect(state().roundWinnerId).toBeTruthy();
  });

  /* ---------------- player counts ---------------- */

  it('supports three and four player matches', async () => {
    for (const count of [3, 4] as const) {
      const local = createTestPlatform();
      const ids = [];
      for (let i = 0; i < count; i += 1) ids.push(await createPlayer(local.platform, `Un${count}${i}`));
      const extra = local.platform.roomManager.createRoom({
        gameId: 'uno',
        maxPlayers: count,
        isPrivate: false,
        host: ids[0]!,
      });
      for (let i = 1; i < count; i += 1) {
        local.platform.roomManager.joinRoom({ roomId: extra.id, player: ids[i]! });
      }
      extra.status = 'PLAYING';
      extra.gameStartedAt = Date.now();
      local.platform.gameManager.createState(extra);
      local.platform.gameManager.start(extra);

      const s = extra.gameState as UnoState;
      expect(Object.keys(s.players)).toHaveLength(count);
      // Everyone is dealt a full starting hand. The opening card's effect is
      // applied immediately, so a `draw-two` opener legitimately leaves the
      // first player holding two extra cards (official rule). Asserting exact
      // equality here is seed-dependent and fails on roughly one deal in ten.
      const handSizes = Object.values(s.players).map((slot) => slot.hand.length);
      expect(handSizes.every((size) => size >= STARTING_HAND)).toBe(true);
      // Only the opening card's effect can add cards, and only to one player.
      expect(handSizes.filter((size) => size > STARTING_HAND).length).toBeLessThanOrEqual(1);
      local.destroy();
    }
  });
});
