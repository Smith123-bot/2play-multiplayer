import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { RoomState } from '@2play/shared';
import { ActiveRoomPrompt } from './ActiveRoomPrompt';
import { useRoomStore } from '../../stores/roomStore';
import { useGameStore } from '../../stores/gameStore';
import { socketClient } from '../../multiplayer/socketClient';

const baseRoom = (overrides: Partial<RoomState> = {}): RoomState =>
  ({
    id: 'ABC123',
    gameId: 'reaction-race',
    hostPlayerId: 'p1',
    maxPlayers: 4,
    isPrivate: false,
    isQuickPlay: false,
    status: 'LOBBY',
    players: [{ id: 'p1', nickname: 'Me' } as never, { id: 'p2', nickname: 'Friend' } as never],
    countdownValue: 0,
    matchNumber: 1,
    gameStartedAt: null,
    gameResult: null,
    gameState: null,
    rematchVotes: {},
    rematchDeadline: null,
    settings: { playerCount: 2, aiOpponents: 0, aiDifficulty: 'medium' },
    chat: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    stateVersion: 1,
    ...overrides,
  }) as RoomState;

describe('ActiveRoomPrompt (global "you are in a room" popup)', () => {
  beforeEach(() => {
    useRoomStore.getState().clearRoom();
    useGameStore.setState({
      games: [
        {
          id: 'reaction-race',
          name: 'Reaction Race',
        } as never,
      ],
    });
  });

  it('renders nothing when there is no active room', () => {
    render(
      <MemoryRouter>
        <ActiveRoomPrompt />
      </MemoryRouter>,
    );
    expect(screen.queryByText('You are in a room')).not.toBeInTheDocument();
  });

  it('shows the room code, game, player count and status when a room is active', () => {
    useRoomStore.getState().setRoom(baseRoom());

    render(
      <MemoryRouter>
        <ActiveRoomPrompt />
      </MemoryRouter>,
    );

    expect(screen.getByText('You are in a room')).toBeInTheDocument();
    // The code appears in the dialog description and in the highlighted code row.
    expect(screen.getAllByText(/ABC123/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Room code: ABC123')).toBeInTheDocument();
    expect(screen.getByText('Reaction Race')).toBeInTheDocument();
    expect(screen.getByText('2/4')).toBeInTheDocument();
    expect(screen.getByText('Open lobby')).toBeInTheDocument();
  });

  it('never shows for a CLOSED room', () => {
    useRoomStore.getState().setRoom(baseRoom({ status: 'CLOSED' }));

    render(
      <MemoryRouter>
        <ActiveRoomPrompt />
      </MemoryRouter>,
    );

    expect(screen.queryByText('You are in a room')).not.toBeInTheDocument();
  });

  it.each(['/games', '/games/reaction-race', '/stats', '/favorites', '/settings'])(
    'remains available on %s while an active room exists', (route) => {
      useRoomStore.getState().setRoom(baseRoom());

      render(
        <MemoryRouter initialEntries={[route]}>
          <ActiveRoomPrompt />
        </MemoryRouter>,
      );

      expect(screen.getByText('You are in a room')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Return to room/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Leave room/i })).toBeInTheDocument();
    },
  );

  it('stays hidden on the matching active room page', () => {
    useRoomStore.getState().setRoom(baseRoom());

    render(
      <MemoryRouter initialEntries={['/room/ABC123']}>
        <ActiveRoomPrompt />
      </MemoryRouter>,
    );

    expect(screen.queryByText('You are in a room')).not.toBeInTheDocument();
    expect(screen.queryByTestId('active-room-banner')).not.toBeInTheDocument();
  });

  it('Leave room clears the local room state so the popup disappears', async () => {
    useRoomStore.getState().setRoom(baseRoom());
    const emitAckSpy = vi
      .spyOn(socketClient, 'emitAck')
      .mockResolvedValue({ ok: true, data: { left: true } });

    render(
      <MemoryRouter>
        <ActiveRoomPrompt />
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole('button', { name: /Leave room/i }));

    expect(emitAckSpy).toHaveBeenCalled();
    expect(useRoomStore.getState().room).toBeNull();

    emitAckSpy.mockRestore();
  });

  it('keeps the room association when the leave acknowledgement fails', async () => {
    useRoomStore.getState().setRoom(baseRoom());
    const emitAckSpy = vi.spyOn(socketClient, 'emitAck').mockResolvedValue({
      ok: false,
      error: { code: 'E008', name: 'CONNECTION_FAILED', message: 'Not connected to the server.' },
    });

    render(
      <MemoryRouter>
        <ActiveRoomPrompt />
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole('button', { name: /Leave room/i }));
    await waitFor(() => expect(useRoomStore.getState().room?.id).toBe('ABC123'));
    expect(screen.getByText('You are in a room')).toBeInTheDocument();

    emitAckSpy.mockRestore();
  });

  it('closing the dialog minimises to a persistent banner that keeps Return / Leave available', async () => {
    useRoomStore.getState().setRoom(baseRoom({ status: 'PLAYING' }));

    render(
      <MemoryRouter>
        <ActiveRoomPrompt />
      </MemoryRouter>,
    );

    expect(screen.getByText('You are in a room')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Close dialog' }));

    // The dialog is gone but the prompt remains available on Home.
    expect(screen.queryByText('You are in a room')).not.toBeInTheDocument();
    expect(screen.getByTestId('active-room-banner')).toBeInTheDocument();
    expect(screen.getByTestId('active-room-banner')).toHaveTextContent('ABC123');
    expect(screen.getByTestId('active-room-banner')).toHaveTextContent('Match in progress');
    expect(
      screen.getByRole('button', { name: /Return to room/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Leave room/i })).toBeInTheDocument();

    // Details reopens the full dialog.
    await userEvent.click(screen.getByRole('button', { name: /Details/i }));
    expect(screen.getByText('You are in a room')).toBeInTheDocument();
  });

  it('leaving from the minimised banner clears the room', async () => {
    useRoomStore.getState().setRoom(baseRoom());
    const emitAckSpy = vi
      .spyOn(socketClient, 'emitAck')
      .mockResolvedValue({ ok: true, data: { left: true } });

    render(
      <MemoryRouter>
        <ActiveRoomPrompt />
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(screen.getByTestId('active-room-banner')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Leave room/i }));
    expect(emitAckSpy).toHaveBeenCalled();
    expect(useRoomStore.getState().room).toBeNull();
    expect(screen.queryByTestId('active-room-banner')).not.toBeInTheDocument();

    emitAckSpy.mockRestore();
  });
});
