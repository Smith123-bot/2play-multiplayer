import { describe, expect, it } from 'vitest';
import { ALL_GAME_METADATA } from '../games/metadata';
import {
  NOINDEX_ROBOTS,
  SITE_NAME,
  SITE_URL,
  STATIC_INFO_PAGES,
  buildGameBreadcrumbJsonLd,
  buildGameIntro,
  buildGameSeo,
  buildGamesCatalogSeo,
  buildHomeAboutContent,
  buildHomeSeo,
  buildNoscriptHtml,
  buildNotFoundSeo,
  buildPrivateSeo,
  buildStaticInfoPageSeo,
  buildVideoGameJsonLd,
  buildWebsiteJsonLd,
  categoryLabel,
  clampDescription,
  escapeHtml,
  escapeHtmlAttr,
  escapeJsonForHtmlScript,
  findStaticInfoPage,
  formatDurationProse,
  gameModesFor,
  gamePagePath,
  playerCountLabel,
  publicUrl,
  relatedGamesFor,
} from './index';

describe('site constants', () => {
  it('points the whole SEO surface at the production domain', () => {
    expect(SITE_URL).toBe('https://duoplay.in');
    expect(SITE_NAME).toBe('DuoPlay');
  });

  it('builds root-relative and absolute URLs without duplicate slashes', () => {
    expect(publicUrl('/')).toBe('https://duoplay.in/');
    expect(publicUrl('/games')).toBe('https://duoplay.in/games');
    expect(publicUrl('games')).toBe('https://duoplay.in/games');
    expect(gamePagePath('snake-battle')).toBe('/games/snake-battle');
    expect(publicUrl(gamePagePath('snake-battle'))).toBe('https://duoplay.in/games/snake-battle');
  });
});

describe('home SEO', () => {
  const seo = buildHomeSeo(ALL_GAME_METADATA);

  it('has a unique title, description and root canonical', () => {
    expect(seo.title).toContain(SITE_NAME);
    expect(seo.description.length).toBeGreaterThan(50);
    expect(seo.description.length).toBeLessThanOrEqual(180);
    expect(seo.canonicalUrl).toBe('https://duoplay.in/');
    expect(seo.robots).toBeUndefined();
  });

  it('derives the game count dynamically from the catalogue', () => {
    expect(seo.description).toContain(String(ALL_GAME_METADATA.length));
    const smaller = buildHomeSeo(ALL_GAME_METADATA.slice(0, 2));
    expect(smaller.description).toContain('2 2D multiplayer games');
    expect(smaller.description).not.toContain(String(ALL_GAME_METADATA.length));
  });

  it('emits truthful WebSite structured data', () => {
    const website = buildWebsiteJsonLd(ALL_GAME_METADATA);
    expect(website['@type']).toBe('WebSite');
    expect(website.url).toBe('https://duoplay.in/');
    expect(website).not.toHaveProperty('aggregateRating');
    expect(seo.jsonLd?.some((entry) => entry['@type'] === 'WebSite')).toBe(true);
  });
});

describe('games catalogue SEO', () => {
  it('targets /games with a distinct title', () => {
    const catalog = buildGamesCatalogSeo(ALL_GAME_METADATA);
    const home = buildHomeSeo(ALL_GAME_METADATA);
    expect(catalog.canonicalUrl).toBe('https://duoplay.in/games');
    expect(catalog.title).not.toBe(home.title);
  });
});

describe('game SEO', () => {
  it('gives every registered game a unique title, description and canonical', () => {
    const titles = new Set<string>();
    const descriptions = new Set<string>();
    const canonicals = new Set<string>();

    for (const game of ALL_GAME_METADATA) {
      const seo = buildGameSeo(game);
      titles.add(seo.title);
      descriptions.add(seo.description);
      canonicals.add(seo.canonicalUrl ?? '');

      expect(seo.title).toContain(game.name);
      expect(seo.title).toContain(SITE_NAME);
      expect(seo.canonicalUrl).toBe(`https://duoplay.in/games/${game.id}`);
      expect(seo.description).toContain(game.description.slice(0, 40));
      expect((seo.description ?? '').length).toBeLessThanOrEqual(180);
      expect(seo.robots).toBeUndefined();
    }

    expect(titles.size).toBe(ALL_GAME_METADATA.length);
    expect(descriptions.size).toBe(ALL_GAME_METADATA.length);
    expect(canonicals.size).toBe(ALL_GAME_METADATA.length);
  });

  it('never collides with the home or catalogue titles', () => {
    const home = buildHomeSeo(ALL_GAME_METADATA);
    const catalog = buildGamesCatalogSeo(ALL_GAME_METADATA);
    for (const game of ALL_GAME_METADATA) {
      const seo = buildGameSeo(game);
      expect(seo.title).not.toBe(home.title);
      expect(seo.title).not.toBe(catalog.title);
    }
  });

  it('describes only real mechanics: player count, category and the shipped description', () => {
    const chess = ALL_GAME_METADATA.find((game) => game.id === 'chess');
    expect(chess).toBeDefined();
    const seo = buildGameSeo(chess!);
    expect(seo.description).toContain('strategy');
    expect(seo.description).toContain(`${chess!.minPlayers}`);
  });
});

describe('VideoGame structured data', () => {
  it('mirrors the real metadata and carries no ratings, reviews or prices', () => {
    for (const game of ALL_GAME_METADATA) {
      const ld = buildVideoGameJsonLd(game);
      expect(ld['@type']).toBe('VideoGame');
      expect(ld.name).toBe(game.name);
      // The structured-data description is the same intro the page renders.
      expect(ld.description).toBe(buildGameIntro(game));
      expect(ld.url).toBe(`https://duoplay.in/games/${game.id}`);
      expect(ld.genre).toBe(categoryLabel(game.category));
      expect(ld.gamePlatform).toBe('Web Browser');
      expect(ld.isAccessibleForFree).toBe(true);
      const players = ld.numberOfPlayers as { minValue: number; maxValue: number };
      expect(players.minValue).toBe(game.minPlayers);
      expect(players.maxValue).toBe(game.maxPlayers);

      // Hard rule: never fabricate social proof or commerce signals.
      expect(ld).not.toHaveProperty('aggregateRating');
      expect(ld).not.toHaveProperty('review');
      expect(ld).not.toHaveProperty('offers');
    }
  });

  it('emits a Home → Games → Category → Game breadcrumb with absolute URLs', () => {
    const game = ALL_GAME_METADATA[0]!;
    const crumb = buildGameBreadcrumbJsonLd(game);
    expect(crumb['@type']).toBe('BreadcrumbList');
    const items = crumb.itemListElement as Array<{ position: number; name: string; item: string }>;
    expect(items.map((item) => item.position)).toEqual([1, 2, 3, 4]);
    expect(items[0]).toMatchObject({ name: 'Home', item: 'https://duoplay.in/' });
    expect(items[1]).toMatchObject({ name: 'Games', item: 'https://duoplay.in/games' });
    expect(items[2]).toMatchObject({
      name: `${categoryLabel(game.category)} games`,
      item: `https://duoplay.in/games?category=${game.category}`,
    });
    expect(items[3]).toMatchObject({
      name: game.name,
      item: `https://duoplay.in/games/${game.id}`,
    });
  });
});

describe('noindex builders', () => {
  it('marks not-found pages as noindex without a canonical', () => {
    const seo = buildNotFoundSeo('Game');
    expect(seo.robots).toBe(NOINDEX_ROBOTS);
    expect(seo.canonicalUrl).toBeUndefined();
    expect(seo.title).toContain('Not Found');
  });

  it('marks private pages as noindex with a custom title', () => {
    const seo = buildPrivateSeo('Settings', 'Account settings.');
    expect(seo.title).toBe(`Settings | ${SITE_NAME}`);
    expect(seo.robots).toBe(NOINDEX_ROBOTS);
    expect(seo.canonicalUrl).toBeUndefined();
  });
});

describe('game modes', () => {
  it('derives modes strictly from metadata flags', () => {
    const withAi = ALL_GAME_METADATA.find((game) => game.hasAI && game.aiDifficulties.length > 0)!;
    const modes = gameModesFor(withAi);
    expect(modes[0]).toContain('Online multiplayer');
    expect(modes.join(' ')).toContain(withAi.aiDifficulties[0]!);

    const withoutAi = {
      ...withAi,
      hasAI: false,
      aiDifficulties: [],
      hasRounds: false,
      gridOptions: undefined,
    };
    const minimal = gameModesFor(withoutAi);
    expect(minimal).toHaveLength(1);
    expect(minimal[0]).toContain('Online multiplayer');
    expect(minimal.join(' ')).not.toContain('AI');
    expect(minimal.join(' ')).not.toContain('Board sizes');
  });

  it('includes rounds and board sizes only when the lobby exposes them', () => {
    const base = ALL_GAME_METADATA.find((game) => game.hasRounds && game.defaultRounds)!;
    expect(gameModesFor(base).join(' ')).toContain(`${base.defaultRounds} rounds`);
    const withGrid = ALL_GAME_METADATA.find((game) => game.gridOptions && game.gridOptions.length > 0);
    if (withGrid) {
      expect(gameModesFor(withGrid).join(' ')).toContain(withGrid.gridOptions![0]);
    }
  });
});

describe('related games', () => {
  it('links to real catalogue games, never to itself, deterministically', () => {
    for (const game of ALL_GAME_METADATA) {
      const first = relatedGamesFor(game, ALL_GAME_METADATA, 3);
      const second = relatedGamesFor(game, ALL_GAME_METADATA, 3);
      expect(first.map((entry) => entry.id)).toEqual(second.map((entry) => entry.id));
      expect(first.length).toBeGreaterThan(0);
      expect(first.length).toBeLessThanOrEqual(3);
      expect(first.some((entry) => entry.id === game.id)).toBe(false);
      for (const entry of first) {
        expect(ALL_GAME_METADATA.some((candidate) => candidate.id === entry.id)).toBe(true);
      }
    }
  });

  it('prefers same-category neighbours', () => {
    const game = ALL_GAME_METADATA.find((entry) => entry.category === 'strategy')!;
    const related = relatedGamesFor(game, ALL_GAME_METADATA, 2);
    expect(related.every((entry) => entry.category === 'strategy')).toBe(true);
  });
});

describe('static information & legal pages', () => {
  it('covers exactly the five intended public routes', () => {
    expect(STATIC_INFO_PAGES.map((page) => page.path).sort()).toEqual(
      ['/about', '/contact', '/faq', '/privacy', '/terms'].sort(),
    );
  });

  it('gives every page a unique, indexable, canonical head', () => {
    const titles = new Set<string>();
    const descriptions = new Set<string>();
    for (const page of STATIC_INFO_PAGES) {
      const seo = buildStaticInfoPageSeo(page);
      expect(seo.title, page.path).toBe(`${page.title} | ${SITE_NAME}`);
      titles.add(seo.title);
      expect(seo.description, page.path).toContain(page.description.slice(0, 60));
      descriptions.add(seo.description);
      expect(seo.canonicalUrl, page.path).toBe(`${SITE_URL}${page.path}`);
      // Indexable: no robots directive at all, website OG type.
      expect(seo.robots, page.path).toBeUndefined();
      expect(seo.ogType).toBe('website');
      // No invented claims in the shared text cortex.
      expect(/\brated\b|\breviews?\b|testimonial/i.test(seo.description)).toBe(false);
    }
    expect(titles.size).toBe(STATIC_INFO_PAGES.length);
    expect(descriptions.size).toBe(STATIC_INFO_PAGES.length);
  });

  it('resolves only registered static paths', () => {
    expect(findStaticInfoPage('/about')?.path).toBe('/about');
    expect(findStaticInfoPage('/about/')).toBeUndefined();
    expect(findStaticInfoPage('/legal')).toBeUndefined();
    expect(findStaticInfoPage('/games')).toBeUndefined();
  });
});

describe('noscript crawl content', () => {
  it('describes the page and links the full Home → Games → Create/Join chain', () => {
    for (const game of [ALL_GAME_METADATA[0]!, ALL_GAME_METADATA.at(-1)!]) {
      const html = buildNoscriptHtml(buildGameSeo(game));
      expect(html).toContain(`<h1>`);
      expect(html).toContain(escapeHtml(game.name));
      // Only public, crawlable destinations — never room URLs.
      expect(html).not.toContain('/room/');
      expect(html).toContain('href="https://duoplay.in/"');
      expect(html).toContain('href="https://duoplay.in/games"');
      expect(html).toContain('href="https://duoplay.in/create"');
      expect(html).toContain('href="https://duoplay.in/join"');
    }
  });
});

describe('game introductions', () => {
  it('gives every game a unique, non-thin introduction built from real metadata', () => {
    const intros = new Set<string>();
    for (const game of ALL_GAME_METADATA) {
      const intro = buildGameIntro(game);
      intros.add(intro);

      // Non-thin: a real paragraph, and every key fact comes from metadata.
      expect(intro.length, game.id).toBeGreaterThan(250);
      expect(intro, game.id).toContain(game.description);
      expect(intro, game.id).toContain(game.name);
      expect(intro, game.id).toContain(categoryLabel(game.category).toLowerCase());
      expect(intro, game.id).toContain(String(game.minPlayers));
      expect(intro, game.id).toContain(proseExpectation(game.winCondition));
    }
    expect(intros.size).toBe(ALL_GAME_METADATA.length);
  });

  it('claims AI opponents exactly for the games that have them', () => {
    for (const game of ALL_GAME_METADATA) {
      const intro = buildGameIntro(game);
      if (game.hasAI && game.aiDifficulties.length > 0) {
        expect(intro, game.id).toContain('against the computer');
        expect(intro, game.id).toContain(game.aiDifficulties[0]!);
      } else {
        expect(intro, game.id).not.toContain('against the computer');
      }
    }
  });

  it('never fabricates and never keyword-stuffs', () => {
    for (const game of ALL_GAME_METADATA) {
      const intro = buildGameIntro(game).toLowerCase();
      expect(intro).not.toContain('best game');
      expect(intro).not.toContain('#1');
      // Word-boundary checks: real metadata words like "generated" must pass.
      expect(intro).not.toMatch(/\brated\b/);
      expect(intro).not.toMatch(/\brating\b/);
      expect(intro).not.toMatch(/\breviews?\b/);
      // No keyword stuffing: the site name appears at most once per intro.
      expect(intro.split(SITE_NAME.toLowerCase()).length - 1).toBeLessThanOrEqual(1);
    }
  });
});

/** The exact professed win condition, in the intro's prose casing. */
function proseExpectation(winCondition: string): string {
  const clean = winCondition.trim().replace(/[\s.]+$/, '');
  return `To win: ${clean.charAt(0).toLowerCase()}${clean.slice(1)}.`;
}

describe('homepage about content', () => {
  const about = buildHomeAboutContent(ALL_GAME_METADATA);

  it('derives totals, AI coverage and used categories from the catalogue', () => {
    expect(about.totalGames).toBe(ALL_GAME_METADATA.length);
    expect(about.aiGames).toBe(ALL_GAME_METADATA.filter((game) => game.hasAI).length);
    expect(about.aiGames).toBeLessThanOrEqual(about.totalGames);

    const usedCategories = new Set(ALL_GAME_METADATA.map((game) => game.category));
    expect(about.categories).toHaveLength(usedCategories.size);
    for (const category of about.categories) {
      expect(usedCategories.has(category.id)).toBe(true);
      expect(category.gameCount).toBe(
        ALL_GAME_METADATA.filter((game) => game.category === category.id).length,
      );
      expect(category.gameCount).toBeGreaterThan(0);
    }
  });

  it('stays in sync as the catalogue changes (never hard-coded)', () => {
    const smaller = buildHomeAboutContent(ALL_GAME_METADATA.slice(0, 4));
    expect(smaller.totalGames).toBe(4);
    expect(smaller.categories.map((entry) => entry.gameCount).reduce((a, b) => a + b, 0)).toBe(4);
  });
});

describe('duration prose', () => {
  it('rounds estimates into readable, honest prose', () => {
    expect(formatDurationProse(30)).toBe('under a minute');
    expect(formatDurationProse(60)).toBe('about 1 minute');
    expect(formatDurationProse(90)).toBe('about 2 minutes');
    expect(formatDurationProse(300)).toBe('about 5 minutes');
    expect(formatDurationProse(Number.NaN)).toBe('under a minute');
  });
});

describe('labels and clamping', () => {
  it('labels categories and player counts from metadata', () => {
    expect(categoryLabel('coop')).toBe('Co-op');
    const chess = ALL_GAME_METADATA.find((game) => game.id === 'chess')!;
    expect(playerCountLabel(chess)).toBe('2-player');
    const reaction = ALL_GAME_METADATA.find((game) => game.id === 'reaction-race')!;
    expect(playerCountLabel(reaction)).toBe('2–4-player');
  });

  it('clamps descriptions on word boundaries', () => {
    const long = 'word '.repeat(80).trim();
    const clamped = clampDescription(long, 180);
    expect(clamped.length).toBeLessThanOrEqual(180);
    expect(clamped.endsWith('…')).toBe(true);
    expect(clampDescription('short text', 180)).toBe('short text');
  });
});

describe('escaping', () => {
  it('escapes HTML attribute content', () => {
    expect(escapeHtmlAttr('a "quote" & <tag>')).toBe('a &quot;quote&quot; &amp; &lt;tag&gt;');
  });

  it('neutralises closing script tags inside JSON-LD', () => {
    const json = escapeJsonForHtmlScript({ evil: '</script><script>alert(1)</script>' });
    expect(json).not.toContain('</script>');
    expect(json).toContain('\\u003c/script>');
    expect(JSON.parse(json)).toEqual({ evil: '</script><script>alert(1)</script>' });
  });
});
