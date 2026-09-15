import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Player, RoomState } from '@2play/shared';
import type { GameComponentProps } from '../registry/types';
import { magnetThiefClient, type MagnetThiefPublicState } from './index';

const players = [
  { id: 'p1', nickname: 'You', avatar: '🦊', seatIndex: 0, score: 0, isHost: true, isReady: true, isConnected: true, isDisconnected: false, isAI: false },
  { id: 'p2', nickname: 'Rival', avatar: '🐼', seatIndex: 1, score: 0, isHost: false, isReady: true, isConnected: true, isDisconnected: false, isAI: false },
] as Player[];

function baseState(): MagnetThiefPublicState {
  return {
    phase: 'playing',
    gems: [{ id: 'gem-0', x: 5, y: 5, ownerId: null, value: 10 }],
    endsAt: null,
    finishReason: null,
    lastEvent: null,
    serverTime: Date.now(),
    width: 18,
    height: 12,
    range: 3,
    cooldown: 2000,
    safeCorners: [{ x: 1.2, y: 1.2 }],
    stage: 1,
    nextStageAt: null,
    obstacles: [],
    lastEffect: null,
    players: {
      p1: { x: 1.2, y: 1.2, facing: { dx: 0, dy: 0 }, score: 0, stolen: 0, carrying: 0, cooldownLeft: 0, inSafe: true, disconnected: false, latestInputSeq: -1 },
      p2: { x: 16.8, y: 1.2, facing: { dx: 0, dy: 0 }, score: 0, stolen: 0, carrying: 0, cooldownLeft: 0, inSafe: true, disconnected: false, latestInputSeq: -1 },
    },
    myCarrying: [],
  };
}

function renderMagnet(state: MagnetThiefPublicState) {
  const sendAction = vi.fn();
  const Component = magnetThiefClient.Component as unknown as ComponentType<
    GameComponentProps<MagnetThiefPublicState>
  >;
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

describe('Magnet Thief client movement', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
  });

  it('streams one step per press with a rising input sequence', () => {
    const sendAction = renderMagnet(baseState());
    const right = screen.getByRole('button', { name: 'Move right' });
    fireEvent.pointerDown(right, { pointerId: 1 });
    fireEvent.pointerUp(right, { pointerId: 1 });
    expect(sendAction).toHaveBeenCalledTimes(1);
    expect(sendAction).toHaveBeenCalledWith({
      type: 'move',
      payload: { dx: 1, dy: 0, sequence: 1 },
    });
  });

  it('holds the D-pad to stream steps and stops on release', () => {
    const sendAction = renderMagnet(baseState());
    const down = screen.getByRole('button', { name: 'Move down' });
    fireEvent.pointerDown(down, { pointerId: 2 });
    expect(sendAction).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(130 * 3);
    expect(sendAction).toHaveBeenCalledTimes(4);
    fireEvent.pointerUp(down, { pointerId: 2 });
    vi.advanceTimersByTime(130 * 3);
    expect(sendAction).toHaveBeenCalledTimes(4);
    // Sequences rise monotonically so the server never sees stale input.
    const sequences = sendAction.mock.calls.map((call) => call[0].payload.sequence);
    expect(sequences).toEqual([1, 2, 3, 4]);
  });

  // jsdom has no PointerEvent, so synthesize pointer events from MouseEvent,
  // which is the only constructor here that carries clientX/clientY.
  const dispatchPointer = (
    target: HTMLElement,
    type: 'pointerdown' | 'pointermove' | 'pointerup',
    init: { clientX?: number; clientY?: number } = {},
  ) => {
    target.dispatchEvent(
      new window.MouseEvent(type, { bubbles: true, cancelable: true, composed: true, ...init }),
    );
  };

  it('steers with an arena drag and ignores short taps', () => {
    const sendAction = renderMagnet(baseState());
    const arena = screen.getByRole('img', { name: 'Magnet arena' });
    dispatchPointer(arena, 'pointerdown', { clientX: 100, clientY: 100 });
    dispatchPointer(arena, 'pointermove', { clientX: 110, clientY: 102 });
    expect(sendAction).not.toHaveBeenCalled();
    dispatchPointer(arena, 'pointermove', { clientX: 200, clientY: 100 });
    expect(sendAction).toHaveBeenCalledWith({
      type: 'move',
      payload: { dx: 1, dy: 0, sequence: 1 },
    });
    dispatchPointer(arena, 'pointerup');
    // Moves after release are ignored until the next press.
    dispatchPointer(arena, 'pointermove', { clientX: 200, clientY: 220 });
    expect(sendAction).toHaveBeenCalledTimes(1);
  });

  it('sends nothing once the match is over', () => {
    const sendAction = renderMagnet({ ...baseState(), phase: 'finished' });
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Move right' }), { pointerId: 1 });
    expect(sendAction).not.toHaveBeenCalled();
  });
});
