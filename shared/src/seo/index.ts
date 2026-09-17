import type { GameMetadata } from '../types/game';

/**
 * Public SEO surface for https://duoplay.in — derived exclusively from the
 * real game metadata in this package, so a title, description, sitemap entry
 * or structured-data block can never claim a feature a game does not have.
 *
 * Both the server (meta injection into the built SPA shell, robots.txt and
 * sitemap.xml) and the client (document-head management while navigating)
 * build their tags from these functions, which keeps the two in lockstep.
 */

export const SITE_NAME = 'DuoPlay';
export const SITE_URL = 'https://duoplay.in';
export const SITE_TAGLINE = 'Play Together, Anywhere.';

/** The one pattern every public game page URL follows. */
export function gamePagePath(gameId: string): string {
  return `/games/${gameId}`;
}

/** Absolute URL on the public site for a root-relative path. */
export function publicUrl(path: string): string {
  if (path === '' || path === '/') return `${SITE_URL}/`;
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

export interface PageSeo {
  title: string;
  description: string;
  /**
   * Absolute canonical URL on https://duoplay.in. Omitted on noindex pages —
   * a canonical on an excluded page sends a contradictory signal.
   */
  canonicalUrl?: string;
  /** Present when the page must stay out of search indexes. */
  robots?: string;
  ogType?: 'website' | 'article';
  /** Structured data blocks (schema.org), rendered as JSON-LD. */
  jsonLd?: Array<Record<string, unknown>>;
}

export const NOINDEX_ROBOTS = 'noindex, nofollow';

/* ------------------------------------------------------------------ */
/* Small format helpers (labels only — no invented content)            */
/* ------------------------------------------------------------------ */

const CATEGORY_LABELS: Record<GameMetadata['category'], string> = {
  reflex: 'Reflex',
  memory: 'Memory',
  word: 'Word',
  strategy: 'Strategy',
  math: 'Math',
  coop: 'Co-op',
};

export function categoryLabel(category: GameMetadata['category']): string {
  return CATEGORY_LABELS[category] ?? category;
}

export function playerCountLabel(game: GameMetadata): string {
  return game.minPlayers === game.maxPlayers
    ? `${game.minPlayers}-player`
    : `${game.minPlayers}–${game.maxPlayers}-player`;
}

/**
 * Estimated match length in casual prose ("about 2 minutes"), for readable
 * introductions and search snippets where `1m 30s` would look machine-made.
 * The estimate comes straight from metadata — it is never implied to be exact.
 */
export function formatDurationProse(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 45) return 'under a minute';
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
}

/**
 * Search snippets keep ~160 characters. Cutting mid-word looks broken, so trim
 * at the last word boundary inside the budget. The budget is generous (180)
 * because Google rewrites snippets anyway; the hard requirement is that a
 * description is never padded with filler to reach a length.
 */
export function clampDescription(text: string, budget = 180): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= budget) return clean;
  const cut = clean.slice(0, budget - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 60 ? lastSpace : budget - 1)}…`;
}

/* ------------------------------------------------------------------ */
/* Truthful derivations from metadata                                  */
/* ------------------------------------------------------------------ */

/**
 * The ways a game can actually be played, derived only from metadata flags:
 * room sizes it supports, AI opponents it ships, round structure and board
 * options it exposes in the lobby. Nothing else is claimed.
 */
export function gameModesFor(game: GameMetadata): string[] {
  const modes: string[] = [];
  modes.push(
    game.supportedPlayerCounts.length > 1
      ? `Online multiplayer (${game.minPlayers}–${game.maxPlayers} players)`
      : `Online multiplayer (${game.minPlayers} players)`,
  );
  if (game.hasAI && game.aiDifficulties.length > 0) {
    modes.push(`Play vs AI (${game.aiDifficulties.join(', ')} difficulty)`);
  }
  if (game.hasRounds && typeof game.defaultRounds === 'number' && game.defaultRounds > 0) {
    modes.push(`Round-based matches (${game.defaultRounds} rounds by default)`);
  }
  if (game.gridOptions && game.gridOptions.length > 0) {
    modes.push(`Board sizes: ${game.gridOptions.join(', ')}`);
  }
  return modes;
}

/**
 * Related games to link out to: same-category titles first (catalogue order),
 * then the rest of the catalogue in order, so every game page always links to
 * real, reachable neighbours without duplicating itself. Deterministic — the
 * same input always produces the same list, which keeps tests and crawlers
 * happy.
 */
export function relatedGamesFor(
  game: GameMetadata,
  allGames: readonly GameMetadata[],
  limit = 3,
): GameMetadata[] {
  const others = allGames.filter((entry) => entry.id !== game.id);
  const sameCategory = others.filter((entry) => entry.category === game.category);
  const rest = others.filter((entry) => entry.category !== game.category);
  return [...sameCategory, ...rest].slice(0, Math.max(0, limit));
}

/* ------------------------------------------------------------------ */
/* Page builders                                                       */
/* ------------------------------------------------------------------ */

export function buildHomeSeo(games: readonly GameMetadata[]): PageSeo {
  const count = games.length;
  return {
    title: `${SITE_NAME} — ${SITE_TAGLINE.replace(/\.$/, '')} | Real-time Multiplayer Games`,
    description: clampDescription(
      `Play ${count} 2D multiplayer games with friends in your browser — no downloads. ` +
        `Create a room, share the code and play together in real time on ${SITE_NAME}.`,
    ),
    canonicalUrl: publicUrl('/'),
    ogType: 'website',
    jsonLd: [buildWebsiteJsonLd(games)],
  };
}

export function buildGamesCatalogSeo(games: readonly GameMetadata[]): PageSeo {
  return {
    title: `All Multiplayer Games | ${SITE_NAME}`,
    description: clampDescription(
      `Browse all ${games.length} ${SITE_NAME} games — reflex, memory, word, strategy, math ` +
        `and co-op games for 2–4 players, playable together in your browser.`,
    ),
    canonicalUrl: publicUrl('/games'),
    ogType: 'website',
  };
}

export function buildGameSeo(game: GameMetadata): PageSeo {
  const category = categoryLabel(game.category);
  return {
    title: `${game.name} — Play Online with Friends | ${SITE_NAME}`,
    description: clampDescription(
      `${game.description} Play ${game.name} online — a ${playerCountLabel(game)} ` +
        `${category.toLowerCase()} game on ${SITE_NAME}. ` +
        `A match usually takes ${formatDurationProse(game.estimatedDuration)}.`,
    ),
    canonicalUrl: publicUrl(gamePagePath(game.id)),
    ogType: 'article',
    jsonLd: [buildVideoGameJsonLd(game), buildGameBreadcrumbJsonLd(game)],
  };
}

/** Lowercases the first letter and guarantees a single trailing period. */
function proseSentence(fragment: string): string {
  const clean = fragment.trim().replace(/[\s.]+$/, '');
  if (clean.length === 0) return '';
  return `${clean.charAt(0).toLowerCase()}${clean.slice(1)}.`;
}

/**
 * A unique, readable introduction for a game page — two to four sentences
 * composed entirely from the game's real metadata (description, player
 * counts, category, estimated duration, AI support and win condition), so the
 * visible text, the meta description and the JSON-LD can never contradict the
 * implementation.
 */
export function buildGameIntro(game: GameMetadata): string {
  const category = categoryLabel(game.category).toLowerCase();
  const players =
    game.minPlayers === game.maxPlayers
      ? `${game.minPlayers}`
      : `${game.minPlayers}–${game.maxPlayers}`;
  const sentences: string[] = [
    game.description,
    `${game.name} is a ${category} game for ${players} players on ${SITE_NAME}, played in real time in the browser — nothing to install or download.`,
    `A typical match takes ${formatDurationProse(game.estimatedDuration)}.`,
  ];
  if (game.hasAI && game.aiDifficulties.length > 0) {
    sentences.push(
      `You can play against the computer at ${game.aiDifficulties.join(', ')} difficulty, ` +
        `or open a room and invite friends with a six-character code.`,
    );
  } else {
    sentences.push('Open a room and invite friends with a six-character code to play together.');
  }
  const win = proseSentence(game.winCondition);
  if (win) sentences.push(`To win: ${win}`);
  return sentences.join(' ');
}

/* ------------------------------------------------------------------ */
/* Homepage "About" content — data derived from the live catalogue     */
/* ------------------------------------------------------------------ */

export interface HomeAboutCategory {
  id: GameMetadata['category'];
  label: string;
  gameCount: number;
}

export interface HomeAboutContent {
  totalGames: number;
  /** Games that ship AI opponents — the honest "play solo too" claim. */
  aiGames: number;
  /** Only categories that actually have games, largest first. */
  categories: HomeAboutCategory[];
}

export function buildHomeAboutContent(games: readonly GameMetadata[]): HomeAboutContent {
  const counts = new Map<GameMetadata['category'], number>();
  for (const game of games) {
    counts.set(game.category, (counts.get(game.category) ?? 0) + 1);
  }
  const categories = [...counts.entries()]
    .map(([id, gameCount]) => ({ id, label: categoryLabel(id), gameCount }))
    .sort((a, b) => b.gameCount - a.gameCount || a.label.localeCompare(b.label));
  return {
    totalGames: games.length,
    aiGames: games.filter((game) => game.hasAI).length,
    categories,
  };
}

/** 404 / unknown route / invalid game id: real \"not found\", never indexed. */
export function buildNotFoundSeo(what = 'Page'): PageSeo {
  return {
    title: `${what} Not Found | ${SITE_NAME}`,
    description: `The page you are looking for does not exist. Browse ${SITE_NAME} games instead.`,
    robots: NOINDEX_ROBOTS,
    ogType: 'website',
  };
}

/** Private/dynamic surfaces (rooms, account pages): reachable but not indexed. */
export function buildPrivateSeo(title: string, description: string): PageSeo {
  return {
    title: `${title} | ${SITE_NAME}`,
    description: clampDescription(description),
    robots: NOINDEX_ROBOTS,
    ogType: 'website',
  };
}

/* ------------------------------------------------------------------ */
/* Public information & legal pages                                      */
/* ------------------------------------------------------------------ */

/**
 * The publicly indexable information pages (/about, /privacy, /terms,
 * /contact, /faq). Single source of truth: the server uses it to resolve
 * SPA heads and build the sitemap, the client uses it for document-head
 * management after client-side navigation, so every surface always agrees.
 */
export interface StaticInfoPage {
  /** The public, indexable route. */
  readonly path: '/about' | '/privacy' | '/terms' | '/contact' | '/faq';
  /** Short page title used without the site name (h1 mirrors it). */
  readonly title: string;
  /** One-sentence search description — matches the visible page lead. */
  readonly description: string;
}

export const STATIC_INFO_PAGES: readonly StaticInfoPage[] = [
  {
    path: '/about',
    title: `About ${SITE_NAME}`,
    description: `${SITE_NAME} is a real-time 2D multiplayer game platform for 2–4 players: open a room, share a six-character code and play together in the browser.`,
  },
  {
    path: '/privacy',
    title: 'Privacy Policy',
    description: `How ${SITE_NAME} handles session, profile, statistics, favorites and room data: what is stored, where, for how long, and what is never collected.`,
  },
  {
    path: '/terms',
    title: 'Terms of Service',
    description: `The ${SITE_NAME} terms: acceptable use, usernames, multiplayer and chat behavior, session responsibilities, availability and liability disclaimers.`,
  },
  {
    path: '/contact',
    title: 'Contact',
    description: `How to reach the ${SITE_NAME} team, and where to find answers first (FAQ, privacy notes and troubleshooting) before writing in.`,
  },
  {
    path: '/faq',
    title: 'FAQ',
    description: `Answers: creating and joining rooms, player counts, favorites, statistics, disconnects and chat, plus basic ${SITE_NAME} troubleshooting.`,
  },
] as const;

export function buildStaticInfoPageSeo(page: StaticInfoPage): PageSeo {
  return {
    title: `${page.title} | ${SITE_NAME}`,
    description: clampDescription(page.description),
    canonicalUrl: publicUrl(page.path),
    ogType: 'website',
  };
}

export function findStaticInfoPage(path: string): StaticInfoPage | undefined {
  return STATIC_INFO_PAGES.find((page) => page.path === path);
}

/* ------------------------------------------------------------------ */
/* Structured data (schema.org) — truthful fields only                 */
/* ------------------------------------------------------------------ */

export function buildWebsiteJsonLd(games: readonly GameMetadata[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: publicUrl('/'),
    description: clampDescription(
      `${SITE_NAME} — ${SITE_TAGLINE} ${games.length} real-time 2D multiplayer games playable in the browser with friends.`,
    ),
    inLanguage: 'en',
  };
}

/**
 * No ratings, no reviews, no prices, no download URLs: the platform has none
 * of those, so the structured data does not invent them.
 *
 * The description is the same intro paragraph the page renders in its
 * "About <game>" section, keeping structured data and visible content in sync.
 */
export function buildVideoGameJsonLd(game: GameMetadata): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'VideoGame',
    name: game.name,
    description: buildGameIntro(game),
    url: publicUrl(gamePagePath(game.id)),
    genre: categoryLabel(game.category),
    gamePlatform: 'Web Browser',
    applicationCategory: 'Game',
    operatingSystem: 'Any',
    inLanguage: 'en',
    isAccessibleForFree: true,
    numberOfPlayers: {
      '@type': 'QuantitativeValue',
      minValue: game.minPlayers,
      maxValue: game.maxPlayers,
    },
  };
}

export function buildGameBreadcrumbJsonLd(game: GameMetadata): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Home',
        item: publicUrl('/'),
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Games',
        item: publicUrl('/games'),
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: `${categoryLabel(game.category)} games`,
        item: publicUrl(`/games?category=${game.category}`),
      },
      {
        '@type': 'ListItem',
        position: 4,
        name: game.name,
        item: publicUrl(gamePagePath(game.id)),
      },
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Escaping (shared so server-rendered tags can never break the shell) */
/* ------------------------------------------------------------------ */

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeHtmlAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** JSON inside a <script> block must not be able to close it early. */
export function escapeJsonForHtmlScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/* ------------------------------------------------------------------ */
/* No-JS body content (crawlable HTML for the SPA shell)               */
/* ------------------------------------------------------------------ */

/**
 * The built SPA shell paints entirely from JavaScript, so without JS the body
 * is just an empty #root. This block — injected by the server per route —
 * gives crawlers and no-JS browsers real, readable HTML that says exactly the
 * same thing the meta tags say (never more): the page's title, its
 * description, and honest links onward. It is graceful degradation, not a
 * hidden content farm.
 */
export function buildNoscriptHtml(seo: PageSeo): string {
  const parts: string[] = [];
  parts.push(`<h1>${escapeHtml(seo.title)}</h1>`);
  parts.push(`<p>${escapeHtml(seo.description)}</p>`);
  if (seo.canonicalUrl) {
    const url = escapeHtmlAttr(seo.canonicalUrl);
    parts.push(
      `<p>${escapeHtml(SITE_NAME)} runs in the browser with JavaScript enabled — ` +
        `open <a href="${url}">${escapeHtml(seo.canonicalUrl)}</a> to play.</p>`,
    );
  }
  parts.push(
    `<p><a href="${escapeHtmlAttr(publicUrl('/'))}">${escapeHtml(SITE_NAME)} home</a> &middot; ` +
      `<a href="${escapeHtmlAttr(publicUrl('/games'))}">Browse all games</a> &middot; ` +
      `<a href="${escapeHtmlAttr(publicUrl('/create'))}">Create a room</a> &middot; ` +
      `<a href="${escapeHtmlAttr(publicUrl('/join'))}">Join a room</a></p>`,
  );
  return parts.join('');
}
