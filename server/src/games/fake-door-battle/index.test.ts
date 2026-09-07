import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createPlayer, createTestPlatform, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  buildDoorRound,
  completeDoorRound,
  fakeDoorGame,
  finishDoors,
  PENALTY_MS,
  SCORE_CORRECT,
  type DoorState,
} from './index';
import type { Room } from '../../rooms/Room';

describe('Fake Door Battle', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'fake-door-battle', { settings: { rounds: 5 } });
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as DoorState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const publicState = (viewerId?: string) =>
    platform.gameManager.getPublicState(room, viewerId) as {
      phase: string;
      clue: string;
      correctDoorId: string | null;
      doors: Array<{ id: string }>;
      players: Record<string, { score: number; picked: string | null }>;
    };

  async function startWithPlayers(count: 3 | 4): Promise<void> {
    const local = createTestPlatform();
    const ids = [];
    for (let i = 0; i < count; i += 1) ids.push(await createPlayer(local.platform, `Fd${count}${i}`));
    const extra = local.platform.roomManager.createRoom({
      gameId: 'fake-door-battle',
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

  it('builds learnable clues, never a purely random door', () => {
    const rng = () => 0.1;
    const color = buildDoorRound(rng, 0, null);
    expect(color.clueKind).toBe('color');
    expect(color.clue).toMatch(/door is safe/);
    const number = buildDoorRound(rng, 2, null);
    expect(number.clueKind).toBe('number');
    expect(number.correctDoorId).toBe('door-1');
    const position = buildDoorRound(rng, 3, null);
    expect(position.clueKind).toBe('position');
    expect(position.correctDoorId).toBe('door-3');
    const memory = buildDoorRound(rng, 4, 'gold');
    expect(memory.clueKind).toBe('memory');
    expect(memory.correctDoorId).toBe('door-3');
  });

  it('starts a round with four doors and hides the correct id', () => {
    expect(state().phase).toBe('round');
    expect(state().doors).toHaveLength(4);
    expect(state().totalRounds).toBe(5);
    expect(state().clue.length).toBeGreaterThan(0);
    const view = publicState(players[0]!.id);
    expect(view.correctDoorId).toBeNull();
    expect(view.doors).toHaveLength(4);
    expect(JSON.stringify(view)).not.toMatch(/"correctDoorId":"door-/);
  });

  it('scores a correct pick, penalises a fake door, and rejects client-owned results', () => {
    const [first, second] = players.map((player) => player.id);
    const correct = platform.gameManager.handleAction(room, first, {
      type: 'pick',
      payload: { doorId: state().correctDoorId },
    });
    expect(correct.accepted).toBe(true);
    expect(state().players[first]!.score).toBeGreaterThanOrEqual(SCORE_CORRECT);
    expect(state().players[first]!.correct).toBe(1);

    const fake = state().doors.find((door) => door.id !== state().correctDoorId)!;
    const wrong = platform.gameManager.handleAction(room, second, { type: 'pick', payload: { doorId: fake.id } });
    expect(wrong.accepted).toBe(true);
    expect(state().players[second]!.wrongs).toBe(1);
    expect(state().players[second]!.freezeUntil).toBeGreaterThan(context().now());
    expect(state().players[second]!.freezeUntil - context().now()).toBeGreaterThanOrEqual(PENALTY_MS - 5);

    expect(fakeDoorGame.validateAction(first, { type: 'score', payload: { score: 999 } }, state(), context()).valid).toBe(false);
    expect(fakeDoorGame.validateAction(first, { type: 'solve' }, state(), context()).valid).toBe(false);
    expect(fakeDoorGame.validateAction(first, { type: 'finish' }, state(), context()).valid).toBe(false);
  });

  it('reveals the correct door only after the round completes', () => {
    completeDoorRound(state(), context());
    expect(state().phase).toBe('reveal');
    const view = publicState(players[0]!.id);
    expect(view.correctDoorId).toBe(state().correctDoorId);
  });

  it('timeout ranks by score; reset keeps seats; cleanup empties players', () => {
    const seats = Object.keys(state().players);
    state().players[seats[0]!]!.score = 180;
    finishDoors(state(), context(), 'timeout');
    expect(state().finishReason).toBe('timeout');
    const draft = fakeDoorGame.getResult(state(), context());
    expect(draft.winners).toEqual([seats[0]]);
    const next = fakeDoorGame.reset(state());
    expect(Object.keys(next.players)).toEqual(seats);
    expect(next.phase).toBe('idle');
    expect(next.players[seats[0]!]!.score).toBe(0);
    fakeDoorGame.cleanup(next);
    expect(Object.keys(next.players)).toHaveLength(0);
  });

  it('disconnect, reconnect and leave', () => {
    const [first, second] = players.map((player) => player.id);
    fakeDoorGame.playerLeft(first, state(), context(), 'disconnect');
    expect(state().players[first]!.disconnected).toBe(true);
    fakeDoorGame.playerJoined({ ...players[0]!, id: first }, state(), context());
    expect(state().players[first]!.disconnected).toBe(false);
    fakeDoorGame.playerLeft(first, state(), context(), 'leave');
    fakeDoorGame.playerLeft(second, state(), context(), 'leave');
    expect(state().phase).toBe('finished');
  });

  it('AI returns a legal door pick', () => {
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const move = fakeDoorGame.getAIMove?.(players[0]!.id, difficulty, state(), context());
      expect(move?.type).toBe('pick');
      expect(fakeDoorGame.validateAction(players[0]!.id, move!, state(), context()).valid).toBe(true);
    }
  });

  it('initialises 3 and 4 player matches', async () => {
    for (const count of [3, 4] as const) {
      await startWithPlayers(count);
      expect(Object.keys(state().players)).toHaveLength(count);
      expect(state().phase).toBe('round');
      expect(state().doors).toHaveLength(4);
    }
  });
});
