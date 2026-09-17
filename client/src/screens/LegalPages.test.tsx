import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  ALL_GAME_METADATA,
  SITE_NAME,
  SITE_URL,
  STATIC_INFO_PAGES,
  buildHomeAboutContent,
} from '@2play/shared';
import { useGameStore } from '../stores/gameStore';

/**
 * Public information & legal page verification.
 *
 * The pages are content surfaces: what the tests pin down is that every route
 * renders with its unique title/description/canonical/OG head, that the lead
 * the crawler reads is the visible lead the user reads, that required topics
 * are covered, that internal links resolve, and that nothing sensitive leaks.
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
    },
  };
});

const AboutScreen = (await import('./AboutScreen')).default;
const PrivacyScreen = (await import('./PrivacyScreen')).default;
const TermsScreen = (await import('./TermsScreen')).default;
const ContactScreen = (await import('./ContactScreen')).default;
const FaqScreen = (await import('./FaqScreen')).default;

const SCREENS: Record<string, () => JSX.Element> = {
  '/about': AboutScreen,
  '/privacy': PrivacyScreen,
  '/terms': TermsScreen,
  '/contact': ContactScreen,
  '/faq': FaqScreen,
};

/** Every path any footer/page link is allowed to point at. */
const ALLOWED_HREFS = new Set([
  '/',
  '/games',
  '/create',
  '/join',
  ...STATIC_INFO_PAGES.map((page) => page.path),
]);

function renderAt(path: string) {
  const Screen = SCREENS[path]!;
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={path} element={<Screen />} />
      </Routes>
    </MemoryRouter>,
  );
}

function metaContent(selector: string): string | null {
  return document.head.querySelector<HTMLMetaElement>(selector)?.getAttribute('content') ?? null;
}

beforeEach(() => {
  document.head.innerHTML = '';
  document.title = '';
  useGameStore.setState({ games: [...ALL_GAME_METADATA], loading: false, error: null, loadedAt: Date.now() });
});

describe('public information & legal pages', () => {
  it.each(STATIC_INFO_PAGES.map((page) => [page.path, page.title] as const))(
    '%s renders h1 + unique title, description, canonical and OG head',
    (path, title) => {
      renderAt(path);
      const page = STATIC_INFO_PAGES.find((entry) => entry.path === path)!;

      expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
      expect(document.title).toBe(`${page.title} | ${SITE_NAME}`);
      expect(metaContent('meta[name="description"]')).toBe(page.description);
      expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
        `${SITE_URL}${page.path}`,
      );
      expect(metaContent('meta[property="og:url"]')).toBe(`${SITE_URL}${page.path}`);
      expect(metaContent('meta[property="og:site_name"]')).toBe(SITE_NAME);
      expect(metaContent('meta[name="twitter:card"]')).toBe('summary');
      // Indexable: no robots meta.
      expect(metaContent('meta[name="robots"]')).toBeNull();

      // The lead the crawler reads IS the lead the user reads.
      expect(document.body.textContent).toContain(page.description);

      // Security surface: no tokens, no secrets, no internal env names.
      expect(document.body.innerHTML).not.toContain('sessionToken');
      expect(document.body.innerHTML).not.toContain('SUPABASE_');
      expect(document.body.innerHTML).not.toContain('/room/');

      // Every internal link resolves to a real public route or a mailto.
      for (const anchor of Array.from(document.querySelectorAll('a[href]'))) {
        const href = anchor.getAttribute('href')!;
        const allowed =
          ALLOWED_HREFS.has(href) || href.startsWith('mailto:') || href.startsWith('#');
        expect(allowed, `${path} → ${href}`).toBe(true);
      }
    },
  );

  it('distinct pages have distinct document titles', () => {
    const seen = new Set<string>();
    for (const path of Object.keys(SCREENS)) {
      const { unmount } = renderAt(path);
      expect(seen.has(document.title), document.title).toBe(false);
      seen.add(document.title);
      unmount();
      document.head.innerHTML = '';
      document.title = '';
    }
    expect(seen.size).toBe(STATIC_INFO_PAGES.length);
  });

  it('/about explains rooms and lists categories derived from the live registry', () => {
    renderAt('/about');
    const about = buildHomeAboutContent(ALL_GAME_METADATA);
    expect(screen.getByRole('heading', { name: 'How multiplayer rooms work' })).toBeInTheDocument();
    expect(document.body.textContent).toContain(`${about.totalGames}`);
    for (const category of about.categories) {
      expect(document.body.textContent).toContain(`${category.label} · ${category.gameCount}`);
    }
    expect(screen.getByRole('link', { name: 'Browse the full catalogue' }).getAttribute('href')).toBe('/games');
  });

  it('/privacy covers storage, cookies, sockets, logs, security and retention honestly', () => {
    renderAt('/privacy');
    const body = document.body.textContent!;
    for (const topic of [
      'local storage',
      'no cookies',
      'Socket.IO',
      'Supabase',
      'rate-limited',
      'favorites',
      'statistics',
      'chat',
      'deleted',
    ]) {
      expect(body.toLowerCase(), topic).toContain(topic.toLowerCase());
    }
    // Explicit no-claim statements.
    expect(body).toContain('no analytics');
    expect(body).not.toMatch(/we collect (your )?email/i);
  });

  it('/terms covers chat rules, abuse and disclaimers', () => {
    renderAt('/terms');
    const body = document.body.textContent!;
    for (const topic of ['acceptable', 'Nicknames', 'chat', 'Prohibited abuse', 'as is', 'as available', 'warranties']) {
      expect(body, topic).toContain(topic);
    }
  });

  it('/contact never invents an email when VITE_CONTACT_EMAIL is unset', () => {
    renderAt('/contact');
    expect(document.body.textContent).toContain('VITE_CONTACT_EMAIL');
    expect(document.body.textContent).toContain('No public contact email is configured');
    expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
    // Internal fallbacks are linked.
    for (const name of ['FAQ', 'Privacy Policy', 'Terms of Service']) {
      expect(within(document.body).getByRole('link', { name })).toBeInTheDocument();
    }
  });

  it('/faq answers every required question from real behavior', () => {
    renderAt('/faq');
    for (const question of [
      'What is DuoPlay?',
      'How do I create a room?',
      'How do I join a room?',
      'How many players can play?',
      'Is DuoPlay 2D?',
      'How do Favorites work?',
      'How do Stats work?',
      'What happens if I disconnect?',
      'How does chat work?',
    ]) {
      expect(screen.getByRole('heading', { name: question })).toBeInTheDocument();
    }
    expect(screen.getByRole('heading', { name: /Troubleshooting/ })).toBeInTheDocument();
    expect(document.body.textContent).toContain('six-character');
  });
});
