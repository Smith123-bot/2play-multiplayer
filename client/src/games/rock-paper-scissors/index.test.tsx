import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Player, RoomState } from '@2play/shared';
import type { GameComponentProps } from '../registry/types';
import { rockPaperScissorsClient, type RpsPublicState } from './index';

/**
 * Rock Paper Scissors — renderer contract.
 *
 * The renderer is a pure view: it must send the shape the player tapped and
 * nothing more, and it must never be able to show the opponent's throw before
 * the server reveals it. That last point is asserted against the projection the
 * server actually sends (opponent `choice: null` while a round is live), so a
 * leak would have to come from the client inventing data it was never given.
 */

const players = [
  {
    id: 'p1',
    nickname: 'You',
    avatar: '🦊',
    seatIndex: 0,
    score: 0,
    isHost: true,
    isReady: true,
    isConnected: true,
    isDisconnected: false,
    isAI: false,
  },
  {
    id: 'p2',
    nickname: 'Rival',
    avatar: '🐼',
    seatIndex: 1,
    score: 0,
    isHost: false,
    isReady: true,
    isConnected: true,
    isDisconnected: false,
    isAI: false,
  },
] as Player[];

const now = Date.now();

function makeState(overrides: Partial<RpsPublicState> = {}): RpsPublicState {
  return {
    phase: 'choose',
    round: 0,
    winsNeeded: 3,
    maxRounds: 12,
    countdownUntil: null,
    chooseUntil: now + 8_000,
    finishReason: null,
    lastEvent: null,
    serverTime: now,
    myChoice: null,
    opponents: {
      p2: { score: 0, draws: 0, forfeits: 0, hasThrown: false, disconnected: false, left: false, choice: null },
    },
    me: { score: 0, draws: 0, forfeits: 0, disconnected: false },
    seatOrder: ['p1', 'p2'],
    roundResult: null,
    history: [],
    ...overrides,
  };
}

function renderGame(state: RpsPublicState, myPlayerId: string | null = 'p1') {
  const sendAction = vi.fn();
  const play = vi.fn();
  const vibrate = vi.fn();
  const Component = rockPaperScissorsClient.Component as unknown as ComponentType<
    GameComponentProps<RpsPublicState>
  >;
  const { unmount, rerender } = render(
    <Component
      state={state}
      room={{} as RoomState}
      players={players}
      myPlayerId={myPlayerId}
      isMyTurn
      sendAction={sendAction}
      play={play}
      vibrate={vibrate}
    />,
  );
  return { sendAction, play, vibrate, unmount, rerender };
}

const throwButton = (label: string) => screen.getByRole('button', { name: `Throw ${label}` });

describe('Rock Paper Scissors client', () => {
  it('ships the catalogue metadata and waits politely before the first round', () => {
    expect(rockPaperScissorsClient.metadata.id).toBe('rock-paper-scissors');
    expect(rockPaperScissorsClient.metadata.name).toBe('Rock Paper Scissors');
    renderGame(makeState({ phase: 'idle', chooseUntil: null }));
    expect(screen.getByText(/shaking hands/i)).toBeInTheDocument();
    // No throw buttons until a round is actually live.
    expect(screen.queryByRole('button', { name: /Throw Rock/i })).not.toBeInTheDocument();
  });

  it('shows both seats with names, avatars, scores and the race to 3', () => {
    renderGame(makeState({ me: { score: 2, draws: 1, forfeits: 0, disconnected: false } }));
    // The shared HUD lists the same seats, so names legitimately appear twice:
    // once in the HUD and once on the throw panel.
    expect(screen.getAllByText('You').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Rival').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('🦊').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('🐼').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('First to 3')).toBeInTheDocument();
    expect(screen.getByText('Round 1')).toBeInTheDocument();
    // My two round wins are on the board, the opponent has none.
    expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(1);
  });

  it('renders the 3-2-1 countdown from the server deadline', () => {
    renderGame(makeState({ phase: 'countdown', countdownUntil: now + 2_400, chooseUntil: null }));
    // 2.4s left rounds up to 3 on the display.
    expect(screen.getByLabelText('Countdown: 3')).toBeInTheDocument();
    expect(screen.getByText('Throws in')).toBeInTheDocument();
    // Throws are locked out until GO.
    expect(throwButton('Rock')).toBeDisabled();
  });

  it('renders three large throw buttons with the rule hints and desktop keys', () => {
    renderGame(makeState());
    for (const label of ['Rock', 'Paper', 'Scissors']) {
      const button = throwButton(label);
      expect(button).toBeEnabled();
      expect(button).toHaveAccessibleName(`Throw ${label}`);
    }
    expect(screen.getByText('beats scissors')).toBeInTheDocument();
    expect(screen.getByText('beats rock')).toBeInTheDocument();
    expect(screen.getByText('beats paper')).toBeInTheDocument();
    expect(screen.getByText('Key R')).toBeInTheDocument();
    expect(screen.getByText('Key P')).toBeInTheDocument();
    expect(screen.getByText('Key S')).toBeInTheDocument();
  });

  it('sends only the tapped shape — the client never asserts an outcome', async () => {
    const user = userEvent.setup();
    const { sendAction } = renderGame(makeState());
    await user.click(throwButton('Paper'));
    expect(sendAction).toHaveBeenCalledTimes(1);
    expect(sendAction).toHaveBeenCalledWith({ type: 'throw', payload: { choice: 'paper' } });
    // No score, winner or result ever leaves the client.
    const sent = JSON.stringify(sendAction.mock.calls);
    for (const forbidden of ['score', 'winner', 'result', 'reveal']) {
      expect(sent).not.toContain(forbidden);
    }
  });

  it('throws with the R, P and S keys on desktop', () => {
    const { sendAction } = renderGame(makeState());
    fireEvent.keyDown(window, { key: 'r' });
    fireEvent.keyDown(window, { key: 'P' });
    fireEvent.keyDown(window, { key: 's' });
    expect(sendAction).toHaveBeenNthCalledWith(1, { type: 'throw', payload: { choice: 'rock' } });
    expect(sendAction).toHaveBeenNthCalledWith(2, { type: 'throw', payload: { choice: 'paper' } });
    expect(sendAction).toHaveBeenNthCalledWith(3, { type: 'throw', payload: { choice: 'scissors' } });
  });

  it('ignores stray keys and keys typed into a field', () => {
    const { sendAction } = renderGame(makeState());
    fireEvent.keyDown(window, { key: 'x' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(sendAction).not.toHaveBeenCalled();

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: 'r' });
    expect(sendAction).not.toHaveBeenCalled();
    input.remove();
  });

  it('does not send a throw once the round is closed', async () => {
    const user = userEvent.setup();
    const { sendAction } = renderGame(makeState({ phase: 'reveal', chooseUntil: null }));
    expect(throwButton('Rock')).toBeDisabled();
    await user.click(throwButton('Rock')).catch(() => undefined);
    fireEvent.keyDown(window, { key: 'r' });
    expect(sendAction).not.toHaveBeenCalled();
  });

  it('shows the locked state and stops accepting throws after a choice', async () => {
    const user = userEvent.setup();
    const { sendAction } = renderGame(makeState({ myChoice: 'rock' }));
    expect(screen.getByText('Locked in')).toBeInTheDocument();
    expect(throwButton('Rock')).toBeDisabled();
    expect(throwButton('Rock')).toHaveAttribute('aria-pressed', 'true');
    expect(throwButton('Paper')).toHaveAttribute('aria-pressed', 'false');
    await user.click(throwButton('Paper')).catch(() => undefined);
    expect(sendAction).not.toHaveBeenCalled();
  });

  it('shows a waiting state while the opponent has not thrown', () => {
    renderGame(makeState({ myChoice: 'rock' }));
    expect(screen.getByText(/waiting for your opponent/i)).toBeInTheDocument();
    // I am locked, they are still deciding — both states are shown at once.
    expect(screen.getByText('Choosing…')).toBeInTheDocument();
    expect(screen.getByText('Locked in')).toBeInTheDocument();
  });

  it('KEEPS THE OPPONENT THROW HIDDEN until the server reveals it', () => {
    // The opponent has locked a throw; the server sends hasThrown but no shape.
    const { rerender } = render(
      <HiddenProbe
        state={makeState({
          opponents: {
            p2: {
              score: 0,
              draws: 0,
              forfeits: 0,
              hasThrown: true,
              disconnected: false,
              left: false,
              choice: null,
            },
          },
        })}
      />,
    );

    // The player learns only THAT a throw happened, never what it was.
    expect(screen.getByText('Locked in')).toBeInTheDocument();
    expect(screen.getByLabelText('opponent throw hidden')).toBeInTheDocument();
    expect(screen.getByText('🔒')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Rival threw/)).not.toBeInTheDocument();

    // Only when the server releases the round does the shape appear.
    rerender(
      <HiddenProbe
        state={makeState({
          phase: 'reveal',
          chooseUntil: null,
          opponents: {
            p2: {
              score: 1,
              draws: 0,
              forfeits: 0,
              hasThrown: true,
              disconnected: false,
              left: false,
              choice: 'paper',
            },
          },
          myChoice: 'rock',
          me: { score: 0, draws: 0, forfeits: 0, disconnected: false },
          roundResult: {
            round: 0,
            choices: { p1: 'rock', p2: 'paper' },
            outcomes: { p1: 'loss', p2: 'win' },
            forfeits: [],
          },
        })}
      />,
    );
    expect(screen.getByLabelText('Rival threw Paper')).toBeInTheDocument();
    expect(screen.queryByLabelText('opponent throw hidden')).not.toBeInTheDocument();
  });

  it('reports the round outcome after the reveal', () => {
    renderGame(
      makeState({
        phase: 'reveal',
        chooseUntil: null,
        myChoice: 'rock',
        opponents: {
          p2: { score: 0, draws: 0, forfeits: 0, hasThrown: true, disconnected: false, left: false, choice: 'scissors' },
        },
        me: { score: 1, draws: 0, forfeits: 0, disconnected: false },
        roundResult: {
          round: 0,
          choices: { p1: 'rock', p2: 'scissors' },
          outcomes: { p1: 'win', p2: 'loss' },
          forfeits: [],
        },
      }),
    );
    expect(screen.getByText('You win the round')).toBeInTheDocument();
    expect(screen.getByText('Rock vs Scissors')).toBeInTheDocument();
    expect(screen.getByLabelText('Rival threw Scissors')).toBeInTheDocument();
  });

  it('reports a draw and a forfeited round', () => {
    const { unmount } = renderGame(
      makeState({
        phase: 'reveal',
        chooseUntil: null,
        myChoice: 'paper',
        opponents: {
          p2: { score: 0, draws: 1, forfeits: 0, hasThrown: true, disconnected: false, left: false, choice: 'paper' },
        },
        me: { score: 0, draws: 1, forfeits: 0, disconnected: false },
        roundResult: {
          round: 0,
          choices: { p1: 'paper', p2: 'paper' },
          outcomes: { p1: 'draw', p2: 'draw' },
          forfeits: [],
        },
      }),
    );
    expect(screen.getByText(/draw — same throw/i)).toBeInTheDocument();
    unmount();

    renderGame(
      makeState({
        phase: 'reveal',
        chooseUntil: null,
        myChoice: null,
        opponents: {
          p2: { score: 1, draws: 0, forfeits: 0, hasThrown: true, disconnected: false, left: false, choice: 'rock' },
        },
        me: { score: 0, draws: 0, forfeits: 1, disconnected: false },
        roundResult: {
          round: 0,
          choices: { p1: null, p2: 'rock' },
          outcomes: { p1: 'forfeit', p2: 'win' },
          forfeits: ['p1'],
        },
      }),
    );
    expect(screen.getByText(/no throw in time/i)).toBeInTheDocument();
    expect(screen.getByText(/the round timer ran out/i)).toBeInTheDocument();
  });

  it('shows the final result for a win, a loss and a draw', () => {
    const finished = (mine: number, theirs: number) =>
      makeState({
        phase: 'finished',
        chooseUntil: null,
        finishReason: 'completed',
        myChoice: null,
        me: { score: mine, draws: 0, forfeits: 0, disconnected: false },
        opponents: {
          p2: { score: theirs, draws: 0, forfeits: 0, hasThrown: false, disconnected: false, left: false, choice: null },
        },
      });

    const { unmount } = renderGame(finished(3, 1));
    expect(screen.getByText('You won the match')).toBeInTheDocument();
    expect(screen.getByText('Final score 3 – 1')).toBeInTheDocument();
    expect(screen.getByText(/rematch/i)).toBeInTheDocument();
    unmount();

    const second = renderGame(finished(1, 3));
    expect(screen.getByText('Opponent won the match')).toBeInTheDocument();
    second.unmount();

    renderGame(finished(2, 2));
    expect(screen.getByText('Match drawn')).toBeInTheDocument();
  });

  it('flags a reconnecting opponent without hiding the board', () => {
    renderGame(
      makeState({
        opponents: {
          p2: { score: 1, draws: 0, forfeits: 0, hasThrown: false, disconnected: true, left: false, choice: null },
        },
      }),
    );
    expect(screen.getByText(/opponent reconnecting/i)).toBeInTheDocument();
    expect(throwButton('Scissors')).toBeEnabled();
  });

  it('renders the round log of revealed throws', () => {
    renderGame(
      makeState({
        history: [
          { round: 0, choices: { p1: 'rock', p2: 'scissors' }, outcomes: { p1: 'win', p2: 'loss' }, forfeits: [] },
          { round: 1, choices: { p1: 'paper', p2: 'paper' }, outcomes: { p1: 'draw', p2: 'draw' }, forfeits: [] },
          { round: 2, choices: { p1: null, p2: 'rock' }, outcomes: { p1: 'forfeit', p2: 'win' }, forfeits: ['p1'] },
        ],
      }),
    );
    expect(screen.getByText('Rounds')).toBeInTheDocument();
    expect(screen.getByTitle('Round 1: Rock vs Scissors')).toBeInTheDocument();
    expect(screen.getByTitle('Round 2: Paper vs Paper')).toBeInTheDocument();
    expect(screen.getByTitle('Round 3: no throw vs Rock')).toBeInTheDocument();
  });

  it('still renders for a spectator with no seat', () => {
    renderGame(makeState(), null);
    expect(screen.getByText('Round 1')).toBeInTheDocument();
    // No seat means no throw of my own and no outcome banner.
    expect(screen.queryByText('You win the round')).not.toBeInTheDocument();
    expect(throwButton('Rock')).toBeDisabled();
  });
});

/** Renders the component with the same props, for rerender-based assertions. */
function HiddenProbe({ state }: { state: RpsPublicState }) {
  const Component = rockPaperScissorsClient.Component as unknown as ComponentType<
    GameComponentProps<RpsPublicState>
  >;
  return (
    <Component
      state={state}
      room={{} as RoomState}
      players={players}
      myPlayerId="p1"
      isMyTurn
      sendAction={vi.fn()}
      play={vi.fn()}
      vibrate={vi.fn()}
    />
  );
}
