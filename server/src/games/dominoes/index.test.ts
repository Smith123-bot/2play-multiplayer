import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createPlayer, createTestPlatform, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  buildTileSet,
  canPlace,
  dominoesGame,
  drawUntilPlayable,
  finishDominoes,
  handPips,
  handSizeFor,
  hasPlayableTile,
  isDouble,
  openEnds,
  orientFor,
  passTurn,
  pipsOf,
  shuffle,
  type DominoState,
  type DominoTile,
} from './index';
import type { Room } from '../../rooms/Room';

describe('Dominoes', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'dominoes');
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as DominoState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const act = (playerId: string, action: { type: string; payload?: Record<string, unknown> }) =>
    platform.gameManager.handleAction(room, playerId, action);
  const current = () => state().currentPlayerId as string;
  const other = () => players.map((p) => p.id).find((id) => id !== current()) as string;
  const setHand = (playerId: string, hand: DominoTile[]) => {
    state().players[playerId]!.hand = hand;
  };
  const tile = (a: number, b: number): DominoTile => ({ id: `t${a}${b}`, a, b });

  /* ---------------- tile set ---------------- */

  it('builds the complete double-six set: 28 unique tiles', () => {
    const tiles = buildTileSet();
    expect(tiles).toHaveLength(28);
    expect(new Set(tiles.map((entry) => entry.id)).size).toBe(28);
    // Every combination a<=b from 0..6 appears exactly once.
    for (let a = 0; a <= 6; a += 1) {
      for (let b = a; b <= 6; b += 1) {
        expect(tiles.filter((entry) => entry.a === a && entry.b === b)).toHaveLength(1);
      }
    }
    // Seven doubles, and 168 total pips in the set.
    expect(tiles.filter(isDouble)).toHaveLength(7);
    expect(tiles.reduce((total, entry) => total + pipsOf(entry), 0)).toBe(168);
  });

  it('shuffles deterministically from a seed', () => {
    const tiles = buildTileSet();
    const seeded = (seed: number) => {
      let value = seed;
      return () => {
        value = (value * 1103515245 + 12345) % 2147483648;
        return value / 2147483648;
      };
    };
    expect(shuffle(tiles, seeded(3)).map((entry) => entry.id)).toEqual(
      shuffle(tiles, seeded(3)).map((entry) => entry.id),
    );
    expect(shuffle(tiles, seeded(3)).map((entry) => entry.id)).not.toEqual(tiles.map((entry) => entry.id));
  });

  it('uses the documented hand sizes', () => {
    expect(handSizeFor(2)).toBe(7);
    expect(handSizeFor(3)).toBe(5);
    expect(handSizeFor(4)).toBe(5);
  });

  /* ---------------- dealing ---------------- */

  it('deals seven tiles each to two players and keeps the rest as boneyard', () => {
    expect(state().phase).toBe('playing');
    for (const player of players) {
      expect(state().players[player.id]!.hand).toHaveLength(7);
    }
    // 28 - 14 dealt = 14 in the boneyard.
    expect(state().boneyard).toHaveLength(14);
    expect(state().turnEndsAt).toBeGreaterThan(context().now());
  });

  it('never deals the same tile twice', () => {
    const hands = Object.values(state().players).flatMap((slot) => slot.hand.map((entry) => entry.id));
    const bone = state().boneyard.map((entry) => entry.id);
    const all = [...hands, ...bone];
    expect(all).toHaveLength(28);
    expect(new Set(all).size).toBe(28);
  });

  it('the opener holds the highest double (or the heaviest tile)', () => {
    const opener = state().players[current()]!;
    const doubles = Object.values(state().players).flatMap((slot) => slot.hand.filter(isDouble));
    if (doubles.length > 0) {
      const highest = Math.max(...doubles.map((entry) => entry.a));
      expect(opener.hand.some((entry) => isDouble(entry) && entry.a === highest)).toBe(true);
    }
  });

  /* ---------------- hidden information ---------------- */

  it('never reveals another player hand or the boneyard contents', () => {
    const [a, b] = players.map((player) => player.id);
    const view = platform.gameManager.getPublicState(room, a) as Record<string, unknown> & {
      myHand: DominoTile[];
      boneyardCount: number;
      players: Record<string, { tileCount: number }>;
    };
    expect(view.myHand.map((entry) => entry.id).sort()).toEqual(
      state().players[a]!.hand.map((entry) => entry.id).sort(),
    );
    expect(view.players[b]!.tileCount).toBe(7);
    expect((view.players[b] as unknown as { hand?: unknown }).hand).toBeUndefined();
    expect(view.boneyardCount).toBe(state().boneyard.length);
    expect(view.boneyard).toBeUndefined();

    // None of B's tile ids may appear in A's payload.
    const json = JSON.stringify(view);
    const mine = new Set(state().players[a]!.hand.map((entry) => entry.id));
    for (const entry of state().players[b]!.hand) {
      if (mine.has(entry.id)) continue;
      expect(json).not.toContain(`"${entry.id}"`);
    }
  });

  /* ---------------- placement ---------------- */

  it('reports open ends and matches tiles to them', () => {
    state().chain = [{ id: 't34', left: 3, right: 4, playedBy: 'x', flipped: false }];
    expect(openEnds(state())).toEqual({ left: 3, right: 4 });
    expect(canPlace(state(), tile(3, 5), 'left')).toBe(true);
    expect(canPlace(state(), tile(4, 6), 'right')).toBe(true);
    expect(canPlace(state(), tile(1, 2), 'left')).toBe(false);
    expect(canPlace(state(), tile(1, 2), 'right')).toBe(false);
  });

  it('rotates a tile automatically so the matching half touches the chain', () => {
    state().chain = [{ id: 't34', left: 3, right: 4, playedBy: 'x', flipped: false }];
    // 5|4 on the right must flip to 4|5.
    const right = orientFor(state(), tile(4, 5), 'right');
    expect(right).toEqual({ left: 4, right: 5, flipped: false });
    const rightFlipped = orientFor(state(), { id: 'z', a: 5, b: 4 }, 'right');
    expect(rightFlipped).toEqual({ left: 4, right: 5, flipped: true });
    // On the left the tile's RIGHT half must match 3.
    const left = orientFor(state(), { id: 'y', a: 6, b: 3 }, 'left');
    expect(left).toEqual({ left: 6, right: 3, flipped: false });
    const leftFlipped = orientFor(state(), { id: 'w', a: 3, b: 6 }, 'left');
    expect(leftFlipped).toEqual({ left: 6, right: 3, flipped: true });
    // A non-matching tile returns null rather than being forced.
    expect(orientFor(state(), tile(1, 2), 'left')).toBeNull();
  });

  it('places a legal tile and extends the chain on the chosen end', () => {
    const playerId = current();
    state().chain = [{ id: 't34', left: 3, right: 4, playedBy: 'x', flipped: false }];
    setHand(playerId, [tile(4, 5), tile(0, 1)]);

    expect(act(playerId, { type: 'place', payload: { tileId: 't45', end: 'right' } }).accepted).toBe(true);
    expect(state().chain).toHaveLength(2);
    expect(openEnds(state())).toEqual({ left: 3, right: 5 });
    expect(state().players[playerId]!.tilesPlayed).toBe(1);
  });

  it('rejects a tile that does not match the chosen end', () => {
    const playerId = current();
    state().chain = [{ id: 't34', left: 3, right: 4, playedBy: 'x', flipped: false }];
    setHand(playerId, [tile(1, 2)]);
    expect(act(playerId, { type: 'place', payload: { tileId: 't12', end: 'right' } }).accepted).toBe(false);
    expect(state().chain).toHaveLength(1);
  });

  /* ---------------- anti-cheat ---------------- */

  it('rejects a tile that is not in your hand, including an opponent tile', () => {
    const [a, b] = players.map((player) => player.id);
    state().currentPlayerId = a;
    state().chain = [{ id: 't34', left: 3, right: 4, playedBy: 'x', flipped: false }];
    const opponentTile = state().players[b]!.hand[0] as DominoTile;

    expect(act(a, { type: 'place', payload: { tileId: opponentTile.id, end: 'right' } }).accepted).toBe(false);
    expect(act(a, { type: 'place', payload: { tileId: 'made-up-tile', end: 'right' } }).accepted).toBe(false);
    expect(state().players[b]!.hand.some((entry) => entry.id === opponentTile.id)).toBe(true);
  });

  it('rejects out of turn play, malformed payloads and outcome-asserting actions', () => {
    const ctx = context();
    expect(act(other(), { type: 'draw' }).accepted).toBe(false);

    const playerId = current();
    for (const type of ['score', 'win', 'finish', 'complete', 'boneyard', 'setHand', 'draw-tile']) {
      expect(dominoesGame.validateAction(playerId, { type, payload: { score: 999 } }, state(), ctx).valid).toBe(
        false,
      );
      expect(dominoesGame.handlePlayerAction(playerId, { type }, state(), ctx).accepted).toBe(false);
    }
    for (const payload of [{}, { tileId: 5, end: 'right' }, { tileId: 't01', end: 'middle' }, { tileId: 't01' }]) {
      expect(dominoesGame.validateAction(playerId, { type: 'place', payload }, state(), ctx).valid).toBe(false);
    }
  });

  it('rejects everything once the hand is over', () => {
    const playerId = current();
    finishDominoes(state(), context(), 'completed');
    expect(act(playerId, { type: 'draw' }).accepted).toBe(false);
    expect(act(playerId, { type: 'place', payload: { tileId: 't01', end: 'right' } }).accepted).toBe(false);
  });

  /* ---------------- drawing and passing ---------------- */

  it('draws until a playable tile appears', () => {
    const playerId = current();
    state().chain = [{ id: 't34', left: 3, right: 4, playedBy: 'x', flipped: false }];
    setHand(playerId, [tile(0, 1)]); // nothing matches 3 or 4
    state().boneyard = [tile(4, 6), tile(0, 2), tile(1, 5)]; // popped from the end

    expect(hasPlayableTile(state(), playerId)).toBe(false);
    const drawn = drawUntilPlayable(state(), playerId);
    expect(drawn.length).toBeGreaterThan(0);
    expect(hasPlayableTile(state(), playerId)).toBe(true);
  });

  it('refuses to draw when you already have a legal tile', () => {
    const playerId = current();
    state().chain = [{ id: 't34', left: 3, right: 4, playedBy: 'x', flipped: false }];
    setHand(playerId, [tile(4, 5)]);
    expect(act(playerId, { type: 'draw' }).accepted).toBe(false);
  });

  it('refuses to pass while the boneyard still has tiles', () => {
    const playerId = current();
    state().chain = [{ id: 't34', left: 3, right: 4, playedBy: 'x', flipped: false }];
    setHand(playerId, [tile(0, 1)]);
    state().boneyard = [tile(6, 6)];
    expect(act(playerId, { type: 'pass' }).accepted).toBe(false);
  });

  it('allows a pass only with no legal tile and an empty boneyard', () => {
    const playerId = current();
    state().chain = [{ id: 't34', left: 3, right: 4, playedBy: 'x', flipped: false }];
    setHand(playerId, [tile(0, 1)]);
    state().boneyard = [];
    expect(act(playerId, { type: 'pass' }).accepted).toBe(true);
    expect(state().players[playerId]!.passes).toBe(1);
  });

  /* ---------------- winning ---------------- */

  it('emptying your hand wins and scores the opponents pips', () => {
    const [a, b] = players.map((player) => player.id);
    state().currentPlayerId = a;
    state().chain = [{ id: 't34', left: 3, right: 4, playedBy: 'x', flipped: false }];
    setHand(a, [tile(4, 5)]);
    setHand(b, [tile(6, 6), tile(2, 3)]); // 12 + 5 = 17 pips

    expect(act(a, { type: 'place', payload: { tileId: 't45', end: 'right' } }).accepted).toBe(true);
    expect(state().players[a]!.hand).toHaveLength(0);
    expect(state().phase).toBe('finished');
    expect(state().winnerId).toBe(a);
    expect(state().players[a]!.score).toBe(17);
    expect(state().players[a]!.handsWon).toBe(1);
    expect(dominoesGame.checkWinCondition(state())).toEqual([a]);
  });

  it('computes hand pips correctly', () => {
    expect(handPips([tile(6, 6), tile(0, 0), tile(3, 4)])).toBe(12 + 0 + 7);
  });

  /* ---------------- blocked game ---------------- */

  it('a blocked game is won by the lowest pip count', () => {
    const [a, b] = players.map((player) => player.id);
    state().chain = [{ id: 't34', left: 3, right: 4, playedBy: 'x', flipped: false }];
    state().boneyard = [];
    setHand(a, [tile(0, 1)]); // 1 pip
    setHand(b, [tile(6, 6)]); // 12 pips
    state().currentPlayerId = a;

    // Both players pass in turn, which blocks the game.
    passTurn(state(), context(), a);
    passTurn(state(), context(), b);

    expect(state().blocked).toBe(true);
    expect(state().phase).toBe('finished');
    expect(state().winnerId).toBe(a);
    // The winner scores the difference: 12 - 1 = 11.
    expect(state().players[a]!.score).toBe(11);
  });

  it('an exact pip tie in a blocked game is a draw', () => {
    const [a, b] = players.map((player) => player.id);
    state().chain = [{ id: 't34', left: 3, right: 4, playedBy: 'x', flipped: false }];
    state().boneyard = [];
    setHand(a, [tile(2, 3)]); // 5 pips
    setHand(b, [tile(1, 4)]); // 5 pips
    state().currentPlayerId = a;

    passTurn(state(), context(), a);
    passTurn(state(), context(), b);

    expect(state().blocked).toBe(true);
    expect(state().isDraw).toBe(true);
    expect(state().winnerId).toBeNull();
    expect(dominoesGame.checkDrawCondition(state())).toBe(true);
    expect(dominoesGame.getResult(state(), context()).isDraw).toBe(true);
  });

  /* ---------------- lifecycle ---------------- */

  it('handles disconnect, reconnect and leave', () => {
    const [a] = players.map((player) => player.id);
    state().players[a]!.score = 30;
    const hand = state().players[a]!.hand.length;

    dominoesGame.playerLeft(a, state(), context(), 'disconnect');
    expect(state().players[a]!.disconnected).toBe(true);
    expect(act(a, { type: 'draw' }).accepted).toBe(false);

    dominoesGame.playerJoined({ ...players[0]! }, state(), context());
    expect(state().players[a]!.disconnected).toBe(false);
    expect(state().players[a]!.score).toBe(30);
    expect(state().players[a]!.hand).toHaveLength(hand);

    dominoesGame.playerLeft(a, state(), context(), 'leave');
    expect(state().phase).toBe('finished');
  });

  it('reset and cleanup prepare a rematch', () => {
    finishDominoes(state(), context(), 'completed');
    const next = dominoesGame.reset(state());
    expect(next.phase).toBe('idle');
    expect(next.chain).toHaveLength(0);
    expect(next.boneyard).toHaveLength(0);
    expect(Object.values(next.players).every((slot) => slot.hand.length === 0 && slot.score === 0)).toBe(true);

    dominoesGame.cleanup(next);
    expect(Object.keys(next.players)).toHaveLength(0);
  });

  /* ---------------- AI ---------------- */

  it('the AI only plays tiles from its own hand onto a matching end', () => {
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const mover = current();
      const action = dominoesGame.getAIMove?.(mover, difficulty, state(), context());
      expect(action).not.toBeNull();
      expect(['place', 'draw', 'pass']).toContain(action!.type);
      if (action!.type === 'place') {
        const tileId = action!.payload!.tileId as string;
        expect(state().players[mover]!.hand.some((entry) => entry.id === tileId)).toBe(true);
        expect(dominoesGame.validateAction(mover, action!, state(), context()).valid).toBe(true);
      }
    }
  });

  it('the AI draws when nothing fits and the boneyard has tiles', () => {
    const playerId = current();
    state().chain = [{ id: 't34', left: 3, right: 4, playedBy: 'x', flipped: false }];
    setHand(playerId, [tile(0, 1)]);
    state().boneyard = [tile(5, 5)];
    expect(dominoesGame.getAIMove?.(playerId, 'hard', state(), context())?.type).toBe('draw');
  });

  it('the AI passes when nothing fits and the boneyard is empty', () => {
    const playerId = current();
    state().chain = [{ id: 't34', left: 3, right: 4, playedBy: 'x', flipped: false }];
    setHand(playerId, [tile(0, 1)]);
    state().boneyard = [];
    expect(dominoesGame.getAIMove?.(playerId, 'hard', state(), context())?.type).toBe('pass');
  });

  it('an AI vs AI hand always terminates with a winner or a blocked result', () => {
    let guard = 0;
    while (state().phase === 'playing' && guard < 300) {
      guard += 1;
      const mover = current();
      const action = dominoesGame.getAIMove?.(mover, 'hard', state(), context());
      if (!action) break;
      const result = act(mover, action);
      if (!result.accepted && action.type === 'place') {
        throw new Error(`AI produced an illegal placement: ${JSON.stringify(action)}`);
      }
    }
    expect(guard).toBeLessThan(300);
    expect(state().phase).toBe('finished');
    // Either someone went out, or the hand blocked and was scored.
    expect(state().winnerId !== null || state().isDraw).toBe(true);
    // Every chain link must genuinely match its neighbour.
    for (let i = 1; i < state().chain.length; i += 1) {
      expect(state().chain[i]!.left).toBe(state().chain[i - 1]!.right);
    }
  });

  it('the AI refuses to act out of turn or after the hand ends', () => {
    expect(dominoesGame.getAIMove?.(other(), 'hard', state(), context())).toBeNull();
    finishDominoes(state(), context(), 'completed');
    expect(dominoesGame.getAIMove?.(players[0]!.id, 'hard', state(), context())).toBeNull();
  });

  /* ---------------- player counts ---------------- */

  it('supports three and four player hands with five tiles each', async () => {
    for (const count of [3, 4] as const) {
      const local = createTestPlatform();
      const ids = [];
      for (let i = 0; i < count; i += 1) ids.push(await createPlayer(local.platform, `Dm${count}${i}`));
      const extra = local.platform.roomManager.createRoom({
        gameId: 'dominoes',
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

      const s = extra.gameState as DominoState;
      expect(Object.keys(s.players)).toHaveLength(count);
      expect(Object.values(s.players).every((slot) => slot.hand.length === 5)).toBe(true);
      expect(s.boneyard).toHaveLength(28 - 5 * count);
      local.destroy();
    }
  });
});
