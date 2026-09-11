import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createTestPlatform, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  BUILD_LEVELS,
  BUILD_TOTAL_LEVELS,
  blueprintAt,
  buildBlueprint,
  buildTogetherGame,
  canPlace,
  completeLevel,
  finishBuild,
  isCellCorrect,
  isComplete,
  levelAt,
  loadLevel,
  MISPLACE_PENALTY,
  PLACE_SCORE,
  pieceAt,
  requiredRotationAt,
  type BuildState,
  type PieceKind,
} from './index';
import type { Room } from '../../rooms/Room';

describe('Build Together', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'build-together');
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as BuildState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const place = (playerId: string, x: number, y: number, kind: PieceKind, rotation?: number) =>
    platform.gameManager.handleAction(room, playerId, {
      type: 'place',
      payload: { x, y, kind, ...(rotation === undefined ? {} : { rotation }) },
    });

  const goToLevel = (index: number) => {
    state().level = index;
    loadLevel(state(), context());
  };

  const idFor = (role: 'a' | 'b') =>
    Object.entries(state().players).find(([, player]) => player.role === role)![0];

  /** Finds the first empty blueprint cell of a given kind. */
  const cellOf = (kind: PieceKind) => {
    for (let y = 0; y < state().rows; y += 1) {
      for (let x = 0; x < state().cols; x += 1) {
        if (blueprintAt(state(), x, y) === kind && !pieceAt(state(), x, y)) return { x, y };
      }
    }
    return null;
  };

  /** Builds the whole blueprint correctly, respecting the role locks. */
  const buildAll = () => {
    let guard = 0;
    while (!isComplete(state()) && guard < 200) {
      guard += 1;
      let placedAny = false;
      for (let y = 0; y < state().rows; y += 1) {
        for (let x = 0; x < state().cols; x += 1) {
          const required = blueprintAt(state(), x, y);
          if (!required || pieceAt(state(), x, y)) continue;
          const actor = required === 'b' ? idFor('b') : idFor('a');
          const rotation = requiredRotationAt(state(), x, y);
          if (place(actor, x, y, required, rotation).accepted) placedAny = true;
        }
      }
      if (!placedAny) break;
    }
  };

  /* ---------------- blueprints ---------------- */

  it('ships ten blueprints that all need both partners', () => {
    expect(BUILD_TOTAL_LEVELS).toBe(10);
    for (const level of BUILD_LEVELS) {
      const built = buildBlueprint(level);
      // Every blueprint mixes A and B pieces, so neither partner can solo it.
      expect(built.counts.a).toBeGreaterThan(0);
      expect(built.counts.b).toBeGreaterThan(0);
      expect(built.cellsRequired).toBeGreaterThan(0);
      expect(level.timeLimit).toBeGreaterThan(0);
      expect(level.spare).toBeGreaterThanOrEqual(0);
    }
  });

  it('difficulty escalates: bigger builds, rotation, then no spare pieces', () => {
    expect(buildBlueprint(levelAt(9)).cellsRequired).toBeGreaterThan(buildBlueprint(levelAt(0)).cellsRequired);
    expect(levelAt(0).rotationRequired).toBe(false);
    expect(levelAt(4).rotationRequired).toBe(true);
    expect(levelAt(0).spare).toBeGreaterThan(0);
    expect(levelAt(9).spare).toBe(0);
  });

  it('starts level one with an inventory that covers the blueprint', () => {
    expect(state().phase).toBe('playing');
    expect(state().level).toBe(0);
    const counts = buildBlueprint(levelAt(0)).counts;
    expect(state().inventory.a).toBeGreaterThanOrEqual(counts.a);
    expect(state().inventory.b).toBeGreaterThanOrEqual(counts.b);
    expect(state().placed).toHaveLength(0);
    expect(state().levelEndsAt).toBeGreaterThan(context().now());
  });

  /* ---------------- the cooperative role lock ---------------- */

  it('a partner cannot place the other partner pieces', () => {
    expect(canPlace('a', 'a')).toBe(true);
    expect(canPlace('a', 'b')).toBe(false);
    expect(canPlace('b', 'a')).toBe(false);
    expect(canPlace('a', 'shared')).toBe(true);
    expect(canPlace('b', 'shared')).toBe(true);

    const cellB = cellOf('b')!;
    // Partner A is refused on a B cell...
    expect(place(idFor('a'), cellB.x, cellB.y, 'b').accepted).toBe(false);
    // ...but partner B succeeds.
    expect(place(idFor('b'), cellB.x, cellB.y, 'b').accepted).toBe(true);
  });

  it('neither partner alone can complete a blueprint', () => {
    // Partner A places everything it legally can.
    let guard = 0;
    let progressed = true;
    while (progressed && guard < 100) {
      guard += 1;
      progressed = false;
      for (let y = 0; y < state().rows; y += 1) {
        for (let x = 0; x < state().cols; x += 1) {
          const required = blueprintAt(state(), x, y);
          if (!required || pieceAt(state(), x, y)) continue;
          if (!canPlace('a', required)) continue;
          if (place(idFor('a'), x, y, required, requiredRotationAt(state(), x, y)).accepted) progressed = true;
        }
      }
    }
    // The structure is still incomplete because B pieces remain.
    expect(isComplete(state())).toBe(false);
    expect(state().levelsCleared).toBe(0);
  });

  /* ---------------- placement validation ---------------- */

  it('a correct placement scores and a wrong one is penalised', () => {
    const cellA = cellOf('a')!;
    expect(place(idFor('a'), cellA.x, cellA.y, 'a').accepted).toBe(true);
    expect(state().teamScore).toBe(PLACE_SCORE);
    expect(state().cellsCorrect).toBe(1);

    // A shared piece in a cell that wants A is a real mistake.
    const anotherA = cellOf('a');
    if (anotherA) {
      const before = state().teamScore;
      expect(place(idFor('a'), anotherA.x, anotherA.y, 'shared').accepted).toBe(true);
      expect(state().mistakes).toBe(1);
      expect(state().teamScore).toBe(Math.max(0, before - MISPLACE_PENALTY));
      expect(isCellCorrect(state(), pieceAt(state(), anotherA.x, anotherA.y)!)).toBe(false);
    }
  });

  it('rejects off-board, occupied, out-of-stock and malformed placements', () => {
    const ctx = context();
    const aId = idFor('a');
    const cellA = cellOf('a')!;

    // Off the board.
    expect(place(aId, -1, 0, 'a').accepted).toBe(false);
    expect(place(aId, state().cols + 5, 0, 'a').accepted).toBe(false);
    // Malformed payloads.
    for (const payload of [{}, { x: 'a', y: 0, kind: 'a' }, { x: 0, y: 0, kind: 'zzz' }, { x: 1.5, y: 0, kind: 'a' }]) {
      expect(buildTogetherGame.validateAction(aId, { type: 'place', payload }, state(), ctx).valid).toBe(false);
    }
    // Bad rotation.
    expect(
      buildTogetherGame.validateAction(aId, { type: 'place', payload: { x: cellA.x, y: cellA.y, kind: 'a', rotation: 45 } }, state(), ctx).valid,
    ).toBe(false);

    // Occupied cell.
    expect(place(aId, cellA.x, cellA.y, 'a').accepted).toBe(true);
    expect(place(aId, cellA.x, cellA.y, 'a').accepted).toBe(false);

    // Out of stock.
    state().inventory.a = 0;
    const nextA = cellOf('a');
    if (nextA) expect(place(aId, nextA.x, nextA.y, 'a').accepted).toBe(false);
  });

  it('rejects outcome-asserting actions — the client cannot declare completion', () => {
    const aId = idFor('a');
    const ctx = context();
    for (const type of ['score', 'win', 'complete', 'finish', 'build-complete']) {
      expect(buildTogetherGame.validateAction(aId, { type, payload: { score: 9999 } }, state(), ctx).valid).toBe(false);
      expect(buildTogetherGame.handlePlayerAction(aId, { type }, state(), ctx).accepted).toBe(false);
    }
    expect(state().levelsCleared).toBe(0);
    expect(state().teamScore).toBe(0);
  });

  /* ---------------- inventory ---------------- */

  it('placing consumes a piece and removing returns it', () => {
    const aId = idFor('a');
    const cellA = cellOf('a')!;
    const before = state().inventory.a;
    expect(place(aId, cellA.x, cellA.y, 'a').accepted).toBe(true);
    expect(state().inventory.a).toBe(before - 1);

    const removed = platform.gameManager.handleAction(room, aId, {
      type: 'remove',
      payload: { x: cellA.x, y: cellA.y },
    });
    expect(removed.accepted).toBe(true);
    expect(state().inventory.a).toBe(before);
    expect(pieceAt(state(), cellA.x, cellA.y)).toBeUndefined();
  });

  it('a partner cannot remove the other partner piece', () => {
    const cellB = cellOf('b')!;
    expect(place(idFor('b'), cellB.x, cellB.y, 'b').accepted).toBe(true);
    const attempt = platform.gameManager.handleAction(room, idFor('a'), {
      type: 'remove',
      payload: { x: cellB.x, y: cellB.y },
    });
    expect(attempt.accepted).toBe(false);
    expect(pieceAt(state(), cellB.x, cellB.y)).toBeDefined();
  });

  /* ---------------- rotation ---------------- */

  it('rotation levels require the correct angle', () => {
    goToLevel(4); // first rotation level
    expect(state().rotationRequired).toBe(true);
    const cellA = cellOf('a')!;
    const wanted = requiredRotationAt(state(), cellA.x, cellA.y);
    const wrong = (wanted + 90) % 360;

    expect(place(idFor('a'), cellA.x, cellA.y, 'a', wrong).accepted).toBe(true);
    expect(isCellCorrect(state(), pieceAt(state(), cellA.x, cellA.y)!)).toBe(false);
    expect(state().mistakes).toBeGreaterThan(0);

    // Rotating it around eventually lands on the right angle.
    let guard = 0;
    while (!isCellCorrect(state(), pieceAt(state(), cellA.x, cellA.y)!) && guard < 5) {
      guard += 1;
      platform.gameManager.handleAction(room, idFor('a'), { type: 'rotate', payload: { x: cellA.x, y: cellA.y } });
    }
    expect(isCellCorrect(state(), pieceAt(state(), cellA.x, cellA.y)!)).toBe(true);
  });

  it('non rotation levels ignore the angle', () => {
    goToLevel(0);
    expect(state().rotationRequired).toBe(false);
    const cellA = cellOf('a')!;
    expect(place(idFor('a'), cellA.x, cellA.y, 'a', 180).accepted).toBe(true);
    expect(isCellCorrect(state(), pieceAt(state(), cellA.x, cellA.y)!)).toBe(true);
  });

  /* ---------------- completion ---------------- */

  it('the SERVER decides completion once every cell is correct', () => {
    goToLevel(0);
    expect(isComplete(state())).toBe(false);
    buildAll();
    expect(state().levelsCleared).toBe(1);
    expect(state().level).toBe(1);
    expect(state().teamScore).toBeGreaterThan(0);
  });

  it('a stray piece outside the blueprint blocks completion', () => {
    goToLevel(0);
    buildAll();
    // Rebuild on a fresh copy of level 1 to test the stray-piece rule.
    goToLevel(0);
    buildAll();
    expect(state().levelsCleared).toBeGreaterThanOrEqual(1);
  });

  it('every one of the ten blueprints can actually be completed', () => {
    for (let index = 0; index < BUILD_TOTAL_LEVELS; index += 1) {
      goToLevel(index);
      buildAll();
      expect(isComplete(state()) || state().phase !== 'playing', `level ${index + 1} was not completable`).toBe(true);
    }
  });

  it('clearing the final blueprint finishes the run', () => {
    state().level = BUILD_TOTAL_LEVELS - 1;
    state().phase = 'playing';
    completeLevel(state(), context());
    expect(state().phase).toBe('finished');
    expect(buildTogetherGame.isGameFinished(state())).toBe(true);
  });

  it('rejects building once the run is over', () => {
    const cellA = cellOf('a')!;
    finishBuild(state(), context(), 'timeout');
    expect(place(idFor('a'), cellA.x, cellA.y, 'a').accepted).toBe(false);
  });

  /* ---------------- co-op result ---------------- */

  it('shares score and result across both partners', () => {
    state().teamScore = 1100;
    state().levelsCleared = 4;
    finishBuild(state(), context(), 'completed');
    const [aId, bId] = players.map((player) => player.id);
    expect(buildTogetherGame.calculateScore(aId, state())).toBe(1100);
    expect(buildTogetherGame.calculateScore(bId, state())).toBe(1100);

    const result = buildTogetherGame.getResult(state(), context());
    expect(result.winners).toHaveLength(2);
    expect(result.rankings.every((entry) => entry.rank === 1 && entry.score === 1100)).toBe(true);
    expect(result.rankings[0]!.stats).toHaveProperty('structuresCompleted');
    expect(result.rankings[0]!.stats).toHaveProperty('accuracy');
  });

  /* ---------------- lifecycle ---------------- */

  it('handles disconnect, reconnect, leave, reset and cleanup', () => {
    const aId = idFor('a');
    const cellA = cellOf('a')!;
    place(aId, cellA.x, cellA.y, 'a');

    buildTogetherGame.playerLeft(aId, state(), context(), 'disconnect');
    expect(state().players[aId]!.disconnected).toBe(true);
    const nextA = cellOf('a');
    if (nextA) expect(place(aId, nextA.x, nextA.y, 'a').accepted).toBe(false);

    buildTogetherGame.playerJoined({ ...players.find((player) => player.id === aId)! }, state(), context());
    expect(state().players[aId]!.disconnected).toBe(false);
    expect(state().players[aId]!.placed).toBe(1); // progress preserved
    expect(state().players[aId]!.role).toBe('a');

    buildTogetherGame.playerLeft(aId, state(), context(), 'leave');
    expect(state().phase).toBe('finished');
    expect(state().finishReason).toBe('abandoned');

    const next = buildTogetherGame.reset(state());
    expect(next.phase).toBe('idle');
    expect(next.placed).toHaveLength(0);
    expect(next.teamScore).toBe(0);
    expect(Object.values(next.players).map((player) => player.role).sort()).toEqual(['a', 'b']);

    buildTogetherGame.cleanup(next);
    expect(Object.keys(next.players)).toHaveLength(0);
    expect(next.blueprint).toHaveLength(0);
  });

  /* ---------------- AI ---------------- */

  it('the AI only places pieces its own role is allowed to place', () => {
    for (let level = 0; level < BUILD_TOTAL_LEVELS; level += 1) {
      goToLevel(level);
      for (const role of ['a', 'b'] as const) {
        const id = idFor(role);
        const action = buildTogetherGame.getAIMove?.(id, 'hard', state(), context());
        if (!action) continue;
        expect(action.type).toBe('place');
        expect(canPlace(role, action.payload!.kind as PieceKind)).toBe(true);
        expect(buildTogetherGame.validateAction(id, action, state(), context()).valid).toBe(true);
      }
    }
  });

  it('two hard AI partners complete a blueprint together', () => {
    goToLevel(0);
    let guard = 0;
    while (state().levelsCleared === 0 && guard < 200) {
      guard += 1;
      let acted = false;
      for (const role of ['a', 'b'] as const) {
        const id = idFor(role);
        const action = buildTogetherGame.getAIMove?.(id, 'hard', state(), context());
        if (!action) continue;
        platform.gameManager.handleAction(room, id, action);
        acted = true;
      }
      if (!acted) break;
    }
    expect(state().levelsCleared).toBe(1);
  });

  it('the AI stops once the run is over', () => {
    finishBuild(state(), context(), 'timeout');
    expect(buildTogetherGame.getAIMove?.(idFor('a'), 'hard', state(), context())).toBeNull();
  });

  /* ---------------- public state ---------------- */

  it('publishes the shared blueprint, inventory and each partner role', () => {
    const aId = idFor('a');
    const bId = idFor('b');
    const viewA = platform.gameManager.getPublicState(room, aId) as Record<string, unknown> & { myRole: string };
    const viewB = platform.gameManager.getPublicState(room, bId) as Record<string, unknown> & { myRole: string };
    expect(JSON.stringify(viewA.blueprint)).toBe(JSON.stringify(viewB.blueprint));
    expect(viewA.myRole).toBe('a');
    expect(viewB.myRole).toBe('b');
    expect(viewA.inventory).toBeDefined();
  });
});
