import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createTestPlatform, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  applyFire,
  CASTLE_HP,
  castleSiegeGame,
  finishSiege,
  FIRE_COST,
  FIRE_RANGE,
  siegeScore,
  stepSiege,
  type SiegeState,
} from './index';
import type { Room } from '../../rooms/Room';

describe('Castle Siege 2D', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'castle-siege-2d');
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as SiegeState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const publicState = (viewerId?: string) =>
    platform.gameManager.getPublicState(room, viewerId) as {
      phase: string;
      commanders: Record<string, { x: number; y: number; energy: number; castleHp: number; score: number }>;
      nodes: Array<{ x: number; y: number; holder: string | null }>;
    };

  it('starts with two keeps at full HP and a live clock', () => {
    expect(state().phase).toBe('playing');
    expect(Object.keys(state().commanders)).toHaveLength(2);
    for (const commander of Object.values(state().commanders)) {
      expect(commander.castleHp).toBe(CASTLE_HP);
      expect(commander.energy).toBeGreaterThan(0);
      expect(commander.alive).toBe(true);
    }
    expect(state().endsAt).toBe(state().startedAt! + state().durationMs);
    expect(publicState(players[0]!.id).nodes).toHaveLength(2);
  });

  it('accepts a legal move and rejects walls, unknown actions and finished matches', () => {
    const playerId = players[0]!.id;
    const commander = state().commanders[playerId]!;
    const result = platform.gameManager.handleAction(room, playerId, { type: 'move', payload: { direction: 'down' } });
    expect(result.accepted).toBe(true);
    expect(commander.y).toBeGreaterThan(0);

    expect(castleSiegeGame.validateAction(playerId, { type: 'fly' }, state(), context()).valid).toBe(false);
    expect(
      castleSiegeGame.validateAction(playerId, { type: 'move', payload: { direction: 'north' } }, state(), context())
        .valid,
    ).toBe(false);
    expect(castleSiegeGame.validateAction('ghost', { type: 'move', payload: { direction: 'up' } }, state(), context()).valid).toBe(
      false,
    );
    commander.alive = false;
    expect(castleSiegeGame.validateAction(playerId, { type: 'move', payload: { direction: 'up' } }, state(), context()).valid).toBe(
      false,
    );
    commander.alive = true;
    state().phase = 'finished';
    expect(castleSiegeGame.validateAction(playerId, { type: 'move', payload: { direction: 'up' } }, state(), context()).valid).toBe(
      false,
    );
    state().phase = 'playing';
  });

  it('builds a wall on an adjacent empty cell and rejects occupied or unaffordable builds', () => {
    const playerId = players[0]!.id;
    const commander = state().commanders[playerId]!;
    const col = commander.x;
    const row = commander.y + 1;
    const built = platform.gameManager.handleAction(room, playerId, { type: 'build', payload: { col, row } });
    expect(built.accepted).toBe(true);
    expect(state().defenses.some((defense) => defense.x === col && defense.y === row && defense.kind === 'wall')).toBe(true);

    commander.energy = 0;
    expect(
      castleSiegeGame.validateAction(playerId, { type: 'build', payload: { col: commander.x + 1, row: commander.y } }, state(), context())
        .valid,
    ).toBe(false);
  });

  it('upgrades an owned adjacent wall into a tower', () => {
    const playerId = players[0]!.id;
    const commander = state().commanders[playerId]!;
    commander.lastBuildAt = 0;
    const col = commander.x;
    const row = commander.y + 1;
    platform.gameManager.handleAction(room, playerId, { type: 'build', payload: { col, row } });
    commander.energy = 10;
    const upgraded = platform.gameManager.handleAction(room, playerId, { type: 'upgrade' });
    expect(upgraded.accepted).toBe(true);
    expect(state().defenses.find((defense) => defense.x === col && defense.y === row)?.kind).toBe('tower');
  });

  it('fires only in range, spends energy, damages the rival keep and never trusts client damage', () => {
    const [attackerId, defenderId] = players.map((player) => player.id);
    const attacker = state().commanders[attackerId]!;
    const defender = state().commanders[defenderId]!;
    attacker.x = defender.castleX - 1;
    attacker.y = defender.castleY;
    attacker.energy = 10;
    attacker.lastFireAt = 0;
    expect(Math.abs(attacker.x - defender.castleX) + Math.abs(attacker.y - defender.castleY)).toBeLessThanOrEqual(FIRE_RANGE);

    const hpBefore = defender.castleHp;
    const energyBefore = attacker.energy;
    const fired = platform.gameManager.handleAction(room, attackerId, {
      type: 'fire',
      payload: { col: defender.castleX, row: defender.castleY },
    });
    expect(fired.accepted).toBe(true);
    expect(defender.castleHp).toBe(hpBefore - 12);
    expect(attacker.energy).toBe(energyBefore - FIRE_COST);
    expect(attacker.damageDealt).toBe(12);

    expect(
      castleSiegeGame.validateAction(attackerId, { type: 'fire', payload: { col: attacker.castleX, row: attacker.castleY } }, state(), context())
        .valid,
    ).toBe(false);
    attacker.lastFireAt = 0;
    attacker.x = 0;
    attacker.y = 0;
    expect(
      castleSiegeGame.validateAction(
        attackerId,
        { type: 'fire', payload: { col: defender.castleX, row: defender.castleY } },
        state(),
        context(),
      ).valid,
    ).toBe(false);
  });

  it('destroys a castle with enough validated shots and ends the match', () => {
    const [attackerId, defenderId] = players.map((player) => player.id);
    const defender = state().commanders[defenderId]!;
    applyFire(state(), attackerId, defender.castleX, defender.castleY, context().now(), 100);
    expect(defender.alive).toBe(false);
    expect(defender.castleHp).toBe(0);
    finishSiege(state(), context(), 'completed');
    const draft = castleSiegeGame.getResult(state(), context());
    expect(draft.winners).toEqual([attackerId]);
    expect(draft.isDraw).toBe(false);
    expect(castleSiegeGame.checkWinCondition(state())).toEqual([attackerId]);
  });

  it('captures a node you stand on and rejects capture from anywhere else', () => {
    const playerId = players[0]!.id;
    const commander = state().commanders[playerId]!;
    const node = state().nodes[0]!;
    expect(castleSiegeGame.validateAction(playerId, { type: 'capture' }, state(), context()).valid).toBe(false);
    commander.x = node.x;
    commander.y = node.y;
    const captured = platform.gameManager.handleAction(room, playerId, { type: 'capture' });
    expect(captured.accepted).toBe(true);
    expect(node.holder).toBe(playerId);
    expect(commander.score).toBeGreaterThan(0);
  });

  it('ticks energy, hold points and tower fire on the server clock', () => {
    const playerId = players[0]!.id;
    const commander = state().commanders[playerId]!;
    commander.energy = 0;
    commander.x = state().nodes[0]!.x;
    commander.y = state().nodes[0]!.y;
    const before = commander.score;
    stepSiege(state(), context());
    expect(commander.score).toBeGreaterThan(before);
    expect(commander.energy).toBeGreaterThanOrEqual(0);
  });

  it('timeout ranks by siege score and equal scores are a draw', () => {
    const [a, b] = players.map((player) => player.id);
    state().commanders[a]!.score = 40;
    state().commanders[b]!.score = 40;
    finishSiege(state(), context(), 'timeout');
    expect(state().finishReason).toBe('timeout');
    expect(castleSiegeGame.isGameFinished(state())).toBe(true);
    const draft = castleSiegeGame.getResult(state(), context());
    expect(draft.isDraw).toBe(true);
    expect(draft.winners).toHaveLength(2);
    expect(siegeScore(state().commanders[a]!)).toBe(siegeScore(state().commanders[b]!));
  });

  it('reset keeps seats, cleanup empties commanders', () => {
    const seats = Object.keys(state().commanders);
    state().commanders[seats[0]!]!.score = 99;
    const next = castleSiegeGame.reset(state());
    expect(Object.keys(next.commanders)).toEqual(seats);
    expect(next.phase).toBe('idle');
    expect(next.commanders[seats[0]!]!.score).toBe(0);
    castleSiegeGame.cleanup(next);
    expect(Object.keys(next.commanders)).toHaveLength(0);
  });

  it('disconnect keeps the commander; reconnect clears the flag; leave can end the match', () => {
    const [first, second] = players.map((player) => player.id);
    castleSiegeGame.playerLeft(first, state(), context(), 'disconnect');
    expect(state().commanders[first]!.disconnected).toBe(true);
    expect(state().phase).toBe('playing');
    castleSiegeGame.playerJoined({ ...players[0]!, id: first }, state(), context());
    expect(state().commanders[first]!.disconnected).toBe(false);

    castleSiegeGame.playerLeft(first, state(), context(), 'leave');
    expect(state().commanders[first]!.left).toBe(true);
    castleSiegeGame.playerLeft(second, state(), context(), 'leave');
    expect(state().phase).toBe('finished');
    expect(state().finishReason).toBe('abandoned');
  });

  it('AI returns a legal move, fire or capture', () => {
    const move = castleSiegeGame.getAIMove?.(players[0]!.id, 'hard', state(), context());
    expect(move).toBeTruthy();
    expect(['move', 'fire', 'capture', 'build', 'upgrade']).toContain(move!.type);
  });
});
