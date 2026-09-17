import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { RoomState } from '@2play/shared';
import { SITE_NAME, STATIC_INFO_PAGES } from '@2play/shared';
import { useGameStore } from '../../stores/gameStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useStatisticsStore } from '../../stores/statisticsStore';
import { useRoomStore } from '../../stores/roomStore';

/**
 * Footer matrix: the public footer with the complete information/legal link
 * ring renders on every public surface and ONLY there (room pages keep the
 * viewport for gameplay). Socket/audio/api stubbed; routing + layout shipped.
 */
vi.mock('../../hooks/useConnection', () => ({
  useConnection: () => undefined,
  default: () => undefined,
}));

vi.mock('../../hooks/useAudioUnlock', () => ({
  useAudioUnlock: () => undefined,
  default: () => undefined,
}));

vi.mock('../../hooks/useIdentityGate', () => {
  const gate = (action?: () => void | Promise<void>) => void action?.();
  return { useIdentityGate: () => gate, default: () => gate };
});

vi.mock('../../hooks/useRoomActions', () => {
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
    reconnectToRoom: vi.fn(async () => false),
  };
  return { useRoomActions: () => actions, default: () => actions };
});

vi.mock('../../services/api', async () => {
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

const { App } = await import('../../App');

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

const EXPECTED_INFO_LINKS: ReadonlyArray<readonly [string, string]> = [
  ['Home', '/'],
  ['Games', '/games'],
  ...STATIC_INFO_PAGES.map((page) => [page.title, page.path] as const),
];

beforeEach(() => {
  useRoomStore.getState().clearRoom();
  useGameStore.setState({ games: [], loading: false, error: null, loadedAt: null });
  useStatisticsStore.setState({ statistics: [], history: [], summary: null, loading: false, error: null });
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

describe('public footer', () => {
  it.each(['/', '/games', '/games/chess', '/about', '/privacy', '/terms', '/contact', '/faq'])(
    'renders the complete link ring exactly once on %s',
    async (route) => {
      renderAt(route);
      const footer = (
        await screen.findAllByRole('navigation', { name: 'Site information' }, { timeout: 10_000 })
      )[0];
      expect(screen.getAllByRole('navigation', { name: 'Site information' })).toHaveLength(1);

      for (const [name, href] of EXPECTED_INFO_LINKS) {
        const link = within(footer).getByRole('link', { name });
        expect(link.getAttribute('href'), `${route} → ${href}`).toBe(href);
      }
      // No private room or API URLs anywhere in the footer.
      for (const anchor of within(footer).getAllByRole('link')) {
        expect(anchor.getAttribute('href')!.startsWith('/room/')).toBe(false);
      }
      // Identification line keeps the real branding.
      expect(document.body.textContent).toContain(SITE_NAME);
    },
  );

  it('stays hidden on room pages (gameplay owns the viewport)', () => {
    useRoomStore.getState().setRoom({
      id: 'K7M2PX',
      code: 'K7M2PX',
      gameId: 'chess',
      hostId: 'p1',
      status: 'LOBBY',
      isPrivate: true,
      isQuickPlay: false,
      maxPlayers: 2,
      players: [{ id: 'p1', nickname: 'Me' } as never],
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
    } as unknown as RoomState);
    renderAt('/room/K7M2PX');
    expect(screen.queryByRole('navigation', { name: 'Site information' })).toBeNull();
  });

  it('every footer title comes from the shared registry (no hand-typed path list)', () => {
    renderAt('/about');
    const footer = screen.getByRole('navigation', { name: 'Site information' });
    const hrefs = within(footer).getAllByRole('link').map((a) => a.getAttribute('href'));
    for (const page of STATIC_INFO_PAGES) {
      expect(hrefs).toContain(page.path);
    }
  });
});
