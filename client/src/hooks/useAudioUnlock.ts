import { useEffect } from 'react';
import { audioManager } from '../audio/AudioManager';
import { hapticsManager } from '../haptics/HapticsManager';
import { useSettingsStore } from '../stores/settingsStore';

/**
 * Browsers require a user gesture before audio can play.
 * This installs one-shot global listeners that unlock audio on first interaction.
 */
export function useAudioUnlock(): void {
  const hapticsEnabled = useSettingsStore((state) => state.hapticsEnabled);

  useEffect(() => {
    hapticsManager.setEnabled(hapticsEnabled);
  }, [hapticsEnabled]);

  useEffect(() => {
    if (audioManager.isUnlocked) return;
    const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'touchstart'];
    const unlock = () => audioManager.unlock();
    for (const event of events) {
      window.addEventListener(event, unlock, { once: true, passive: true });
    }
    return () => {
      for (const event of events) window.removeEventListener(event, unlock);
    };
  }, []);
}
