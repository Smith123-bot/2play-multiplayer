import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ALL_GAME_METADATA, GAME_CATEGORIES } from '@2play/shared';
import { useGameStore } from '../stores/gameStore';
import { useFavoritesStore } from '../stores/favoritesStore';
import { usePopularityStore } from '../stores/popularityStore';

/**
 * Discovery-surface verification against the real shared catalogue.
 *
 * The api layer is stubbed but the metadata, filtering, sorting and rendering
 * are the shipped ones, so these tests exercise the same code path a player
 * uses: search, category filters, Most Played, New Games and the failure states.
 */
const popularityData: { current: Array<{ gameId: string; playCount: number }> } = { current: [] };
const gamesFail: { current: boolean } = { current: false };

vi.mock('../services/api', async () => {
  const { ALL_GAME_METADATA } = await import('@2play/shared');
  return {
    api: {
      games: async () =>
        gamesFail.current
          ? { ok: false, error: { message: 'Network unreachable' } }
          : { ok: true, data: { games: ALL_GAME_METADATA } },
      popularity: async () => ({ ok: true, data: { popularity: popularityData.current } }),
      favorites: async () => ({ ok: true, data: { favorites: [] } }),
      addFavorite: async () => ({ ok: true }),
      removeFavorite: async () => ({ ok: true }),
    },
  };
});

vi.mock('../hooks/useRoomActions', () => {
  // Stable identities, matching the real hook's useCallback([]). A fresh
  // function per render would re-trigger any effect keyed on them.
  const actions = {
    quickPlay: vi.fn(async () => ({ id: 'ABC123' })),
    listRooms: vi.fn(async () => []),
    createRoom: vi.fn(),
    joinRoom: vi.fn(),
    leaveRoom: vi.fn(),
  };
  return { useRoomActions: () => actions, default: () => actions };
});

vi.mock('../hooks/useIdentityGate', () => {
  const gate = (action?: () => void | Promise<void>) => void action?.();
  return { useIdentityGate: () => gate, default: () => gate };
});

// Imported after the mocks so the store picks up the stubbed api.
const { GameBrowserScreen } = await import('./GameBrowserScreen');

const CARD = /^Expand /;

function renderScreen() {
  return render(
    <MemoryRouter>
      <GameBrowserScreen />
    </MemoryRouter>,
  );
}

/** Cards inside the "All Games" rail only (other rails repeat some games). */
async function allGamesCards() {
  const heading = await screen.findByRole('heading', { name: /All Games/i });
  const section = heading.closest('section');
  expect(section, 'All Games heading is not inside a section').not.toBeNull();
  return within(section as HTMLElement).queryAllByRole('button', { name: CARD });
}

/** Cards in the single grid rendered while a search/filter is active. */
function resultCards() {
  return screen.queryAllByRole('button', { name: CARD });
}

function cardNames(cards: HTMLElement[]) {
  return cards.map((card) => (card.getAttribute('aria-label') ?? '').replace(/^Expand /, ''));
}

beforeEach(() => {
  popularityData.current = [];
  gamesFail.current = false;
  useGameStore.setState({ games: [], loading: false, error: null, loadedAt: null });
  useFavoritesStore.setState({ favorites: [], pending: {}, loading: false });
  usePopularityStore.setState({ popularity: [], loadedAt: null });
});

describe('game discovery: catalogue', () => {
  it('lists the complete catalogue with no duplicates', async () => {
    renderScreen();
    const catalogueCount = ALL_GAME_METADATA.length;
    const cards = await allGamesCards();
    const names = cardNames(cards);
    expect(names).toHaveLength(catalogueCount);
    expect(new Set(names).size, 'duplicate game cards').toBe(catalogueCount);
    expect(screen.getByText(new RegExp(`${catalogueCount} games · 0 favorites`))).toBeInTheDocument();
  });

  it('shows every game exactly once across all category filters', async () => {
    renderScreen();
    await allGamesCards();

    const seen: string[] = [];
    for (const category of GAME_CATEGORIES) {
      fireEvent.change(screen.getByLabelText('Category'), { target: { value: category } });
      await waitFor(() => expect(resultCards().length).toBeGreaterThan(0));
      seen.push(...cardNames(resultCards()));
    }

    expect(seen.sort()).toEqual(ALL_GAME_METADATA.map((game) => game.name).sort());
    expect(new Set(seen).size, 'a game appears in two categories').toBe(ALL_GAME_METADATA.length);
  });

  it('filters by player count using the real supportedPlayerCounts', async () => {
    renderScreen();
    await allGamesCards();

    fireEvent.change(screen.getByLabelText('Players'), { target: { value: '4' } });
    await waitFor(() => {
      const expected = ALL_GAME_METADATA.filter((game) =>
        game.supportedPlayerCounts.includes(4),
      ).length;
      expect(resultCards()).toHaveLength(expected);
    });
  });
});

describe('game discovery: search', () => {
  it('finds a game by exact name, partial name and any letter case', async () => {
    renderScreen();
    const search = await screen.findByLabelText('Search');
    await allGamesCards();

    for (const query of ['Chess', 'chess', 'CHESS', 'ches', 'ss']) {
      fireEvent.change(search, { target: { value: query } });
      await waitFor(() => expect(cardNames(resultCards())).toContain('Chess'));
    }
  });

  it('searches tags and category text, not just names', async () => {
    renderScreen();
    const search = await screen.findByLabelText('Search');
    await allGamesCards();

    fireEvent.change(search, { target: { value: 'reflex' } });
    await waitFor(() => {
      const expected = ALL_GAME_METADATA.filter(
        (game) =>
          `${game.name} ${game.id} ${game.category} ${game.description} ${game.tags.join(' ')}`
            .toLowerCase()
            .includes('reflex'),
      ).length;
      expect(expected).toBeGreaterThan(0);
      expect(resultCards()).toHaveLength(expected);
    });
  });

  it('shows a no-result state with a way back', async () => {
    renderScreen();
    const search = await screen.findByLabelText('Search');
    await allGamesCards();

    fireEvent.change(search, { target: { value: 'zzzz-not-a-game' } });
    expect(await screen.findByText('No games found')).toBeInTheDocument();
    expect(resultCards()).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: /clear filters/i }));
    await waitFor(() => expect(allGamesCards()).resolves.toHaveLength(ALL_GAME_METADATA.length));
  });

  it('clears the query with the search field clear button', async () => {
    renderScreen();
    const search = await screen.findByLabelText('Search');
    await allGamesCards();

    fireEvent.change(search, { target: { value: 'chess' } });
    await waitFor(() => expect(resultCards().length).toBeLessThan(ALL_GAME_METADATA.length));

    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect((search as HTMLInputElement).value).toBe('');
    await waitFor(() => expect(allGamesCards()).resolves.toHaveLength(ALL_GAME_METADATA.length));
  });

  it('announces the result count to assistive technology', async () => {
    renderScreen();
    const search = await screen.findByLabelText('Search');
    await allGamesCards();

    fireEvent.change(search, { target: { value: 'chess' } });
    const status = await screen.findByRole('status');
    expect(status.textContent).toMatch(/1 game found/);
  });
});

describe('game discovery: card expansion', () => {
  it('expands only the clicked card when that game also appears in another rail', async () => {
    renderScreen();
    await allGamesCards();

    // New Games repeats six games that are also listed in All Games.
    const newSection = screen.getByRole('heading', { name: /New Games/i }).closest('section')!;
    const newCards = within(newSection as HTMLElement).getAllByRole('button', { name: CARD });
    const target = cardNames([newCards[0]])[0];
    const allCards = await allGamesCards();
    const twin = allCards.find((card) => cardNames([card])[0] === target);
    expect(twin, 'the same game should also be in All Games').toBeDefined();

    await userEvent.click(newCards[0]);

    // Exactly one action panel on the page: expanding by id alone used to open
    // every copy of the game at once.
    expect(screen.getAllByRole('button', { name: /play with ai/i })).toHaveLength(1);
    expect(newCards[0]).toHaveAttribute('aria-expanded', 'true');
    expect(twin!).toHaveAttribute('aria-expanded', 'false');

    // And it collapses again.
    await userEvent.click(newCards[0]);
    expect(newCards[0]).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: /play with ai/i })).toBeNull();
  });

  it('moves the open card when a different game is expanded', async () => {
    renderScreen();
    const cards = await allGamesCards();

    await userEvent.click(cards[0]);
    expect(cards[0]).toHaveAttribute('aria-expanded', 'true');

    await userEvent.click(cards[1]);
    expect(cards[0]).toHaveAttribute('aria-expanded', 'false');
    expect(cards[1]).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('button', { name: /play with ai/i })).toHaveLength(1);
  });
});

describe('game discovery: Most Played and New Games', () => {
  it('hides Most Played entirely when the server has recorded no matches', async () => {
    renderScreen();
    await allGamesCards();
    // No fabricated ranking: the rail is absent, not filled with guesses.
    expect(screen.queryByRole('heading', { name: /Most Played/i })).toBeNull();
  });

  it('ranks Most Played by the real play counts from the server', async () => {
    popularityData.current = [
      { gameId: 'chess', playCount: 12 },
      { gameId: 'ludo', playCount: 80 },
      { gameId: 'uno', playCount: 35 },
    ];
    renderScreen();
    await allGamesCards();

    const heading = await screen.findByRole('heading', { name: /Most Played/i });
    const section = heading.closest('section') as HTMLElement;
    const names = cardNames(within(section).getAllByRole('button', { name: CARD }));
    expect(names).toEqual(['Ludo', 'Uno', 'Chess']);
  });

  it('shows New Games in real registration order, not a hand-picked list', async () => {
    renderScreen();
    await allGamesCards();

    const heading = await screen.findByRole('heading', { name: /New Games/i });
    const section = heading.closest('section') as HTMLElement;
    const names = cardNames(within(section).getAllByRole('button', { name: CARD }));

    // Newest registration first: the tail of /api/games order, reversed.
    const expected = ALL_GAME_METADATA.slice(-6)
      .reverse()
      .map((game) => game.name);
    expect(names).toEqual(expected);
    expect(names).toHaveLength(6);
  });
});

describe('game discovery: failure states', () => {
  it('reports a failed catalogue load instead of an empty state', async () => {
    gamesFail.current = true;
    renderScreen();

    expect(await screen.findByText('Could not load games')).toBeInTheDocument();
    expect(screen.getByText(/Network unreachable/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    // It must not pretend the catalogue is simply empty.
    expect(screen.queryByText('No games available')).toBeNull();
  });

  it('recovers when the retry succeeds', async () => {
    gamesFail.current = true;
    renderScreen();
    await screen.findByText('Could not load games');

    gamesFail.current = false;
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(allGamesCards()).resolves.toHaveLength(ALL_GAME_METADATA.length));
  });
});
