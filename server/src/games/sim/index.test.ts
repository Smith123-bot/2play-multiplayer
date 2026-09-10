import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createTestPlatform, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  buildEdges,
  edgeKey,
  edgesOf,
  findEdge,
  findTriangle,
  finishSim,
  freeEdges,
  simGame,
  SIM_NODES,
  wouldFormTriangle,
  type SimState,
} from './index';
import type { Room } from '../../rooms/Room';

describe('Sim', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'sim');
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as SimState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const claim = (playerId: string, edgeId: string) =>
    platform.gameManager.handleAction(room, playerId, { type: 'claim', payload: { edgeId } });
  const current = () => state().currentPlayerId as string;
  const other = () => players.map((p) => p.id).find((id) => id !== current()) as string;
  /** Assigns an edge directly, for detection tests. */
  const own = (edgeId: string, playerId: string) => {
    const edge = findEdge(state(), edgeId);
    if (edge) edge.owner = playerId;
  };

  /* ---------------- board ---------------- */

  it('builds the complete graph K6: 6 nodes and 15 unique edges', () => {
    expect(SIM_NODES).toBe(6);
    expect(state().nodes).toBe(6);
    expect(state().edges).toHaveLength(15);
    expect(new Set(state().edges.map((edge) => edge.id)).size).toBe(15);
    // Every pair of distinct nodes appears exactly once.
    for (let a = 0; a < 6; a += 1) {
      for (let b = a + 1; b < 6; b += 1) {
        expect(state().edges.some((edge) => edge.id === edgeKey(a, b))).toBe(true);
      }
    }
    expect(state().edges.every((edge) => edge.owner === null)).toBe(true);
    expect(state().phase).toBe('playing');
    expect(state().turnEndsAt).toBeGreaterThan(context().now());
  });

  it('edgeKey is order independent', () => {
    expect(edgeKey(2, 4)).toBe(edgeKey(4, 2));
    expect(edgeKey(0, 5)).toBe('e05');
  });

  /* ---------------- claiming ---------------- */

  it('claims an edge and assigns ownership', () => {
    const playerId = current();
    expect(claim(playerId, 'e01').accepted).toBe(true);
    expect(findEdge(state(), 'e01')!.owner).toBe(playerId);
    expect(state().players[playerId]!.edges).toBe(1);
    expect(state().moves).toBe(1);
    expect(edgesOf(state(), playerId)).toHaveLength(1);
  });

  it('alternates turns after each claim', () => {
    const first = current();
    claim(first, 'e01');
    expect(state().currentPlayerId).not.toBe(first);
    const second = current();
    claim(second, 'e02');
    expect(state().currentPlayerId).toBe(first);
  });

  it('rejects an occupied edge, a bad edge id, and out of turn play', () => {
    const playerId = current();
    claim(playerId, 'e01');
    // Already taken.
    expect(claim(current(), 'e01').accepted).toBe(false);
    // Out of turn: the player who just moved cannot move again.
    expect(claim(playerId, 'e23').accepted).toBe(false);
    // Nonexistent edges.
    const ctx = context();
    for (const edgeId of ['e99', 'e00', 'nonsense', '']) {
      expect(simGame.validateAction(current(), { type: 'claim', payload: { edgeId } }, state(), ctx).valid).toBe(
        false,
      );
    }
  });

  it('rejects malformed payloads and outcome-asserting actions', () => {
    const playerId = current();
    const ctx = context();
    for (const type of ['score', 'win', 'finish', 'complete', 'board', 'triangle']) {
      expect(simGame.validateAction(playerId, { type, payload: { score: 999 } }, state(), ctx).valid).toBe(false);
      expect(simGame.handlePlayerAction(playerId, { type }, state(), ctx).accepted).toBe(false);
    }
    for (const edgeId of [undefined, null, 42, {}]) {
      expect(simGame.validateAction(playerId, { type: 'claim', payload: { edgeId } }, state(), ctx).valid).toBe(
        false,
      );
    }
  });

  it('rejects everything once the game is over', () => {
    const playerId = current();
    finishSim(state(), context(), 'completed');
    expect(claim(playerId, 'e01').accepted).toBe(false);
  });

  /* ---------------- triangle detection ---------------- */

  it('detects a triangle in one colour', () => {
    const playerId = current();
    own('e01', playerId);
    own('e12', playerId);
    own('e02', playerId);
    const triangle = findTriangle(state(), playerId);
    expect(triangle).not.toBeNull();
    expect(triangle).toHaveLength(3);
    expect(new Set(triangle!)).toEqual(new Set(['e01', 'e12', 'e02']));
  });

  it('does NOT count a mixed-colour triangle', () => {
    const [a, b] = players.map((player) => player.id);
    own('e01', a);
    own('e12', b); // the opponent owns the middle edge
    own('e02', a);
    expect(findTriangle(state(), a)).toBeNull();
    expect(findTriangle(state(), b)).toBeNull();
  });

  it('does not report a triangle for only two edges', () => {
    const playerId = current();
    own('e01', playerId);
    own('e12', playerId);
    expect(findTriangle(state(), playerId)).toBeNull();
  });

  it('detects every one of the 20 possible node triples', () => {
    const playerId = current();
    let detected = 0;
    for (let a = 0; a < 6; a += 1) {
      for (let b = a + 1; b < 6; b += 1) {
        for (let c = b + 1; c < 6; c += 1) {
          state().edges = buildEdges();
          own(edgeKey(a, b), playerId);
          own(edgeKey(b, c), playerId);
          own(edgeKey(a, c), playerId);
          if (findTriangle(state(), playerId)) detected += 1;
        }
      }
    }
    expect(detected).toBe(20);
  });

  it('wouldFormTriangle predicts the losing move', () => {
    const playerId = current();
    own('e01', playerId);
    own('e12', playerId);
    expect(wouldFormTriangle(state(), playerId, 'e02')).toBe(true);
    expect(wouldFormTriangle(state(), playerId, 'e34')).toBe(false);
    // An occupied edge is never a candidate.
    own('e02', playerId);
    expect(wouldFormTriangle(state(), playerId, 'e02')).toBe(false);
  });

  /* ---------------- the losing condition ---------------- */

  it('completing YOUR OWN triangle LOSES the game', () => {
    const [a, b] = players.map((player) => player.id);
    state().currentPlayerId = a;
    own('e01', a);
    own('e12', a);
    // Give the opponent unrelated edges so the board is realistic.
    own('e34', b);
    own('e45', b);

    expect(claim(a, 'e02').accepted).toBe(true);
    expect(state().phase).toBe('finished');
    // The player who built the triangle is the LOSER.
    expect(state().loserId).toBe(a);
    expect(state().winnerId).toBe(b);
    expect(state().losingTriangle).toHaveLength(3);
    expect(simGame.checkWinCondition(state())).toEqual([b]);
    expect(simGame.calculateScore(b, state())).toBe(100);
    expect(simGame.calculateScore(a, state())).toBe(0);
  });

  it('reports the losing triangle and the causer in the result', () => {
    const [a, b] = players.map((player) => player.id);
    state().currentPlayerId = a;
    own('e01', a);
    own('e12', a);
    claim(a, 'e02');

    const result = simGame.getResult(state(), context());
    expect(result.winners).toEqual([b]);
    expect(result.isDraw).toBe(false);
    const loserRanking = result.rankings.find((entry) => entry.playerId === a);
    expect(loserRanking!.stats!.trianglesCaused).toBe(1);
    const winnerRanking = result.rankings.find((entry) => entry.playerId === b);
    expect(winnerRanking!.stats!.trianglesCaused).toBe(0);
    expect(winnerRanking!.isWinner).toBe(true);
  });

  it('a safe move does not end the game', () => {
    const playerId = current();
    own('e01', playerId);
    expect(claim(playerId, 'e23').accepted).toBe(true);
    expect(state().phase).toBe('playing');
    expect(state().loserId).toBeNull();
  });

  /* ---------------- game completion ---------------- */

  it('a real game always produces a loser (Ramsey R(3,3)=6)', () => {
    // Play out many AI games; a filled K6 board cannot avoid a mono triangle.
    for (let game = 0; game < 5; game += 1) {
      const local = createTestPlatform();
      // Reuse this room by resetting instead of building a new fixture.
      state().edges = buildEdges();
      state().phase = 'playing';
      state().loserId = null;
      state().winnerId = null;
      state().isDraw = false;
      state().moves = 0;
      state().currentPlayerId = players[0]!.id;
      for (const player of players) state().players[player.id]!.edges = 0;

      let guard = 0;
      while (state().phase === 'playing' && guard < 30) {
        guard += 1;
        const mover = current();
        const action = simGame.getAIMove?.(mover, 'easy', state(), context());
        if (!action) break;
        platform.gameManager.handleAction(room, mover, action);
      }
      expect(state().phase).toBe('finished');
      // Someone must have built a triangle; a draw is mathematically impossible.
      expect(state().loserId).not.toBeNull();
      expect(state().isDraw).toBe(false);
      local.destroy();
    }
  });

  it('never leaves more than 15 edges claimed', () => {
    let guard = 0;
    while (state().phase === 'playing' && guard < 30) {
      guard += 1;
      const mover = current();
      const action = simGame.getAIMove?.(mover, 'medium', state(), context());
      if (!action) break;
      platform.gameManager.handleAction(room, mover, action);
    }
    const claimed = state().edges.filter((edge) => edge.owner !== null).length;
    expect(claimed).toBeLessThanOrEqual(15);
    expect(freeEdges(state()).length).toBe(15 - claimed);
  });

  /* ---------------- lifecycle ---------------- */

  it('handles disconnect, reconnect and leave', () => {
    const [a, b] = players.map((player) => player.id);
    claim(current(), 'e01');

    simGame.playerLeft(a, state(), context(), 'disconnect');
    expect(state().players[a]!.disconnected).toBe(true);

    simGame.playerJoined({ ...players[0]! }, state(), context());
    expect(state().players[a]!.disconnected).toBe(false);
    expect(state().players[a]!.seat).toBe(0);

    simGame.playerLeft(a, state(), context(), 'leave');
    expect(state().phase).toBe('finished');
    expect(state().winnerId).toBe(b);
    expect(state().finishReason).toBe('forfeit');
  });

  it('reset and cleanup prepare a rematch', () => {
    claim(current(), 'e01');
    finishSim(state(), context(), 'completed');
    const next = simGame.reset(state());
    expect(next.phase).toBe('idle');
    expect(next.edges).toHaveLength(15);
    expect(next.edges.every((edge) => edge.owner === null)).toBe(true);
    expect(next.moves).toBe(0);
    expect(next.losingTriangle).toHaveLength(0);

    simGame.cleanup(next);
    expect(Object.keys(next.players)).toHaveLength(0);
    expect(next.edges).toHaveLength(0);
  });

  /* ---------------- AI ---------------- */

  it('the AI only claims free edges', () => {
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const mover = current();
      const action = simGame.getAIMove?.(mover, difficulty, state(), context());
      expect(action?.type).toBe('claim');
      const edgeId = action!.payload!.edgeId as string;
      expect(findEdge(state(), edgeId)!.owner).toBeNull();
      expect(simGame.validateAction(mover, action!, state(), context()).valid).toBe(true);
    }
  });

  it('the AI avoids completing its own triangle when a safe edge exists', () => {
    const playerId = current();
    own('e01', playerId);
    own('e12', playerId);
    // e02 would lose; plenty of safe edges remain.
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const action = simGame.getAIMove?.(playerId, difficulty, state(), context());
      expect(action!.payload!.edgeId).not.toBe('e02');
      expect(wouldFormTriangle(state(), playerId, action!.payload!.edgeId as string)).toBe(false);
    }
  });

  it('the AI refuses to act out of turn or after the game ends', () => {
    expect(simGame.getAIMove?.(other(), 'hard', state(), context())).toBeNull();
    finishSim(state(), context(), 'completed');
    expect(simGame.getAIMove?.(players[0]!.id, 'hard', state(), context())).toBeNull();
  });

  /* ---------------- public state ---------------- */

  it('publishes the full graph (perfect information)', () => {
    const view = platform.gameManager.getPublicState(room, players[0]!.id) as {
      edges: Array<{ id: string; owner: string | null }>;
      nodes: number;
      isMyTurn: boolean;
      mySeat: number;
    };
    expect(view.nodes).toBe(6);
    expect(view.edges).toHaveLength(15);
    expect(view.isMyTurn).toBe(true);
    expect(view.mySeat).toBe(0);
  });
});
