import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Player, RoomState } from '@2play/shared';
import type { GameComponentProps } from './registry/types';
import { blackBlastClient, type BlastPublicState } from './black-blast';
import { brickBreakerClient, type BrickBreakerPublicState } from './brick-breaker-battle';
import { ludoClient, type LudoPublicState } from './ludo';
import { paddleDuelClient, type PaddleDuelPublicState } from './paddle-duel';

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

  it('renders sequenced Paddle Duel controls and authoritative trajectory feedback', async () => {
    const paddle = {
      side: 'left' as const,
      y: 30,
      dir: 0,
      latestInputSeq: 12,
      score: 1,
      rallies: 3,
      bestRally: 3,
      pointStreak: 1,
      disconnected: false,
      left: false,
    };
    const state: PaddleDuelPublicState = {
      phase: 'playing',
      width: 100,
      height: 60,
      paddleWidth: 2,
      paddleHeight: 12,
      ballRadius: 1,
      ball: { x: 50, y: 20, vx: 40, vy: -10 },
      serveAt: null,
      servingTo: null,
      rallyHits: 3,
      pointNumber: 1,
      lastHit: null,
      lastImpact: { id: 4, kind: 'wall', x: 40, y: 1, at: Date.now() },
      scoreLimit: 7,
      startedAt: Date.now(),
      endsAt: Date.now() + 30_000,
      finishReason: null,
      lastEvent: 'wall',
      serverTime: Date.now(),
      paddles: { p1: paddle, p2: { ...paddle, side: 'right', latestInputSeq: 2 } },
    };
    const { sendAction } = renderGame(paddleDuelClient, state);
    await userEvent.pointer({
      keys: '[MouseLeft>]',
      target: screen.getByRole('button', { name: 'Move paddle up' }),
    });
    expect(sendAction).toHaveBeenCalledWith({
      type: 'move',
      payload: { direction: 'up', sequence: 13 },
    });
    expect(screen.getByText('Rally 3')).toBeInTheDocument();
  });

  it('renders Brick Breaker durability/layout progress and sends reconnect-safe input', async () => {
    const durability = Array(28).fill(1) as number[];
    durability[0] = 2;
    const arena = {
      paddleX: 50,
      paddleDir: 0,
      latestInputSeq: 8,
      ball: { x: 50, y: 40, vx: 10, vy: -30 },
      launchAt: null,
      bricks: Array(28).fill(true) as boolean[],
      brickHp: durability,
      brickMaxHp: durability,
      levelBrickCount: 28,
      lastImpact: null,
      destroyed: 4,
      chain: 2,
      level: 2,
      levelsCleared: 1,
      paddleScale: 1,
      powerUp: null,
      powerUpUntil: 0,
      lives: 3,
      score: 220,
      bricksBroken: 32,
      done: false,
      doneAt: null,
      disconnected: false,
      left: false,
    };
    const state: BrickBreakerPublicState = {
      phase: 'playing',
      width: 100,
      height: 70,
      paddleWidth: 16,
      paddleHeight: 2,
      paddleY: 66,
      ballRadius: 1,
      brickCols: 7,
      brickRows: 4,
      brickValues: [30, 20, 15, 10],
      clearBonus: 100,
      maxLevels: 3,
      startedAt: Date.now(),
      endsAt: Date.now() + 30_000,
      finishReason: null,
      lastEvent: null,
      serverTime: Date.now(),
      arenas: { p1: arena, p2: { ...arena, latestInputSeq: 1 } },
    };
    const { sendAction } = renderGame(brickBreakerClient, state);
    expect(screen.getAllByLabelText('Brick 1, 2 hits remaining')).toHaveLength(2);
    expect(screen.getByText(/4\/28 wall/)).toBeInTheDocument();
    await userEvent.pointer({
      keys: '[MouseLeft>]',
      target: screen.getByRole('button', { name: 'Move paddle right' }),
    });
    expect(sendAction).toHaveBeenCalledWith({
      type: 'move',
      payload: { direction: 'right', sequence: 9 },
    });
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
      finishDistance: 57,
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
        captured: 'green-0',
        capturedFrom: 44,
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
