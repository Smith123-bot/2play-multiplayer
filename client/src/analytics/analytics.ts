import { getAnalyticsConsent } from './consent';

/** Public GA4 measurement ID. It is not a secret and is safe to ship to the browser. */
export const GA_MEASUREMENT_ID = 'G-4WC7R746MT';

const GOOGLE_TAG_SCRIPT_ID = 'duoplay-google-tag';
const GOOGLE_TAG_SCRIPT_URL = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;

type AnalyticsValue = string | number | boolean;
type AnalyticsParams = Record<string, AnalyticsValue>;
type Gtag = (...args: unknown[]) => void;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
  }
}

let analyticsStarted = false;
let scriptLoadStarted = false;
let lastTrackedPagePath: string | null = null;
let lastTrackedPageKey: string | null = null;

function installGtagQueue(): Gtag {
  const dataLayer = (window.dataLayer ??= []);
  const gtag: Gtag = (...args) => {
    dataLayer.push(args);
  };
  window.gtag ??= gtag;
  return window.gtag;
}

/**
 * Room URLs contain a private room code. Query strings can also contain a room
 * code on the join screen, so analytics intentionally reports route paths only
 * and collapses dynamic room URLs to `/room`.
 */
const SAFE_STATIC_PAGE_PATHS = new Set([
  '/',
  '/games',
  '/create',
  '/join',
  '/settings',
  '/stats',
  '/statistics',
  '/favorites',
  '/about',
  '/privacy',
  '/terms',
  '/contact',
  '/faq',
  '/error',
]);

export function safeAnalyticsPagePath(pathname: string): string {
  const path = pathname || '/';
  if (path === '/room' || path.startsWith('/room/')) return '/room';
  // Keep the game-details route distinguishable without trusting a dynamic
  // URL segment that could contain arbitrary user input.
  if (/^\/games\/[^/]+$/.test(path)) return '/games/:gameId';
  return SAFE_STATIC_PAGE_PATHS.has(path) ? path : '/unknown';
}

function safeAnalyticsLocation(pagePath: string): string {
  if (typeof window === 'undefined') return pagePath;
  return new URL(pagePath, window.location.origin).toString();
}

function pageContext(pagePath = safeAnalyticsPagePath(window.location.pathname)): AnalyticsParams {
  const previousPath = lastTrackedPagePath;
  return {
    // These values are explicit so GA never falls back to the browser URL,
    // which could contain a room code.
    page_location: safeAnalyticsLocation(pagePath),
    page_path: pagePath,
    page_referrer: previousPath ? safeAnalyticsLocation(previousPath) : '',
  };
}

/**
 * Starts Google's official gtag.js snippet once, and only after analytics
 * consent has been granted. The queue is installed before the async script so
 * no event is lost while the tag downloads.
 */
export function initializeGoogleAnalytics(): void {
  if (typeof window === 'undefined' || getAnalyticsConsent() !== 'granted') return;

  const gtag = installGtagQueue();
  if (!analyticsStarted) {
    analyticsStarted = true;
    gtag('consent', 'default', {
      analytics_storage: 'denied',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      wait_for_update: 500,
    });
    gtag('consent', 'update', {
      analytics_storage: 'granted',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    });
    gtag('js', new Date());
    gtag('config', GA_MEASUREMENT_ID, {
      send_page_view: false,
      anonymize_ip: true,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      ...pageContext(),
    });
  }

  if (scriptLoadStarted) return;
  scriptLoadStarted = true;

  // The id guard also protects against duplicate script elements during Vite
  // HMR, where a module can be evaluated again without a full page reload.
  if (document.getElementById(GOOGLE_TAG_SCRIPT_ID)) return;
  const script = document.createElement('script');
  script.id = GOOGLE_TAG_SCRIPT_ID;
  script.async = true;
  script.src = GOOGLE_TAG_SCRIPT_URL;
  document.head.appendChild(script);
}

/** Stops future collection when consent is withdrawn without unloading gtag.js. */
export function updateGoogleAnalyticsConsent(granted: boolean): void {
  if (!analyticsStarted || typeof window === 'undefined' || !window.gtag) return;
  window.gtag('consent', 'update', {
    analytics_storage: granted ? 'granted' : 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  });
  if (!granted) {
    lastTrackedPagePath = null;
    lastTrackedPageKey = null;
  }
}

/**
 * Sends one manual page_view for a route. `send_page_view: false` above is
 * essential: it leaves React Router as the sole page-view source.
 */
export function trackPageView(pathname: string): void {
  if (typeof window === 'undefined' || getAnalyticsConsent() !== 'granted') return;
  const pagePath = safeAnalyticsPagePath(pathname);
  // Game-detail pages are reported using a fixed safe template path, but two
  // different game routes are still distinct React Router page changes. Every
  // other route is deduplicated by its sanitized path (including room URLs).
  const pageKey = pagePath === '/games/:gameId' ? pathname : pagePath;
  if (lastTrackedPageKey === pageKey) return;

  initializeGoogleAnalytics();
  window.gtag?.('event', 'page_view', {
    page_title: document.title,
    ...pageContext(pagePath),
  });
  lastTrackedPagePath = pagePath;
  lastTrackedPageKey = pageKey;
}

function trackEvent(name: string, params: AnalyticsParams = {}): void {
  if (typeof window === 'undefined' || getAnalyticsConsent() !== 'granted') return;
  initializeGoogleAnalytics();
  // Context is appended after event-specific values so callers cannot replace
  // the sanitized URL fields with the browser's private URL.
  window.gtag?.('event', name, {
    ...params,
    ...pageContext(),
  });
}

export function trackRoomCreated(gameId: string): void {
  trackEvent('room_created', { game_id: gameId });
}

export function trackRoomJoined(gameId: string): void {
  trackEvent('room_joined', { game_id: gameId });
}

export function trackGameStarted(gameId: string): void {
  trackEvent('game_started', { game_id: gameId });
}

export function trackGameCompleted(gameId: string, reason: string): void {
  trackEvent('game_completed', { game_id: gameId, completion_reason: reason });
}

export function trackFavoriteAdded(gameId: string): void {
  trackEvent('favorite_added', { game_id: gameId });
}

export function trackFavoriteRemoved(gameId: string): void {
  trackEvent('favorite_removed', { game_id: gameId });
}

/** Primarily useful when consent is withdrawn and then granted again. */
export function resetAnalyticsPageViewDeduplication(): void {
  lastTrackedPagePath = null;
  lastTrackedPageKey = null;
}
