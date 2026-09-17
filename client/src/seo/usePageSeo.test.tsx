import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SITE_NAME, SITE_URL, buildGameSeo, buildNotFoundSeo } from '@2play/shared';
import { ALL_GAME_METADATA } from '@2play/shared';
import { applyPageSeo, readJsonLdBlocks, useNoindexPageSeo, usePageSeo } from './usePageSeo';

/**
 * jsdom ships a <head> seeded from an empty document, so every test starts
 * from a clean slate and asserts the exact head state the hook produces.
 */
function clearHead() {
  document.head.innerHTML = '';
  document.title = '';
}

function metaContent(selector: string): string | null {
  return document.head.querySelector<HTMLMetaElement>(selector)?.getAttribute('content') ?? null;
}

function SeoProbe({ seo }: { seo: Parameters<typeof usePageSeo>[0] }) {
  usePageSeo(seo);
  return <p>probe</p>;
}

function NoindexProbe({ title, description }: { title: string; description: string }) {
  useNoindexPageSeo(title, description);
  return <p>probe</p>;
}

beforeEach(clearHead);

describe('applyPageSeo', () => {
  const chess = ALL_GAME_METADATA.find((game) => game.id === 'chess')!;
  const seo = buildGameSeo(chess);

  it('writes title, description and canonical', () => {
    applyPageSeo(seo);
    expect(document.title).toContain('Chess');
    expect(document.title).toContain(SITE_NAME);
    expect(metaContent('meta[name="description"]')).toContain(chess.description.slice(0, 30));
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      `${SITE_URL}/games/chess`,
    );
  });

  it('writes Open Graph and Twitter metadata', () => {
    applyPageSeo(seo);
    expect(metaContent('meta[property="og:title"]')).toBe(document.title);
    expect(metaContent('meta[property="og:url"]')).toBe(`${SITE_URL}/games/chess`);
    expect(metaContent('meta[property="og:site_name"]')).toBe(SITE_NAME);
    expect(metaContent('meta[property="og:type"]')).toBe('article');
    expect(metaContent('meta[name="twitter:card"]')).toBe('summary');
    expect(metaContent('meta[name="twitter:description"]')).toContain('strategy');
  });

  it('renders VideoGame and BreadcrumbList JSON-LD without fabricated fields', () => {
    applyPageSeo(seo);
    const blocks = readJsonLdBlocks();
    const types = blocks.map((block) => block['@type']);
    expect(types).toContain('VideoGame');
    expect(types).toContain('BreadcrumbList');
    const videoGame = blocks.find((block) => block['@type'] === 'VideoGame')!;
    expect(videoGame.name).toBe('Chess');
    expect(videoGame.url).toBe(`${SITE_URL}/games/chess`);
    expect(videoGame).not.toHaveProperty('aggregateRating');
    expect(videoGame).not.toHaveProperty('offers');
    expect(videoGame).not.toHaveProperty('review');
  });

  it('removes robots and canonical when a page stops being noindex', () => {
    applyPageSeo(buildNotFoundSeo('Game'));
    expect(metaContent('meta[name="robots"]')).toBe('noindex, nofollow');
    applyPageSeo(seo);
    expect(metaContent('meta[name="robots"]')).toBeNull();
    expect(document.head.querySelector('link[rel="canonical"]')).not.toBeNull();
  });

  it('removes canonical and og:url for noindex pages', () => {
    applyPageSeo(seo);
    applyPageSeo(buildNotFoundSeo('Page'));
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
    expect(metaContent('meta[property="og:url"]')).toBeNull();
  });

  it('replaces JSON-LD instead of accumulating blocks across navigations', () => {
    applyPageSeo(seo);
    applyPageSeo(seo);
    applyPageSeo(buildGameSeo(ALL_GAME_METADATA[0]!));
    const blocks = readJsonLdBlocks();
    expect(blocks).toHaveLength(2);
    const names = blocks.map((block) => block.name).filter(Boolean);
    expect(names).toContain(ALL_GAME_METADATA[0]!.name);
    expect(names).not.toContain('Chess');
  });
});

describe('usePageSeo hook', () => {
  it('applies metadata on mount and updates on rerender', () => {
    const first = buildGameSeo(ALL_GAME_METADATA[0]!);
    const second = buildGameSeo(ALL_GAME_METADATA[1]!);
    const { rerender } = render(<SeoProbe seo={first} />);
    expect(document.title).toContain(ALL_GAME_METADATA[0]!.name);

    rerender(<SeoProbe seo={second} />);
    expect(document.title).toContain(ALL_GAME_METADATA[1]!.name);
    expect(screen.getByText('probe')).toBeInTheDocument();
  });

  it('ignores null (loading) states without touching the head', () => {
    document.title = 'Untouched';
    render(<SeoProbe seo={null} />);
    expect(document.title).toBe('Untouched');
  });
});

describe('useNoindexPageSeo', () => {
  it('marks the page noindex with a unique title and no canonical', () => {
    render(<NoindexProbe title="Room" description="A live room." />);
    expect(document.title).toBe(`Room | ${SITE_NAME}`);
    expect(metaContent('meta[name="robots"]')).toBe('noindex, nofollow');
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
  });
});
