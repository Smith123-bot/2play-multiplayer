import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { RoomState } from '@2play/shared';
import { ALL_GAME_METADATA } from '@2play/shared';
import { useGameStore } from '../stores/gameStore';
import { useSessionStore } from '../stores/sessionStore';
import { useStatisticsStore } from '../stores/statisticsStore';
import { useFavoritesStore } from '../stores/favoritesStore';
import { useRoomStore } from '../stores/roomStore';

/**
 * Room-presence matrix: the global "You are in a room" prompt is mounted once
 * in AppShell and must surface on every non-room screen a player might wander
 * to mid-match — and ONLY there. Socket/audio/api are stubbed; routing, the
 * prompt, and the stores are the shipped ones.
 */
vi.mock('../hooks/useConnection', () => ({
  useConnection: () => undefined,
  default: () => undefined,
}));

vi.mock('../hooks/useAudioUnlock', () => ({
  useAudioUnlock: () => undefined,
  default: () => undefined,
}));

vi.mock('../hooks/useIdentityGate', () => {
  const gate = (action?: () => void | Promise<void>) => void action?.();
  return { useIdentityGate: () => gate, default: () => gate };
});

vi.mock('../hooks/useRoomActions', () => {
  const actions = {
    listRooms: vi.fn(async () => []),
    quickPlay: vi.fn(async () => ({ id: 'ABC123' })),
    createRoom: vi.fn(),
    joinRoom: vi.fn(),
    leaveRoom: vi.fn(async () => true),
    setReady: vi.fn(async () => true),
    startGame: vi.fn(async () => true),
    kickPlayer: vi.fn(async () => true),
    requestRematch: vi.fn(async () => true),
    cancelRematch: vi.fn(async () => true),
    leaveMatch: vi.fn(async () => true),
    // Unknown room id: reconnect fails (the shipped UI then shows its error state).
    reconnectToRoom: vi.fn(async () => false),
  };
  return { useRoomActions: () => actions, default: () => actions };
});

vi.mock('../services/api', async () => {
  const { ALL_GAME_METADATA } = await import('@2play/shared');
  return {
    api: {
      games: async () => ({ ok: true, data: { games: ALL_GAME_METADATA } }),
      popularity: async () => ({ ok: true, data: { popularity: [] } }),
      favorites: async () => ({ ok: true, data: { favorites: [] } }),
      addFavorite: async () => ({ ok: true }),
      removeFavorite: async () => ({ ok: true }),
      statistics: async () => ({ ok: true, data: { statistics: [], summary: null } }),
      history: async () => ({ ok: true, data: { history: [] } }),
    },
  };
});

const { App } = await import('../App');

const chess = ALL_GAME_METADATA.find((game) => game.id === 'chess')!;

function seededRoom(overrides: Partial<RoomState> = {}): RoomState {
  return {
    id: 'K7M2PX',
    code: 'K7M2PX',
    gameId: chess.id,
    hostId: 'p1',
    status: 'LOBBY',
    isPrivate: true,
    isQuickPlay: false,
    maxPlayers: 2,
    players: [
      { id: 'p1', nickname: 'Me' } as never,
      { id: 'p2', nickname: 'Friend' } as never,
    ],
    countdownValue: 0,
    matchNumber: 0,
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
  } as RoomState;
}

function renderAt(route: string) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useRoomStore.getState().clearRoom();
  useGameStore.setState({ games: [], loading: false, error: null, loadedAt: null });
  useStatisticsStore.setState({ statistics: [], history: [], summary: null, loading: false, error: null });
  useFavoritesStore.setState({ favorites: [], pending: {}, loading: false });
  useSessionStore.setState({
    session: {
      userId: 'u1',
      sessionToken: 'token',
      playerId: 'p1',
      nickname: 'Tester',
      avatar: '🦊',
      createdAt: Date.now(),
    },
    nickname: 'Tester',
    avatar: '🦊',
    ready: true,
  });
});

describe('room-presence matrix ("You are in a room" across the app)', () => {
  it.each([
    ['/', 'Home'],
    ['/games', 'Games catalogue'],
    ['/games/chess', 'Game details'],
    ['/stats', 'Statistics'],
    ['/favorites', 'Favorites'],
    ['/settings', 'Settings'],
  ])('shows the prompt exactly once on %s (%s)', async (route) => {
    useRoomStore.getState().setRoom(seededRoom());
    renderAt(route);
    // The prompt header is the "Return to" CTA with the room code; assert it
    // appears exactly once even on heavy pages.
    const returns = await screen.findAllByText('You are in a room', undefined, {
      timeout: 10_000,
    });
    expect(returns).toHaveLength(1);
    expect(document.body.textContent).toContain('K7M2PX');
    expect(screen.getAllByRole('button', { name: /Return to room/i }).length).toBe(1);
    expect(screen.getAllByRole('button', { name: /Leave room/i }).length).toBe(1);
  });

  it('does NOT show the prompt inside the matching room screen itself', async () => {
    useRoomStore.getState().setRoom(seededRoom({ status: 'LOBBY' }));
    renderAt('/room/K7M2PX');
    // The room screen loads; no overlay prompt may cover the lobby.
    await screen.findAllByText(/K7M2PX/);
    expect(screen.queryByText('You are in a room')).toBeNull();
  });

  it('STILL shows the prompt on a different room route (it is the way back)', async () => {
    useRoomStore.getState().setRoom(seededRoom());
    renderAt('/room/OTHERX');
    // Viewing some other /room/<id> is just another non-room of THIS room: the
    // prompt must stay visible so the player can get back to their match.
    await screen.findByText('You are in a room', undefined, { timeout: 10_000 });
    expect(screen.getByRole('button', { name: /Return to room/i })).toBeInTheDocument();
  });

  it('shows nothing on public pages when the room is CLOSED', async () => {
    useRoomStore.getState().setRoom(seededRoom({ status: 'CLOSED' } as Partial<RoomState>));
    renderAt('/games');
    await screen.findByRole('heading', { name: /^Games$/ }, { timeout: 10_000 });
    expect(screen.queryByRole('button', { name: /Return/i })).toBeNull();
  });
});
