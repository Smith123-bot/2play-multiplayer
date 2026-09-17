import {
  SITE_NAME,
  buildNoscriptHtml,
  escapeHtml,
  escapeHtmlAttr,
  escapeJsonForHtmlScript,
  type PageSeo,
} from '@2play/shared';

/**
 * Renders the SEO <head> block for one page and splices it into the built
 * SPA shell between two stable HTML comments. Everything goes through the
 * shared escaping helpers, so a game description can never break out of a
 * meta attribute or a JSON-LD block.
 */

export const SEO_HEAD_START = '<!--seo-head-start-->';
export const SEO_HEAD_END = '<!--seo-head-end-->';

const NOSCRIPT_PATTERN = /<noscript>[\s\S]*?<\/noscript>/i;

/**
 * Webmaster-verification extras, provided by env config at boot. When a token
 * is absent the corresponding tag is omitted entirely — an empty
 * `content=""` would fail the verification probe.
 */
export interface SeoHeadExtras {
  googleSiteVerification?: string | undefined;
  bingSiteVerification?: string | undefined;
}

export function renderHeadTags(seo: PageSeo, extras: SeoHeadExtras = {}): string {
  const lines: string[] = [];
  lines.push(`<title>${escapeHtml(seo.title)}</title>`);
  lines.push(`<meta name="description" content="${escapeHtmlAttr(seo.description)}" />`);
  if (seo.robots) {
    lines.push(`<meta name="robots" content="${escapeHtmlAttr(seo.robots)}" />`);
  }
  if (seo.canonicalUrl) {
    lines.push(`<link rel="canonical" href="${escapeHtmlAttr(seo.canonicalUrl)}" />`);
  }

  // Search Console / Bing Webmaster Tools ownership probes (env-configured).
  if (extras.googleSiteVerification) {
    lines.push(
      `<meta name="google-site-verification" content="${escapeHtmlAttr(extras.googleSiteVerification)}" />`,
    );
  }
  if (extras.bingSiteVerification) {
    lines.push(
      `<meta name="msvalidate.01" content="${escapeHtmlAttr(extras.bingSiteVerification)}" />`,
    );
  }

  // Open Graph — absolute URLs only, so crawlers never resolve them against
  // the Render/on-render hostname the request may have arrived on.
  lines.push(`<meta property="og:title" content="${escapeHtmlAttr(seo.title)}" />`);
  lines.push(`<meta property="og:description" content="${escapeHtmlAttr(seo.description)}" />`);
  lines.push(`<meta property="og:type" content="${seo.ogType ?? 'website'}" />`);
  lines.push(`<meta property="og:site_name" content="${escapeHtmlAttr(SITE_NAME)}" />`);
  if (seo.canonicalUrl) {
    lines.push(`<meta property="og:url" content="${escapeHtmlAttr(seo.canonicalUrl)}" />`);
  }

  lines.push('<meta name="twitter:card" content="summary" />');
  lines.push(`<meta name="twitter:title" content="${escapeHtmlAttr(seo.title)}" />`);
  lines.push(`<meta name="twitter:description" content="${escapeHtmlAttr(seo.description)}" />`);

  for (const block of seo.jsonLd ?? []) {
    lines.push(
      `<script type="application/ld+json">${escapeJsonForHtmlScript(block)}</script>`,
    );
  }
  return lines.join('\n    ');
}

/**
 * Replaces the marked region of the shell with the tags for this route and
 * swaps the static <noscript> for route-specific readable body content, so
 * the served HTML carries crawlable text even before any JavaScript runs.
 * Missing markers are *not* an error: an older shell still works unchanged.
 */
export function renderShell(template: string, seo: PageSeo, extras: SeoHeadExtras = {}): string {
  const start = template.indexOf(SEO_HEAD_START);
  const end = template.indexOf(SEO_HEAD_END);
  if (start === -1 || end === -1 || end < start) return template;
  const withHead =
    template.slice(0, start + SEO_HEAD_START.length) +
    '\n    ' +
    renderHeadTags(seo, extras) +
    '\n    ' +
    template.slice(end);
  return withHead.replace(NOSCRIPT_PATTERN, `<noscript>${buildNoscriptHtml(seo)}</noscript>`);
}
