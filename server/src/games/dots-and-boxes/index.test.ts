import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createTestPlatform, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import { dotsAndBoxesGame, type DotsAndBoxesState } from './index';
import type { Room } from '../../rooms/Room';

describe('Dots and Boxes', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'dots-and-boxes', {
      settings: { gridSize: '4x4' },
    });
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as DotsAndBoxesState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const draw = (playerId: string, orientation: 'h' | 'v', row: number, col: number) =>
    platform.gameManager.handleAction(room, playerId, {
      type: 'draw',
      payload: { orientation, row, col },
    });

  it('builds the board for the requested grid size', () => {
    const current = state();
    expect(current.cols).toBe(4);
    expect(current.rows).toBe(4);
    expect(current.hLines).toHaveLength(4 * 3);
    expect(current.vLines).toHaveLength(3 * 4);
    expect(current.boxes).toHaveLength(9);
    expect(current.totalBoxes).toBe(9);
  });

  it('rejects lines that are off the board, drawn already or out of turn', () => {
    const turnPlayer = state().currentPlayerId!;
    const other = players.find((player) => player.id !== turnPlayer)!;

    expect(
      dotsAndBoxesGame.validateAction(
        turnPlayer,
        { type: 'draw', payload: { orientation: 'h', row: 9, col: 0 } },
        state(),
        context(),
      ).valid,
    ).toBe(false);

    expect(
      dotsAndBoxesGame.validateAction(
        other.id,
        { type: 'draw', payload: { orientation: 'h', row: 0, col: 0 } },
        state(),
        context(),
      ).valid,
    ).toBe(false);

    draw(turnPlayer, 'h', 0, 0);
    expect(state().hLines[0]).toBe(true);
    expect(
      dotsAndBoxesGame.validateAction(
        turnPlayer,
        { type: 'draw', payload: { orientation: 'h', row: 0, col: 0 } },
        state(),
        context(),
      ).valid,
    ).toBe(false);
  });

  it('passes the turn when no box is completed', () => {
    const turnPlayer = state().currentPlayerId!;
    draw(turnPlayer, 'h', 0, 0);
    expect(state().scores[turnPlayer]).toBe(0);
    expect(state().currentPlayerId).not.toBe(turnPlayer);
  });

  it('awards the box and keeps the turn when a box is closed', () => {
    const first = state().currentPlayerId!;
    draw(first, 'h', 0, 0); // top of box (0,0)
    const second = state().currentPlayerId!;
    draw(second, 'v', 0, 0); // left
    const third = state().currentPlayerId!;
    draw(third, 'v', 0, 1); // right
    const fourth = state().currentPlayerId!;
    draw(fourth, 'h', 1, 0); // bottom → closes box (0,0)

    expect(state().boxes[0]).toBe(fourth);
    expect(state().scores[fourth]).toBe(1);
    expect(state().currentPlayerId).toBe(fourth);
  });

  it('finishes when every box is claimed', () => {
    const current = state();
    const [playerA, playerB] = players;
    current.boxes = current.boxes.map((_, index) => (index % 2 === 0 ? playerA!.id : playerB!.id));
    current.claimedBoxes = current.totalBoxes;
    current.phase = 'finished';
    current.scores[playerA!.id] = 5;
    current.scores[playerB!.id] = 4;

    const draft = dotsAndBoxesGame.getResult(current, context());
    expect(draft.winners).toEqual([playerA!.id]);
    expect(draft.rankings[0]!.score).toBe(5);
  });

  it('AI selects legal, board-valid lines only', () => {
    const current = state();
    const aiPlayer = players[0]!;
    current.currentPlayerId = aiPlayer.id;

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const move = dotsAndBoxesGame.getAIMove?.(aiPlayer.id, 'hard', current, context());
      expect(move).not.toBeNull();
      const { orientation, row, col } = move!.payload as {
        orientation: 'h' | 'v';
        row: number;
        col: number;
      };
      const index =
        orientation === 'h' ? row * (current.cols - 1) + col : row * current.cols + col;
      if (orientation === 'h') {
        expect(row).toBeLessThan(current.rows);
        expect(col).toBeLessThan(current.cols - 1);
        expect(current.hLines[index]).toBe(false);
        current.hLines[index] = true;
      } else {
        expect(row).toBeLessThan(current.rows - 1);
        expect(col).toBeLessThan(current.cols);
        expect(current.vLines[index]).toBe(false);
        current.vLines[index] = true;
      }
    }
  });

  it('resets the board for a rematch', () => {
    const current = state();
    current.hLines[0] = true;
    current.boxes[0] = players[0]!.id;
    current.scores[players[0]!.id] = 3;

    const reset = dotsAndBoxesGame.reset(current);
    expect(reset.hLines.every((line) => line === false)).toBe(true);
    expect(reset.boxes.every((owner) => owner === null)).toBe(true);
    expect(Object.values(reset.scores).every((score) => score === 0)).toBe(true);
  });
});
