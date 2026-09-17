import { Router, type Request, type Response } from 'express';
import {
  SITE_URL,
  STATIC_INFO_PAGES,
  escapeHtml,
  gamePagePath,
  type GameMetadata,
} from '@2play/shared';

/**
 * robots.txt and sitemap.xml — generated from the live game registry, so a
 * game that ships is in the sitemap on the next deploy and a removed game
 * disappears without anyone editing a static file.
 */

export function buildRobotsTxt(): string {
  return [
    '# DuoPlay — https://duoplay.in',
    'User-agent: *',
    'Allow: /',
    '',
    '# Never crawl live matches, the realtime transport, the API or account pages.',
    'Disallow: /api/',
    'Disallow: /socket.io/',
    'Disallow: /room/',
    'Disallow: /create',
    'Disallow: /join',
    'Disallow: /settings',
    'Disallow: /stats',
    'Disallow: /statistics',
    'Disallow: /favorites',
    'Disallow: /error',
    '',
    `Sitemap: ${SITE_URL}/sitemap.xml`,
    '',
  ].join('\n');
}

export function buildSitemapXml(games: readonly GameMetadata[], lastmod: string): string {
  const urls: Array<{ loc: string; changefreq: string; priority: string }> = [
    { loc: `${SITE_URL}/`, changefreq: 'daily', priority: '1.0' },
    { loc: `${SITE_URL}/games`, changefreq: 'daily', priority: '0.9' },
    ...games.map((game) => ({
      loc: `${SITE_URL}${gamePagePath(game.id)}`,
      changefreq: 'weekly',
      priority: '0.8',
    })),
    // Public information/legal pages — registry-controlled like the games.
    ...STATIC_INFO_PAGES.map((page) => ({
      loc: `${SITE_URL}${page.path}`,
      changefreq: 'monthly',
      priority: '0.5',
    })),
  ];

  const body = urls
    .map(
      (entry) =>
        '  <url>\n' +
        `    <loc>${escapeHtml(entry.loc)}</loc>\n` +
        `    <lastmod>${escapeHtml(lastmod)}</lastmod>\n` +
        `    <changefreq>${entry.changefreq}</changefreq>\n` +
        `    <priority>${entry.priority}</priority>\n` +
        '  </url>',
    )
    .join('\n');

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    body +
    '\n</urlset>\n'
  );
}

/**
 * Mounts the public discovery documents at the site root. The game list is
 * read per request through `listGames`, so the sitemap always matches the
 * registry the /api catalogue serves — never a hard-coded count.
 */
export function createSeoRouter(options: {
  listGames: () => readonly GameMetadata[];
  startedAt?: Date;
}): Router {
  const router = Router();
  // Deploy-scoped freshness signal, stable for the process lifetime rather
  // than changing on every request (which teaches crawlers to ignore it).
  const lastmod = (options.startedAt ?? new Date()).toISOString().slice(0, 10);

  router.get('/robots.txt', (_req: Request, res: Response) => {
    res
      .status(200)
      .set('Cache-Control', 'public, max-age=3600')
      .type('text/plain')
      .send(buildRobotsTxt());
  });

  router.get('/sitemap.xml', (_req: Request, res: Response) => {
    res
      .status(200)
      .set('Cache-Control', 'public, max-age=3600')
      .type('application/xml; charset=utf-8')
      .send(buildSitemapXml(options.listGames(), lastmod));
  });

  return router;
}
