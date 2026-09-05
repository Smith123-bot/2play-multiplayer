import { useCallback } from 'react';
import { hapticsManager, type HapticPattern } from './HapticsManager';

export function useHaptics() {
  const vibrate = useCallback((pattern: HapticPattern) => hapticsManager.trigger(pattern), []);
  return { vibrate, isSupported: hapticsManager.isSupported(), isEnabled: hapticsManager.isEnabled() };
}

export { hapticsManager };
