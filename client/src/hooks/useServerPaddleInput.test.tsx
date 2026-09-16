import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useServerPaddleInput } from './useServerPaddleInput';

type InputOptions = Parameters<typeof useServerPaddleInput>[0];

type Action = Parameters<NonNullable<InputOptions['sendAction']>>[0];

function makeOptions(overrides: Partial<InputOptions> = {}): InputOptions {
  return {
    canPlay: true,
    axis: 'y',
    paddlePosition: 50,
    paddleSize: 10,
    arenaSize: 100,
    negativeDirection: 'negative',
    positiveDirection: 'positive',
    latestInputSeq: -1,
    sendAction: vi.fn().mockResolvedValue(true),
    vibrate: vi.fn(),
    ...overrides,
  };
}

function directions(sendAction: ReturnType<typeof vi.fn>): string[] {
  return sendAction.mock.calls.map((call) => {
    const action = call[0] as Action;
    return action.payload?.direction as string;
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('useServerPaddleInput', () => {
  it('keeps keyboard listeners stable across snapshots and sends a sequenced release', () => {
    const sendAction = vi.fn().mockResolvedValue(true);
    const vibrate = vi.fn();
    const options = makeOptions({ sendAction, vibrate });
    const { rerender, unmount } = renderHook(
      (props: InputOptions) => useServerPaddleInput(props),
      { initialProps: options },
    );

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w' }));
    });
    expect(directions(sendAction)).toEqual(['up']);
    expect(sendAction.mock.calls[0]?.[0].payload?.sequence).toBe(1);
    expect(vibrate).toHaveBeenCalledWith('buttonPress');

    // The parent receives authoritative snapshots and supplies a new haptic
    // callback each render. That must not tear down a held input source.
    rerender({ ...options, paddlePosition: 48, vibrate: vi.fn() });
    expect(directions(sendAction)).toEqual(['up']);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'w' }));
    });
    expect(directions(sendAction)).toEqual(['up', 'stop']);
    expect(sendAction.mock.calls[1]?.[0].payload?.sequence).toBe(2);

    unmount();
    expect(directions(sendAction)).toEqual(['up', 'stop']);
  });

  it('renews a held direction and retries a rejected stop through the action ack', async () => {
    vi.useFakeTimers();
    const sendAction = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    const { unmount } = renderHook(() => useServerPaddleInput(makeOptions({ sendAction })));

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowUp', key: 'ArrowUp' }));
      vi.advanceTimersByTime(160);
    });
    expect(directions(sendAction)).toEqual(['up', 'up']);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowUp', key: 'ArrowUp' }));
    });
    expect(directions(sendAction)).toEqual(['up', 'up', 'stop']);

    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      vi.advanceTimersByTime(160);
    });
    expect(directions(sendAction)).toEqual(['up', 'up', 'stop', 'stop']);

    unmount();
  });

  it('handles arena drag, touch fallback, blur and hidden-tab release', () => {
    const sendAction = vi.fn().mockResolvedValue(true);
    const originalHidden = document.hidden;
    const options = makeOptions({ sendAction });
    const { result, unmount } = renderHook(() => useServerPaddleInput(options));
    const arena = {
      getBoundingClientRect: () => ({ top: 0, left: 0, width: 100, height: 100 }),
      setPointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => true),
    } as unknown as HTMLElement;
    const preventDefault = vi.fn();

    act(() => {
      result.current.onArenaPointerDown({
        pointerId: 1,
        clientX: 50,
        clientY: 10,
        currentTarget: arena,
        preventDefault,
      } as never);
      result.current.onArenaPointerUp({ pointerId: 1 } as never);
    });
    expect(directions(sendAction)).toEqual(['up', 'stop']);
    expect(preventDefault).toHaveBeenCalled();

    const touch = { identifier: 2, clientX: 50, clientY: 90 };
    act(() => {
      result.current.onArenaTouchStart({
        changedTouches: [touch],
        touches: [touch],
        currentTarget: arena,
        preventDefault,
      } as never);
      result.current.onArenaTouchEnd({ changedTouches: [touch] } as never);
      window.dispatchEvent(new Event('blur'));
    });
    expect(directions(sendAction)).toEqual(['up', 'stop', 'down', 'stop']);

    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS', key: 's' }));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(directions(sendAction)).toEqual(['up', 'stop', 'down', 'stop', 'down', 'stop']);

    Object.defineProperty(document, 'hidden', { configurable: true, value: originalHidden });
    unmount();
  });
});
