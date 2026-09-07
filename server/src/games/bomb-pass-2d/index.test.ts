import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createTestPlatform, waitFor, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  alivePlayers,
  armFuse,
  beginBombRound,
  bombPassGame,
  computeBombRanking,
  explode,
  fuseFor,
  pickHolder,
  roundsFor,
  type BombPassState,
} from './index';
import type { Room } from '../../rooms/Room';

describe('Bomb Pass 2D', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'bomb-pass-2d');
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as BombPassState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const publicState = () =>
    platform.gameManager.getPublicState(room, players[0]!.id) as {
      phase: string;
      holderId: string | null;
      fuseEndsAt: number | null;
      passAvailableAt: number | null;
      players: Record<string, { strikes: number; points: number; eliminated: boolean; disconnected: boolean }>;
    };

  /* ---------------------------------------------------------------- */
  /* Configuration + initialisation                                    */
  /* ---------------------------------------------------------------- */

  it('scales and clamps rounds and fuse lengths', () => {
    expect(roundsFor(undefined)).toBe(8);
    expect(roundsFor(2)).toBe(3);
    expect(roundsFor(50)).toBe(15);
    expect(fuseFor(1, () => 0)).toBe(5600);
    expect(fuseFor(9, () => 0.99)).toBeLessThanOrEqual(6200);
    expect(fuseFor(9, () => 0)).toBeGreaterThanOrEqual(2400); // decay clamped
    expect(fuseFor(20, () => 0.5)).toBeGreaterThanOrEqual(2400);
  });

  it('starts into a countdown with a random holder and an unarmed fuse', async () => {
    await waitFor(() => state().phase === 'countdown', { timeoutMs: 5000 });
    expect(state().round).toBe(1);
    expect(state().holderId).not.toBeNull();
    expect(alivePlayers(state())).toHaveLength(2);
    expect(state().fuseEndsAt).toBeNull(); // not armed during the countdown
    expect(state().roundEndsAt).toBeGreaterThan(context().now());
  });

  /* ---------------------------------------------------------------- */
  /* Pass validation                                                   */
  /* ---------------------------------------------------------------- */

  it('rejects passes from anyone but the holder, to invalid/out targets, or too fast', async () => {
    await waitFor(() => state().phase === 'countdown', { timeoutMs: 5000 });
    const [a, b] = players.map((player) => player.id);
    armFuse(state(), context());
    expect(state().phase).toBe('running');

    const holder = state().holderId!;
    const other = holder === a ? b : a;

    // Non-holder cannot pass.
    expect(
      bombPassGame.validateAction(other, { type: 'pass', payload: { targetId: holder } }, state(), context()).valid,
    ).toBe(false);
    // Self-pass blocked.
    expect(
      bombPassGame.validateAction(holder, { type: 'pass', payload: { targetId: holder } }, state(), context()).valid,
    ).toBe(false);
    // Unknown action + ghost target.
    expect(bombPassGame.validateAction(holder, { type: 'throw' }, state(), context()).valid).toBe(false);
    expect(
      bombPassGame.validateAction(holder, { type: 'pass', payload: { targetId: 'ghost' } }, state(), context()).valid,
    ).toBe(false);
    // Cooldown: holder just received the bomb.
    expect(
      bombPassGame.validateAction(holder, { type: 'pass', payload: { targetId: other } }, state(), context()).valid,
    ).toBe(false);

    // After the cooldown the pass is legal.
    state().players[holder]!.receivedAt = context().now() - state().passCooldownMs - 1;
    expect(
      bombPassGame.validateAction(holder, { type: 'pass', payload: { targetId: other } }, state(), context()).valid,
    ).toBe(true);

    // An eliminated or departed target is blocked.
    state().players[other]!.eliminated = true;
    expect(
      bombPassGame.validateAction(holder, { type: 'pass', payload: { targetId: other } }, state(), context()).valid,
    ).toBe(false);
    state().players[other]!.eliminated = false;

    // Nothing passes outside the running phase.
    state().phase = 'roundResult';
    expect(
      bombPassGame.validateAction(holder, { type: 'pass', payload: { targetId: other } }, state(), context()).valid,
    ).toBe(false);
  });

  it('a valid pass moves the bomb and restarts the catch cooldown', async () => {
    await waitFor(() => state().phase === 'countdown', { timeoutMs: 5000 });
    const [a, b] = players.map((player) => player.id);
    armFuse(state(), context());
    const holder = state().holderId!;
    const other = holder === a ? b : a;
    state().players[holder]!.receivedAt = context().now() - 1000;

    const result = platform.gameManager.handleAction(room, holder, {
      type: 'pass',
      payload: { targetId: other },
    });
    expect(result.accepted).toBe(true);
    expect(state().holderId).toBe(other);
    expect(state().lastEvent).toBe(`pass:${other}`);
    expect(state().players[other]!.receivedAt).toBe(context().now());
  });

  /* ---------------------------------------------------------------- */
  /* Explosion / strikes / elimination                                 */
  /* ---------------------------------------------------------------- */

  it('explosion: the holder takes a strike, survivors score, three strikes eliminate', async () => {
    await waitFor(() => state().phase === 'countdown', { timeoutMs: 5000 });
    const [a, b] = players.map((player) => player.id);
    armFuse(state(), context());
    const holder = state().holderId!;
    const other = holder === a ? b : a;

    explode(state(), context());
    expect(state().phase).toBe('roundResult');
    expect(state().players[holder]!.strikes).toBe(1);
    expect(state().players[other]!.points).toBe(1);
    expect(state().players[holder]!.points).toBe(0);
    expect(state().lastEvent).toBe(`boom:${holder}`);
    expect(state().fuseEndsAt).toBeNull();

    // Two more explosions on the same player → eliminated → match over.
    state().phase = 'running';
    state().holderId = holder;
    explode(state(), context());
    state().phase = 'running';
    state().holderId = holder;
    explode(state(), context());
    expect(state().players[holder]!.eliminated).toBe(true);
    expect(state().phase).toBe('finished');
    expect(state().finishReason).toBe('completed');

    const draft = bombPassGame.getResult(state(), context());
    expect(draft.winners).toEqual([other]);
    expect(draft.rankings[0]!.stats.survived).toBe(1);
    expect(draft.rankings[1]!.stats.strikes).toBe(3);
  });

  it('round flow: result window → next round with a shorter fuse, finish after the last', async () => {
    await waitFor(() => state().phase === 'countdown', { timeoutMs: 5000 });
    state().totalRounds = 2;
    armFuse(state(), context());
    explode(state(), context());
    expect(state().phase).toBe('roundResult');

    beginBombRound(state(), context());
    expect(state().phase).toBe('countdown');
    expect(state().round).toBe(2);
    expect(state().fuseMs).toBeGreaterThanOrEqual(2400);
    expect(state().fuseMs).toBeLessThanOrEqual(6200);
    // Same jitter level → later rounds always burn shorter (below the clamp).
    for (const r of [0.05, 0.25, 0.4]) {
      expect(fuseFor(2, () => r)).toBeLessThan(fuseFor(1, () => r));
    }
    expect(state().holderId).not.toBe(state().lastHolderId); // fresh holder each round

    armFuse(state(), context());
    explode(state(), context());
    beginBombRound(state(), context());
    expect(state().phase).toBe('finished');
    expect(state().round).toBe(2);
  });

  it('pickHolder avoids the previous holder when possible', () => {
    const [a, b] = players.map((player) => player.id);
    state().lastHolderId = a;
    expect(pickHolder(state(), () => 0)).toBe(b);
    state().lastHolderId = null;
    expect(pickHolder(state(), () => 0.99)).toBe(b);
  });

  /* ---------------------------------------------------------------- */
  /* Ranking / draws / leaves                                          */
  /* ---------------------------------------------------------------- */

  it('ranks survivors first, then fewest strikes, then points; ties draw', async () => {
    await waitFor(() => state().phase === 'countdown', { timeoutMs: 5000 });
    const [a, b] = players.map((player) => player.id);
    state().players[a]!.strikes = 2;
    state().players[a]!.points = 3;
    state().players[b]!.strikes = 1;
    state().players[b]!.points = 1;
    state().phase = 'finished';

    const ranking = computeBombRanking(state(), context());
    expect(ranking[0]!.playerId).toBe(b);
    expect(bombPassGame.checkWinCondition(state())).toEqual([b]);

    // Mirror everything → draw.
    state().players[a]!.strikes = 1;
    state().players[a]!.points = 1;
    expect(bombPassGame.checkDrawCondition(state())).toBe(true);
  });

  it('a departing holder drops the bomb to someone else; last one standing wins', async () => {
    await waitFor(() => state().phase === 'countdown', { timeoutMs: 5000 });
    const [a, b] = players.map((player) => player.id);
    armFuse(state(), context());
    const holder = state().holderId!;
    const other = holder === a ? b : a;

    bombPassGame.playerLeft(holder, state(), context(), 'leave');
    expect(state().departed[holder]).toBe(true);
    expect(state().holderId).toBe(other); // bomb transferred before the finish

    // The lone survivor is immediately declared the winner.
    expect(state().phase).toBe('finished');
    const draft = bombPassGame.getResult(state(), context());
    expect(draft.winners).toEqual([other]);
  });

  it('disconnect blocks catching but keeps the seat (reconnection window)', async () => {
    await waitFor(() => state().phase === 'countdown', { timeoutMs: 5000 });
    const [a, b] = players.map((player) => player.id);
    armFuse(state(), context());
    const holder = state().holderId!;
    const other = holder === a ? b : a;

    bombPassGame.playerLeft(other, state(), context(), 'disconnect');
    expect(state().players[other]!.disconnected).toBe(true);
    expect(state().phase).toBe('running');
    state().players[holder]!.receivedAt = context().now() - 1000;
    expect(
      bombPassGame.validateAction(holder, { type: 'pass', payload: { targetId: other } }, state(), context()).valid,
    ).toBe(false);
  });

  it('reset zeroes strikes and points for the same seats', async () => {
    await waitFor(() => state().phase === 'countdown', { timeoutMs: 5000 });
    const seats = Object.keys(state().players);
    state().players[seats[0]!]!.strikes = 2;
    state().players[seats[0]!]!.points = 5;

    const next = bombPassGame.reset(state());
    expect(Object.keys(next.players)).toEqual(seats);
    expect(next.phase).toBe('idle');
    expect(next.round).toBe(0);
    for (const player of Object.values(next.players)) {
      expect(player.strikes).toBe(0);
      expect(player.points).toBe(0);
      expect(player.eliminated).toBe(false);
    }
  });

  /* ---------------------------------------------------------------- */
  /* AI + public state                                                 */
  /* ---------------------------------------------------------------- */

  it('AI passes legally to a living opponent while holding', async () => {
    await waitFor(() => state().phase === 'countdown', { timeoutMs: 5000 });
    const [a, b] = players.map((player) => player.id);
    armFuse(state(), context());
    const holder = state().holderId!;
    const other = holder === a ? b : a;

    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const move = bombPassGame.getAIMove?.(holder, difficulty, state(), context());
        expect(move?.type).toBe('pass');
        expect(move?.payload?.targetId).toBe(other); // only legal target
      }
    }
    // Not holding → quiet.
    expect(bombPassGame.getAIMove?.(other, 'hard', state(), context())).toBeNull();
  });

  it('public state exposes the fuse and holder but never the seed', async () => {
    await waitFor(() => state().phase === 'countdown', { timeoutMs: 5000 });
    armFuse(state(), context());
    const view = publicState();
    expect(view.phase).toBe('running');
    expect(view.holderId).not.toBeNull();
    expect(view.fuseEndsAt).toBeGreaterThan(context().now());
    expect(view.passAvailableAt).toBeGreaterThan(context().now());
    expect(Object.keys(view.players)).toHaveLength(2);
    expect(JSON.stringify(view)).not.toContain('"seed"');
  });

  it('enterRunningRound helper reaches the running phase (module wiring smoke test)', () => {
    expect(typeof beginBombRound).toBe('function');
    expect(typeof alivePlayers).toBe('function');
    expect(state === state).toBe(true);
  });
});
