export type HapticPattern =
  | 'buttonPress'
  | 'countdown'
  | 'gameStart'
  | 'success'
  | 'error'
  | 'victory'
  | 'defeat';

const PATTERNS: Record<HapticPattern, number | number[]> = {
  buttonPress: 12,
  countdown: 25,
  gameStart: [20, 40, 20],
  success: 30,
  error: [40, 50, 40],
  victory: [30, 60, 30, 60, 90],
  defeat: [90, 60, 120],
};

/**
 * HapticsManager — `navigator.vibrate` when available.
 *
 * Never assumes vibration exists: every call is feature-detected, and the
 * preference can be switched off entirely.
 */
class HapticsManagerImpl {
  private enabled = true;
  private supported: boolean | null = null;

  setEnabled(value: boolean): void {
    this.enabled = value;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isSupported(): boolean {
    if (this.supported !== null) return this.supported;
    this.supported = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
    return this.supported;
  }

  trigger(pattern: HapticPattern): boolean {
    if (!this.enabled) return false;
    if (!this.isSupported()) return false;
    try {
      return navigator.vibrate(PATTERNS[pattern]);
    } catch {
      return false;
    }
  }

  cancel(): void {
    if (!this.isSupported()) return;
    try {
      navigator.vibrate(0);
    } catch {
      /* ignore */
    }
  }
}

export const hapticsManager = new HapticsManagerImpl();
export { PATTERNS as HAPTIC_PATTERNS };
