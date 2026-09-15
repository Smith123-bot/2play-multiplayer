import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Player, RoomState } from '@2play/shared';
import type { GameComponentProps } from '../registry/types';
import { sosGameClient, type SosPublicState } from './index';

const players = [
  { id: 'p1', nickname: 'You', avatar: '🦊', seatIndex: 0, score: 0, isHost: true, isReady: true, isConnected: true, isDisconnected: false, isAI: false },
  { id: 'p2', nickname: 'Rival', avatar: '🐼', seatIndex: 1, score: 0, isHost: false, isReady: true, isConnected: true, isDisconnected: false, isAI: false },
] as Player[];

function baseState(overrides: Partial<SosPublicState> = {}): SosPublicState {
  return {
    phase: 'playing',
    size: 5,
    board: new Array(25).fill(null),
    currentPlayerId: 'p1',
    isMyTurn: true,
    lines: [],
    moves: 0,
    lastMove: null,
    extraTurn: false,
    turnEndsAt: null,
    winnerId: null,
    isDraw: false,
    finishReason: null,
    lastEvent: null,
    serverTime: Date.now(),
    players: {
      p1: { seat: 0, score: 0, moves: 0, extraTurns: 0, disconnected: false },
      p2: { seat: 1, score: 0, moves: 0, extraTurns: 0, disconnected: false },
    },
    ...overrides,
  };
}

function renderSos(state: SosPublicState) {
  const sendAction = vi.fn();
  const Component = sosGameClient.Component as unknown as ComponentType<GameComponentProps<SosPublicState>>;
  render(
    <Component
      state={state}
      room={{} as RoomState}
      players={players}
      myPlayerId="p1"
      isMyTurn={state.isMyTurn}
      sendAction={sendAction}
      play={vi.fn()}
      vibrate={vi.fn()}
    />,
  );
  return sendAction;
}

describe('SOS client', () => {
  it('renders one cell per board square and the selected letter', () => {
    renderSos(baseState());
    expect(screen.getByRole('grid', { name: 'SOS board' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Place S in cell/ })).toHaveLength(25);
    expect(screen.getByRole('button', { name: 'Place the letter S' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('sends the selected letter for an empty cell on your turn', async () => {
    const sendAction = renderSos(baseState());
    await userEvent.click(screen.getByRole('button', { name: 'Place the letter O' }));
    await userEvent.click(screen.getByRole('button', { name: 'Place O in cell 13' }));
    expect(sendAction).toHaveBeenCalledWith({
      type: 'place',
      payload: { index: 12, letter: 'O' },
    });
  });

  it('shows the turn clearly and blocks rival-turn taps with feedback', async () => {
    const sendAction = renderSos(baseState({ isMyTurn: false, currentPlayerId: 'p2' }));
    expect(screen.getByText("Rival's turn")).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Place S in cell 1' }));
    expect(sendAction).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Wait for your turn.');
  });

  it('rejects an occupied cell locally with feedback and no action', async () => {
    const board = new Array(25).fill(null);
    board[0] = 'S';
    const sendAction = renderSos(baseState({ board }));
    await userEvent.click(screen.getByRole('button', { name: 'Cell 1 has S' }));
    expect(sendAction).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('already taken');
  });

  it('highlights completed SOS lines in the scorer colour and shows the result', () => {
    const board = new Array(25).fill(null);
    board[0] = 'S';
    board[1] = 'O';
    board[2] = 'S';
    renderSos(
      baseState({
        board,
        lines: [{ cells: [0, 1, 2], playerId: 'p1' }],
        lastMove: { index: 2, letter: 'S', playerId: 'p1', scored: 1 },
        phase: 'finished',
        winnerId: 'p1',
        isMyTurn: false,
        currentPlayerId: null,
        players: {
          p1: { seat: 0, score: 1, moves: 3, extraTurns: 1, disconnected: false },
          p2: { seat: 1, score: 0, moves: 3, extraTurns: 0, disconnected: false },
        },
      }),
    );
    expect(screen.getByText('You win!')).toBeInTheDocument();
    expect(screen.getByText('1 SOS made')).toBeInTheDocument();
    // All three line cells carry the seat-0 highlight colour.
    for (const name of ['Cell 1 has S', 'Cell 2 has O', 'Cell 3 has S']) {
      expect(screen.getByRole('button', { name })).toHaveStyle({ color: '#38bdf8' });
    }
  });
});
