import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ALL_GAME_METADATA, SITE_NAME, SITE_URL } from '@2play/shared';
import { readJsonLdBlocks } from '../seo/usePageSeo';

/**
 * Game-page SEO verification against the real shared catalogue.
 *
 * The API layer is stubbed, but metadata, routing, head management and the
 * rendered content are the shipped ones — so what these tests assert is what
 * a crawler (with or without JavaScript) ultimately finds on /games/<id>.
 */
vi.mock('../services/api', async () => {
  const { ALL_GAME_METADATA } = await import('@2play/shared');
  return {
    api: {
      games: async () => ({ ok: true, data: { games: ALL_GAME_METADATA } }),
      favorites: async () => ({ ok: true, data: { favorites: [] } }),
      addFavorite: async () => ({ ok: true }),
      removeFavorite: async () => ({ ok: true }),
    },
  };
});

vi.mock('../hooks/useRoomActions', () => {
  const actions = {
    quickPlay: vi.fn(async () => null),
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

// Imported after the mocks so the screen picks up the stubbed api.
const { GameDetailsScreen } = await import('./GameDetailsScreen');

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/games/:gameId" element={<GameDetailsScreen />} />
      </Routes>
    </MemoryRouter>,
  );
}

function metaContent(selector: string): string | null {
  return document.head.querySelector<HTMLMetaElement>(selector)?.getAttribute('content') ?? null;
}

const CHESS = ALL_GAME_METADATA.find((game) => game.id === 'chess')!;

beforeEach(() => {
  document.head.innerHTML = '';
  document.title = '';
});

describe('valid game page', () => {
  it('renders the game with unique title, description and canonical', async () => {
    renderAt('/games/chess');
    await screen.findByRole('heading', { level: 1, name: 'Chess' });

    expect(document.title).toBe(`Chess — Play Online with Friends | ${SITE_NAME}`);
    expect(metaContent('meta[name="description"]')).toContain(CHESS.description.slice(0, 40));
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      `${SITE_URL}/games/chess`,
    );
    expect(metaContent('meta[name="robots"]')).toBeNull();
    expect(metaContent('meta[property="og:url"]')).toBe(`${SITE_URL}/games/chess`);
    expect(metaContent('meta[property="og:site_name"]')).toBe(SITE_NAME);
    expect(metaContent('meta[name="twitter:title"]')).toBe(document.title);
  });

  it('shows the required visible SEO content, all sourced from real metadata', async () => {
    renderAt('/games/chess');
    await screen.findByRole('heading', { level: 1, name: 'Chess' });

    // How to Play (steps or rules, numbered)
    expect(screen.getByRole('heading', { name: 'How to play' })).toBeInTheDocument();
    for (const step of CHESS.howToPlay?.steps ?? []) {
      expect(screen.getByText(step)).toBeInTheDocument();
    }
    expect(screen.getByText(CHESS.description)).toBeInTheDocument();

    // Rules (chess ships structured steps, so the flat rules render separately)
    expect(screen.getByRole('heading', { name: 'Rules' })).toBeInTheDocument();
    for (const rule of CHESS.rules) {
      expect(screen.getByText(rule)).toBeInTheDocument();
    }

    // Player count, category and game modes
    expect(screen.getByText('Player count')).toBeInTheDocument();
    expect(screen.getByText('Category')).toBeInTheDocument();
    // The category label appears in the hero badge and the Details card.
    expect(screen.getAllByText('Strategy').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Game modes' })).toBeInTheDocument();
    expect(screen.getByText(/Online multiplayer/)).toBeInTheDocument();

    // Scoring / win condition / controls stay visible from the shipped metadata
    expect(screen.getByText(CHESS.scoring)).toBeInTheDocument();
    expect(screen.getByText(CHESS.winCondition)).toBeInTheDocument();
  });

  it('does not render a duplicate Rules card when a game has no structured steps', async () => {
    // reaction-race has no howToPlay.steps: its rules ARE the how-to-play list.
    renderAt('/games/reaction-race');
    await screen.findByRole('heading', { level: 1, name: 'Reaction Race' });
    expect(screen.getByRole('heading', { name: 'How to play' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Rules' })).not.toBeInTheDocument();
  });

  it('injects VideoGame + BreadcrumbList JSON-LD with truthful fields only', async () => {
    renderAt('/games/chess');
    await screen.findByRole('heading', { level: 1, name: 'Chess' });

    const blocks = readJsonLdBlocks();
    const videoGame = blocks.find((block) => block['@type'] === 'VideoGame');
    expect(videoGame).toBeDefined();
    expect(videoGame?.name).toBe('Chess');
    expect(videoGame?.url).toBe(`${SITE_URL}/games/chess`);
    expect(videoGame?.genre).toBe('Strategy');
    expect(videoGame?.numberOfPlayers).toMatchObject({ minValue: CHESS.minPlayers, maxValue: CHESS.maxPlayers });
    expect(videoGame).not.toHaveProperty('aggregateRating');
    expect(videoGame).not.toHaveProperty('offers');
    expect(videoGame).not.toHaveProperty('review');

    const breadcrumb = blocks.find((block) => block['@type'] === 'BreadcrumbList');
    expect(breadcrumb).toBeDefined();
    const items = breadcrumb?.itemListElement as Array<{ name: string; item: string }>;
    // Home → Games → Category → Game, matching the visible breadcrumb trail.
    expect(items.map((item) => item.item)).toEqual([
      `${SITE_URL}/`,
      `${SITE_URL}/games`,
      `${SITE_URL}/games?category=${CHESS.category}`,
      `${SITE_URL}/games/chess`,
    ]);
  });

  it('links to related games with real anchors and meaningful names', async () => {
    renderAt('/games/chess');
    const heading = await screen.findByRole('heading', { name: 'Related games' });
    const section = heading.closest('section');
    expect(section).not.toBeNull();

    const links = within(section as HTMLElement)
      .getAllByRole('link')
      .filter((link) => (link.getAttribute('href') ?? '').startsWith('/games/'));
    expect(links.length).toBeGreaterThan(0);

    for (const link of links) {
      const href = link.getAttribute('href')!;
      // Every related link is a valid, registered game (never broken, never self).
      expect(ALL_GAME_METADATA.some((game) => `/games/${game.id}` === href), href).toBe(true);
      expect(href).not.toBe('/games/chess');
      // Meaningful anchor: the accessible name contains the game's name.
      const target = ALL_GAME_METADATA.find((game) => `/games/${game.id}` === href)!;
      expect((link.textContent ?? '').length + (link.getAttribute('aria-label') ?? '').length).toBeGreaterThan(0);
      expect(
        (link.textContent ?? '').includes(target.name) ||
          (link.getAttribute('aria-label') ?? '').includes(target.name),
        `${target.name} anchor text`,
      ).toBe(true);
    }
  });

  it('keeps the breadcrumb trail back to the catalogue, including its category', async () => {
    renderAt('/games/chess');
    await screen.findByRole('heading', { level: 1, name: 'Chess' });
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    const allGames = within(breadcrumb).getByRole('link', { name: /All games/ });
    expect(allGames.getAttribute('href')).toBe('/games');
    // Deep-linked category filter — the full Home → Games → Category → Game chain.
    const category = within(breadcrumb).getByRole('link', { name: /Strategy games/ });
    expect(category.getAttribute('href')).toBe('/games?category=strategy');
    // Current page is a self-describing label, not a link to itself.
    expect(within(breadcrumb).queryByRole('link', { name: 'Chess' })).toBeNull();
  });

  it('renders a unique About introduction that matches the meta description and JSON-LD', async () => {
    const { container } = renderAt('/games/chess');
    await screen.findByRole('heading', { level: 1, name: 'Chess' });

    const aboutHeading = screen.getByRole('heading', { name: 'About Chess' });
    const section = aboutHeading.closest('section');
    expect(section).not.toBeNull();
    const intro = section!.querySelector('p')?.textContent ?? '';
    expect(intro.length).toBeGreaterThan(250);
    expect(intro).toContain(CHESS.description);

    // Head and structured data describe exactly this visible content: the
    // meta description is the short snippet form, the JSON-LD description is
    // the same full paragraph the About section shows.
    expect(metaContent('meta[name="description"]')).toContain(CHESS.description.slice(0, 40));
    const videoGame = readJsonLdBlocks().find((block) => block['@type'] === 'VideoGame');
    expect(videoGame?.description).toBe(intro);
    expect(container.querySelector(`section[aria-labelledby="about-chess"]`)).not.toBeNull();
  });

  it('offers a descriptive play path (create / join / catalogue) with no private-room links', async () => {
    renderAt('/games/chess');
    await screen.findByRole('heading', { level: 1, name: 'Chess' });

    const play = screen.getByRole('navigation', { name: 'Play Chess' });
    const create = within(play).getByRole('link', { name: /Create a Chess room/ });
    expect(create.getAttribute('href')).toBe('/create?game=chess');
    const join = within(play).getByRole('link', { name: /Join a Chess room with a code/ });
    expect(join.getAttribute('href')).toBe('/join?game=chess');
    expect(within(play).getByRole('link', { name: 'Explore all games' }).getAttribute('href')).toBe(
      '/games',
    );

    // Crawlable content must never leak room URLs — rooms are private and
    // noindexed; the whole page must link only to public destinations.
    const body = document.body.innerHTML;
    expect(body).not.toContain('/room/');
    for (const anchor of Array.from(document.querySelectorAll('a[href^="/games/"]'))) {
      const id = anchor.getAttribute('href')!.replace('/games/', '');
      expect(ALL_GAME_METADATA.some((game) => game.id === id), id).toBe(true);
    }
  });
});

describe('internal link integrity across the catalogue', () => {
  // Representative spread over categories plus AI / non-AI metadata paths.
  it.each([
    'reaction-race',
    'chess',
    'hangman',
    'memory-match',
    'couple-sync',
    'maze-race-2d',
  ])('page %s links only to real registered games and public destinations', async (id) => {
    const game = ALL_GAME_METADATA.find((entry) => entry.id === id)!;
    renderAt(`/games/${id}`);
    await screen.findByRole('heading', { level: 1, name: game.name });

    // Visible intro follows the same honest asymmetry as the metadata.
    const intro = screen.getByRole('heading', { name: `About ${game.name}` })
      .closest('section')!.querySelector('p')!.textContent!;
    expect(intro.includes('against the computer')).toBe(Boolean(game.hasAI));

    expect(document.body.innerHTML).not.toContain('/room/');
    expect(document.body.innerHTML).not.toContain(`/games/${id}"`);

    const internal = Array.from(document.querySelectorAll('a[href^="/"]')).map((a) =>
      a.getAttribute('href')!,
    );
    expect(internal.length).toBeGreaterThan(0);
    for (const href of internal) {
      const isKnown =
        ALL_GAME_METADATA.some((entry) => href === `/games/${entry.id}`) ||
        ['/', '/games', '/create', '/join'].includes(href) ||
        href.startsWith('/games?category=') ||
        href.startsWith('/create?') ||
        href.startsWith('/join?');
      expect(isKnown, href).toBe(true);
    }
  });
});

describe('invalid game page', () => {
  it('shows the not-found state with a noindex head and no canonical', async () => {
    renderAt('/games/this-game-does-not-exist');
    await screen.findByText('Game not found');

    expect(document.title).toBe(`Game Not Found | ${SITE_NAME}`);
    expect(metaContent('meta[name="robots"]')).toBe('noindex, nofollow');
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();

    // Recovery path: a real link back to the catalogue.
    const browse = screen.getByRole('link', { name: 'Browse games' });
    expect(browse.getAttribute('href')).toBe('/games');
  });
});
