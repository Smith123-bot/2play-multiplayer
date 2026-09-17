import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  ALL_GAME_METADATA,
  SITE_NAME,
  SITE_URL,
  STATIC_INFO_PAGES,
  escapeHtml,
  gamePagePath,
  type GameMetadata,
} from '@2play/shared';
import { SEO_HEAD_END, SEO_HEAD_START, renderHeadTags, renderShell } from './render';
import { buildRobotsTxt, buildSitemapXml, createSeoRouter } from './routes';
import { createSpaSeoHandler, resolveSeoForPath, type SeoMetadataProvider } from './spa';

/** The live-catalogue stand-in: real shared metadata through the provider contract. */
const provider: SeoMetadataProvider = {
  findGame: (gameId: string) => ALL_GAME_METADATA.find((game) => game.id === gameId),
  listGames: () => ALL_GAME_METADATA,
};

const FIXTURE_TEMPLATE = [
  '<!doctype html>',
  '<html lang="en">',
  '  <head>',
  '    <meta charset="UTF-8" />',
  `    ${SEO_HEAD_START}`,
  '    <title>Static Fallback</title>',
  `    ${SEO_HEAD_END}`,
  '  </head>',
  '  <body><div id="root"></div><noscript>Enable JS.</noscript></body>',
  '</html>',
].join('\n');

function buildTestApp() {
  const app = express();
  app.use(createSeoRouter({ listGames: provider.listGames, startedAt: new Date('2026-09-16T00:00:00Z') }));
  app.get('*', createSpaSeoHandler(provider, FIXTURE_TEMPLATE));
  return app;
}

describe('renderHeadTags', () => {
  it('renders title, description, canonical, Open Graph and Twitter tags', () => {
    const seo = resolveSeoForPath('/games/chess', provider).seo;
    const tags = renderHeadTags(seo);
    expect(tags).toContain('<title>');
    expect(tags).toContain('Chess');
    expect(tags).toContain('<meta name="description"');
    expect(tags).toContain(`<link rel="canonical" href="${SITE_URL}/games/chess" />`);
    expect(tags).toContain('<meta property="og:title"');
    expect(tags).toContain(`<meta property="og:url" content="${SITE_URL}/games/chess" />`);
    expect(tags).toContain(`<meta property="og:site_name" content="${SITE_NAME}" />`);
    expect(tags).toContain('<meta name="twitter:card" content="summary" />');
    expect(tags).toContain('<meta name="twitter:description"');
  });

  it('resolves the public info/legal pages as indexable canonical pages (trailing slash tolerated)', () => {
    for (const page of STATIC_INFO_PAGES) {
      const direct = resolveSeoForPath(page.path, provider);
      expect(direct.status, page.path).toBe(200);
      expect(direct.seo.canonicalUrl, page.path).toBe(`${SITE_URL}${page.path}`);
      expect(direct.seo.robots, page.path).toBeUndefined();

      const clean = resolveSeoForPath(`${page.path}/`, provider);
      expect(clean.status, `${page.path}/`).toBe(200);
      expect(clean.seo.canonicalUrl).toBe(`${SITE_URL}${page.path}`);

      const tags = renderHeadTags(direct.seo);
      expect(tags).toContain(`<title>${escapeHtml(page.title)} | ${SITE_NAME}</title>`);
      expect(tags).toContain(`<meta property="og:url" content="${SITE_URL}${page.path}" />`);
      expect(tags).not.toContain('noindex');
    }
  });

  it('404s unknown siblings of the info pages rather than shadowing them', () => {
    expect(resolveSeoForPath('/about/anything', provider).status).toBe(404);
    expect(resolveSeoForPath('/privacy-policy', provider).status).toBe(404);
  });

  it('renders robots only for noindex pages and omits canonical there', () => {
    const notFound = renderHeadTags(resolveSeoForPath('/games/nope', provider).seo);
    expect(notFound).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(notFound).not.toContain('rel="canonical"');

    const home = renderHeadTags(resolveSeoForPath('/', provider).seo);
    expect(home).not.toContain('name="robots"');
    expect(home).toContain(`<link rel="canonical" href="${SITE_URL}/" />`);
  });

  it('serialises JSON-LD safely inside script blocks', () => {
    const chess = resolveSeoForPath('/games/chess', provider).seo;
    const tags = renderHeadTags(chess);
    const blocks = tags.match(/<script type="application\/ld\+json">/g) ?? [];
    expect(blocks.length).toBe(2); // VideoGame + BreadcrumbList
    expect(tags).not.toContain('aggregateRating');
    expect(tags).toContain('BreadcrumbList');
  });

  it('escapes hostile metadata content', () => {
    const hostile: GameMetadata = {
      ...ALL_GAME_METADATA[0]!,
      id: 'evil',
      name: 'Evil "Game" <script>alert(1)</script>',
      description: 'Breaks "quotes" & <tags>',
    };
    const hostileProvider: SeoMetadataProvider = {
      findGame: (id) => (id === 'evil' ? hostile : undefined),
      listGames: () => [hostile],
    };
    const html = renderShell(FIXTURE_TEMPLATE, resolveSeoForPath('/games/evil', hostileProvider).seo);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&quot;');
    expect(html.indexOf('<title>')).toBeGreaterThan(-1);
  });
});

describe('renderShell', () => {
  it('replaces only the marked region and keeps the rest of the shell intact', () => {
    const { seo } = resolveSeoForPath('/', provider);
    const html = renderShell(FIXTURE_TEMPLATE, seo);
    expect(html).toContain(SEO_HEAD_START);
    expect(html).toContain(SEO_HEAD_END);
    expect(html).not.toContain('<title>Static Fallback</title>');
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain('<meta charset="UTF-8" />');
  });

  it('leaves a marker-less template untouched', () => {
    const template = '<html><head><title>x</title></head></html>';
    expect(renderShell(template, resolveSeoForPath('/', provider).seo)).toBe(template);
  });

  it('injects webmaster verification meta tags only when configured', () => {
    const seo = resolveSeoForPath('/', provider).seo;
    const withExtras = renderHeadTags(seo, {
      googleSiteVerification: 'google-token-123',
      bingSiteVerification: 'BINGTOKEN456',
    });
    expect(withExtras).toContain('<meta name="google-site-verification" content="google-token-123" />');
    expect(withExtras).toContain('<meta name="msvalidate.01" content="BINGTOKEN456" />');

    const withoutExtras = renderHeadTags(seo);
    expect(withoutExtras).not.toContain('google-site-verification');
    expect(withoutExtras).not.toContain('msvalidate.01');
  });

  it('replaces the static noscript with route-specific crawlable content', () => {
    // FIXTURE_TEMPLATE carries one static <noscript>Enable JS.</noscript>.
    const template = FIXTURE_TEMPLATE;
    const chess = resolveSeoForPath('/games/chess', provider).seo;
    const html = renderShell(template, chess);
    expect(html).not.toContain('Enable JS.');
    const noscript = html.match(/<noscript>([\s\S]*?)<\/noscript>/);
    expect(noscript).not.toBeNull();
    expect(noscript![1]).toContain('Chess');
    const chessMeta = ALL_GAME_METADATA.find((game) => game.id === 'chess')!;
    expect(noscript![1]).toContain(escapeHtml(chessMeta.description.slice(0, 40)));
    expect(noscript![1]).toContain(`${SITE_URL}/games/chess`);
    expect(noscript![1]).toContain(`${SITE_URL}/games`);

    // A different route yields different body text — no cross-page leakage.
    const home = renderShell(template, resolveSeoForPath('/', provider).seo);
    expect(home).not.toContain('Chess —');
    expect(home).toContain(`${SITE_URL}/`);
  });
});

describe('resolveSeoForPath', () => {
  it('resolves home and the games catalogue', () => {
    expect(resolveSeoForPath('/', provider).status).toBe(200);
    expect(resolveSeoForPath('/', provider).seo.canonicalUrl).toBe(`${SITE_URL}/`);
    expect(resolveSeoForPath('/games', provider).seo.canonicalUrl).toBe(`${SITE_URL}/games`);
    expect(resolveSeoForPath('/games/', provider).status).toBe(200);
  });

  it('resolves every registered game to its own canonical page', () => {
    for (const game of ALL_GAME_METADATA) {
      const resolved = resolveSeoForPath(gamePagePath(game.id), provider);
      expect(resolved.status).toBe(200);
      expect(resolved.seo.title).toContain(game.name);
      expect(resolved.seo.canonicalUrl).toBe(`${SITE_URL}${gamePagePath(game.id)}`);
      expect(resolved.seo.robots).toBeUndefined();
    }
  });

  it('returns 404 + noindex for unknown game ids', () => {
    const resolved = resolveSeoForPath('/games/not-a-real-game', provider);
    expect(resolved.status).toBe(404);
    expect(resolved.seo.robots).toBe('noindex, nofollow');
    expect(resolved.seo.canonicalUrl).toBeUndefined();
  });

  it('returns 404 for malformed or nested game paths', () => {
    // '/games/' (bare catalogue slash) resolves to the catalogue with a 200 —
    // asserted above — not to a phantom game.
    for (const bad of ['/games/Chess', '/games/chess/anything', '/games/%E0%A4%A', '/games/space%20id']) {
      expect(resolveSeoForPath(bad, provider).status, bad).toBe(404);
    }
  });

  it('marks private and dynamic surfaces as noindex but keeps them reachable', () => {
    for (const path of ['/room/ABC123', '/create', '/join', '/settings', '/stats', '/statistics', '/favorites', '/error']) {
      const resolved = resolveSeoForPath(path, provider);
      expect(resolved.status, path).toBe(200);
      expect(resolved.seo.robots, path).toBe('noindex, nofollow');
    }
  });

  it('returns 404 + noindex for unknown routes', () => {
    for (const path of ['/nope', '/wp-admin', '/games2', '/api2/test']) {
      const resolved = resolveSeoForPath(path, provider);
      expect(resolved.status, path).toBe(404);
      expect(resolved.seo.robots, path).toBe('noindex, nofollow');
    }
  });
});

describe('robots.txt', () => {
  const robots = buildRobotsTxt();

  it('allows public pages and blocks private/dynamic areas', () => {
    expect(robots).toContain('User-agent: *');
    expect(robots).toContain('Allow: /');
    for (const blocked of ['/api/', '/socket.io/', '/room/', '/create', '/join', '/settings', '/stats', '/favorites', '/error']) {
      expect(robots).toContain(`Disallow: ${blocked}`);
    }
  });

  it('references the sitemap on the production domain', () => {
    expect(robots).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`);
    expect(robots).not.toContain('onrender.com');
  });
});

describe('sitemap.xml', () => {
  const xml = buildSitemapXml(ALL_GAME_METADATA, '2026-09-16');

  it('includes the homepage, the catalogue, every registered game and the public info pages — no more, no fewer', () => {
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
    expect(locs[0]).toBe(`${SITE_URL}/`);
    expect(locs[1]).toBe(`${SITE_URL}/games`);
    expect(locs).toHaveLength(ALL_GAME_METADATA.length + 2 + STATIC_INFO_PAGES.length);
    for (const game of ALL_GAME_METADATA) {
      expect(locs).toContain(`${SITE_URL}${gamePagePath(game.id)}`);
    }
    for (const page of STATIC_INFO_PAGES) {
      expect(locs).toContain(`${SITE_URL}${page.path}`);
    }
    // No duplicate URLs — every submitted URL is unique.
    expect(new Set(locs).size).toBe(locs.length);
  });

  it('stays dynamic: a different registry produces a different sitemap', () => {
    const smaller = buildSitemapXml(ALL_GAME_METADATA.slice(0, 3), '2026-09-16');
    const locs = [...smaller.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
    expect(locs).toHaveLength(5 + STATIC_INFO_PAGES.length);
    expect(smaller).not.toContain(ALL_GAME_METADATA[10]!.id);
    // The info pages are registry-independent: always present.
    for (const page of STATIC_INFO_PAGES) {
      expect(smaller).toContain(`${SITE_URL}${page.path}`);
    }
  });

  it('never lists rooms, API routes or private pages', () => {
    for (const banned of ['/room/', '/api/', '/socket.io/', '/settings', '/favorites', '/stats']) {
      expect(xml).not.toContain(banned);
    }
  });

  it('is well-formed XML with a sitemap namespace', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml.trimEnd().endsWith('</urlset>')).toBe(true);
    expect(xml).toContain('<lastmod>2026-09-16</lastmod>');
  });
});

describe('HTTP surface', () => {
  const app = buildTestApp();

  it('serves robots.txt as text with the sitemap reference', async () => {
    const res = await request(app).get('/robots.txt');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`);
  });

  it('serves sitemap.xml as XML with every registered game', async () => {
    const res = await request(app).get('/sitemap.xml');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/xml');
    const locs = [...res.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
    expect(locs).toHaveLength(ALL_GAME_METADATA.length + 2 + STATIC_INFO_PAGES.length);
    for (const page of STATIC_INFO_PAGES) {
      expect(locs).toContain(`${SITE_URL}${page.path}`);
    }
  });

  it('serves home, catalogue and game pages with injected per-route metadata', async () => {
    const home = await request(app).get('/');
    expect(home.status).toBe(200);
    expect(home.text).toContain(`<link rel="canonical" href="${SITE_URL}/" />`);
    expect(home.text).toContain('application/ld+json');

    const catalog = await request(app).get('/games');
    expect(catalog.status).toBe(200);
    expect(catalog.text).toContain(`<link rel="canonical" href="${SITE_URL}/games" />`);

    const chess = await request(app).get('/games/chess');
    expect(chess.status).toBe(200);
    expect(chess.text).toContain('<title>Chess — Play Online with Friends');
    expect(chess.text).toContain(`<link rel="canonical" href="${SITE_URL}/games/chess" />`);
    expect(chess.text).toContain('VideoGame');
  });

  it('never emits an accidental noindex on public pages', async () => {
    for (const path of ['/', '/games', '/games/reaction-race', '/games/uno']) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(200);
      expect(res.text, path).not.toContain('name="robots"');
      expect(res.text, path).not.toContain('noindex');
    }
  });

  it('serves crawlable per-route body content without any JavaScript', async () => {
    const chess = await request(app).get('/games/chess');
    const noscript = chess.text.match(/<noscript>([\s\S]*?)<\/noscript>/);
    expect(noscript).not.toBeNull();
    expect(noscript![1]).toContain('Chess');
    expect(noscript![1]).toContain(`${SITE_URL}/games/chess`);
    // Internal onward links exist directly in the raw HTML.
    expect(noscript![1]).toContain(`href="${SITE_URL}/games"`);
  });

  it('omits verification tags by default and includes them when configured', async () => {
    const plain = await request(app).get('/');
    expect(plain.text).not.toContain('google-site-verification');
    expect(plain.text).not.toContain('msvalidate.01');

    const configured = express();
    configured.get(
      '*',
      createSpaSeoHandler(provider, FIXTURE_TEMPLATE, {
        googleSiteVerification: 'google-token-123',
        bingSiteVerification: 'BINGTOKEN456',
      }),
    );
    const res = await request(configured).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<meta name="google-site-verification" content="google-token-123" />');
    expect(res.text).toContain('<meta name="msvalidate.01" content="BINGTOKEN456" />');
  });

  it('answers real 404s for invalid game ids and unknown routes', async () => {
    const missing = await request(app).get('/games/this-game-does-not-exist');
    expect(missing.status).toBe(404);
    expect(missing.text).toContain('<meta name="robots" content="noindex, nofollow" />');

    const unknown = await request(app).get('/definitely-not-here');
    expect(unknown.status).toBe(404);
    expect(unknown.text).toContain('noindex');
  });

  it('keeps private pages reachable but noindexed', async () => {
    const room = await request(app).get('/room/ABC123');
    expect(room.status).toBe(200);
    expect(room.text).toContain('<meta name="robots" content="noindex, nofollow" />');
  });

  it('canonicals always use the production domain, whatever host the request used', async () => {
    const res = await request(app).get('/games/chess').set('Host', 'duoplay.onrender.com');
    expect(res.status).toBe(200);
    expect(res.text).toContain(`href="${SITE_URL}/games/chess"`);
    expect(res.text).not.toContain('onrender.com');
  });
});
