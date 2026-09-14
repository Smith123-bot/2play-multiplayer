import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomState } from '@2play/shared';
import { REVEAL_HOLD_MS, useGameEndReveal } from './useGameEndReveal';

type Status = RoomState['status'];
const initial = { status: 'PLAYING' as Status };

/**
 * The platform-wide GAME-END REVEAL: PLAYING -> result must hold the final
 * board on screen for a short, fixed window before the result panel replaces
 * it — long enough to see the decisive moment, short enough not to stall.
 */

describe('useGameEndReveal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('holds the reveal when a live match flips to a result status', () => {
    const { result, rerender } = renderHook(({ status }) => useGameEndReveal(status), {
      initialProps: initial,
    });
    expect(result.current).toBe(false);

    act(() => rerender({ status: 'RESULT' }));
    expect(result.current).toBe(true);

    // The hold expires by itself — the flow never stalls on it.
    act(() => vi.advanceTimersByTime(REVEAL_HOLD_MS + 10));
    expect(result.current).toBe(false);
  });

  it('holds for every result status but not for non-result transitions', () => {
    const { result, rerender } = renderHook(({ status }) => useGameEndReveal(status), {
      initialProps: initial,
    });

    for (const status of ['GAME_FINISHED', 'RESULT', 'REMATCH_WAITING'] as const) {
      act(() => rerender({ status: 'PLAYING' }));
      act(() => rerender({ status }));
      expect(result.current).toBe(true);
    }

    // PLAYING -> PLAYING (snapshot refresh) and -> lobby statuses never hold.
    act(() => rerender({ status: 'PLAYING' }));
    act(() => rerender({ status: 'LOBBY' }));
    expect(result.current).toBe(false);
  });

  it('does not hold when mounting straight onto the result screen', () => {
    const { result } = renderHook(() => useGameEndReveal('RESULT'));
    expect(result.current).toBe(false);
  });

  it('clears an active hold if the room leaves the result status early', () => {
    const { result, rerender } = renderHook(({ status }) => useGameEndReveal(status), {
      initialProps: initial,
    });
    act(() => rerender({ status: 'RESULT' }));
    expect(result.current).toBe(true);

    // Rematch accepted mid-reveal: back to play, hold must drop immediately.
    act(() => rerender({ status: 'PLAYING' }));
    expect(result.current).toBe(false);
  });
});
