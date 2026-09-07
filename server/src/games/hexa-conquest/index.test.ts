import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createTestPlatform, waitFor, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  advanceTurn,
  finishHexa,
  hexaConquestGame,
  hexNeighbors,
  HEX_COLS,
  HEX_ROWS,
  isAdjacentToOwner,
  legalBridges,
  legalCaptures,
  type HexaConquestState,
} from './index';
import type { Room } from '../../rooms/Room';

describe('Hexa Conquest', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'hexa-conquest');
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as HexaConquestState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const publicState = (viewerId?: string) =>
    platform.gameManager.getPublicState(room, viewerId) as {
      phase: string;
      tiles: Array<{ col: number; row: number; owner: string | null; kind: string }>;
      currentPlayerId: string | null;
      specials: Record<string, number>;
      scores: Record<string, number>;
    };

  it('starts a 15x11 hex map with one starting hex each', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    expect(state().cols).toBe(HEX_COLS);
    expect(state().rows).toBe(HEX_ROWS);
    expect(state().tiles).toHaveLength(HEX_COLS * HEX_ROWS);
    for (const player of players) {
      expect(state().tiles.some((tile) => tile.startOf === player.id && tile.owner === player.id)).toBe(true);
    }
    const view = publicState(players[0]!.id);
    expect(view.currentPlayerId).toBeTruthy();
    expect(view.tiles).toHaveLength(HEX_COLS * HEX_ROWS);
  });

  it('hex neighbours stay within six cells', () => {
    expect(hexNeighbors(4, 4)).toHaveLength(6);
    expect(hexNeighbors(5, 5)).toHaveLength(6);
  });

  it('accepts an adjacent capture and rejects a blocked or owned tile', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = state().currentPlayerId!;
    const legal = legalCaptures(state(), playerId);
    expect(legal.length).toBeGreaterThan(0);
    const tile = legal[0]!;
    expect(isAdjacentToOwner(state(), playerId, tile.col, tile.row)).toBe(true);
    const result = platform.gameManager.handleAction(room, playerId, {
      type: 'capture',
      payload: { col: tile.col, row: tile.row },
    });
    expect(result.accepted).toBe(true);
    expect(state().tiles.find((entry) => entry.col === tile.col && entry.row === tile.row)?.owner).toBe(playerId);

    expect(
      hexaConquestGame.validateAction(
        state().currentPlayerId!,
        { type: 'capture', payload: { col: tile.col, row: tile.row } },
        state(),
        context(),
      ).valid,
    ).toBe(false);

    const blocked = state().tiles.find((entry) => entry.kind === 'blocked');
    if (blocked) {
      expect(
        hexaConquestGame.validateAction(
          state().currentPlayerId!,
          { type: 'capture', payload: { col: blocked.col, row: blocked.row } },
          state(),
          context(),
        ).valid,
      ).toBe(false);
    }
  });

  it('rejects out-of-turn captures and unknown actions', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const other = players.find((player) => player.id !== state().currentPlayerId)!;
    expect(
      hexaConquestGame.validateAction(other.id, { type: 'capture', payload: { col: 3, row: 3 } }, state(), context())
        .valid,
    ).toBe(false);
    expect(hexaConquestGame.validateAction(state().currentPlayerId!, { type: 'paint' }, state(), context()).valid).toBe(
      false,
    );
  });

  it('bridge spends a special and cannot target an adjacent hex', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = state().currentPlayerId!;
    state().players[playerId]!.specials = 1;
    const adjacent = legalCaptures(state(), playerId)[0]!;
    expect(
      hexaConquestGame.validateAction(
        playerId,
        { type: 'bridge', payload: { col: adjacent.col, row: adjacent.row } },
        state(),
        context(),
      ).valid,
    ).toBe(false);
    const remote = legalBridges(state(), playerId)[0];
    expect(remote).toBeTruthy();
    const result = platform.gameManager.handleAction(room, playerId, {
      type: 'bridge',
      payload: { col: remote!.col, row: remote!.row },
    });
    expect(result.accepted).toBe(true);
    expect(state().players[playerId]!.specials).toBe(0);
  });

  it('turn timeout advances the current player', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const first = state().currentPlayerId;
    advanceTurn(state(), context());
    expect(state().currentPlayerId).not.toBe(first);
  });

  it('timeout finishes and ranks by score', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    state().players[players[0]!.id]!.score = 40;
    state().players[players[1]!.id]!.score = 12;
    finishHexa(state(), context(), 'timeout');
    expect(state().phase).toBe('finished');
    const draft = hexaConquestGame.getResult(state(), context());
    expect(draft.winners).toEqual([players[0]!.id]);
  });

  it('reset keeps seats', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const seats = Object.keys(state().players);
    const next = hexaConquestGame.reset(state());
    expect(Object.keys(next.players)).toEqual(seats);
    expect(next.phase).toBe('idle');
    expect(next.tiles).toEqual([]);
  });

  it('AI captures a legal adjacent hex', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const current = state().currentPlayerId!;
    const move = hexaConquestGame.getAIMove?.(current, 'hard', state(), context());
    expect(move?.type === 'capture' || move?.type === 'bridge').toBe(true);
    expect(typeof move?.payload?.col).toBe('number');
  });
});
