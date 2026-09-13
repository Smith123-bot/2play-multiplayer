import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { REACTION_RACE_METADATA } from '@2play/shared';
import { GameCard } from './GameCard';

const renderCard = (props: Omit<React.ComponentProps<typeof GameCard>, 'game'>) =>
  render(
    <MemoryRouter>
      <GameCard {...props} game={REACTION_RACE_METADATA} />
    </MemoryRouter>,
  );

/**
 * Game cards are the main discovery surface, so two structural rules matter:
 * interactive elements must never be nested inside each other (invalid HTML —
 * browsers hoist a button out of an anchor and screen readers fold it into the
 * link's announcement), and each action button must carry one icon, not a
 * lucide glyph plus an emoji of the same thing.
 */
describe('GameCard structure', () => {
  it('link mode keeps the whole card clickable without nesting a button in the anchor', async () => {
    const onToggle = vi.fn();
    const { container } = renderCard({ favorite: true, onToggleFavorite: onToggle });

    expect(container.querySelector('a button'), 'button nested inside an anchor').toBeNull();
    expect(container.querySelector('button button'), 'button nested inside a button').toBeNull();

    // The stretched link still makes the card itself the navigation target.
    const link = screen.getByRole('link', { name: 'Open Reaction Race' });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toBe('/games/reaction-race');

    // And the favorite control stays independently reachable and operable.
    await userEvent.click(
      screen.getByRole('button', { name: 'Remove Reaction Race from favorites' }),
    );
    expect(onToggle).toHaveBeenCalledWith('reaction-race');
  });

  it('inline mode does not nest the favorite button inside the expand toggle', () => {
    const { container } = renderCard({
      expanded: false,
      onToggleExpand: vi.fn(),
      onQuickPlay: vi.fn(),
      onCreateRoom: vi.fn(),
      onJoinRoom: vi.fn(),
      onToggleFavorite: vi.fn(),
    });

    expect(container.querySelector('button button'), 'button nested inside a button').toBeNull();
    expect(
      screen.getByRole('button', { name: 'Expand Reaction Race' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Add Reaction Race to favorites' }),
    ).toBeInTheDocument();
  });

  it('shows the category as a readable word, matching the filter dropdown', () => {
    renderCard({});
    // Metadata stores 'reflex'; the UI must not leak the raw lowercase id.
    expect(REACTION_RACE_METADATA.category).toBe('reflex');
    expect(screen.getByText('Reflex')).toBeInTheDocument();
  });

  it('labels each action once, without an emoji duplicating the button icon', async () => {
    renderCard({
      expanded: true,
      onToggleExpand: vi.fn(),
      onQuickPlay: vi.fn(),
      onCreateRoom: vi.fn(),
      onJoinRoom: vi.fn(),
    });

    for (const name of [/play with ai/i, /create room/i, /join room/i]) {
      const button = screen.getByRole('button', { name });
      expect(button.textContent, `${name} repeats its icon as an emoji`).not.toMatch(
        /[⚡🏠🔗]/u,
      );
    }

    const onQuickPlay = vi.fn();
    const onCreateRoom = vi.fn();
    const onJoinRoom = vi.fn();
    const { unmount } = renderCard({
      expanded: true,
      onToggleExpand: vi.fn(),
      onQuickPlay,
      onCreateRoom,
      onJoinRoom,
    });
    await userEvent.click(screen.getAllByRole('button', { name: /play with ai/i }).at(-1)!);
    expect(onQuickPlay).toHaveBeenCalledWith('reaction-race');
    unmount();
  });
});
