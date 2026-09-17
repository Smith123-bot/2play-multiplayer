import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ALL_GAME_METADATA, SITE_NAME, SITE_URL } from '@2play/shared';
import { readJsonLdBlocks } from '../seo/usePageSeo';

/**
 * Homepage content + internal-linking verification against the real catalogue.
 *
 * The gameplay surfaces are stubbed, but routing, head management, the
 * "What is DuoPlay" section and every anchor are the shipped ones — exactly
 * what a JS-executing crawler experiences on /.
 */
vi.mock('../services/api', async () => {
  const { ALL_GAME_METADATA } = await import('@2play/shared');
  return {
    api: {
      games: async () => ({ ok: true, data: { games: ALL_GAME_METADATA } }),
      favorites: async () => ({ ok: true, data: { favorites: [] } }),
      addFavorite: async () => ({ ok: true }),
      removeFavorite: async () => ({ ok: true }),
      popularity: async () => ({ ok: true, data: { popularity: [] } }),
      statistics: async () => ({
        ok: true,
        data: { summary: { totalMatches: 0, wins: 0, losses: 0, draws: 0, winRate: 0 } },
      }),
      history: async () => ({ ok: true, data: { entries: [] } }),
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
const { HomeScreen } = await import('./HomeScreen');

function renderHome() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <HomeScreen />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  document.head.innerHTML = '';
  document.title = '';
});

describe('homepage SEO content', () => {
  it('sets the home head with canonical + WebSite JSON-LD from the real catalogue', async () => {
    renderHome();
    // The About section proves the store finished loading the catalogue.
    await screen.findByRole('heading', { name: `What is ${SITE_NAME}?` });

    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      `${SITE_URL}/`,
    );
    expect(document.title).toContain(SITE_NAME);
    const website = readJsonLdBlocks().find((block) => block['@type'] === 'WebSite');
    expect(website).toBeDefined();
    expect(website?.name).toBe(SITE_NAME);
    expect((website?.description as string) ?? '').toContain(`${ALL_GAME_METADATA.length}`);
  });

  it('renders the readable About section as the last block on the page', async () => {
    renderHome();
    const heading = await screen.findByRole('heading', { name: `What is ${SITE_NAME}?` });
    const section = heading.closest('section');
    expect(section).not.toBeNull();

    // Content derived from the live registry — never a hard-coded count.
    expect(section!.textContent).toContain(`${ALL_GAME_METADATA.length}`);

    // Last element inside the page container: hero, featured games, public
    // rooms and stats all render above it, so mobile gameplay is untouched.
    const children = Array.from(section!.parentElement!.children);
    expect(children[children.length - 1]).toBe(section);
  });

  it('links Home → create/join/catalogue with descriptive anchors and no room URLs', async () => {
    renderHome();
    await screen.findByRole('heading', { name: `What is ${SITE_NAME}?` });

    const nav = screen.getByRole('navigation', { name: 'Get started' });
    expect(
      within(nav).getByRole('link', { name: /Create a room and invite friends/ }).getAttribute('href'),
    ).toBe('/create');
    expect(
      within(nav).getByRole('link', { name: /Join a room with a code/ }).getAttribute('href'),
    ).toBe('/join');
    expect(
      within(nav)
        .getByRole('link', { name: `Browse all ${ALL_GAME_METADATA.length} games` })
        .getAttribute('href'),
    ).toBe('/games');

    // Nothing on Home points at a private room or an unknown game slug.
    expect(document.body.innerHTML).not.toContain('href="/room/');
    for (const anchor of Array.from(document.querySelectorAll('a[href^="/games/"]'))) {
      const id = anchor.getAttribute('href')!.replace('/games/', '');
      expect(ALL_GAME_METADATA.some((game) => game.id === id), id).toBe(true);
    }
  });
});
