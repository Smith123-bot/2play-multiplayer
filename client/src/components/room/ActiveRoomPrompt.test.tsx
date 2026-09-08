import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

describe('ActiveRoomPrompt (Home "you are in a room" popup)', () => {
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

  it('shows the room code, game and player count when a room is active', () => {
    useRoomStore.getState().setRoom(baseRoom());

    render(
      <MemoryRouter>
        <ActiveRoomPrompt />
      </MemoryRouter>,
    );

    expect(screen.getByText('You are in a room')).toBeInTheDocument();
    expect(screen.getByText(/ABC123/)).toBeInTheDocument();
    expect(screen.getByText('Reaction Race')).toBeInTheDocument();
    expect(screen.getByText('2/4')).toBeInTheDocument();
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
});
