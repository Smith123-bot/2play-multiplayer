import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createPlayer, createTestPlatform, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  arenaForRound,
  blockedByTruth,
  buildArena,
  endRound,
  evaluateObjective,
  finishSplit,
  GOAL_SCORE,
  HAZARD_PENALTY,
  KEY_SCORE,
  lensForSeat,
  LENS_REVEAL,
  loadRound,
  openRound,
  PLATE_SCORE,
  ROUND_WIN_SCORE,
  SPLIT_ARENAS,
  SPLIT_TOTAL_ROUNDS,
  splitWorldGame,
  SWITCH_SCORE,
  viewTile,
  viewTiles,
  WRONG_ORDER_PENALTY,
  type SplitLens,
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
    platform.gameManager.getPublicState(room, viewerId) as Record<string, unknown> & {
      tiles: ViewTile[][];
      lens: SplitLens;
      players: Record<string, { x: number; y: number; score: number }>;
      orderHints: Array<{ x: number; y: number; order: number }>;
    };

  /** Opens the round so movement is legal (start() begins in the prep phase). */
  const open = () => {
    if (state().phase === 'prep') openRound(state(), context());
  };

  const move = (playerId: string, direction: 'up' | 'down' | 'left' | 'right') =>
    platform.gameManager.handleAction(room, playerId, { type: 'move', payload: { direction } });

  /** Teleports a body next to a target so a single legal step lands on it. */
  const placeBeside = (playerId: string, target: { x: number; y: number }) => {
    const body = state().players[playerId]!;
    body.x = target.x - 1;
    body.y = target.y;
    return () => move(playerId, 'right');
  };

  /** Rebuilds the room state on a specific arena index. */
  const loadArena = (index: number) => {
    state().round = index;
    loadRound(state(), context());
    state().phase = 'playing';
    state().endsAt = context().now() + 60_000;
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

  /* ---------------------------------------------------------------- */
  /* Initialisation and arenas                                         */
  /* ---------------------------------------------------------------- */

  it('initialises a five round match on the first arena with complementary lenses', () => {
    expect(state().phase).toBe('prep');
    expect(state().round).toBe(0);
    expect(state().totalRounds).toBe(SPLIT_TOTAL_ROUNDS);
    expect(SPLIT_TOTAL_ROUNDS).toBe(5);
    expect(state().arenaId).toBe(SPLIT_ARENAS[0]!.id);
    expect(state().players[players[0]!.id]!.lens).toBe('warden');
    expect(state().players[players[1]!.id]!.lens).toBe('gatekeeper');
    expect(state().prepUntil).toBeGreaterThan(context().now());
  });

  it('ships five distinct, well formed arenas covering five objective types', () => {
    expect(SPLIT_ARENAS).toHaveLength(5);
    expect(new Set(SPLIT_ARENAS.map((arena) => arena.id)).size).toBe(5);
    expect(new Set(SPLIT_ARENAS.map((arena) => arena.objective)).size).toBe(5);

    for (const arena of SPLIT_ARENAS) {
      const built = buildArena(arena, () => 0.5);
      const width = built.tiles[0]!.length;
      // Rectangular, walled and with at least two spawns and an exit.
      expect(built.tiles.every((row) => row.length === width)).toBe(true);
      expect(built.spawns.length).toBeGreaterThanOrEqual(2);
      expect(built.goal).not.toBeNull();
      expect(built.door).not.toBeNull();
      expect(built.tiles[0]!.every((tile) => tile === 'wall')).toBe(true);
    }
  });

  it('generates a secret switch order and key sequence from the seeded PRNG', () => {
    const orderArena = SPLIT_ARENAS.find((arena) => arena.objective === 'switch-order')!;
    const built = buildArena(orderArena, () => 0.42);
    const orders = built.switches.map((entry) => entry.order).sort();
    expect(orders).toEqual([...orders.keys()]);

    const seqArena = SPLIT_ARENAS.find((arena) => arena.objective === 'sequence-keys')!;
    const seqBuilt = buildArena(seqArena, () => 0.42);
    const sequence = seqBuilt.keys.map((entry) => entry.seq).sort((a, b) => a - b);
    expect(sequence).toEqual([...sequence.keys()]);
  });

  /* ---------------------------------------------------------------- */
  /* Player-specific information / hidden information protection       */
  /* ---------------------------------------------------------------- */

  it('gives every lens a different but useful projection of the same tile', () => {
    expect(viewTile('switch', 'warden')).toBe('switch');
    expect(viewTile('switch', 'gatekeeper')).toBe('floor');
    expect(viewTile('hazard', 'gatekeeper')).toBe('hazard');
    expect(viewTile('hazard', 'warden')).toBe('floor');
    expect(viewTile('door', 'gatekeeper')).toBe('door');
    expect(viewTile('door', 'warden')).toBe('floor');
    expect(viewTile('goal', 'warden')).toBe('goal');
    expect(viewTile('goal', 'gatekeeper')).toBe('floor');
    // Walls are real for everyone — the world stays consistent.
    expect(viewTile('wall', 'warden')).toBe('wall');
    expect(viewTile('wall', 'scout')).toBe('wall');
    // A decoy is floor in truth but is drawn differently per lens.
    expect(viewTile('decoy', 'warden')).toBe('wall');
    expect(viewTile('decoy', 'gatekeeper')).toBe('switch');
  });

  it('the two base lenses together cover every object type (2 player solvable)', () => {
    const warden = LENS_REVEAL[lensForSeat(0)];
    const gatekeeper = LENS_REVEAL[lensForSeat(1)];
    for (const field of ['switches', 'plates', 'keys', 'hazards', 'door', 'goal'] as const) {
      expect(warden[field] || gatekeeper[field]).toBe(true);
    }
    // ...but neither seat alone can see everything.
    expect(Object.values(warden).includes(false)).toBe(true);
    expect(Object.values(gatekeeper).includes(false)).toBe(true);
  });

  it('never leaks the true layout, secret order or hidden objects to a client', () => {
    loadArena(4); // extraction: keys in sequence + hazards
    const [alphaId, betaId] = players.map((player) => player.id);
    const alpha = publicState(alphaId);
    const beta = publicState(betaId);

    for (const payload of [alpha, beta]) {
      const json = JSON.stringify(payload);
      expect(json).not.toMatch(/trueTiles/);
      expect(json).not.toMatch(/"seq"/);
      expect(json).not.toMatch(/decoy/);
      expect(payload.trueTiles).toBeUndefined();
      expect(payload.switches).toBeUndefined();
      expect(payload.keys).toBeUndefined();
      expect(payload.plates).toBeUndefined();
      expect(payload.spawns).toBeUndefined();
    }

    // The gatekeeper cannot see keys; the warden can.
    const keyCell = state().keys[0]!;
    expect(alpha.tiles[keyCell.y]![keyCell.x]).toBe('key');
    expect(beta.tiles[keyCell.y]![keyCell.x]).toBe('floor');

    // The warden cannot see hazards or the gate; the gatekeeper can.
    const door = state().door!;
    expect(alpha.tiles[door.y]![door.x]).toBe('floor');
    expect(beta.tiles[door.y]![door.x]).toBe('door');
    expect(alpha.goal).not.toBeNull();
    expect(beta.goal).toBeNull();
    expect(beta.door).not.toBeNull();
    expect(alpha.door).toBeNull();
  });

  it('player A cannot obtain player B slice of the secret ordering', () => {
    loadArena(2); // order hall: switch-order
    const [alphaId, betaId] = players.map((player) => player.id);
    const alpha = publicState(alphaId);
    const beta = publicState(betaId);

    // Hints are split across seats and no seat holds the whole solution.
    const total = state().switches.length;
    expect(alpha.orderHints.length).toBeLessThan(total);
    const alphaOrders = alpha.orderHints.map((hint) => hint.order);
    const betaOrders = beta.orderHints.map((hint) => hint.order);
    expect(alphaOrders.some((order) => betaOrders.includes(order))).toBe(false);
    // The gatekeeper lens has no switch vision at all, so it gets no switch hints.
    expect(beta.orderHints).toHaveLength(0);
  });

  it('projects tiles without mutating the authoritative world', () => {
    const before = JSON.stringify(state().trueTiles);
    viewTiles(state().trueTiles, 'scout');
    publicState(players[0]!.id);
    expect(JSON.stringify(state().trueTiles)).toBe(before);
  });

  /* ---------------------------------------------------------------- */
  /* Movement / collision / anti-cheat                                 */
  /* ---------------------------------------------------------------- */

  it('blocks movement during prep and accepts it once the round opens', () => {
    expect(state().phase).toBe('prep');
    expect(move(players[0]!.id, 'right').accepted).toBe(false);
    open();
    expect(state().phase).toBe('playing');
    expect(move(players[0]!.id, 'right').accepted).toBe(true);
  });

  it('rejects moves through real walls and through a closed gate', () => {
    open();
    const playerId = players[0]!.id;
    const body = state().players[playerId]!;
    // Walk into the outer wall.
    body.x = 1;
    body.y = 1;
    expect(move(playerId, 'up').accepted).toBe(false);
    expect(move(playerId, 'left').accepted).toBe(false);

    // The gate is shut until the objective completes.
    const door = state().door!;
    state().doorOpen = false;
    body.x = door.x - 1;
    body.y = door.y;
    expect(blockedByTruth(state(), door.x, door.y)).toBe(true);
    expect(move(playerId, 'right').accepted).toBe(false);
  });

  it('rejects out of bounds, unknown, malformed and outcome-asserting actions', () => {
    open();
    const playerId = players[0]!.id;
    const ctx = context();

    // The client may never assert score, completion or a winner.
    for (const type of ['score', 'reveal', 'open', 'world', 'win', 'complete', 'finish']) {
      expect(splitWorldGame.validateAction(playerId, { type, payload: { score: 9999 } }, state(), ctx).valid).toBe(
        false,
      );
      expect(splitWorldGame.handlePlayerAction(playerId, { type }, state(), ctx).accepted).toBe(false);
    }
    // Malformed direction payloads.
    for (const direction of [undefined, null, 'diagonal', 42, { x: 1 }]) {
      expect(
        splitWorldGame.validateAction(playerId, { type: 'move', payload: { direction } }, state(), ctx).valid,
      ).toBe(false);
    }
    // Unknown player id.
    expect(
      splitWorldGame.validateAction('ghost-player', { type: 'move', payload: { direction: 'right' } }, state(), ctx)
        .valid,
    ).toBe(false);

    const before = state().players[playerId]!.score;
    splitWorldGame.handlePlayerAction(playerId, { type: 'score', payload: { score: 9999 } }, state(), ctx);
    expect(state().players[playerId]!.score).toBe(before);
  });

  it('rejects actions after the round is over and after the match finishes', () => {
    open();
    const playerId = players[0]!.id;
    finishSplit(state(), context(), 'timeout');
    expect(move(playerId, 'right').accepted).toBe(false);
    expect(
      splitWorldGame.validateAction(playerId, { type: 'move', payload: { direction: 'right' } }, state(), context())
        .valid,
    ).toBe(false);
  });

  /* ---------------------------------------------------------------- */
  /* Objectives and scoring                                            */
  /* ---------------------------------------------------------------- */

  it('scores switches, opens the gate and awards the exit only after it opens', () => {
    loadArena(0); // twin causeway: reach-exit
    const [alphaId, betaId] = players.map((player) => player.id);

    placeBeside(alphaId, state().switches[0]!)();
    expect(state().players[alphaId]!.score).toBe(SWITCH_SCORE);
    expect(state().doorOpen).toBe(false);

    placeBeside(betaId, state().switches[1]!)();
    expect(state().doorOpen).toBe(true);
    expect(state().objectiveComplete).toBe(true);

    const goal = state().goal!;
    const beta = state().players[betaId]!;
    beta.x = goal.x - 1;
    beta.y = goal.y;
    move(betaId, 'right');
    expect(state().players[betaId]!.finished).toBe(true);
    expect(state().players[betaId]!.score).toBeGreaterThanOrEqual(SWITCH_SCORE + GOAL_SCORE);
  });

  it('never pays a switch or a key twice', () => {
    loadArena(0);
    const alphaId = players[0]!.id;
    const target = state().switches[0]!;
    placeBeside(alphaId, target)();
    const afterFirst = state().players[alphaId]!.score;
    expect(afterFirst).toBe(SWITCH_SCORE);

    // Step off and back on: no second reward.
    move(alphaId, 'left');
    move(alphaId, 'right');
    expect(state().players[alphaId]!.score).toBe(afterFirst);
    expect(state().switches.filter((entry) => entry.triggered)).toHaveLength(1);
  });

  it('collect-keys unlocks the gate only once enough keys are taken', () => {
    loadArena(1); // key vault
    const alphaId = players[0]!.id;
    expect(state().objective).toBe('collect-keys');
    const required = state().keysRequired;
    expect(required).toBeGreaterThan(1);

    state().keys.slice(0, required - 1).forEach((entry) => {
      entry.taken = true;
    });
    evaluateObjective(state());
    expect(state().doorOpen).toBe(false);

    const last = state().keys.find((entry) => !entry.taken)!;
    placeBeside(alphaId, last)();
    expect(state().players[alphaId]!.score).toBe(KEY_SCORE);
    expect(state().doorOpen).toBe(true);
  });

  it('switch-order punishes the wrong switch and resets the sequence', () => {
    loadArena(2); // order hall
    const alphaId = players[0]!.id;
    expect(state().objective).toBe('switch-order');

    const wrong = state().switches.find((entry) => entry.order !== 0)!;
    placeBeside(alphaId, wrong)();
    expect(state().lastEvent).toBe(`wrong:${alphaId}`);
    expect(state().orderProgress).toBe(0);
    expect(state().players[alphaId]!.score).toBe(0); // clamped at zero

    // Now the correct one advances the order.
    const first = state().switches.find((entry) => entry.order === 0)!;
    placeBeside(alphaId, first)();
    expect(state().orderProgress).toBe(1);
    expect(state().players[alphaId]!.score).toBe(SWITCH_SCORE);
  });

  it('pressure plates must be held simultaneously and release when a player steps off', () => {
    loadArena(3); // mirror basin
    const [alphaId, betaId] = players.map((player) => player.id);
    expect(state().objective).toBe('pressure-plates');

    placeBeside(alphaId, state().plates[0]!)();
    expect(state().doorOpen).toBe(false);
    expect(state().players[alphaId]!.score).toBe(PLATE_SCORE);

    placeBeside(betaId, state().plates[1]!)();
    expect(state().plates.filter((plate) => plate.pressed).length).toBeGreaterThanOrEqual(2);
    expect(state().doorOpen).toBe(true);

    // Stepping off closes the vault again — plates latch nothing.
    move(alphaId, 'left');
    expect(state().doorOpen).toBe(false);
  });

  it('hazards cost points, stun the player and bounce them back', () => {
    loadArena(1); // key vault has hazards
    const alphaId = players[0]!.id;
    const hazard = state().trueTiles.flatMap((row, y) =>
      row.map((tile, x) => (tile === 'hazard' ? { x, y } : null)),
    ).find(Boolean) as { x: number; y: number };

    const body = state().players[alphaId]!;
    body.score = 100;
    body.roundScore = 100;
    const step = placeBeside(alphaId, hazard);
    const from = { x: body.x, y: body.y };
    step();

    expect(state().players[alphaId]!.score).toBe(100 - HAZARD_PENALTY);
    expect(state().players[alphaId]!.stunUntil).toBeGreaterThan(context().now());
    // Bounced back to where the step started.
    expect({ x: state().players[alphaId]!.x, y: state().players[alphaId]!.y }).toEqual(from);
    // Stunned players cannot act.
    expect(move(alphaId, 'left').accepted).toBe(false);
  });

  it('never lets a score go negative', () => {
    loadArena(2);
    const alphaId = players[0]!.id;
    const wrong = state().switches.find((entry) => entry.order !== 0)!;
    for (let i = 0; i < 5; i += 1) {
      const body = state().players[alphaId]!;
      body.x = wrong.x - 1;
      body.y = wrong.y;
      move(alphaId, 'right');
    }
    expect(state().players[alphaId]!.score).toBeGreaterThanOrEqual(0);
    expect(WRONG_ORDER_PENALTY).toBeGreaterThan(0);
  });

  /* ---------------------------------------------------------------- */
  /* Round progression and match completion                            */
  /* ---------------------------------------------------------------- */

  it('awards the round bonus and advances to the next arena', () => {
    open();
    const alphaId = players[0]!.id;
    state().players[alphaId]!.roundScore = 90;
    endRound(state(), context(), 'completed');

    expect(state().players[alphaId]!.roundsWon).toBe(1);
    expect(state().players[alphaId]!.score).toBeGreaterThanOrEqual(ROUND_WIN_SCORE);
    expect(state().round).toBe(1);
    expect(state().phase).toBe('intermission');
  });

  it('plays through every round and finishes the match after the last arena', () => {
    open();
    for (let i = 0; i < SPLIT_TOTAL_ROUNDS; i += 1) {
      if (state().phase === 'intermission') {
        state().phase = 'prep';
        loadRound(state(), context());
        openRound(state(), context());
      }
      endRound(state(), context(), 'timeout');
    }
    expect(state().phase).toBe('finished');
    expect(splitWorldGame.isGameFinished(state())).toBe(true);
    expect(state().finishReason).toBe('completed');
  });

  it('rotates a distinct arena into every round of the match', () => {
    const seen = new Set<string>();
    for (let round = 0; round < SPLIT_TOTAL_ROUNDS; round += 1) seen.add(arenaForRound(round).id);
    expect(seen.size).toBe(SPLIT_TOTAL_ROUNDS);
  });

  it('honours a shorter configured round count', async () => {
    const local = createTestPlatform();
    const fixture = await createGameFixture(local.platform, 'split-world', { settings: { rounds: 2 } });
    expect((fixture.room.gameState as SplitState).totalRounds).toBe(2);
    local.destroy();
  });

  it('computes the winner from the server score, with rounds won as the tiebreak', () => {
    const [alphaId, betaId] = players.map((player) => player.id);
    state().players[alphaId]!.score = 240;
    state().players[betaId]!.score = 130;
    finishSplit(state(), context(), 'completed');

    expect(splitWorldGame.checkWinCondition(state())).toEqual([alphaId]);
    expect(splitWorldGame.checkDrawCondition(state())).toBe(false);
    expect(splitWorldGame.calculateScore(alphaId, state())).toBe(240);

    const result = splitWorldGame.getResult(state(), context());
    expect(result.winners).toEqual([alphaId]);
    expect(result.rankings[0]!.playerId).toBe(alphaId);
    expect(result.rankings[0]!.rank).toBe(1);
    expect(result.rankings[0]!.isWinner).toBe(true);
    expect(result.rankings[1]!.score).toBe(130);
    expect(result.rankings[0]!.stats).toHaveProperty('roundsWon');
  });

  it('reports a draw when scores are level', () => {
    const [alphaId, betaId] = players.map((player) => player.id);
    state().players[alphaId]!.score = 100;
    state().players[betaId]!.score = 100;
    finishSplit(state(), context(), 'timeout');
    expect(splitWorldGame.checkDrawCondition(state())).toBe(true);
    expect(splitWorldGame.getResult(state(), context()).isDraw).toBe(true);
  });

  /* ---------------------------------------------------------------- */
  /* Lifecycle: disconnect, reconnect, leave, rematch, cleanup         */
  /* ---------------------------------------------------------------- */

  it('keeps a disconnected seat and restores its state on reconnect', () => {
    loadArena(3);
    const [alphaId] = players.map((player) => player.id);
    const body = state().players[alphaId]!;
    body.score = 75;
    body.roundsWon = 1;
    const plate = state().plates[0]!;
    body.x = plate.x;
    body.y = plate.y;
    evaluateObjective(state());
    expect(state().plates[0]!.pressed).toBe(true);

    splitWorldGame.playerLeft(alphaId, state(), context(), 'disconnect');
    expect(state().players[alphaId]!.disconnected).toBe(true);
    // A disconnected body cannot keep a plate held for the team.
    expect(state().plates[0]!.pressed).toBe(false);
    expect(move(alphaId, 'left').accepted).toBe(false);

    splitWorldGame.playerJoined({ ...players[0]! }, state(), context());
    const restored = state().players[alphaId]!;
    expect(restored.disconnected).toBe(false);
    expect(restored.score).toBe(75); // score, lens and seat all survive
    expect(restored.roundsWon).toBe(1);
    expect(restored.lens).toBe('warden');
  });

  it('ends the match once too few players remain to continue', async () => {
    // A 2 player room drops below the minimum as soon as one seat leaves.
    const [first] = players.map((player) => player.id);
    splitWorldGame.playerLeft(first, state(), context(), 'leave');
    expect(state().players[first]!.left).toBe(true);
    expect(state().phase).toBe('finished');
    expect(state().finishReason).toBe('abandoned');

    // With four seats the match survives the first two departures.
    await startWithPlayers(4);
    const ids = players.map((player) => player.id);
    splitWorldGame.playerLeft(ids[0]!, state(), context(), 'leave');
    expect(state().phase).not.toBe('finished');
    splitWorldGame.playerLeft(ids[1]!, state(), context(), 'leave');
    expect(state().phase).not.toBe('finished');
    splitWorldGame.playerLeft(ids[2]!, state(), context(), 'leave');
    expect(state().phase).toBe('finished');
    expect(state().finishReason).toBe('abandoned');
  });

  it('reset produces a fresh match on the same seats for a rematch', () => {
    open();
    const seats = Object.keys(state().players);
    state().players[seats[0]!]!.score = 320;
    state().players[seats[0]!]!.roundsWon = 3;
    state().round = 4;
    finishSplit(state(), context(), 'completed');

    const next = splitWorldGame.reset(state());
    expect(Object.keys(next.players)).toEqual(seats);
    expect(next.phase).toBe('idle');
    expect(next.round).toBe(0);
    expect(next.finishReason).toBeNull();
    expect(next.players[seats[0]!]!.score).toBe(0);
    expect(next.players[seats[0]!]!.roundsWon).toBe(0);
    // Lenses are stable across a rematch so seats keep their role.
    expect(next.players[seats[0]!]!.lens).toBe('warden');
    expect(next.players[seats[1]!]!.lens).toBe('gatekeeper');
    expect(next.totalRounds).toBe(SPLIT_TOTAL_ROUNDS);
  });

  it('cleanup releases the world', () => {
    const next = splitWorldGame.reset(state());
    splitWorldGame.cleanup(next);
    expect(Object.keys(next.players)).toHaveLength(0);
    expect(next.trueTiles).toHaveLength(0);
    expect(next.switches).toHaveLength(0);
    expect(next.keys).toHaveLength(0);
    expect(next.phase).toBe('finished');
  });

  /* ---------------------------------------------------------------- */
  /* AI                                                                */
  /* ---------------------------------------------------------------- */

  it('AI returns only legal moves on every arena and difficulty', () => {
    for (let arena = 0; arena < SPLIT_ARENAS.length; arena += 1) {
      loadArena(arena);
      for (const difficulty of ['easy', 'medium', 'hard'] as const) {
        for (let attempt = 0; attempt < 8; attempt += 1) {
          const action = splitWorldGame.getAIMove?.(players[0]!.id, difficulty, state(), context());
          if (!action) continue;
          expect(action.type).toBe('move');
          expect(
            splitWorldGame.validateAction(players[0]!.id, action, state(), context()).valid,
          ).toBe(true);
        }
      }
    }
  });

  it('AI does not act while stunned, finished or outside a live round', () => {
    loadArena(0);
    const playerId = players[0]!.id;
    state().players[playerId]!.stunUntil = context().now() + 5_000;
    expect(splitWorldGame.getAIMove?.(playerId, 'hard', state(), context())).toBeNull();

    state().players[playerId]!.stunUntil = 0;
    state().players[playerId]!.finished = true;
    expect(splitWorldGame.getAIMove?.(playerId, 'hard', state(), context())).toBeNull();

    state().players[playerId]!.finished = false;
    state().phase = 'prep';
    expect(splitWorldGame.getAIMove?.(playerId, 'hard', state(), context())).toBeNull();
  });

  it('a hard AI makes real progress toward the objective', () => {
    loadArena(0);
    const playerId = players[0]!.id;
    const target = state().switches[0]!;
    const body = state().players[playerId]!;
    const startDistance = Math.abs(body.x - target.x) + Math.abs(body.y - target.y);

    for (let step = 0; step < 40; step += 1) {
      const action = splitWorldGame.getAIMove?.(playerId, 'hard', state(), context());
      if (!action) break;
      platform.gameManager.handleAction(room, playerId, action);
      if (state().switches.some((entry) => entry.triggered)) break;
    }
    const current = state().players[playerId]!;
    const endDistance = Math.abs(current.x - target.x) + Math.abs(current.y - target.y);
    expect(state().switches.some((entry) => entry.triggered) || endDistance < startDistance).toBe(true);
  });

  /* ---------------------------------------------------------------- */
  /* Player counts                                                     */
  /* ---------------------------------------------------------------- */

  it('supports 3 and 4 player matches with four distinct lenses', async () => {
    for (const count of [3, 4] as const) {
      await startWithPlayers(count);
      expect(Object.keys(state().players)).toHaveLength(count);
      const lenses = Object.values(state().players).map((player) => player.lens);
      expect(new Set(lenses).size).toBe(count);
      expect(lenses).toContain('warden');
      expect(lenses).toContain('gatekeeper');
      // Every seat gets its own spawn point.
      const positions = Object.values(state().players).map((player) => `${player.x}:${player.y}`);
      expect(new Set(positions).size).toBe(count);
    }
  });
});
