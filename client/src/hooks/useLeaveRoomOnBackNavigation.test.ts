import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLeaveRoomOnBackNavigation } from './useLeaveRoomOnBackNavigation';

/**
 * Spec: "PHONE BACK BUTTON MUST LEAVE ACTIVE ROOM" — a popstate (which the
 * phone/browser back button fires) while inside a room must trigger an
 * intentional leave; while inactive (no room, or unmounted) it must not.
 */
describe('useLeaveRoomOnBackNavigation', () => {
  it('calls the exit handler on a back/popstate navigation while active', () => {
    const onExit = vi.fn();
    renderHook(() => useLeaveRoomOnBackNavigation(true, onExit));

    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('does nothing when not active (no active room)', () => {
    const onExit = vi.fn();
    renderHook(() => useLeaveRoomOnBackNavigation(false, onExit));

    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(onExit).not.toHaveBeenCalled();
  });

  it('removes its listener on unmount — no leaked/duplicate handlers', () => {
    const onExit = vi.fn();
    const { unmount } = renderHook(() => useLeaveRoomOnBackNavigation(true, onExit));

    unmount();
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(onExit).not.toHaveBeenCalled();
  });

  it('always calls the latest handler, never a stale closure', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ handler }) => useLeaveRoomOnBackNavigation(true, handler), {
      initialProps: { handler: first },
    });

    rerender({ handler: second });
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
