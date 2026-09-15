import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Player, RoomState } from '@2play/shared';
import type { GameComponentProps } from './registry/types';
import { drawGuessClient, type DrawGuessPublicState } from './draw-guess-battle';
import { territoryRushClient, type TerritoryRushPublicState } from './territory-rush';

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

function renderGame<T>(module: { Component: ComponentType<GameComponentProps<never>> }, state: T) {
  const sendAction = vi.fn();
  const Component = module.Component as unknown as ComponentType<GameComponentProps<T>>;
  render(
    <Component
      state={state}
      room={{} as RoomState}
      players={players}
      myPlayerId="p1"
      isMyTurn
      sendAction={sendAction}
      play={vi.fn()}
      vibrate={vi.fn()}
    />,
  );
  return sendAction;
}

describe('Batch 2 premium game clients', () => {
  it('renders Draw & Guess progression, hint and authoritative undo/guess actions', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const state = {
      phase: 'drawing',
      round: 5,
      totalRounds: 6,
      drawerId: 'p2',
      category: 'places',
      difficulty: 'hard',
      hint: 'c____e',
      word: null,
      endsAt: Date.now() + 20_000,
      strokes: [
        { id: 's1', color: '#111827', size: 8, tool: 'brush', points: [{ x: 0.1, y: 0.1 }] },
      ],
      solved: [],
      guesses: [],
      scores: { p1: 0, p2: 0 },
      history: [],
      palette: ['#111827'],
      lastEvent: null,
      eventSeq: 1,
      serverTime: Date.now(),
    } as DrawGuessPublicState;
    const send = renderGame(drawGuessClient, state);
    expect(screen.getByText('c____e')).toBeInTheDocument();
    expect(screen.getByText('hard')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Your guess'), 'castle');
    await userEvent.click(screen.getByRole('button', { name: 'Guess' }));
    expect(send).toHaveBeenCalledWith({ type: 'guess', payload: { text: 'castle' } });
  });

  it('renders Territory Rush map/stage progress and sequences touch-friendly steering', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const runner = {
      x: 2,
      y: 2,
      direction: 'right',
      owner: 1,
      trail: [],
      cells: 20,
      percent: 8.3,
      captures: 2,
      deaths: 1,
      largestCapture: 11,
      latestInputSeq: 6,
      frozenUntil: 0,
      disconnected: false,
    };
    const state = {
      phase: 'playing',
      cols: 40,
      rows: 24,
      grid: '0'.repeat(960),
      walls: [20],
      layout: 'crossroads',
      stage: 2,
      nextStageAt: Date.now() + 10_000,
      stepMs: 220,
      stepIndex: 8,
      startedAt: Date.now(),
      endsAt: Date.now() + 20_000,
      durationMs: 180_000,
      finishReason: null,
      lastEvent: null,
      serverTime: Date.now(),
      totalCells: 960,
      runners: { p1: runner, p2: { ...runner, owner: 2, latestInputSeq: 1 } },
    } as TerritoryRushPublicState;
    const send = renderGame(territoryRushClient, state);
    expect(screen.getByText('Stage 2/3 · crossroads')).toBeInTheDocument();
    expect(screen.getByText('Best loop +11')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Turn down' }));
    expect(send).toHaveBeenCalledWith({
      type: 'turn',
      payload: { direction: 'down', sequence: 7 },
    });
  });

});
