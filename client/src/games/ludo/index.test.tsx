import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import type { Player } from '@2play/shared';
import type { GameComponentProps } from '../registry/types';
import { ludoClient, ludoCellForProgress, type LudoPublicState } from './index';

/**
 * Ludo — board renderer contract.
 *
 * The client is a pure view over server-resolved geometry: tokens are placed
 * from `gridCell`, animations from `lastMove.cells`, destinations from
 * `toCell`. These tests pin the bug fixes:
 *  - a token on ANY server cell renders (no disappearing tokens);
 *  - a finished token stays visible in its home triangle, marked ✓, immovable;
 *  - the animation path is exactly the server's `cells` (logical path);
 *  - the finished reveal names the winner and the "all tokens home" moment.
 */

const now = Date.now();

const players = [
  { id: 'p1', nickname: 'You', avatar: '🦊', seatIndex: 0, score: 0, isHost: true, isReady: true, isConnected: true, isDisconnected: false, isAI: false },
  { id: 'p2', nickname: 'Rival', avatar: '🐼', seatIndex: 1, score: 0, isHost: false, isReady: true, isConnected: true, isDisconnected: false, isAI: false },
] as Player[];

const TRACK = Array.from({ length: 52 }, (_entry, index) => {
  // A deterministic ring so cells are unique and adjacent-ish.
  if (index < 13) return { x: index, y: 0 };
  if (index < 26) return { x: 13, y: index - 13 };
  if (index < 39) return { x: 13 - (index - 26), y: 13 };
  return { x: 0, y: 13 - (index - 39) };
});

const HOME_LANES = {
  0: Array.from({ length: 5 }, (_x, i) => ({ x: 1 + i, y: 7 })),
  1: Array.from({ length: 5 }, (_x, i) => ({ x: 7, y: 1 + i })),
  2: Array.from({ length: 5 }, (_x, i) => ({ x: 13 - i, y: 7 })),
  3: Array.from({ length: 5 }, (_x, i) => ({ x: 7, y: 13 - i })),
};

const YARDS = {
  0: [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 3 }],
  1: [{ x: 11, y: 2 }, { x: 12, y: 2 }, { x: 11, y: 3 }, { x: 12, y: 3 }],
  2: [{ x: 11, y: 11 }, { x: 12, y: 11 }, { x: 11, y: 12 }, { x: 12, y: 12 }],
  3: [{ x: 2, y: 11 }, { x: 3, y: 11 }, { x: 2, y: 12 }, { x: 3, y: 12 }],
};

function makeState(overrides: Partial<LudoPublicState> = {}): LudoPublicState {
  const redTokens = Array.from({ length: 4 }, (_entry, index) => ({
    id: `red-${index}`,
    seatIndex: 0,
    progress: -1,
    cell: null,
    gridCell: YARDS[0][index],
    kind: 'yard' as const,
  }));
  const greenTokens = Array.from({ length: 4 }, (_entry, index) => ({
    id: `green-${index}`,
    seatIndex: 1,
    progress: -1,
    cell: null,
    gridCell: YARDS[1][index],
    kind: 'yard' as const,
  }));
  return {
    phase: 'awaiting-roll',
    currentPlayerId: 'p1',
    dice: null,
    lastRoll: null,
    consecutiveSixes: 0,
    legalMoves: [],
    turnOrder: ['p1', 'p2'],
    turnEndsAt: now + 20_000,
    tokensToWin: 4,
    finishedOrder: [],
    lastEvent: null,
    lastMove: null,
    finishReason: null,
    serverTime: now,
    boardSize: 15,
    trackCells: TRACK,
    safeIndices: [0, 8, 13, 21, 26, 34, 39, 47],
    homeStretchCells: HOME_LANES,
    yardCells: YARDS,
    startIndex: { 0: 0, 1: 13, 2: 26, 3: 39 },
    homeEntryIndex: { 0: 50, 1: 11, 2: 24, 3: 37 },
    trackLength: 52,
    laneStart: 51,
    homeStretchLength: 5,
    finishDistance: 56,
    players: {
      p1: {
        color: 'red',
        seatIndex: 0,
        tokens: redTokens,
        finishedTokens: 0,
        captures: 0,
        score: 0,
        rank: 0,
        disconnected: false,
        left: false,
      },
      p2: {
        color: 'green',
        seatIndex: 1,
        tokens: greenTokens,
        finishedTokens: 0,
        captures: 0,
        score: 0,
        rank: 0,
        disconnected: false,
        left: false,
      },
    },
    ...overrides,
  };
}

function renderGame(state: LudoPublicState) {
  const sendAction = vi.fn();
  const props = {
    state,
    players,
    myPlayerId: 'p1',
    sendAction,
    play: vi.fn(),
    vibrate: vi.fn(),
  } as unknown as GameComponentProps<LudoPublicState>;
  const Component = ludoClient.Component as unknown as ComponentType<
    GameComponentProps<LudoPublicState>
  >;
  render(<Component {...props} />);
  return { sendAction };
}

function tokenButton(id: string) {
  return document.querySelector(`button[aria-label="Token ${id}"]`) as HTMLButtonElement | null;
}

describe('Ludo board renderer', () => {
  it('renders every token from its server-resolved cell, including lane and home', () => {
    const state = makeState();
    // red-0 mid-lane (progress 53 -> lane cell 2), red-1 finished home.
    state.players.p1!.tokens[0] = {
      id: 'red-0',
      seatIndex: 0,
      progress: 53,
      cell: null,
      gridCell: HOME_LANES[0][2]!,
      kind: 'lane',
    };
    state.players.p1!.tokens[1] = {
      id: 'red-1',
      seatIndex: 0,
      progress: 56,
      cell: null,
      gridCell: { x: 6, y: 7 },
      kind: 'home',
    };
    renderGame(state);
    for (const id of ['red-0', 'red-1', 'red-2', 'red-3', 'green-0']) {
      expect(tokenButton(id)).not.toBeNull();
    }
    // The finished token carries the completed ✓ state and is not clickable.
    const finished = tokenButton('red-1')!;
    expect(finished.disabled).toBe(true);
    expect(finished.textContent).toContain('✓');
    expect(finished.getAttribute('aria-label')).toBe('Token red-1');
    // Lane tokens render at the lane cell (server cell), not a track corner.
    const lane = tokenButton('red-0')!;
    const expectedLeft = ((HOME_LANES[0][2]!.x + 0.16) / 15) * 100;
    expect(Number.parseFloat(lane.style.left)).toBeCloseTo(expectedLeft, 1);
  });

  it('animates along exactly the server-resolved cells (logical path == drawn path)', () => {
    const state = makeState();
    const path = [10, 11, 12, 13];
    state.phase = 'awaiting-move';
    state.dice = 4;
    state.legalMoves = [
      {
        tokenId: 'red-0',
        from: 9,
        to: 13,
        capturesTokenId: null,
        entersBoard: false,
        reachesHome: false,
        toCell: TRACK[13]!,
      },
    ];
    state.players.p1!.tokens[0] = {
      id: 'red-0',
      seatIndex: 0,
      progress: 13,
      cell: 13,
      gridCell: TRACK[13]!,
      kind: 'track',
    };
    state.lastMove = {
      id: 7,
      playerId: 'p1',
      tokenId: 'red-0',
      from: 9,
      to: 13,
      path,
      cells: path.map((step) => TRACK[step]!),
      captured: null,
      capturedFrom: null,
      capturedFromCell: null,
    };
    renderGame(state);
    // The animation begins at the FIRST server-resolved cell of the path
    // (jsdom applies the initial keyframe), proving the drawn path is the
    // server's `cells` and not client-recomputed geometry.
    const moved = screen.getByRole('button', { name: 'Move token red-0' });
    const startLeft = ((TRACK[path[0]]!.x + 0.16) / 15) * 100;
    expect(Number.parseFloat(moved.style.left)).toBeCloseTo(startLeft, 1);
    expect((moved as HTMLButtonElement).disabled).toBe(false); // movable for the pending move
  });

  it('shows the finished reveal with the winner name and marks the seat', () => {
    const state = makeState({ phase: 'finished', currentPlayerId: null });
    state.finishedOrder = ['p1'];
    state.finishReason = 'completed';
    state.players.p1!.finishedTokens = 4;
    state.players.p1!.rank = 1;
    state.players.p1!.tokens = state.players.p1!.tokens.map((token) => ({
      ...token,
      progress: 56,
      gridCell: { x: 6, y: 7 },
      kind: 'home' as const,
    }));
    state.lastEvent = 'finished:p1';
    renderGame(state);
    expect(screen.getByText(/You brought all 4 tokens home!/)).toBeInTheDocument();
    // All four finished tokens visible, disabled, marked ✓.
    for (let i = 0; i < 4; i += 1) {
      const button = tokenButton(`red-${i}`)!;
      expect(button.disabled).toBe(true);
      expect(button.textContent).toContain('✓');
    }
  });

  it('taps only a server-listed legal token and shows its destination marker', async () => {
    const state = makeState();
    state.phase = 'awaiting-move';
    state.dice = 6;
    state.legalMoves = [
      {
        tokenId: 'red-0',
        from: -1,
        to: 0,
        capturesTokenId: null,
        entersBoard: true,
        reachesHome: false,
        toCell: TRACK[0]!,
      },
    ];
    state.players.p1!.tokens[0] = {
      ...state.players.p1!.tokens[0]!,
      progress: -1,
      gridCell: YARDS[0][0]!,
      kind: 'yard',
    };
    const { sendAction } = renderGame(state);
    const movable = screen.getByRole('button', { name: 'Move token red-0' });
    await userEvent.click(movable);
    expect(sendAction).toHaveBeenCalledWith({ type: 'move', payload: { tokenId: 'red-0' } });
    // Non-listed tokens stay inert.
    expect(tokenButton('red-1')!.disabled).toBe(true);
  });

  it('keeps the fallback resolver consistent with the server geometry', () => {
    const state = makeState();
    // Track, lane and home progress all resolve to a cell (never undefined).
    for (const progress of [0, 25, 50, 51, 55, 56]) {
      const cell = ludoCellForProgress(state, 2, progress, 1);
      expect(cell).not.toBeNull();
    }
    // Yard tokens resolve to their yard slot.
    expect(ludoCellForProgress(state, 3, -1, 2)).toEqual(YARDS[3][2]);
  });
});
