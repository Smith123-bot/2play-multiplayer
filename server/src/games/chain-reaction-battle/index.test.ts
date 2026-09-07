import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createPlayer, createTestPlatform, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  chainReactionGame,
  closeChainRound,
  dealBoard,
  evaluateChain,
  finishChain,
  scoreChain,
  type ChainNode,
  type ChainState,
} from './index';
import type { Room } from '../../rooms/Room';

describe('Chain Reaction Battle', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'chain-reaction-battle', { settings: { rounds: 4 } });
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as ChainState;
  const context = (): GameContext => platform.gameManager.getContext(room);

  async function startWithPlayers(count: 3 | 4): Promise<void> {
    const local = createTestPlatform();
    const ids = [];
    for (let i = 0; i < count; i += 1) ids.push(await createPlayer(local.platform, `Cr${count}${i}`));
    const extra = local.platform.roomManager.createRoom({
      gameId: 'chain-reaction-battle',
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

  it('deals a live board, two triggers each, and a round clock', () => {
    expect(state().phase).toBe('playing');
    expect(state().nodes.length).toBe(30);
    expect(state().totalRounds).toBe(4);
    expect(state().players[players[0]!.id]!.triggersLeft).toBe(2);
    expect(state().endsAt).toBeGreaterThan(context().now());
    expect(dealBoard(1).map((node) => node.kind)).not.toEqual(dealBoard(2).map((node) => node.kind));
  });

  it('evaluates same-colour chains, skips blockers, and scores multipliers on the server', () => {
    const nodes: ChainNode[] = [
      { id: '0,0', x: 0, y: 0, color: 1, kind: 'normal', alive: true },
      { id: '1,0', x: 1, y: 0, color: 1, kind: 'bonus', alive: true },
      { id: '2,0', x: 2, y: 0, color: 1, kind: 'multiplier', alive: true },
      { id: '3,0', x: 3, y: 0, color: 1, kind: 'blocker', alive: true },
      { id: '0,1', x: 0, y: 1, color: 2, kind: 'normal', alive: true },
    ];
    const chain = evaluateChain(nodes, '0,0');
    expect(chain.map((node) => node.id)).toEqual(['0,0', '1,0', '2,0']);
    expect(evaluateChain(nodes, '3,0')).toHaveLength(0);
    expect(scoreChain(chain)).toBe(3 * 10 * 2 + 15);
  });

  it('accepts TRIGGER_NODE, ignores client-owned chain length, and spends a trigger', () => {
    const playerId = players[0]!.id;
    const spark = state().nodes.find((node) => node.alive && node.kind !== 'blocker')!;
    const before = state().players[playerId]!.triggersLeft;
    const result = platform.gameManager.handleAction(room, playerId, {
      type: 'TRIGGER_NODE',
      payload: { nodeId: spark.id },
    });
    expect(result.accepted).toBe(true);
    expect(state().players[playerId]!.triggersLeft).toBe(before - 1);
    expect(state().players[playerId]!.score).toBeGreaterThan(0);
    expect(state().lastChain?.playerId).toBe(playerId);
    expect(state().lastChain?.length).toBeGreaterThan(0);

    expect(
      chainReactionGame.validateAction(playerId, { type: 'score', payload: { score: 999 } }, state(), context()).valid,
    ).toBe(false);
    expect(
      chainReactionGame.validateAction(playerId, { type: 'chain', payload: { length: 99 } }, state(), context()).valid,
    ).toBe(false);
    expect(chainReactionGame.validateAction(playerId, { type: 'length' }, state(), context()).valid).toBe(false);
    expect(chainReactionGame.handlePlayerAction(playerId, { type: 'chain' }, state(), context()).accepted).toBe(false);
  });

  it('timeout ranks by score; reset keeps seats; cleanup empties players', () => {
    const seats = Object.keys(state().players);
    state().players[seats[0]!]!.score = 220;
    finishChain(state(), context(), 'timeout');
    expect(state().finishReason).toBe('timeout');
    const draft = chainReactionGame.getResult(state(), context());
    expect(draft.winners).toEqual([seats[0]]);
    const next = chainReactionGame.reset(state());
    expect(Object.keys(next.players)).toEqual(seats);
    expect(next.phase).toBe('idle');
    expect(next.players[seats[0]!]!.score).toBe(0);
    chainReactionGame.cleanup(next);
    expect(Object.keys(next.players)).toHaveLength(0);
  });

  it('disconnect, reconnect and leave', () => {
    const [first, second] = players.map((player) => player.id);
    chainReactionGame.playerLeft(first, state(), context(), 'disconnect');
    expect(state().players[first]!.disconnected).toBe(true);
    chainReactionGame.playerJoined({ ...players[0]!, id: first }, state(), context());
    expect(state().players[first]!.disconnected).toBe(false);
    chainReactionGame.playerLeft(first, state(), context(), 'leave');
    chainReactionGame.playerLeft(second, state(), context(), 'leave');
    expect(state().phase).toBe('finished');
  });

  it('AI returns a legal trigger', () => {
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const move = chainReactionGame.getAIMove?.(players[0]!.id, difficulty, state(), context());
      expect(move?.type).toBe('trigger');
      expect(chainReactionGame.validateAction(players[0]!.id, move!, state(), context()).valid).toBe(true);
    }
  });

  it('closes a round when every trigger is spent and supports 3–4 players', async () => {
    for (const player of Object.values(state().players)) player.triggersLeft = 0;
    closeChainRound(state(), context());
    expect(state().phase === 'between' || state().phase === 'finished').toBe(true);
    for (const count of [3, 4] as const) {
      await startWithPlayers(count);
      expect(Object.keys(state().players)).toHaveLength(count);
      expect(state().phase).toBe('playing');
    }
  });
});
