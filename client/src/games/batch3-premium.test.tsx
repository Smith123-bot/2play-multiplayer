import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Player, RoomState } from '@2play/shared';
import type { GameComponentProps } from './registry/types';
import { magnetThiefClient, type MagnetThiefPublicState } from './magnet-thief';
import { coupleSyncClient, type CoupleSyncPublicState } from './couple-sync';
import { mazeRaceClient, type MazeRacePublicState } from './maze-race-2d';
import { patternMemoryClient, type PatternMemoryPublicState } from './pattern-memory-battle';

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
    nickname: 'Partner',
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

const now = Date.now();

describe('Batch 3 premium game clients', () => {
  it('renders Magnet Thief stages, obstacles and both field actions', async () => {
    const player = {
      x: 2,
      y: 2,
      score: 10,
      stolen: 1,
      carrying: 1,
      cooldownLeft: 0,
      latestInputSeq: -1,
      inSafe: false,
      disconnected: false,
    };
    const state = {
      phase: 'playing',
      gems: [{ id: 'g1', x: 3, y: 2, ownerId: 'p1', value: 10 }],
      endsAt: now + 20_000,
      finishReason: null,
      lastEvent: null,
      serverTime: now,
      width: 18,
      height: 12,
      range: 3.35,
      cooldown: 1700,
      safeCorners: [{ x: 1.5, y: 1.5 }],
      stage: 2,
      nextStageAt: now + 5000,
      obstacles: [{ x: 6, y: 4, radius: 1 }],
      lastEffect: null,
      players: { p1: player, p2: { ...player, x: 16, carrying: 0 } },
      myCarrying: ['g1'],
    } as MagnetThiefPublicState;
    const send = renderGame(magnetThiefClient, state);
    expect(screen.getByText('Stage 2/3')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Repel/ }));
    expect(send).toHaveBeenCalledWith({ type: 'repel', payload: {} });
    await userEvent.click(screen.getByRole('button', { name: 'Move down' }));
    expect(send).toHaveBeenCalledWith({ type: 'move', payload: { dx: 0, dy: 1, sequence: 1 } });
  });

  it('renders Couple Sync partner coordination, tier and match input', async () => {
    const state = {
      phase: 'active',
      round: 3,
      totalRounds: 10,
      teamScore: 240,
      roundsWon: 2,
      streak: 2,
      bestStreak: 2,
      difficultyTier: 2,
      lastEvent: null,
      finishReason: null,
      history: [],
      serverTime: now,
      current: {
        index: 3,
        type: 'match',
        options: ['★', '●', '▲', '■'],
        code: null,
        isCodeHolder: false,
        hasCodeHolder: false,
        requiredOrder: [],
        signalFired: false,
        signalAt: null,
        toleranceMs: 595,
        syncSpreadMs: null,
        endsAt: now + 8000,
        succeeded: null,
        detail: null,
      },
      me: { acted: false, submitted: null, mistakes: 0 },
      players: {
        p1: { acted: false, correct: 2, mistakes: 0, disconnected: false },
        p2: { acted: true, correct: 2, mistakes: 0, disconnected: false },
      },
    } as CoupleSyncPublicState;
    const send = renderGame(coupleSyncClient, state);
    expect(screen.getByText('Tier 2/3')).toBeInTheDocument();
    expect(screen.getByText(/Partner: ready/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Choose ★' }));
    expect(send).toHaveBeenCalledWith({ type: 'act', payload: { choice: '★' } });
  });

  it('renders Maze checkpoints and hazards and sequences movement', async () => {
    const runner = {
      x: 1,
      y: 1,
      steps: 4,
      finished: false,
      finishMs: null,
      disconnected: false,
      checkpointIndex: 1,
      penaltyMs: 1500,
      latestInputSeq: -1,
    };
    const walls = Array(121).fill(false) as boolean[];
    const state = {
      phase: 'playing',
      cols: 11,
      rows: 11,
      walls,
      goal: { x: 9, y: 9 },
      checkpoints: [
        { x: 3, y: 3 },
        { x: 7, y: 7 },
      ],
      hazards: [{ x: 5, y: 5, penaltyMs: 1500 }],
      courseLevel: 1,
      lastEvent: null,
      finishOrder: [],
      startedAt: now,
      endsAt: now + 20_000,
      durationMs: 90_000,
      serverTime: now,
      finishReason: null,
      runners: { p1: runner, p2: { ...runner, x: 2, checkpointIndex: 0, penaltyMs: 0 } },
    } as MazeRacePublicState;
    const send = renderGame(mazeRaceClient, state);
    expect(screen.getByText('Checkpoint 1/2')).toBeInTheDocument();
    expect(screen.getByText('Penalty +1.5s')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Move right' }));
    expect(send).toHaveBeenCalledWith({
      type: 'move',
      payload: { direction: 'right', sequence: 1 },
    });
  });

  it('renders progressive Pattern Memory layouts and sends sequenced taps', async () => {
    const player = {
      progress: 0,
      locked: false,
      succeeded: false,
      mistakes: 0,
      score: 20,
      streak: 1,
      bestStreak: 1,
      latestInputSeq: -1,
      completedRounds: 1,
      disconnected: false,
      left: false,
    };
    const state = {
      phase: 'input',
      round: 3,
      totalRounds: 8,
      patternLength: 4,
      tileCount: 6,
      shown: 4,
      showStepMs: 550,
      inputEndsAt: now + 5000,
      flash: null,
      revealPattern: null,
      history: [],
      players: { p1: player, p2: { ...player, progress: 1 } },
      startedAt: now,
      finishReason: null,
      lastEvent: null,
      serverTime: now,
    } as PatternMemoryPublicState;
    const send = renderGame(patternMemoryClient, state);
    expect(screen.getByText('Layout 3×2')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Tile/ })).toHaveLength(6);
    await userEvent.click(screen.getByRole('button', { name: 'Tile 1' }));
    expect(send).toHaveBeenCalledWith({ type: 'tap', payload: { tile: 0, sequence: 1 } });
  });
});
