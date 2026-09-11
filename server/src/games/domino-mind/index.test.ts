import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createTestPlatform, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  DOMINO_LEVELS,
  DOMINO_TOTAL_LEVELS,
  FACINGS,
  clonePieces,
  dominoMindGame,
  endLevel,
  finishDominoMind,
  inBounds,
  levelAt,
  pieceAt,
  simulate,
  startPieceOf,
  targetsOf,
  type DominoLevel,
  type DominoMindState,
  type Facing,
  type Piece,
} from './index';
import type { Room } from '../../rooms/Room';

/** Exhaustive solver used to prove each level is winnable within budget. */
function minPlacements(level: DominoLevel, max = 3): number | null {
  const run = (pieces: Piece[]): boolean => {
    const start = startPieceOf(pieces);
    if (!start) return false;
    return simulate(pieces, level, level.reach, start.id, level.requiredTargets, level.forbidden).result
      .success;
  };
  const base = clonePieces(level);
  const free: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < level.rows; y += 1) {
    for (let x = 0; x < level.cols; x += 1) {
      if (!pieceAt(base, x, y)) free.push({ x, y });
    }
  }
  const build = (indices: number[], facings: Facing[]): Piece[] => [
    ...clonePieces(level),
    ...indices.map((value, slot) => ({
      id: `p${slot}`,
      x: free[value]!.x,
      y: free[value]!.y,
      facing: facings[slot] as Facing,
      kind: 'domino' as const,
      fallen: false,
      fallOrder: -1,
    })),
  ];

  if (run(base)) return 0;
  for (let i = 0; i < free.length; i += 1) {
    for (const f1 of FACINGS) if (run(build([i], [f1]))) return 1;
  }
  if (max < 2 || level.budget < 2) return null;
  for (let i = 0; i < free.length; i += 1) {
    for (const f1 of FACINGS) {
      for (let j = i + 1; j < free.length; j += 1) {
        for (const f2 of FACINGS) if (run(build([i, j], [f1, f2]))) return 2;
      }
    }
  }
  return null;
}

describe('Domino Mind', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'domino-mind');
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as DominoMindState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const act = (playerId: string, action: { type: string; payload?: Record<string, unknown> }) =>
    platform.gameManager.handleAction(room, playerId, action);
  const piecesOf = (playerId: string) => state().players[playerId]!.pieces;

  /* ---------------- levels ---------------- */

  it('ships ten levels, each with a start piece and at least one target', () => {
    expect(DOMINO_TOTAL_LEVELS).toBe(10);
    for (const level of DOMINO_LEVELS) {
      expect(startPieceOf(level.pieces), `level ${level.id} has no start piece`).toBeDefined();
      expect(level.requiredTargets.length).toBeGreaterThan(0);
      // Every required target must actually exist on the board.
      for (const id of level.requiredTargets) {
        expect(level.pieces.some((piece) => piece.id === id), `${id} missing in level ${level.id}`).toBe(true);
      }
      for (const id of level.forbidden) {
        expect(level.pieces.some((piece) => piece.id === id)).toBe(true);
      }
      expect(level.timeLimit).toBeGreaterThan(0);
      expect(level.reach).toBeGreaterThan(0);
    }
  });

  it('EVERY level is solvable within its placement budget', () => {
    for (const level of DOMINO_LEVELS) {
      const needed = minPlacements(level);
      expect(needed, `level ${level.id} (${level.name}) has no solution`).not.toBeNull();
      expect(needed!, `level ${level.id} exceeds its budget`).toBeLessThanOrEqual(level.budget);
    }
  });

  it('NO level is trivially solvable by pushing without placing anything', () => {
    // This is the key design guard: the puzzle must require real reasoning.
    for (const level of DOMINO_LEVELS) {
      expect(minPlacements(level), `level ${level.id} is a click-to-win`).toBeGreaterThan(0);
    }
  });

  /* ---------------- simulation ---------------- */

  it('topples the first standing piece within reach along the facing', () => {
    const level = { cols: 6, rows: 3, reach: 2 };
    const pieces: Piece[] = [
      { id: 'a', x: 0, y: 1, facing: 'E', kind: 'start', fallen: false, fallOrder: -1 },
      { id: 'b', x: 1, y: 1, facing: 'E', kind: 'domino', fallen: false, fallOrder: -1 },
      { id: 'c', x: 5, y: 1, facing: 'E', kind: 'domino', fallen: false, fallOrder: -1 },
    ];
    const hits = targetsOf(pieces[0]!, pieces, level, 2);
    // Only 'b' is within reach; 'c' is four cells away.
    expect(hits.map((piece) => piece.id)).toEqual(['b']);
  });

  it('cannot reach past an intervening domino', () => {
    const level = { cols: 6, rows: 3, reach: 3 };
    const pieces: Piece[] = [
      { id: 'a', x: 0, y: 1, facing: 'E', kind: 'start', fallen: false, fallOrder: -1 },
      { id: 'b', x: 1, y: 1, facing: 'E', kind: 'domino', fallen: false, fallOrder: -1 },
      { id: 'c', x: 2, y: 1, facing: 'E', kind: 'domino', fallen: false, fallOrder: -1 },
    ];
    // Even with reach 3, only the first piece in the line is hit.
    expect(targetsOf(pieces[0]!, pieces, level, 3).map((piece) => piece.id)).toEqual(['b']);
  });

  it('a blocker stops the chain and never falls', () => {
    const level = { cols: 6, rows: 3, reach: 3 };
    const pieces: Piece[] = [
      { id: 'a', x: 0, y: 1, facing: 'E', kind: 'start', fallen: false, fallOrder: -1 },
      { id: 'x', x: 1, y: 1, facing: 'E', kind: 'blocker', fallen: false, fallOrder: -1 },
      { id: 't', x: 2, y: 1, facing: 'E', kind: 'target', fallen: false, fallOrder: -1 },
    ];
    const { result } = simulate(pieces, level, 3, 'a', ['t'], []);
    expect(result.fallen).toEqual(['a']);
    expect(result.standing).toContain('x');
    expect(result.standing).toContain('t');
    expect(result.success).toBe(false);
  });

  it('a splitter topples sideways as well as forward', () => {
    const level = { cols: 5, rows: 5, reach: 2 };
    const pieces: Piece[] = [
      { id: 'a', x: 0, y: 2, facing: 'E', kind: 'start', fallen: false, fallOrder: -1 },
      { id: 's', x: 1, y: 2, facing: 'E', kind: 'splitter', fallen: false, fallOrder: -1 },
      { id: 'up', x: 1, y: 1, facing: 'N', kind: 'target', fallen: false, fallOrder: -1 },
      { id: 'down', x: 1, y: 3, facing: 'S', kind: 'target', fallen: false, fallOrder: -1 },
    ];
    const { result } = simulate(pieces, level, 2, 'a', ['up', 'down'], []);
    expect(result.success).toBe(true);
    expect(result.fallen).toContain('up');
    expect(result.fallen).toContain('down');
  });

  it('is deterministic and reacts to layout changes (not pre-recorded)', () => {
    const level = levelAt(0);
    const base = clonePieces(level);
    const start = startPieceOf(base)!;
    const first = simulate(base, level, level.reach, start.id, level.requiredTargets, level.forbidden).result;
    const second = simulate(base, level, level.reach, start.id, level.requiredTargets, level.forbidden).result;
    // Same board, same outcome.
    expect(first.fallen).toEqual(second.fallen);

    // Adding a bridging domino changes the outcome.
    const bridged = [
      ...clonePieces(level),
      { id: 'p1', x: 1, y: 1, facing: 'E' as Facing, kind: 'domino' as const, fallen: false, fallOrder: -1 },
    ];
    const changed = simulate(bridged, level, level.reach, start.id, level.requiredTargets, level.forbidden)
      .result;
    expect(changed.fallen.length).not.toBe(first.fallen.length);
  });

  it('records fall order and never mutates the input pieces', () => {
    const level = { cols: 6, rows: 3, reach: 2 };
    const pieces: Piece[] = [
      { id: 'a', x: 0, y: 1, facing: 'E', kind: 'start', fallen: false, fallOrder: -1 },
      { id: 'b', x: 1, y: 1, facing: 'E', kind: 'domino', fallen: false, fallOrder: -1 },
      { id: 'c', x: 2, y: 1, facing: 'E', kind: 'target', fallen: false, fallOrder: -1 },
    ];
    const { result } = simulate(pieces, level, 2, 'a', ['c'], []);
    expect(result.fallen).toEqual(['a', 'b', 'c']);
    expect(result.success).toBe(true);
    // The caller's array is untouched — the simulation works on a copy.
    expect(pieces.every((piece) => !piece.fallen)).toBe(true);
  });

  it('fails when a forbidden domino is knocked over', () => {
    const level = { cols: 6, rows: 3, reach: 2 };
    const pieces: Piece[] = [
      { id: 'a', x: 0, y: 1, facing: 'E', kind: 'start', fallen: false, fallOrder: -1 },
      { id: 'f', x: 1, y: 1, facing: 'E', kind: 'domino', fallen: false, fallOrder: -1 },
      { id: 't', x: 2, y: 1, facing: 'E', kind: 'target', fallen: false, fallOrder: -1 },
    ];
    const { result } = simulate(pieces, level, 2, 'a', ['t'], ['f']);
    expect(result.hitForbidden).toEqual(['f']);
    expect(result.success).toBe(false);
  });

  /* ---------------- match setup ---------------- */

  it('starts every player on the identical level', () => {
    expect(state().phase).toBe('playing');
    expect(state().levelEndsAt).toBeGreaterThan(context().now());
    const [a, b] = players.map((player) => player.id);
    expect(piecesOf(a).map((piece) => piece.id)).toEqual(piecesOf(b).map((piece) => piece.id));
    expect(startPieceOf(piecesOf(a))).toBeDefined();
  });

  /* ---------------- placing ---------------- */

  it('places, rotates and removes a domino within budget', () => {
    const playerId = players[0]!.id;
    // Find an empty cell.
    let cell: { x: number; y: number } | null = null;
    for (let y = 0; y < state().rows && !cell; y += 1) {
      for (let x = 0; x < state().cols && !cell; x += 1) {
        if (!pieceAt(piecesOf(playerId), x, y)) cell = { x, y };
      }
    }
    expect(cell).not.toBeNull();

    expect(act(playerId, { type: 'place', payload: { ...cell!, facing: 'E' } }).accepted).toBe(true);
    expect(state().players[playerId]!.placed).toBe(1);
    const placed = piecesOf(playerId).find((piece) => piece.id === 'p1')!;
    expect(placed.facing).toBe('E');

    expect(act(playerId, { type: 'rotate', payload: { pieceId: 'p1' } }).accepted).toBe(true);
    expect(piecesOf(playerId).find((piece) => piece.id === 'p1')!.facing).toBe('S');

    expect(act(playerId, { type: 'remove', payload: { pieceId: 'p1' } }).accepted).toBe(true);
    expect(state().players[playerId]!.placed).toBe(0);
  });

  it('enforces the placement budget', () => {
    const playerId = players[0]!.id;
    const budget = state().budget;
    const free: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < state().rows; y += 1) {
      for (let x = 0; x < state().cols; x += 1) {
        if (!pieceAt(piecesOf(playerId), x, y)) free.push({ x, y });
      }
    }
    for (let i = 0; i < budget; i += 1) {
      expect(act(playerId, { type: 'place', payload: { ...free[i]!, facing: 'E' } }).accepted).toBe(true);
    }
    // One more than the budget must be refused.
    expect(act(playerId, { type: 'place', payload: { ...free[budget]!, facing: 'E' } }).accepted).toBe(false);
  });

  /* ---------------- anti-cheat ---------------- */

  it('rejects invalid coordinates, facings and occupied cells', () => {
    const playerId = players[0]!.id;
    const ctx = context();
    const occupied = piecesOf(playerId)[0]!;
    for (const payload of [
      { x: -1, y: 0, facing: 'E' },
      { x: 999, y: 0, facing: 'E' },
      { x: 0, y: 0, facing: 'UP' },
      { x: 1.5, y: 0, facing: 'E' },
      { x: occupied.x, y: occupied.y, facing: 'E' },
      {},
    ]) {
      expect(
        dominoMindGame.validateAction(playerId, { type: 'place', payload }, state(), ctx).valid,
        JSON.stringify(payload),
      ).toBe(false);
    }
    expect(inBounds(state(), -1, 0)).toBe(false);
    expect(inBounds(state(), 0, 0)).toBe(true);
  });

  it('refuses to rotate or remove a piece the player did not place', () => {
    const playerId = players[0]!.id;
    const fixed = piecesOf(playerId).find((piece) => !piece.id.startsWith('p'))!;
    expect(act(playerId, { type: 'rotate', payload: { pieceId: fixed.id } }).accepted).toBe(false);
    expect(act(playerId, { type: 'remove', payload: { pieceId: fixed.id } }).accepted).toBe(false);
    expect(act(playerId, { type: 'rotate', payload: { pieceId: 'does-not-exist' } }).accepted).toBe(false);
  });

  it('rejects outcome-asserting actions', () => {
    const playerId = players[0]!.id;
    const ctx = context();
    for (const type of ['score', 'win', 'finish', 'complete', 'solved', 'chain']) {
      expect(dominoMindGame.validateAction(playerId, { type, payload: { score: 999 } }, state(), ctx).valid).toBe(
        false,
      );
      expect(dominoMindGame.handlePlayerAction(playerId, { type }, state(), ctx).accepted).toBe(false);
    }
    expect(state().players[playerId]!.score).toBe(0);
    expect(state().players[playerId]!.solvedAt).toBeNull();
  });

  it('rejects everything after the match ends', () => {
    const playerId = players[0]!.id;
    finishDominoMind(state(), context(), 'completed');
    expect(act(playerId, { type: 'push' }).accepted).toBe(false);
    expect(act(playerId, { type: 'place', payload: { x: 0, y: 0, facing: 'E' } }).accepted).toBe(false);
  });

  /* ---------------- pushing ---------------- */

  it('a failed attempt costs points but does not end the level', () => {
    const playerId = players[0]!.id;
    state().players[playerId]!.score = 100;
    // Level 1 needs a placement, so pushing immediately must fail.
    expect(act(playerId, { type: 'push' }).accepted).toBe(true);
    const slot = state().players[playerId]!;
    expect(slot.attempts).toBe(1);
    expect(slot.solvedAt).toBeNull();
    expect(slot.score).toBe(85);
    expect(slot.lastRun?.success).toBe(false);
    // The player may keep trying.
    expect(state().phase).toBe('playing');
  });

  it('the SERVER runs the chain and scores a genuine solve', () => {
    const playerId = players[0]!.id;
    const level = levelAt(state().level);
    const needed = minPlacements(level);
    expect(needed).toBeGreaterThan(0);

    // Find and apply a real solution by search.
    const free: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < level.rows; y += 1) {
      for (let x = 0; x < level.cols; x += 1) {
        if (!pieceAt(clonePieces(level), x, y)) free.push({ x, y });
      }
    }
    let solved = false;
    for (const cell of free) {
      for (const facing of FACINGS) {
        const probe: Piece[] = [
          ...clonePieces(level),
          { id: 'p1', x: cell.x, y: cell.y, facing, kind: 'domino', fallen: false, fallOrder: -1 },
        ];
        const start = startPieceOf(probe)!;
        if (!simulate(probe, level, level.reach, start.id, level.requiredTargets, level.forbidden).result.success) {
          continue;
        }
        expect(act(playerId, { type: 'place', payload: { x: cell.x, y: cell.y, facing } }).accepted).toBe(true);
        expect(act(playerId, { type: 'push' }).accepted).toBe(true);
        solved = true;
        break;
      }
      if (solved) break;
    }
    expect(solved).toBe(true);
    const slot = state().players[playerId]!;
    expect(slot.solvedAt).toBeGreaterThan(0);
    expect(slot.finishRank).toBe(1);
    expect(slot.score).toBeGreaterThan(0);
  });

  /* ---------------- hidden information ---------------- */

  it('never sends another player layout — only a progress percentage', () => {
    const [a, b] = players.map((player) => player.id);
    const view = platform.gameManager.getPublicState(room, a) as Record<string, unknown> & {
      pieces: unknown[];
      players: Record<string, { progress: number }>;
    };
    expect(Array.isArray(view.pieces)).toBe(true);
    expect(typeof view.players[b]!.progress).toBe('number');
    expect((view.players[b] as unknown as { pieces?: unknown }).pieces).toBeUndefined();
  });

  /* ---------------- progression ---------------- */

  it('advances levels and finishes after the last one', () => {
    state().totalLevels = 2;
    endLevel(state(), context());
    expect(state().level).toBe(1);
    expect(state().phase).toBe('level-clear');
    state().phase = 'playing';
    endLevel(state(), context());
    expect(state().phase).toBe('finished');
  });

  /* ---------------- results ---------------- */

  it('ranks by score with completion time as the tiebreak', () => {
    const [a, b] = players.map((player) => player.id);
    state().players[a]!.score = 500;
    state().players[b]!.score = 500;
    state().players[a]!.solvedAt = 9_000;
    state().players[b]!.solvedAt = 3_000;
    finishDominoMind(state(), context(), 'completed');

    const result = dominoMindGame.getResult(state(), context());
    expect(result.rankings[0]!.playerId).toBe(b);
    expect(result.rankings[0]!.stats).toHaveProperty('attempts');
    expect(result.rankings[0]!.stats).toHaveProperty('triggered');
  });

  /* ---------------- lifecycle ---------------- */

  it('handles disconnect, reconnect and leave', () => {
    const playerId = players[0]!.id;
    act(playerId, { type: 'push' });

    dominoMindGame.playerLeft(playerId, state(), context(), 'disconnect');
    expect(state().players[playerId]!.disconnected).toBe(true);
    expect(act(playerId, { type: 'push' }).accepted).toBe(false);

    dominoMindGame.playerJoined({ ...players[0]! }, state(), context());
    expect(state().players[playerId]!.disconnected).toBe(false);
    expect(state().players[playerId]!.attempts).toBe(1);

    dominoMindGame.playerLeft(playerId, state(), context(), 'leave');
    expect(state().players[playerId]!.left).toBe(true);
  });

  it('reset and cleanup prepare a rematch', () => {
    finishDominoMind(state(), context(), 'completed');
    const next = dominoMindGame.reset(state());
    expect(next.phase).toBe('idle');
    expect(next.level).toBe(0);
    expect(Object.values(next.players).every((slot) => slot.score === 0 && slot.attempts === 0)).toBe(true);
    dominoMindGame.cleanup(next);
    expect(Object.keys(next.players)).toHaveLength(0);
  });

  /* ---------------- AI ---------------- */

  it('the AI only produces legal actions', () => {
    const playerId = players[0]!.id;
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const action = dominoMindGame.getAIMove?.(playerId, difficulty, state(), context());
      if (!action) continue;
      expect(['place', 'push']).toContain(action.type);
      expect(dominoMindGame.validateAction(playerId, action, state(), context()).valid).toBe(true);
    }
  });

  it('a hard AI actually solves a level by reasoning about the chain', () => {
    const playerId = players[0]!.id;
    let guard = 0;
    while (!state().players[playerId]!.solvedAt && guard < 60) {
      guard += 1;
      const action = dominoMindGame.getAIMove?.(playerId, 'hard', state(), context());
      if (!action) break;
      act(playerId, action);
      if (state().phase !== 'playing') break;
    }
    expect(state().players[playerId]!.solvedAt).toBeGreaterThan(0);
  });

  it('the AI stops once solved or the match ends', () => {
    const playerId = players[0]!.id;
    state().players[playerId]!.solvedAt = 1;
    expect(dominoMindGame.getAIMove?.(playerId, 'hard', state(), context())).toBeNull();
    state().players[playerId]!.solvedAt = null;
    finishDominoMind(state(), context(), 'completed');
    expect(dominoMindGame.getAIMove?.(playerId, 'hard', state(), context())).toBeNull();
  });
});
