import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SITE_URL, STATIC_INFO_PAGES, gamePagePath } from '@2play/shared';
import { startTestServer, type TestServer } from '../helpers/server';

/**
 * The public discovery surface over the wire: robots.txt, sitemap.xml and
 * their agreement with the live game registry and the /api catalogue. Every
 * expectation is derived from the registry — no game count is hard-coded.
 */
let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
}, 30_000);

afterAll(async () => {
  await server?.stop();
});

async function get(path: string) {
  const response = await fetch(`${server.url}${path}`);
  return { status: response.status, contentType: response.headers.get('content-type') ?? '', body: await response.text() };
}

describe('robots.txt', () => {
  it('is served as plain text, blocks private areas and references the sitemap', async () => {
    const { status, contentType, body } = await get('/robots.txt');
    expect(status).toBe(200);
    expect(contentType).toContain('text/plain');

    expect(body).toContain('User-agent: *');
    expect(body).toContain('Allow: /');
    for (const blocked of ['/api/', '/socket.io/', '/room/', '/create', '/join', '/settings', '/stats', '/favorites', '/error']) {
      expect(body).toContain(`Disallow: ${blocked}`);
    }
    expect(body).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`);
  });
});

describe('sitemap.xml', () => {
  it('lists homepage, catalogue and every registered game — and nothing else', async () => {
    const { status, contentType, body } = await get('/sitemap.xml');
    expect(status).toBe(200);
    expect(contentType).toContain('application/xml');

    const registryIds = server.platform.registry.ids();
    const locs = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]!);

    expect(locs[0]).toBe(`${SITE_URL}/`);
    expect(locs[1]).toBe(`${SITE_URL}/games`);
    // homepage + catalogue + one URL per registered game + public info pages.
    expect(locs).toHaveLength(registryIds.length + 2 + STATIC_INFO_PAGES.length);
    for (const gameId of registryIds) {
      expect(locs).toContain(`${SITE_URL}${gamePagePath(gameId)}`);
    }
    for (const page of STATIC_INFO_PAGES) {
      expect(locs).toContain(`${SITE_URL}${page.path}`);
    }

    // No duplicates, no dead/removed games — the set IS the registry id set.
    expect(new Set(locs).size).toBe(locs.length);
    const gameLocs = locs.filter((loc) => loc.startsWith(`${SITE_URL}/games/`));
    const locIds = new Set(gameLocs.map((loc) => loc.slice(`${SITE_URL}/games/`.length)));
    expect([...locIds].sort()).toEqual([...registryIds].sort());

    // Rooms, API routes and private pages are never listed.
    for (const banned of ['/room/', '/api/', '/socket.io/', '/settings', '/favorites', '/stats']) {
      expect(body).not.toContain(banned);
    }
  });

  it('stays in lockstep with the catalogue the REST API serves', async () => {
    const sitemap = await get('/sitemap.xml');
    const apiGames = (await (await fetch(`${server.url}/api/games`)).json()) as {
      games: Array<{ id: string }>;
    };

    const sitemapGameUrls = [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)]
      .map((match) => match[1]!)
      .filter((loc) => loc.startsWith(`${SITE_URL}/games/`));
    expect(sitemapGameUrls).toHaveLength(apiGames.games.length);
    for (const game of apiGames.games) {
      expect(sitemapGameUrls).toContain(`${SITE_URL}${gamePagePath(game.id)}`);
    }
  });
});

describe('public information & legal pages over the wire', () => {
  it('serves all five pages with 200 + unique canonical heads, indexable', async () => {
    for (const page of STATIC_INFO_PAGES) {
      const { status, contentType, body } = await get(page.path);
      expect(status, page.path).toBe(200);
      expect(contentType).toContain('text/html');

      expect(body).toContain(`<title>${page.title} | DuoPlay</title>`);
      expect(body).toContain(`<link rel="canonical" href="${SITE_URL}${page.path}" />`);
      expect(body).toContain(`<meta property="og:url" content="${SITE_URL}${page.path}" />`);
      expect(body).toContain('<meta name="twitter:card" content="summary" />');
      expect(body).toContain('<meta name="description"');
      // Public pages carry no noindex directives...
      expect(body).not.toContain('noindex');
      // ...and never leak secrets, tokens or internals in the served shell.
      expect(body).not.toContain('sessionToken');
      expect(body).not.toContain('SUPABASE_');
      expect(body).not.toContain('INDEXNOW');
    }
  });

  it('404 + noindex for unknown siblings; trailing slash tolerated', async () => {
    const bogus = await get('/about/anything');
    expect(bogus.status).toBe(404);
    expect(bogus.body).toContain('noindex, nofollow');

    const trailing = await get('/faq/');
    expect(trailing.status).toBe(200);
    expect(trailing.body).toContain(`<link rel="canonical" href="${SITE_URL}/faq" />`);
  });
});

describe('IndexNow without configuration', () => {
  it('exposes no key document when INDEXNOW_KEY is not set (no hard-coded key)', async () => {
    // This suite booted without INDEXNOW_KEY: any plausible key file must 404.
    const response = await fetch(`${server.url}/0123456789abcdef0123456789abcdef.txt`);
    expect(response.status).toBe(404);
  });
});
