import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import { ALL_GAME_METADATA, CONNECT_FOUR_METADATA, type Player, type RoomState } from '@2play/shared';
import type { GameComponentProps } from '../../games/registry/types';
import { connectFourClient, type ConnectFourPublicState } from '../../games/connect-four';
import { HowToPlayContent, HowToPlayModal, useHowToPlay } from './HowToPlayModal';

/**
 * The single shared How To Play system.
 *
 * All 40 games render their rules through this one component, so these tests
 * pin the contract the rules audit depends on: every section is present for
 * every game, the timer text is the real clock rather than a derived estimate,
 * mobile and desktop controls are described separately, and the auto-popup is
 * owned by exactly one place so gameplay is never re-blocked.
 */

const SECTION_HEADINGS = [
  /objective/i,
  /how to play/i,
  /controls/i,
  /turn system/i,
  /scoring/i,
  /win, loss/i,
  /timer rules/i,
  /special rules/i,
  /players/i,
];

const STORAGE_PREFIX = '2play:howtoplay:';

describe('HowToPlayContent', () => {
  it('renders every section, for every one of the 40 games', () => {
    expect(ALL_GAME_METADATA).toHaveLength(40);
    for (const game of ALL_GAME_METADATA) {
      const { unmount } = render(<HowToPlayContent game={game} />);
      for (const heading of SECTION_HEADINGS) {
        expect(
          screen.queryByRole('heading', { name: heading }),
          `${game.id} is missing the "${heading}" section`,
        ).not.toBeNull();
      }
      unmount();
    }
  });

  it('shows the real clock instead of the estimated-duration fallback', () => {
    for (const game of ALL_GAME_METADATA) {
      const { container, unmount } = render(<HowToPlayContent game={game} />);
      const text = container.textContent ?? '';
      expect(text, `${game.id} fell back to the derived estimate`).not.toMatch(
        /About \d+ min per match\./,
      );
      expect(text, `${game.id} does not render its timeLimit`).toContain(
        game.howToPlay!.timeLimit!,
      );
      expect(text, `${game.id} does not render its turnSystem`).toContain(
        game.howToPlay!.turnSystem!,
      );
      unmount();
    }
  });

  it('describes mobile and desktop controls separately for every game', () => {
    for (const game of ALL_GAME_METADATA) {
      const { container, unmount } = render(<HowToPlayContent game={game} />);
      const text = container.textContent ?? '';
      const { mobile, desktop } = game.howToPlay!.controls!;
      expect(text, `${game.id} does not render its mobile controls`).toContain(mobile);
      expect(text, `${game.id} does not render its desktop controls`).toContain(desktop);
      expect(mobile, `${game.id} reuses one string for both`).not.toBe(desktop);
      unmount();
    }
  });

  it('states AI support so the rules also cover solo play', () => {
    for (const game of ALL_GAME_METADATA) {
      const { container, unmount } = render(<HowToPlayContent game={game} />);
      expect(container.textContent ?? '', game.id).toMatch(
        /Solo play against the AI|Human opponents only/,
      );
      unmount();
    }
  });
});

describe('HowToPlayModal', () => {
  const game = CONNECT_FOUR_METADATA;

  it('renders nothing while closed and a dialog once open', async () => {
    const { rerender } = render(<HowToPlayModal game={game} open={false} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();

    rerender(<HowToPlayModal game={game} open onClose={vi.fn()} />);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('closes through the Got it button and reports it to the owner', async () => {
    const onClose = vi.fn();
    render(<HowToPlayModal game={game} open onClose={onClose} />);
    await userEvent.click(await screen.findByRole('button', { name: /got it/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('useHowToPlay auto-open ownership', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('auto-opens the first time a game is opened, then remembers it', () => {
    const first = renderHook(() => useHowToPlay('reaction-race'));
    expect(first.result.current.open).toBe(true);

    act(() => first.result.current.close());
    expect(first.result.current.open).toBe(false);
    expect(window.localStorage.getItem(`${STORAGE_PREFIX}reaction-race`)).toBe('1');

    // A returning player is not blocked by the popup a second time.
    const second = renderHook(() => useHowToPlay('reaction-race'));
    expect(second.result.current.open).toBe(false);
  });

  it('tracks each game separately', () => {
    window.localStorage.setItem(`${STORAGE_PREFIX}reaction-race`, '1');
    const { result } = renderHook(() => useHowToPlay('maze-race-2d'));
    expect(result.current.open).toBe(true);
  });

  it('never auto-opens when a game component opts out, but its Help button still works', () => {
    const { result } = renderHook(() => useHowToPlay('chess', false));
    expect(result.current.open, 'opted-out game auto-opened the popup').toBe(false);

    act(() => result.current.show());
    expect(result.current.open).toBe(true);

    act(() => result.current.close());
    expect(result.current.open).toBe(false);
  });
});

describe('in-game Help button', () => {
  const players = [
    { id: 'p1', nickname: 'Player One', seatIndex: 0, isHost: true },
    { id: 'p2', nickname: 'Rival', seatIndex: 1, isHost: false },
  ] as Player[];

  const state: ConnectFourPublicState = {
    phase: 'playing',
    cols: 7,
    rows: 6,
    board: new Array(42).fill(0),
    currentPlayerId: 'p1',
    isMyTurn: true,
    mySeat: 1,
    legalColumns: [0, 1, 2, 3, 4, 5, 6],
    moves: 0,
    lastMove: null,
    winningLine: [],
    winnerId: null,
    isDraw: false,
    turnEndsAt: Date.now() + 30_000,
    finishReason: null,
    lastEvent: null,
    serverTime: Date.now(),
    players: {
      p1: { seat: 1, discs: 0, disconnected: false },
      p2: { seat: 2, discs: 0, disconnected: false },
    },
  };

  it('does not stack a rules dialog over live play, and opens one on demand', async () => {
    window.localStorage.clear();
    const Component = connectFourClient.Component as unknown as ComponentType<
      GameComponentProps<ConnectFourPublicState>
    >;
    render(
      <Component
        state={state}
        room={{} as RoomState}
        players={players}
        myPlayerId="p1"
        isMyTurn
        sendAction={vi.fn()}
        play={vi.fn()}
        vibrate={vi.fn()}
      />,
    );

    // RoomScreen owns the pre-match popup, so the game itself must not open one
    // on top of a live board.
    expect(screen.queryByRole('dialog')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /how to play/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    // The dialog carries this game's own rules, not generic copy.
    const text = screen.getByRole('dialog').textContent ?? '';
    expect(text).toContain(CONNECT_FOUR_METADATA.howToPlay!.turnSystem!);
    expect(text).toContain(CONNECT_FOUR_METADATA.howToPlay!.controls!.mobile);
  });
});
