import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Player, RoomState } from '@2play/shared';
import type { GameComponentProps } from './registry/types';
import { blackBlastClient, type BlastPublicState } from './black-blast';
import { ludoClient, type LudoPublicState } from './ludo';

const players = [
  {
    id: 'p1',
    nickname: 'Player One',
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
  const result = render(
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
  return { ...result, sendAction };
}

describe('Batch 1 premium game clients', () => {
  it('renders Black Blast strategy state and sends the selected blast mode', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const player = {
      x: 2,
      y: 2,
      score: 0,
      combo: 0,
      bestCombo: 0,
      hits: 0,
      chains: 0,
      energy: 80,
      maxEnergy: 100,
      waveHits: 7,
      wavesCleared: 1,
      disconnected: false,
    };
    const state: BlastPublicState = {
      phase: 'playing',
      cols: 18,
      rows: 12,
      endsAt: Date.now() + 30_000,
      serverTime: Date.now(),
      lastEvent: null,
      finishReason: null,
      wave: 5,
      maxWave: 6,
      waveEndsAt: Date.now() + 10_000,
      waveTarget: 30,
      waveTheme: 'pressure',
      pulseEnergyCost: 28,
      overchargeEnergyCost: 52,
      nodes: [],
      pulses: [],
      effects: [],
      me: {
        cooldownUntil: 0,
        combo: 0,
        comboUntil: 0,
        score: 0,
        energy: 80,
        maxEnergy: 100,
        waveHits: 7,
        wavesCleared: 1,
      },
      players: { p1: player, p2: { ...player, x: 15 } },
    };
    const { sendAction } = renderGame(blackBlastClient, state);
    expect(screen.getByText(/Wave 5\/6 · pressure/)).toBeInTheDocument();
    expect(screen.getByText('Target 7/30')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Drop overcharged pulse' }));
    expect(sendAction).toHaveBeenCalledWith({ type: 'pulse', payload: { mode: 'overcharge' } });
  });

  it('renders Ludo capture feedback and moves only a server-listed token', async () => {
    const grid = Array.from({ length: 52 }, (_entry, index) => ({
      x: index % 15,
      y: Math.floor(index / 15),
    }));
    const tokens = Array.from({ length: 4 }, (_entry, index) => ({
      id: `red-${index}`,
      seatIndex: 0,
      progress: index === 0 ? 5 : -1,
      cell: index === 0 ? 5 : null,
      gridCell: index === 0 ? grid[5] : { x: 2 + (index % 2), y: 2 + Math.floor(index / 2) },
      kind: index === 0 ? 'track' : 'yard',
      finished: false,
    }));
    const state = {
      phase: 'awaiting-move',
      currentPlayerId: 'p1',
      dice: 3,
      legalMoves: [
        {
          tokenId: 'red-0',
          from: 5,
          to: 8,
          capturesTokenId: null,
          entersBoard: false,
          reachesHome: false,
          toCell: grid[8],
        },
      ],
      winnerIds: [],
      rankings: [],
      turnOrder: ['p1', 'p2'],
      tokensToWin: 4,
      finishedOrder: [],
      consecutiveSixes: 0,
      boardSize: 15,
      turnEndsAt: Date.now() + 20_000,
      serverTime: Date.now(),
      lastEvent: 'capture:p1:red-0:green-0',
      finishReason: null,
      trackLength: 52,
      laneStart: 51,
      homeStretchLength: 5,
      homeEntryIndex: { 0: 50, 1: 11, 2: 24, 3: 37 },
      finishDistance: 56,
      tokensPerPlayer: 4,
      safeIndices: [0, 13, 26, 39],
      startIndex: [0, 13, 26, 39],
      trackCells: grid,
      homeStretchCells: Array.from({ length: 4 }, () =>
        Array.from({ length: 5 }, (_x, i) => ({ x: 7, y: 1 + i })),
      ),
      yardCells: [
        [
          { x: 1, y: 1 },
          { x: 4, y: 1 },
          { x: 1, y: 4 },
          { x: 4, y: 4 },
        ],
        [
          { x: 10, y: 1 },
          { x: 13, y: 1 },
          { x: 10, y: 4 },
          { x: 13, y: 4 },
        ],
        [
          { x: 10, y: 10 },
          { x: 13, y: 10 },
          { x: 10, y: 13 },
          { x: 13, y: 13 },
        ],
        [
          { x: 1, y: 10 },
          { x: 4, y: 10 },
          { x: 1, y: 13 },
          { x: 4, y: 13 },
        ],
      ],
      lastRoll: { playerId: 'p1', value: 3, playable: true },
      lastMove: {
        id: 3,
        playerId: 'p1',
        tokenId: 'red-0',
        from: 2,
        to: 5,
        path: [3, 4, 5],
        cells: [grid[3], grid[4], grid[5]],
        captured: 'green-0',
        capturedFrom: 44,
        capturedFromCell: grid[44],
      },
      players: {
        p1: {
          color: 'red',
          seatIndex: 0,
          tokens,
          finishedTokens: 0,
          captures: 1,
          score: 25,
          rank: 0,
          disconnected: false,
          left: false,
        },
        p2: {
          color: 'green',
          seatIndex: 1,
          tokens: Array.from({ length: 4 }, (_e, i) => ({
            id: `green-${i}`,
            seatIndex: 1,
            progress: -1,
            cell: null,
            finished: false,
          })),
          finishedTokens: 0,
          captures: 0,
          score: 0,
          rank: 0,
          disconnected: false,
          left: false,
        },
      },
    } as LudoPublicState;
    const { sendAction } = renderGame(ludoClient, state);
    expect(screen.getByText('Token captured — bonus roll!')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Move token red-0' }));
    expect(sendAction).toHaveBeenCalledWith({ type: 'move', payload: { tokenId: 'red-0' } });
  });
});
