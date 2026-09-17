import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ALL_GAME_METADATA, GAME_CATEGORIES, SITE_NAME, buildHomeAboutContent } from '@2play/shared';
import { HomeAboutSection } from './HomeAboutSection';

/**
 * Homepage readable-content verification against the real catalogue.
 *
 * The section exists for players AND crawlers: it must describe the real
 * platform (derived from GameRegistry metadata — never hard-coded counts),
 * and every call to action must be a real, crawlable internal link.
 */

function renderSection(games = ALL_GAME_METADATA) {
  return render(
    <MemoryRouter>
      <HomeAboutSection games={games} />
    </MemoryRouter>,
  );
}

describe('HomeAboutSection', () => {
  it('renders nothing when the catalogue is empty', () => {
    const { container } = renderSection([]);
    expect(container).toBeEmptyDOMElement();
  });

  it('answers the core questions: what it is, categories, rooms, friends/solo', () => {
    renderSection();

    expect(screen.getByRole('heading', { name: `What is ${SITE_NAME}?` })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Game categories' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'How rooms work' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /Playing with friends/i }),
    ).toBeInTheDocument();

    // Structural proof the content is real paragraphs, not keyword lists.
    const section = screen
      .getByRole('heading', { name: `What is ${SITE_NAME}?` })
      .closest('section')!;
    const paragraphs = Array.from(section.querySelectorAll('p'));
    expect(paragraphs.length).toBeGreaterThanOrEqual(3);
    expect(paragraphs.every((p) => (p.textContent ?? '').length > 80)).toBe(true);
  });

  it('counts games and AI support dynamically from the registry, never hard-coded', () => {
    renderSection();
    const about = buildHomeAboutContent(ALL_GAME_METADATA);

    // The exact live count appears in the copy.
    expect(
      screen.getAllByText(new RegExp(`\\b${about.totalGames}\\b`)).length,
    ).toBeGreaterThan(0);

    // AI sentence stays truthful in both directions.
    const body = screen
      .getByRole('heading', { name: /Playing with friends/i })
      .closest('div')!.textContent!;
    expect(body).toContain(`${about.aiGames}`);
    expect(about.aiGames).toBeLessThanOrEqual(about.totalGames);

    // Category chips mirror the registry: only used categories, with counts.
    const chips = within(
      screen.getByRole('heading', { name: 'Game categories' }).closest('section') ??
        screen.getByRole('heading', { name: 'Game categories' }).parentElement!,
    ).getAllByText(/· \d+/);
    expect(chips).toHaveLength(about.categories.length);
    expect(about.categories.length).toBeGreaterThan(0);
    for (const category of about.categories) {
      expect((GAME_CATEGORIES as readonly string[]).includes(category.id)).toBe(true);
      expect(
        ALL_GAME_METADATA.filter((g) => g.category === category.id).length,
      ).toBe(category.gameCount);
    }
  });

  it('links into create / join / catalogue with descriptive exposed anchors', () => {
    renderSection();
    const about = buildHomeAboutContent(ALL_GAME_METADATA);

    const nav = screen.getByRole('navigation', { name: 'Get started' });
    const create = within(nav).getByRole('link', { name: /Create a room and invite friends/ });
    expect(create.getAttribute('href')).toBe('/create');
    const join = within(nav).getByRole('link', { name: /Join a room with a code/ });
    expect(join.getAttribute('href')).toBe('/join');
    const browse = within(nav).getByRole('link', { name: `Browse all ${about.totalGames} games` });
    expect(browse.getAttribute('href')).toBe('/games');

    // No private-room or external links anywhere in the section.
    expect(document.body.innerHTML).not.toContain('/room/');
    for (const anchor of within(nav).getAllByRole('link')) {
      expect(anchor.getAttribute('href')!.startsWith('/')).toBe(true);
    }
  });
});
