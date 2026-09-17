import { useEffect, useMemo } from 'react';
import { SITE_NAME, buildPrivateSeo, escapeJsonForHtmlScript, type PageSeo } from '@2play/shared';

/**
 * Document-head management for SPA navigation.
 *
 * The server already renders the correct tags into the shell for the first
 * paint of every route; this hook keeps those tags truthful as the player
 * moves between screens without a reload. It writes only head elements —
 * no game chunks, sockets or engines are ever touched here.
 */

function upsertMeta(selector: string, createAttrs: Record<string, string>, content: string): void {
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement('meta');
    for (const [name, value] of Object.entries(createAttrs)) {
      element.setAttribute(name, value);
    }
    document.head.appendChild(element);
  }
  element.setAttribute('content', content);
}

function removeIfPresent(selector: string): void {
  document.head.querySelector(selector)?.remove();
}

const JSONLD_SELECTOR = 'script[data-seo-jsonld]';

export function applyPageSeo(seo: PageSeo): void {
  if (typeof document === 'undefined') return;

  document.title = seo.title;

  upsertMeta('meta[name="description"]', { name: 'description' }, seo.description);

  if (seo.robots) {
    upsertMeta('meta[name="robots"]', { name: 'robots' }, seo.robots);
  } else {
    removeIfPresent('meta[name="robots"]');
  }

  if (seo.canonicalUrl) {
    let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'canonical';
      document.head.appendChild(link);
    }
    link.href = seo.canonicalUrl;
  } else {
    removeIfPresent('link[rel="canonical"]');
  }

  upsertMeta('meta[property="og:title"]', { property: 'og:title' }, seo.title);
  upsertMeta('meta[property="og:description"]', { property: 'og:description' }, seo.description);
  upsertMeta('meta[property="og:type"]', { property: 'og:type' }, seo.ogType ?? 'website');
  upsertMeta('meta[property="og:site_name"]', { property: 'og:site_name' }, SITE_NAME);
  if (seo.canonicalUrl) {
    upsertMeta('meta[property="og:url"]', { property: 'og:url' }, seo.canonicalUrl);
  } else {
    removeIfPresent('meta[property="og:url"]');
  }

  upsertMeta('meta[name="twitter:card"]', { name: 'twitter:card' }, 'summary');
  upsertMeta('meta[name="twitter:title"]', { name: 'twitter:title' }, seo.title);
  upsertMeta('meta[name="twitter:description"]', { name: 'twitter:description' }, seo.description);

  // Structured data: drop the previous page's blocks, then append this page's.
  document.head.querySelectorAll(JSONLD_SELECTOR).forEach((element) => element.remove());
  for (const block of seo.jsonLd ?? []) {
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.setAttribute('data-seo-jsonld', '');
    script.textContent = escapeJsonForHtmlScript(block);
    document.head.appendChild(script);
  }
}

/** Reads the JSON-LD blocks this module manages (used by tests). */
export function readJsonLdBlocks(): Array<Record<string, unknown>> {
  return [...document.head.querySelectorAll(JSONLD_SELECTOR)]
    .map((element) => element.textContent ?? '')
    .filter((text) => text.length > 0)
    .map((text) => JSON.parse(text) as Record<string, unknown>);
}

/**
 * Applies a page's SEO whenever it changes. Call sites memoize the PageSeo
 * (e.g. with useMemo) so the effect only re-runs on real navigation or
 * catalogue changes. Passing `null` leaves the current head untouched —
 * useful while a screen is still loading and the correct tags are not known
 * yet (avoids flashing a noindex state at crawlers mid-load).
 */
export function usePageSeo(seo: PageSeo | null): void {
  useEffect(() => {
    if (seo) applyPageSeo(seo);
  }, [seo]);
}

/**
 * One-liner for private/dynamic screens (rooms, settings, statistics,
 * favorites, join/create flows, errors): unique title for the tab, noindex
 * for crawlers. Memoized internally, so callers pass plain strings.
 */
export function useNoindexPageSeo(title: string, description: string): void {
  const seo = useMemo(() => buildPrivateSeo(title, description), [title, description]);
  usePageSeo(seo);
}
