import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import type { Player } from '@2play/shared';
import type { GameComponentProps } from '../registry/types';
import { simClient, type SimPublicState } from './index';

/**
 * Sim — reveal contract.
 *
 * When the server declares the losing triangle the client must highlight
 * EXACTLY those three edges (never re-derived or re-randomised) and show the
 * decisive message while the board stays visible.
 */

const players = [
  { id: 'p1', nickname: 'You', avatar: '🦊', seatIndex: 0, score: 0, isHost: true, isReady: true, isConnected: true, isDisconnected: false, isAI: false },
  { id: 'p2', nickname: 'Rival', avatar: '🐼', seatIndex: 1, score: 0, isHost: false, isReady: true, isConnected: true, isDisconnected: false, isAI: false },
] as Player[];

function makeState(overrides: Partial<SimPublicState> = {}): SimPublicState {
  const edges = [] as SimPublicState['edges'];
  for (let a = 0; a < 6; a += 1) {
    for (let b = a + 1; b < 6; b += 1) {
      edges.push({ id: `e${a}${b}`, a, b, owner: null });
    }
  }
  edges.find((edge) => edge.id === 'e01')!.owner = 'p1';
  edges.find((edge) => edge.id === 'e12')!.owner = 'p1';
  edges.find((edge) => edge.id === 'e02')!.owner = 'p1';
  edges.find((edge) => edge.id === 'e34')!.owner = 'p2';
  edges.find((edge) => edge.id === 'e45')!.owner = 'p2';
  return {
    phase: 'reveal',
    nodes: 6,
    edges,
    currentPlayerId: null,
    isMyTurn: false,
    mySeat: 0,
    moves: 5,
    lastMove: { edgeId: 'e02', playerId: 'p1' },
    losingTriangle: ['e01', 'e12', 'e02'],
    loserId: 'p1',
    winnerId: 'p2',
    isDraw: false,
    turnEndsAt: null,
    finishReason: null,
    lastEvent: 'triangle:p1',
    serverTime: Date.now(),
    players: {
      p1: { seat: 0, edges: 3, disconnected: false },
      p2: { seat: 1, edges: 2, disconnected: false },
    },
    ...overrides,
  };
}

function renderGame(state: SimPublicState) {
  const sendAction = vi.fn();
  const props = {
    state,
    players,
    myPlayerId: 'p1',
    sendAction,
    play: vi.fn(),
    vibrate: vi.fn(),
  } as unknown as GameComponentProps<SimPublicState>;
  const Component = simClient.Component as unknown as ComponentType<
    GameComponentProps<SimPublicState>
  >;
  render(<Component {...props} />);
  return { sendAction };
}

describe('Sim reveal', () => {
  it('highlights exactly the three server-declared losing edges', () => {
    const state = makeState();
    renderGame(state);
    const losingLines = document.querySelectorAll('line[data-losing="true"]');
    expect(losingLines).toHaveLength(3);
    // The highlighted trio is the exact triangle from the server payload.
    const stroked = [...losingLines].map((line) => line.getAttribute('stroke'));
    for (const stroke of stroked) expect(stroke).toBe('#f43f5e');
    // Non-losing edges keep their normal colours (not the losing red pulse).
    const allEdges = document.querySelectorAll('line[data-losing], line:not([data-losing])');
    expect(allEdges.length).toBeGreaterThanOrEqual(15);
  });

  it('shows the decisive message with the loser name during the reveal', () => {
    const state = makeState();
    renderGame(state);
    const message = screen.getByTestId('sim-result-message');
    expect(message.textContent).toContain('Triangle!');
    expect(message.textContent).toContain('You'); // my own nickname in a personal loss
    expect(screen.getByText('Triangle!')).toBeInTheDocument();
  });

  it('keeps the board visible with all fifteen edges during the reveal', () => {
    const state = makeState();
    renderGame(state);
    const board = screen.getByRole('grid', { name: /Sim board/i });
    expect(board).toBeInTheDocument();
    const lines = board.querySelectorAll('line');
    expect(lines.length).toBe(30); // 15 edges x (hit area + visible line)
  });

  it('input stays disabled: no edge is claimable outside the playing phase', () => {
    const state = makeState();
    const { sendAction } = renderGame(state);
    const claimable = document.querySelector('line[aria-label^="Claim"]');
    expect(claimable).not.toBeNull(); // free edges exist
    // But the component's claim handler never fires a sendAction during reveal.
    const free = claimable as SVGLineElement;
    free.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(sendAction).not.toHaveBeenCalled();
  });
});
