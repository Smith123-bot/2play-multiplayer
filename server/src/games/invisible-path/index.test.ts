import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createPlayer, createTestPlatform, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  finishPath,
  generateSafePath,
  invisiblePathGame,
  openPathRound,
  PATH_LAYOUTS,
  SCORE_FINISH,
  SCORE_STEP,
  WRONG_PENALTY,
  type PathState,
} from './index';
import type { Room } from '../../rooms/Room';

describe('Invisible Path', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'invisible-path', { settings: { rounds: 3 } });
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as PathState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const publicState = (viewerId?: string) =>
    platform.gameManager.getPublicState(room, viewerId) as {
      phase: string;
      safe: string[];
      start: { x: number; y: number };
      goal: { x: number; y: number };
      layoutId?: number;
    };

  async function startWithPlayers(count: 3 | 4): Promise<void> {
    const local = createTestPlatform();
    const ids = [];
    for (let i = 0; i < count; i += 1) ids.push(await createPlayer(local.platform, `Ip${count}${i}`));
    const extra = local.platform.roomManager.createRoom({
      gameId: 'invisible-path',
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

  it('builds connected, non-random layouts with decoys', () => {
    const paths = Array.from({ length: PATH_LAYOUTS }, (_, index) => generateSafePath(index));
    expect(new Set(paths.map((path) => path.safe.join('|'))).size).toBeGreaterThan(1);
    for (const path of paths) {
      expect(path.safe).toContain(`${path.start.x},${path.start.y}`);
      expect(path.safe).toContain(`${path.goal.x},${path.goal.y}`);
      expect(path.decoys.every((cell) => !path.safe.includes(cell))).toBe(true);
    }
  });

  it('previews the path then hides the safe set', () => {
    expect(state().phase).toBe('preview');
    expect(state().totalRounds).toBe(3);
    const preview = publicState(players[0]!.id);
    expect(preview.safe.length).toBeGreaterThan(3);
    expect(preview.layoutId).toBeUndefined();
    openPathRound(state(), context());
    expect(state().phase).toBe('playing');
    const hidden = publicState(players[0]!.id);
    expect(hidden.safe).toEqual([`${state().start.x},${state().start.y}`]);
    expect(JSON.stringify(hidden)).not.toContain('"layoutId"');
  });

  it('scores a safe step, penalises a wrong tile, and rejects client-owned paths', () => {
    openPathRound(state(), context());
    const playerId = players[0]!.id;
    const player = state().players[playerId]!;
    const next = state().safe
      .map((cell) => {
        const [x, y] = cell.split(',').map(Number);
        return { x: x!, y: y! };
      })
      .find((cell) => Math.abs(cell.x - player.x) + Math.abs(cell.y - player.y) === 1);
    expect(next).toBeTruthy();
    const stepped = platform.gameManager.handleAction(room, playerId, { type: 'move', payload: next });
    expect(stepped.accepted).toBe(true);
    expect(player.score).toBe(SCORE_STEP);

    const wrong = [
      { x: player.x + 1, y: player.y },
      { x: player.x - 1, y: player.y },
      { x: player.x, y: player.y + 1 },
      { x: player.x, y: player.y - 1 },
    ].find((cell) => !state().safe.includes(`${cell.x},${cell.y}`) && cell.x >= 0 && cell.y >= 0);
    if (wrong) {
      player.stunUntil = 0;
      const bounced = platform.gameManager.handleAction(room, playerId, { type: 'move', payload: wrong });
      expect(bounced.accepted).toBe(true);
      expect(player.wrongs).toBe(1);
      expect(player.score).toBe(SCORE_STEP - WRONG_PENALTY);
      expect(player.x).toBe(next!.x);
      expect(player.y).toBe(next!.y);
    }

    expect(invisiblePathGame.validateAction(playerId, { type: 'path', payload: { tiles: [] } }, state(), context()).valid).toBe(
      false,
    );
    expect(invisiblePathGame.validateAction(playerId, { type: 'finish' }, state(), context()).valid).toBe(false);
    expect(invisiblePathGame.validateAction(playerId, { type: 'score' }, state(), context()).valid).toBe(false);
  });

  it('awards a finish when occupying the goal cell', () => {
    openPathRound(state(), context());
    const playerId = players[0]!.id;
    const player = state().players[playerId]!;
    const goal = state().goal;
    const neighbour = goal.x > 0 ? { x: goal.x - 1, y: goal.y } : { x: goal.x, y: goal.y - 1 };
    player.x = neighbour.x;
    player.y = neighbour.y;
    player.stunUntil = 0;
    state().safe.push(`${neighbour.x},${neighbour.y}`, `${goal.x},${goal.y}`);
    expect(platform.gameManager.handleAction(room, playerId, { type: 'move', payload: goal }).accepted).toBe(true);
    expect(player.finished).toBe(true);
    expect(player.score).toBeGreaterThanOrEqual(SCORE_FINISH);
  });

  it('timeout ranks by score; reset keeps seats; cleanup empties players', () => {
    const seats = Object.keys(state().players);
    state().players[seats[0]!]!.score = 70;
    finishPath(state(), context(), 'timeout');
    expect(state().finishReason).toBe('timeout');
    const next = invisiblePathGame.reset(state());
    expect(Object.keys(next.players)).toEqual(seats);
    expect(next.phase).toBe('idle');
    invisiblePathGame.cleanup(next);
    expect(Object.keys(next.players)).toHaveLength(0);
  });

  it('disconnect, reconnect and leave', () => {
    const [first, second] = players.map((player) => player.id);
    invisiblePathGame.playerLeft(first, state(), context(), 'disconnect');
    expect(state().players[first]!.disconnected).toBe(true);
    invisiblePathGame.playerJoined({ ...players[0]!, id: first }, state(), context());
    expect(state().players[first]!.disconnected).toBe(false);
    invisiblePathGame.playerLeft(first, state(), context(), 'leave');
    invisiblePathGame.playerLeft(second, state(), context(), 'leave');
    expect(state().phase).toBe('finished');
  });

  it('AI returns a legal adjacent step once playing', () => {
    openPathRound(state(), context());
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const move = invisiblePathGame.getAIMove?.(players[0]!.id, difficulty, state(), context());
      expect(move?.type).toBe('move');
      expect(invisiblePathGame.validateAction(players[0]!.id, move!, state(), context()).valid).toBe(true);
    }
  });

  it('initialises 3 and 4 player matches', async () => {
    for (const count of [3, 4] as const) {
      await startWithPlayers(count);
      expect(Object.keys(state().players)).toHaveLength(count);
      expect(state().phase).toBe('preview');
    }
  });
});
