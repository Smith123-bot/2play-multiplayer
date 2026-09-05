import { useCallback } from 'react';
import { audioManager, type AudioSettings } from './AudioManager';
import type { SoundName } from './sounds';

/**
 * React bindings for the AudioManager.
 * `play` is safe to call before the audio context is unlocked — it simply
 * no-ops until the first user gesture unlocks audio.
 */
export function useAudio() {
  const play = useCallback((name: SoundName, options?: { volume?: number }) => {
    audioManager.play(name, options);
  }, []);

  const unlock = useCallback(() => audioManager.unlock(), []);
  const setSettings = useCallback((patch: Partial<AudioSettings>) => audioManager.setSettings(patch), []);
  const settings = audioManager.getSettings();

  return { play, unlock, setSettings, settings, isUnlocked: audioManager.isUnlocked };
}

export { audioManager };
