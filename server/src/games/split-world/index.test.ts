import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createPlayer, createTestPlatform, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  blockedByTruth,
  finishSplit,
  GOAL_SCORE,
  splitWorldGame,
  SWITCH_SCORE,
  viewTile,
  viewTiles,
  type SplitState,
  type ViewTile,
} from './index';
import type { Room } from '../../rooms/Room';

describe('Split World', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'split-world');
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as SplitState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const publicState = (viewerId?: string) =>
    platform.gameManager.getPublicState(room, viewerId) as {
      tiles: ViewTile[][];
      role: string;
      doorOpen: boolean;
      trueTiles?: unknown;
      switches?: unknown;
      players: Record<string, { x: number; y: number; score: number; role: string }>;
    };

  async function startWithPlayers(count: 3 | 4): Promise<void> {
    const local = createTestPlatform();
    const ids = [];
    for (let i = 0; i < count; i += 1) ids.push(await createPlayer(local.platform, `Sw${count}${i}`));
    const extra = local.platform.roomManager.createRoom({
      gameId: 'split-world',
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

  it('starts a shared world with opposite roles and a live clock', () => {
    expect(state().phase).toBe('playing');
    expect(state().trueTiles).toHaveLength(7);
    expect(state().players[players[0]!.id]!.role).toBe('alpha');
    expect(state().players[players[1]!.id]!.role).toBe('beta');
    expect(state().endsAt).toBeGreaterThan(context().now());
    expect(viewTile('switch', 'alpha')).toBe('switch');
    expect(viewTile('switch', 'beta')).toBe('floor');
    expect(viewTile('door', 'alpha')).toBe('floor');
    expect(viewTile('door', 'beta')).toBe('door');
  });

  it('does not leak true tiles, switches or the hidden door to the wrong seat', () => {
    const [alphaId, betaId] = players.map((player) => player.id);
    const alpha = publicState(alphaId);
    const beta = publicState(betaId);
    expect(JSON.stringify(alpha)).not.toMatch(/trueTiles/);
    expect(JSON.stringify(beta)).not.toMatch(/trueTiles/);
    expect(alpha.trueTiles).toBeUndefined();
    expect(beta.switches).toBeUndefined();
    const switchCell = state().switches[0]!;
    expect(alpha.tiles[switchCell.y]![switchCell.x]).toBe('switch');
    expect(beta.tiles[switchCell.y]![switchCell.x]).toBe('floor');
    expect(alpha.tiles[state().door.y]![state().door.x]).toBe('floor');
    expect(beta.tiles[state().door.y]![state().door.x]).toBe('door');
    expect(viewTiles(state().trueTiles, 'beta').flat()).not.toContain('true');
  });

  it('accepts a legal step, blocks the closed door, and rejects client-owned reveals', () => {
    const playerId = players[0]!.id;
    expect(platform.gameManager.handleAction(room, playerId, { type: 'move', payload: { direction: 'right' } }).accepted).toBe(
      true,
    );
    const body = state().players[playerId]!;
    body.x = state().door.x - 1;
    body.y = state().door.y;
    state().doorOpen = false;
    expect(blockedByTruth(state(), state().door.x, state().door.y)).toBe(true);
    expect(
      splitWorldGame.validateAction(playerId, { type: 'move', payload: { direction: 'right' } }, state(), context()).valid,
    ).toBe(false);

    expect(splitWorldGame.validateAction(playerId, { type: 'score', payload: { score: 9 } }, state(), context()).valid).toBe(
      false,
    );
    expect(splitWorldGame.validateAction(playerId, { type: 'reveal' }, state(), context()).valid).toBe(false);
    expect(splitWorldGame.validateAction(playerId, { type: 'world' }, state(), context()).valid).toBe(false);
    expect(splitWorldGame.handlePlayerAction(playerId, { type: 'open' }, state(), context()).accepted).toBe(false);
  });

  it('scores a switch hold and a goal only after the door opens', () => {
    const [alphaId, betaId] = players.map((player) => player.id);
    const alpha = state().players[alphaId]!;
    const first = state().switches[0]!;
    alpha.x = first.x - 1;
    alpha.y = first.y;
    expect(platform.gameManager.handleAction(room, alphaId, { type: 'move', payload: { direction: 'right' } }).accepted).toBe(
      true,
    );
    expect(alpha.heldSwitch).toBe(true);
    expect(alpha.score).toBe(SWITCH_SCORE);

    const second = state().switches[1]!;
    const beta = state().players[betaId]!;
    beta.x = second.x - 1;
    beta.y = second.y;
    expect(platform.gameManager.handleAction(room, betaId, { type: 'move', payload: { direction: 'right' } }).accepted).toBe(
      true,
    );
    expect(state().doorOpen).toBe(true);
    beta.x = state().goal.x - 1;
    beta.y = state().goal.y;
    expect(platform.gameManager.handleAction(room, betaId, { type: 'move', payload: { direction: 'right' } }).accepted).toBe(
      true,
    );
    expect(state().players[betaId]!.finished).toBe(true);
    expect(state().players[betaId]!.score).toBeGreaterThanOrEqual(GOAL_SCORE);
  });

  it('timeout ranks by score; reset keeps seats; cleanup empties players', () => {
    const seats = Object.keys(state().players);
    state().players[seats[0]!]!.score = 130;
    finishSplit(state(), context(), 'timeout');
    expect(state().finishReason).toBe('timeout');
    const next = splitWorldGame.reset(state());
    expect(Object.keys(next.players)).toEqual(seats);
    expect(next.phase).toBe('idle');
    expect(next.players[seats[0]!]!.score).toBe(0);
    splitWorldGame.cleanup(next);
    expect(Object.keys(next.players)).toHaveLength(0);
    expect(next.trueTiles).toHaveLength(0);
  });

  it('disconnect, reconnect and leave', () => {
    const [first, second] = players.map((player) => player.id);
    splitWorldGame.playerLeft(first, state(), context(), 'disconnect');
    expect(state().players[first]!.disconnected).toBe(true);
    splitWorldGame.playerJoined({ ...players[0]!, id: first }, state(), context());
    expect(state().players[first]!.disconnected).toBe(false);
    splitWorldGame.playerLeft(first, state(), context(), 'leave');
    splitWorldGame.playerLeft(second, state(), context(), 'leave');
    expect(state().phase).toBe('finished');
  });

  it('AI returns a legal step', () => {
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const move = splitWorldGame.getAIMove?.(players[0]!.id, difficulty, state(), context());
      expect(move?.type).toBe('move');
      expect(splitWorldGame.validateAction(players[0]!.id, move!, state(), context()).valid).toBe(true);
    }
  });

  it('initialises 3 and 4 player matches with mixed roles', async () => {
    for (const count of [3, 4] as const) {
      await startWithPlayers(count);
      expect(Object.keys(state().players)).toHaveLength(count);
      const roles = Object.values(state().players).map((player) => player.role);
      expect(roles).toContain('alpha');
      expect(roles).toContain('beta');
    }
  });
});
