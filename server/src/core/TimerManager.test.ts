import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimerManager } from './TimerManager';

describe('TimerManager', () => {
  let timers: TimerManager;

  beforeEach(() => {
    timers = new TimerManager();
  });

  afterEach(() => {
    timers.dispose();
  });

  it('runs a one-shot timer and cleans itself up', async () => {
    const onComplete = vi.fn();
    const id = timers.create({ roomId: 'ROOM1', type: 'turn', delayMs: 20, onComplete });
    expect(timers.activeCount).toBe(1);
    expect(timers.getRemaining(id)).toBeGreaterThan(0);

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(timers.activeCount).toBe(0);
    expect(timers.getRemaining(id)).toBeNull();
  });

  it('never invokes onComplete when a timer is cancelled', async () => {
    const onComplete = vi.fn();
    const id = timers.create({ roomId: 'ROOM1', type: 'gameDuration', delayMs: 20, onComplete });
    expect(timers.cancel(id)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(onComplete).not.toHaveBeenCalled();
    expect(timers.cancel(id)).toBe(false);
  });

  it('de-duplicates timers by (room, type, key)', () => {
    const first = vi.fn();
    const second = vi.fn();
    const idA = timers.create({ roomId: 'R', type: 'countdown', key: 'start', delayMs: 50, onComplete: first });
    const idB = timers.create({ roomId: 'R', type: 'countdown', key: 'start', delayMs: 50, onComplete: second });
    expect(idA).not.toBe(idB);
    expect(timers.activeCount).toBe(1);
    // Cancelled timers never fire (this is what prevents double countdowns).
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });

  it('cancels every timer of a room', () => {
    timers.create({ roomId: 'A', type: 'turn', delayMs: 5000, key: 'a1' });
    timers.create({ roomId: 'A', type: 'turn', delayMs: 5000, key: 'a2' });
    timers.create({ roomId: 'B', type: 'turn', delayMs: 5000, key: 'b1' });

    expect(timers.cancelAllForRoom('A')).toBe(2);
    expect(timers.activeCount).toBe(1);
    expect(timers.timersForRoom('A')).toHaveLength(0);
    expect(timers.timersForRoom('B')).toHaveLength(1);
  });

  it('cancels by type and reports remaining time', async () => {
    timers.create({ roomId: 'R', type: 'rematch', key: 'vote', delayMs: 500, intervalMs: 100 });
    expect(timers.has('R', 'rematch', 'vote')).toBe(true);
    expect(timers.getRemainingByKey('R', 'rematch', 'vote')).toBeGreaterThan(0);
    expect(timers.cancelByType('R', 'rematch')).toBe(1);
    expect(timers.has('R', 'rematch', 'vote')).toBe(false);
  });

  it('keeps interval timers running until cancelled when durationMs is omitted', async () => {
    const onTick = vi.fn();
    const onComplete = vi.fn();
    timers.create({
      roomId: 'R',
      type: 'turn',
      delayMs: 25,
      intervalMs: 25,
      key: 'update-loop',
      onTick,
      onComplete,
    });
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(onTick.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(onComplete).not.toHaveBeenCalled();
    expect(timers.activeCount).toBe(1);
    expect(timers.cancelByKey('R', 'turn', 'update-loop')).toBe(true);
    expect(onComplete).not.toHaveBeenCalled();
    expect(timers.activeCount).toBe(0);
  });

  it('ticks interval timers and completes at the deadline', async () => {
    const onTick = vi.fn();
    const onComplete = vi.fn();
    timers.create({
      roomId: 'R',
      type: 'countdown',
      delayMs: 30,
      intervalMs: 30,
      durationMs: 120,
      key: 'tick',
      onTick,
      onComplete,
    });
    await new Promise((resolve) => setTimeout(resolve, 220));
    expect(onTick.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(onComplete).toHaveBeenCalledTimes(1);
    const info = onComplete.mock.calls[0]?.[0] as { cancelled: boolean };
    expect(info.cancelled).toBe(false);
  });
});
