import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomState } from '@2play/shared';
import { phaseForRemaining, useMatchCountdown } from './useMatchCountdown';

function room(overrides: Partial<RoomState> = {}): RoomState {
  return {
    id: 'ABCDEF',
    gameId: 'sos-game',
    hostPlayerId: 'p1',
    maxPlayers: 2,
    isPrivate: false,
    status: 'COUNTDOWN',
    players: [],
    countdownValue: 3,
    countdownEndsAt: null,
    matchNumber: 1,
    gameStartedAt: null,
    gameResult: null,
    gameState: null,
    rematchVotes: {},
    rematchDeadline: null,
    settings: { playerCount: 2, aiOpponents: 0, aiDifficulty: 'medium' },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    stateVersion: 1,
    isQuickPlay: false,
    ...overrides,
  } as RoomState;
}

describe('phaseForRemaining', () => {
  it('maps the server-clock remaining time to 3-2-1-GO boundaries', () => {
    expect(phaseForRemaining(3000)).toEqual({ phase: 'COUNTDOWN_3', value: 3 });
    expect(phaseForRemaining(2001)).toEqual({ phase: 'COUNTDOWN_3', value: 3 });
    expect(phaseForRemaining(2000)).toEqual({ phase: 'COUNTDOWN_2', value: 2 });
    expect(phaseForRemaining(1001)).toEqual({ phase: 'COUNTDOWN_2', value: 2 });
    expect(phaseForRemaining(1000)).toEqual({ phase: 'COUNTDOWN_1', value: 1 });
    expect(phaseForRemaining(1)).toEqual({ phase: 'COUNTDOWN_1', value: 1 });
    expect(phaseForRemaining(0)).toEqual({ phase: 'COUNTDOWN_GO', value: 0 });
    expect(phaseForRemaining(-500)).toEqual({ phase: 'COUNTDOWN_GO', value: 0 });
  });
});

describe('useMatchCountdown', () => {
  let frames: FrameRequestCallback[];

  beforeEach(() => {
    vi.useFakeTimers();
    frames = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Advances the fake clock, then runs every queued animation frame. */
  function step(ms: number) {
    act(() => {
      vi.advanceTimersByTime(ms);
      const pending = frames;
      frames = [];
      for (const callback of pending) callback(Date.now());
    });
  }

  it('walks 3-2-1-GO from the authoritative timestamp and hides after GO', () => {
    const endsAt = Date.now() + 2500;
    const { result, rerender } = renderHook(({ state }) => useMatchCountdown(state), {
      initialProps: { state: room({ status: 'COUNTDOWN', countdownEndsAt: endsAt }) },
    });

    step(0);
    expect(result.current).toEqual({ phase: 'COUNTDOWN_3', value: 3, visible: true });

    step(600); // 1900 ms left
    expect(result.current).toEqual({ phase: 'COUNTDOWN_2', value: 2, visible: true });

    step(1000); // 900 ms left
    expect(result.current).toEqual({ phase: 'COUNTDOWN_1', value: 1, visible: true });

    step(1000); // past GO
    expect(result.current).toEqual({ phase: 'COUNTDOWN_GO', value: 0, visible: true });

    // The match starts: GO holds briefly, then gameplay takes over.
    act(() => rerender({ state: room({ status: 'PLAYING', countdownEndsAt: endsAt }) }));
    step(0);
    expect(result.current.visible).toBe(true);
    expect(result.current.value).toBe(0);

    step(1000);
    expect(result.current).toEqual({ phase: 'PLAYING', value: 0, visible: false });
  });

  it('stays hidden outside countdown and gameplay-start states', () => {
    const { result } = renderHook(() => useMatchCountdown(room({ status: 'LOBBY' })));
    step(0);
    expect(result.current.visible).toBe(false);
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
  });

  it('falls back to the snapshot value when the timestamp is missing', () => {
    const { result } = renderHook(() =>
      useMatchCountdown(room({ status: 'COUNTDOWN', countdownEndsAt: null, countdownValue: 2 })),
    );
    step(0);
    expect(result.current).toEqual({ phase: 'COUNTDOWN_2', value: 2, visible: true });
  });

  it('cancels its animation frame on unmount', () => {
    const endsAt = Date.now() + 2500;
    const { unmount } = renderHook(() =>
      useMatchCountdown(room({ status: 'COUNTDOWN', countdownEndsAt: endsAt })),
    );
    step(0);
    expect(window.requestAnimationFrame).toHaveBeenCalled();
    unmount();
    expect(window.cancelAnimationFrame).toHaveBeenCalled();
  });
});
