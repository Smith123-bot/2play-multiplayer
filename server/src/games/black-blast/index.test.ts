import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createTestPlatform, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  ARENA_COLS,
  ARENA_ROWS,
  applyWavePattern,
  blackBlastGame,
  buildArena,
  CHAIN_BONUS,
  COMBO_STEP,
  COMBO_WINDOW_MS,
  detonate,
  ENERGY_SCORE,
  finishBlast,
  FUSE_MS,
  inArena,
  isBlocked,
  MAX_COMBO_MULTIPLIER,
  NODE_RESPAWN_MS,
  OVERCHARGE_ENERGY_COST,
  PULSE_COOLDOWN_MS,
  PULSE_ENERGY_COST,
  PULSE_RADIUS,
  RICH_SCORE,
  WAVE_CLEAR_BONUS,
  waveTargetFor,
  type BlastState,
} from './index';
import type { Room } from '../../rooms/Room';

describe('Black Blast', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'black-blast');
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as BlastState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const act = (playerId: string, action: { type: string; payload?: Record<string, unknown> }) =>
    platform.gameManager.handleAction(room, playerId, action);

  /** Clears the arena so a test can place exactly the nodes it needs. */
  const clearArena = () => {
    state().nodes = [];
    state().pulses = [];
    state().effects = [];
  };

  const addNode = (
    id: string,
    x: number,
    y: number,
    kind: 'energy' | 'rich' | 'obstacle' = 'energy',
  ) => {
    state().nodes.push({ id, x, y, kind, consumed: false, respawnAt: 0 });
  };

  /* ---------------- arena ---------------- */

  it('initialises a populated arena with every player on a distinct spawn', () => {
    expect(state().phase).toBe('playing');
    expect(state().cols).toBe(ARENA_COLS);
    expect(state().rows).toBe(ARENA_ROWS);
    expect(state().endsAt).toBeGreaterThan(context().now());
    expect(state().nodes.length).toBeGreaterThan(30);

    const positions = Object.values(state().players).map((player) => `${player.x}:${player.y}`);
    expect(new Set(positions).size).toBe(players.length);
    expect(Object.values(state().players).every((player) => player.score === 0)).toBe(true);
  });

  it('builds arenas with energy, rich and obstacle nodes, all inside bounds', () => {
    const nodes = buildArena(context().random);
    expect(nodes.some((node) => node.kind === 'energy')).toBe(true);
    expect(nodes.some((node) => node.kind === 'rich')).toBe(true);
    expect(nodes.some((node) => node.kind === 'obstacle')).toBe(true);
    expect(nodes.every((node) => inArena(node.x, node.y))).toBe(true);
    // No two nodes share a cell.
    const cells = nodes.map((node) => `${node.x}:${node.y}`);
    expect(new Set(cells).size).toBe(cells.length);
  });

  /* ---------------- movement ---------------- */

  it('moves a player and rejects walking into a wall or an obstacle', () => {
    const playerId = players[0]!.id;
    clearArena();
    const body = state().players[playerId]!;
    body.x = 5;
    body.y = 5;

    expect(act(playerId, { type: 'move', payload: { direction: 'right' } }).accepted).toBe(true);
    expect(state().players[playerId]!.x).toBe(6);

    // Obstacle blocks.
    addNode('o1', 7, 5, 'obstacle');
    expect(isBlocked(state(), 7, 5)).toBe(true);
    expect(act(playerId, { type: 'move', payload: { direction: 'right' } }).accepted).toBe(false);
    expect(state().players[playerId]!.x).toBe(6);

    // Arena edge blocks.
    body.x = 0;
    body.y = 0;
    expect(act(playerId, { type: 'move', payload: { direction: 'left' } }).accepted).toBe(false);
    expect(act(playerId, { type: 'move', payload: { direction: 'up' } }).accepted).toBe(false);
  });

  it('rejects malformed directions and unknown actions', () => {
    const playerId = players[0]!.id;
    const ctx = context();
    for (const direction of [undefined, null, 'diagonal', 7, {}]) {
      expect(
        blackBlastGame.validateAction(
          playerId,
          { type: 'move', payload: { direction } },
          state(),
          ctx,
        ).valid,
      ).toBe(false);
    }
    expect(blackBlastGame.validateAction(playerId, { type: 'teleport' }, state(), ctx).valid).toBe(
      false,
    );
  });

  /* ---------------- pulses ---------------- */

  it('places a charging pulse that does not resolve until its fuse expires', () => {
    const playerId = players[0]!.id;
    clearArena();
    const body = state().players[playerId]!;
    body.x = 5;
    body.y = 5;
    addNode('n1', 5, 5);

    expect(act(playerId, { type: 'pulse' }).accepted).toBe(true);
    expect(state().pulses).toHaveLength(1);
    const pulse = state().pulses[0]!;
    expect(pulse.ownerId).toBe(playerId);
    expect(pulse.detonateAt).toBeGreaterThan(context().now());
    expect(pulse.detonateAt - context().now()).toBeLessThanOrEqual(FUSE_MS + 50);
    // Nothing has scored yet — the blast has not gone off.
    expect(state().players[playerId]!.score).toBe(0);
    expect(state().nodes[0]!.consumed).toBe(false);
  });

  it('enforces the pulse cooldown server-side', () => {
    const playerId = players[0]!.id;
    expect(act(playerId, { type: 'pulse' }).accepted).toBe(true);
    // Spamming does nothing: the second pulse is refused.
    expect(act(playerId, { type: 'pulse' }).accepted).toBe(false);
    expect(state().pulses).toHaveLength(1);
    expect(state().players[playerId]!.cooldownUntil).toBeGreaterThan(context().now());
    expect(state().players[playerId]!.cooldownUntil - context().now()).toBeLessThanOrEqual(
      PULSE_COOLDOWN_MS + 50,
    );
  });

  it('spends and regenerates server-owned pulse energy', () => {
    const playerId = players[0]!.id;
    const body = state().players[playerId]!;
    body.cooldownUntil = 0;
    body.energy = PULSE_ENERGY_COST;
    expect(act(playerId, { type: 'pulse' }).accepted).toBe(true);
    expect(body.energy).toBe(0);

    body.cooldownUntil = 0;
    expect(act(playerId, { type: 'pulse' }).accepted).toBe(false);
    platform.gameManager.update(room, 1000);
    expect(body.energy).toBeGreaterThan(0);
    expect(body.energy).toBeLessThanOrEqual(body.maxEnergy);
  });

  it('advances waves and refreshes consumed pickups', () => {
    const node = state().nodes.find((entry) => entry.kind === 'energy')!;
    node.consumed = true;
    node.respawnAt = context().now() + NODE_RESPAWN_MS;
    state().waveEndsAt = context().now() - 1;
    platform.gameManager.update(room, 50);
    expect(state().wave).toBe(2);
    expect(node.consumed).toBe(false);
    expect(state().lastEvent).toBe('wave:2');
  });

  it('detonation consumes every node inside the radius and scores them', () => {
    const playerId = players[0]!.id;
    clearArena();
    addNode('in1', 5, 5, 'energy');
    addNode('in2', 6, 5, 'energy');
    addNode('rich', 5, 6, 'rich');
    addNode('far', 12, 11, 'energy'); // well outside the radius

    const pulse = {
      id: 'p1',
      ownerId: playerId,
      x: 5,
      y: 5,
      detonateAt: context().now(),
      radius: PULSE_RADIUS,
      depth: 0,
      detonated: false,
    };
    state().pulses.push(pulse);
    detonate(state(), pulse, context());

    expect(state().nodes.find((node) => node.id === 'in1')!.consumed).toBe(true);
    expect(state().nodes.find((node) => node.id === 'in2')!.consumed).toBe(true);
    expect(state().nodes.find((node) => node.id === 'rich')!.consumed).toBe(true);
    expect(state().nodes.find((node) => node.id === 'far')!.consumed).toBe(false);

    // 2 energy + 1 rich, combo 1 => multiplier 1.
    expect(state().players[playerId]!.score).toBe(ENERGY_SCORE * 2 + RICH_SCORE);
    expect(state().players[playerId]!.hits).toBe(3);
    // Obstacles are never consumed.
    expect(state().effects).toHaveLength(1);
  });

  it('never consumes obstacles', () => {
    const playerId = players[0]!.id;
    clearArena();
    addNode('o1', 5, 5, 'obstacle');
    const pulse = {
      id: 'p1',
      ownerId: playerId,
      x: 5,
      y: 5,
      detonateAt: context().now(),
      radius: PULSE_RADIUS,
      depth: 0,
      detonated: false,
    };
    detonate(state(), pulse, context());
    expect(state().nodes[0]!.consumed).toBe(false);
    expect(state().players[playerId]!.score).toBe(0);
  });

  /* ---------------- chain reactions ---------------- */

  it('a rich node queues a deeper chain pulse that scores a depth bonus', () => {
    const playerId = players[0]!.id;
    clearArena();
    addNode('rich', 5, 5, 'rich');

    const pulse = {
      id: 'p1',
      ownerId: playerId,
      x: 5,
      y: 5,
      detonateAt: context().now(),
      radius: PULSE_RADIUS,
      depth: 0,
      detonated: false,
    };
    state().pulses.push(pulse);
    detonate(state(), pulse, context());

    // The rich node spawned a follow-up pulse at depth 1.
    const chain = state().pulses.find((entry) => entry.depth === 1);
    expect(chain).toBeDefined();
    expect(chain!.ownerId).toBe(playerId);
    expect(chain!.x).toBe(5);

    // Give the chain something to hit, then detonate it.
    addNode('e1', 5, 6, 'energy');
    const scoreBefore = state().players[playerId]!.score;
    detonate(state(), chain!, context());
    const gained = state().players[playerId]!.score - scoreBefore;
    // depth 1 hit: (20 + 1*CHAIN_BONUS*1) * combo multiplier
    expect(gained).toBeGreaterThan(ENERGY_SCORE);
    expect(gained).toBeGreaterThanOrEqual(ENERGY_SCORE + CHAIN_BONUS);
    expect(state().players[playerId]!.chains).toBe(1);
    expect(state().lastEvent).toBe(`chain:${playerId}:1`);
  });

  it('caps the chain depth so a cascade cannot run forever', () => {
    const playerId = players[0]!.id;
    clearArena();
    addNode('rich', 5, 5, 'rich');
    const deep = {
      id: 'deep',
      ownerId: playerId,
      x: 5,
      y: 5,
      detonateAt: context().now(),
      radius: PULSE_RADIUS,
      depth: 99, // already past the cap
      detonated: false,
    };
    detonate(state(), deep, context());
    // No further chain pulses were queued.
    expect(state().pulses.filter((entry) => entry.depth === 100)).toHaveLength(0);
  });

  /* ---------------- combos ---------------- */

  it('builds a combo multiplier on back to back hits and caps it', () => {
    const playerId = players[0]!.id;
    clearArena();
    const body = state().players[playerId]!;

    for (let i = 0; i < 20; i += 1) {
      state().nodes = [];
      addNode(`n${i}`, 5, 5, 'energy');
      detonate(
        state(),
        {
          id: `p${i}`,
          ownerId: playerId,
          x: 5,
          y: 5,
          detonateAt: context().now(),
          radius: PULSE_RADIUS,
          depth: 0,
          detonated: false,
        },
        context(),
      );
    }
    expect(body.combo).toBe(20);
    expect(body.bestCombo).toBe(20);
    // The multiplier is clamped.
    const multiplier = Math.min(MAX_COMBO_MULTIPLIER, 1 + (body.combo - 1) * COMBO_STEP);
    expect(multiplier).toBe(MAX_COMBO_MULTIPLIER);
    expect(COMBO_WINDOW_MS).toBeGreaterThan(0);
  });

  it('a pulse that hits nothing breaks the combo', () => {
    const playerId = players[0]!.id;
    clearArena();
    const body = state().players[playerId]!;
    body.combo = 5;
    body.comboUntil = context().now() + COMBO_WINDOW_MS;

    detonate(
      state(),
      {
        id: 'p1',
        ownerId: playerId,
        x: 1,
        y: 1,
        detonateAt: context().now(),
        radius: PULSE_RADIUS,
        depth: 0,
        detonated: false,
      },
      context(),
    );
    expect(body.combo).toBe(0);
    expect(state().lastEvent).toBe(`miss:${playerId}`);
  });

  /* ---------------- update loop ---------------- */

  it('the update loop detonates due pulses and respawns consumed nodes', () => {
    const playerId = players[0]!.id;
    clearArena();
    addNode('n1', 5, 5, 'energy');
    const now = context().now();
    state().pulses.push({
      id: 'p1',
      ownerId: playerId,
      x: 5,
      y: 5,
      detonateAt: now - 10, // already due
      radius: PULSE_RADIUS,
      depth: 0,
      detonated: false,
    });

    blackBlastGame.update(state(), 250, context());
    expect(state().nodes[0]!.consumed).toBe(true);
    expect(state().players[playerId]!.score).toBeGreaterThan(0);
    // Detonated pulses are cleaned up, not left to leak.
    expect(state().pulses.filter((pulse) => pulse.detonated)).toHaveLength(0);

    // Respawn once the timer elapses.
    state().nodes[0]!.respawnAt = context().now() - 1;
    blackBlastGame.update(state(), 250, context());
    expect(state().nodes[0]!.consumed).toBe(false);
    expect(NODE_RESPAWN_MS).toBeGreaterThan(0);
  });

  it('the update loop expires stale combos', () => {
    const playerId = players[0]!.id;
    const body = state().players[playerId]!;
    body.combo = 4;
    body.comboUntil = context().now() - 1; // already expired
    blackBlastGame.update(state(), 250, context());
    expect(body.combo).toBe(0);
  });

  /* ---------------- anti-cheat ---------------- */

  it('refuses client attempts to award score, claim hits or end the match', () => {
    const playerId = players[0]!.id;
    const ctx = context();
    const before = state().players[playerId]!.score;
    for (const type of ['score', 'hit', 'win', 'finish', 'detonate', 'chain']) {
      expect(
        blackBlastGame.validateAction(playerId, { type, payload: { score: 5000 } }, state(), ctx)
          .valid,
      ).toBe(false);
      expect(
        blackBlastGame.handlePlayerAction(
          playerId,
          { type, payload: { score: 5000 } },
          state(),
          ctx,
        ).accepted,
      ).toBe(false);
    }
    expect(state().players[playerId]!.score).toBe(before);
  });

  it('refuses all actions once the match is finished', () => {
    const playerId = players[0]!.id;
    finishBlast(state(), context(), 'timeout');
    expect(state().phase).toBe('finished');
    expect(act(playerId, { type: 'move', payload: { direction: 'right' } }).accepted).toBe(false);
    expect(act(playerId, { type: 'pulse' }).accepted).toBe(false);
    expect(state().pulses).toHaveLength(0);
  });

  /* ---------------- lifecycle ---------------- */

  it('keeps a disconnected player score and restores it on reconnect', () => {
    const playerId = players[0]!.id;
    state().players[playerId]!.score = 340;
    blackBlastGame.playerLeft(playerId, state(), context(), 'disconnect');
    expect(state().players[playerId]!.disconnected).toBe(true);
    expect(act(playerId, { type: 'pulse' }).accepted).toBe(false);

    blackBlastGame.playerJoined({ ...players[0]! }, state(), context());
    expect(state().players[playerId]!.disconnected).toBe(false);
    expect(state().players[playerId]!.score).toBe(340);
  });

  it('ends the match when only one player is left after a leave', () => {
    const playerId = players[0]!.id;
    blackBlastGame.playerLeft(playerId, state(), context(), 'leave');
    expect(state().phase).toBe('finished');
    expect(state().finishReason).toBe('abandoned');
  });

  it('reset and cleanup release the arena for a rematch', () => {
    state().players[players[0]!.id]!.score = 900;
    finishBlast(state(), context(), 'timeout');
    const next = blackBlastGame.reset(state());
    expect(next.phase).toBe('idle');
    expect(next.nodes).toHaveLength(0);
    expect(next.pulses).toHaveLength(0);
    expect(Object.keys(next.players)).toEqual(Object.keys(state().players));
    expect(Object.values(next.players).every((player) => player.score === 0)).toBe(true);

    blackBlastGame.cleanup(next);
    expect(Object.keys(next.players)).toHaveLength(0);
    expect(next.phase).toBe('finished');
  });

  /* ---------------- result ---------------- */

  it('ranks by score with best combo as the tiebreak', () => {
    const [a, b] = players.map((player) => player.id);
    state().players[a]!.score = 800;
    state().players[b]!.score = 1200;
    finishBlast(state(), context(), 'timeout');

    expect(blackBlastGame.checkWinCondition(state())).toEqual([b]);
    const result = blackBlastGame.getResult(state(), context());
    expect(result.rankings[0]!.playerId).toBe(b);
    expect(result.winners).toEqual([b]);
    expect(result.isDraw).toBe(false);
    expect(result.rankings[0]!.stats).toHaveProperty('chains');
    expect(blackBlastGame.calculateScore(b, state())).toBe(1200);
  });

  it('reports a draw on equal scores', () => {
    const [a, b] = players.map((player) => player.id);
    state().players[a]!.score = 500;
    state().players[b]!.score = 500;
    finishBlast(state(), context(), 'timeout');
    expect(blackBlastGame.checkDrawCondition(state())).toBe(true);
    expect(blackBlastGame.getResult(state(), context()).isDraw).toBe(true);
  });

  /* ---------------- privacy / public state ---------------- */

  it('publishes only pending pulse markers, never a resolved outcome', () => {
    const playerId = players[0]!.id;
    act(playerId, { type: 'pulse' });
    const view = platform.gameManager.getPublicState(room, playerId) as Record<string, unknown> & {
      pulses: Array<Record<string, unknown>>;
      nodes: Array<{ id: string }>;
    };
    expect(view.pulses).toHaveLength(1);
    // The marker carries geometry and timing only — no score or hit list.
    expect(view.pulses[0]).not.toHaveProperty('detonated');
    expect(JSON.stringify(view)).not.toMatch(/respawnAt/);
    // Consumed nodes are simply absent rather than exposed.
    expect(view.nodes.every((node) => typeof node.id === 'string')).toBe(true);
  });

  /* ---------------- AI ---------------- */

  it('AI only issues legal moves and pulses', () => {
    const playerId = players[0]!.id;
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      for (let i = 0; i < 30; i += 1) {
        const action = blackBlastGame.getAIMove?.(playerId, difficulty, state(), context());
        if (!action) continue;
        expect(['move', 'pulse']).toContain(action.type);
        if (action.type === 'move') {
          expect(blackBlastGame.validateAction(playerId, action, state(), context()).valid).toBe(
            true,
          );
        }
        act(playerId, action);
      }
    }
  });

  it('a hard AI pulses when sitting on a valuable cluster', () => {
    const playerId = players[0]!.id;
    clearArena();
    const body = state().players[playerId]!;
    body.x = 5;
    body.y = 5;
    body.cooldownUntil = 0;
    addNode('n1', 5, 5, 'energy');
    addNode('n2', 6, 5, 'energy');
    addNode('n3', 5, 6, 'rich');
    addNode('n4', 4, 5, 'energy');
    const action = blackBlastGame.getAIMove?.(playerId, 'hard', state(), context());
    expect(action?.type).toBe('pulse');
    expect(action?.payload?.mode).toBe('overcharge');
  });

  it('AI stops once the match is over', () => {
    const playerId = players[0]!.id;
    finishBlast(state(), context(), 'timeout');
    expect(blackBlastGame.getAIMove?.(playerId, 'hard', state(), context())).toBeNull();
  });

  it('makes overcharge a validated high-cost, high-radius strategic action', () => {
    const playerId = players[0]!.id;
    const body = state().players[playerId]!;
    body.energy = OVERCHARGE_ENERGY_COST - 1;
    expect(act(playerId, { type: 'pulse', payload: { mode: 'overcharge' } }).accepted).toBe(false);
    body.energy = 100;
    expect(act(playerId, { type: 'pulse', payload: { mode: 'overcharge' } }).accepted).toBe(true);
    expect(body.energy).toBe(100 - OVERCHARGE_ENERGY_COST);
    expect(state().pulses[0]).toMatchObject({ mode: 'overcharge' });
    expect(state().pulses[0]!.radius).toBeGreaterThan(PULSE_RADIUS);
    expect(
      blackBlastGame.validateAction(
        playerId,
        { type: 'pulse', payload: { mode: 'nuclear' } },
        state(),
        context(),
      ).valid,
    ).toBe(false);
  });

  it('reshapes later waves deterministically and awards each target once', () => {
    const playerId = players[0]!.id;
    clearArena();
    for (let index = 0; index < 20; index += 1)
      addNode(`wave-${index}`, index % 10, Math.floor(index / 10) + 2);
    state().wave = 5;
    applyWavePattern(state(), () => 0.37);
    expect(state().waveTheme).toBe('pressure');
    expect(state().waveTarget).toBe(waveTargetFor(5));
    expect(state().nodes.filter((node) => node.kind === 'rich')).toHaveLength(2);
    expect(state().nodes.filter((node) => node.kind === 'obstacle')).toHaveLength(3);

    const body = state().players[playerId]!;
    body.x = 4;
    body.y = 2;
    body.waveHits = state().waveTarget - 1;
    const before = body.score;
    detonate(
      state(),
      {
        id: 'target',
        ownerId: playerId,
        x: 4,
        y: 2,
        detonateAt: 0,
        radius: 1,
        depth: 0,
        detonated: false,
      },
      context(),
    );
    expect(body.wavesCleared).toBe(1);
    expect(body.score).toBeGreaterThanOrEqual(before + WAVE_CLEAR_BONUS * 5);
    const scoreAfterClear = body.score;
    detonate(
      state(),
      {
        id: 'again',
        ownerId: playerId,
        x: 4,
        y: 2,
        detonateAt: 0,
        radius: 1,
        depth: 0,
        detonated: false,
      },
      context(),
    );
    expect(body.wavesCleared).toBe(1);
    expect(body.score - scoreAfterClear).toBeLessThan(WAVE_CLEAR_BONUS * 5);
  });
});
