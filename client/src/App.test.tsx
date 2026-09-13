import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { useGameStore } from './stores/gameStore';
import { useSessionStore } from './stores/sessionStore';
import { useStatisticsStore } from './stores/statisticsStore';

/**
 * Navigation contract for the real (lazily split) route table.
 *
 * Every screen except Home is now a separate chunk behind `React.lazy`, so this
 * also proves each route actually resolves at runtime rather than 404-ing into
 * an empty Suspense boundary. Socket, audio and api layers are stubbed; routing,
 * screens and their states are the shipped ones.
 */
vi.mock('./hooks/useConnection', () => ({
  useConnection: () => undefined,
  default: () => undefined,
}));

vi.mock('./hooks/useAudioUnlock', () => ({
  useAudioUnlock: () => undefined,
  default: () => undefined,
}));

vi.mock('./hooks/useIdentityGate', () => {
  // Stable identity for the same reason as useRoomActions above.
  const gate = (action?: () => void | Promise<void>) => void action?.();
  return { useIdentityGate: () => gate, default: () => gate };
});

vi.mock('./hooks/useRoomActions', () => {
  // Identities must be stable across renders exactly like the real hook, which
  // wraps every action in useCallback([]). HomeScreen keys an effect on
  // `listRooms`; returning a fresh function per render makes that effect re-run
  // forever and the suite never finishes.
  const actions = {
    listRooms: vi.fn(async () => []),
    quickPlay: vi.fn(async () => ({ id: 'ABC123' })),
    createRoom: vi.fn(),
    joinRoom: vi.fn(),
    leaveRoom: vi.fn(async () => true),
  };
  return { useRoomActions: () => actions, default: () => actions };
});

vi.mock('./services/api', async () => {
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

const { App } = await import('./App');

function renderAt(route: string) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useGameStore.setState({ games: [], loading: false, error: null, loadedAt: null });
  useStatisticsStore.setState({ statistics: [], history: [], summary: null, loading: false, error: null });
  // A returning player with an established session — Statistics and Favorites
  // gate their content on it, so without this they show their nickname prompt.
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

describe('branding and home', () => {
  it('shows the 2PLAY brand and the tagline on the landing route', async () => {
    renderAt('/');
    expect(
      await screen.findByRole('link', { name: /2PLAY home/i }),
    ).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      'Play Together, Anywhere.',
    );
  });

  it('offers the three entry points straight from the hero', async () => {
    renderAt('/');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByRole('button', { name: /play now/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create room/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /join room/i })).toBeInTheDocument();
  });
});

describe('routing', () => {
  it('resolves /games and lists the whole catalogue', async () => {
    renderAt('/games');
    expect(await screen.findByRole('heading', { name: 'Games' })).toBeInTheDocument();
    await screen.findByText(/40 games · 0 favorites/);
    // Scope to the All Games rail: New Games repeats six of the same games.
    const section = screen.getByRole('heading', { name: /All Games/i }).closest('section')!;
    expect(
      within(section as HTMLElement).getAllByRole('button', { name: /^Expand / }),
    ).toHaveLength(40);
  });

  it('resolves a direct deep link to a game', async () => {
    renderAt('/games/chess');
    expect(await screen.findByRole('heading', { name: 'Chess' })).toBeInTheDocument();
    // The three selection actions are present on a cold load, no extra step.
    expect(screen.getByRole('button', { name: /play with ai/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create room/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /join room/i })).toBeInTheDocument();
  });

  it('shows a not-found game state for an unknown game id', async () => {
    renderAt('/games/not-a-real-game');
    expect(await screen.findByText('Game not found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /browse games/i })).toBeInTheDocument();
  });

  it.each([
    ['/create', 'Create a room'],
    ['/join', 'Join a room'],
    ['/favorites', 'Favorites'],
    ['/stats', 'Statistics'],
    ['/settings', 'Settings'],
  ])('resolves %s', async (route, heading) => {
    renderAt(route);
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
  });

  it('redirects the legacy /statistics path to /stats', async () => {
    renderAt('/statistics');
    expect(await screen.findByRole('heading', { name: 'Statistics' })).toBeInTheDocument();
  });

  it('renders a not-found page for an invalid route', async () => {
    renderAt('/this-route-does-not-exist');
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back home/i })).toBeInTheDocument();
  });
});

describe('in-app navigation', () => {
  it('navigates Home → Games → game details → back to Games', async () => {
    renderAt('/');
    await screen.findByRole('heading', { level: 1 });

    await userEvent.click(screen.getAllByRole('link', { name: /all games/i })[0]);
    expect(await screen.findByRole('heading', { name: 'Games' })).toBeInTheDocument();

    const cards = screen.getAllByRole('button', { name: /^Expand / });
    // Read the name first: the toggle re-labels itself "Collapse …" once open.
    const cardName = (cards[0].getAttribute('aria-label') ?? '').replace(/^Expand /, '');
    await userEvent.click(cards[0]);

    // Expanding is inline: the three actions appear without leaving /games.
    const panel = await screen.findByRole('button', { name: /play with ai/i });
    expect(panel).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Games' })).toBeInTheDocument();

    // "How to play" on the expanded card goes to the details page for that game.
    await userEvent.click(screen.getByRole('link', { name: /how to play/i }));
    expect(await screen.findByRole('heading', { name: cardName })).toBeInTheDocument();

    // And the details page links back to the catalogue.
    await userEvent.click(screen.getByRole('link', { name: /all games/i }));
    expect(await screen.findByRole('heading', { name: 'Games' })).toBeInTheDocument();
  });

  it('keeps the bottom navigation on mobile and the header nav on desktop', async () => {
    renderAt('/');
    await screen.findByRole('heading', { level: 1 });

    const bottomNav = screen.getByRole('navigation', { name: /bottom navigation/i });
    expect(
      within(bottomNav).getByRole('link', { name: /games/i }),
    ).toBeInTheDocument();

    const mainNav = screen.getByRole('navigation', { name: /main navigation/i });
    expect(within(mainNav).getByRole('link', { name: /games/i })).toBeInTheDocument();
    // Both navs must use the same destinations.
    expect(
      within(bottomNav).getByRole('link', { name: /games/i }).getAttribute('href'),
    ).toBe(within(mainNav).getByRole('link', { name: /games/i }).getAttribute('href'));
  });
});
