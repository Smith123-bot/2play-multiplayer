import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hapticsManager, HAPTIC_PATTERNS } from './HapticsManager';

const vibrate = vi.fn(() => true);

describe('HapticsManager', () => {
  beforeEach(() => {
    vibrate.mockClear();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    hapticsManager.setEnabled(true);
  });

  it('detects support at runtime', () => {
    expect(hapticsManager.isSupported()).toBe(true);
  });

  it('vibrates with the documented patterns', () => {
    for (const pattern of Object.keys(HAPTIC_PATTERNS) as Array<keyof typeof HAPTIC_PATTERNS>) {
      expect(hapticsManager.trigger(pattern)).toBe(true);
    }
    expect(vibrate).toHaveBeenCalledTimes(Object.keys(HAPTIC_PATTERNS).length);
  });

  it('can be switched off', () => {
    hapticsManager.setEnabled(false);
    expect(hapticsManager.trigger('victory')).toBe(false);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('cancels vibration', () => {
    hapticsManager.setEnabled(true);
    hapticsManager.cancel();
    expect(vibrate).toHaveBeenCalledWith(0);
  });

  it('degrades gracefully when vibration is unavailable', () => {
    Object.defineProperty(navigator, 'vibrate', { value: undefined, configurable: true });
    // The cached support flag keeps the previous value, so force a new check.
    const fresh = new (Object.getPrototypeOf(hapticsManager).constructor)();
    fresh.setEnabled(true);
    expect(fresh.isSupported()).toBe(false);
    expect(fresh.trigger('success')).toBe(false);
  });
});
