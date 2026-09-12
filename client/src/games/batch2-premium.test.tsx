import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Player, RoomState } from '@2play/shared';
import type { GameComponentProps } from './registry/types';
import { drawGuessClient, type DrawGuessPublicState } from './draw-guess-battle';
import { territoryRushClient, type TerritoryRushPublicState } from './territory-rush';
import { coinHuntersClient, type CoinHuntersPublicState } from './coin-hunters-arena';
import { shopRushClient, type ShopPublicState } from './shop-rush-battle';

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

  it('renders real Coin Hunter rounds/streaks and sequences movement', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const hunter = {
      x: 1,
      y: 1,
      direction: 'right',
      score: 75,
      coins: 4,
      multiplier: true,
      streak: 3,
      bestStreak: 4,
      latestInputSeq: 9,
      disconnected: false,
    };
    const state = {
      phase: 'playing',
      cols: 18,
      rows: 12,
      stepMs: 190,
      stepIndex: 2,
      startedAt: Date.now(),
      endsAt: Date.now() + 20_000,
      durationMs: 150_000,
      finishReason: null,
      lastEvent: null,
      serverTime: Date.now(),
      bonus: { x: 8, y: 5, w: 3, h: 2 },
      slow: [],
      blocker: { x: 9, y: 1, direction: 'down' },
      walls: [20],
      layout: 'lanes',
      round: 3,
      coins: [{ id: 'c1', x: 3, y: 3, kind: 'gold', value: 25, expiresAt: Date.now() + 5000 }],
      hunters: { p1: hunter, p2: { ...hunter, x: 16, latestInputSeq: 0 } },
    } as CoinHuntersPublicState;
    const send = renderGame(coinHuntersClient, state);
    expect(screen.getByText('Round 3/3 · lanes')).toBeInTheDocument();
    expect(screen.getByText('Streak x3')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Move down' }));
    expect(send).toHaveBeenCalledWith({
      type: 'move',
      payload: { direction: 'down', sequence: 10 },
    });
  });

  it('renders Shop Rush customer progress and sends authoritative checkout', async () => {
    const shopper = {
      x: 5,
      y: 8,
      inventory: ['milk'],
      list: ['milk', 'bread'],
      score: 90,
      checkouts: 2,
      combo: 2,
      bestCombo: 2,
      correctItems: 4,
      wrongItems: 1,
      missedOrders: 0,
      orderNumber: 3,
      orderDeadline: Date.now() + 15_000,
      latestInputSeq: 4,
      disconnected: false,
      basketSize: 1,
    };
    const state = {
      phase: 'playing',
      cols: 11,
      rows: 9,
      shelves: [{ x: 2, y: 2, item: 'milk' }],
      till: { x: 5, y: 8 },
      startedAt: Date.now(),
      endsAt: Date.now() + 40_000,
      durationMs: 120_000,
      finishReason: null,
      lastEvent: null,
      eventSeq: 2,
      serverTime: Date.now(),
      shoppers: { p1: shopper, p2: { ...shopper, inventory: ['hidden'], list: [] } },
    } as ShopPublicState;
    const send = renderGame(shopRushClient, state);
    expect(screen.getByText('Customer order 3')).toBeInTheDocument();
    expect(screen.getByText('Service streak x2')).toBeInTheDocument();
    expect(screen.getByText('Accuracy 80%')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Checkout' }));
    expect(send).toHaveBeenCalledWith({ type: 'checkout' });
  });
});
