import { create } from 'zustand';
import { STORAGE_KEYS } from '../core/config';
import { readJson, writeJson } from '../utils/storage';
import { audioManager, type AudioSettings } from '../audio/AudioManager';
import { hapticsManager } from '../haptics/HapticsManager';

export type ThemeMode = 'dark' | 'light';

export interface SettingsState {
  theme: ThemeMode;
  audio: AudioSettings;
  hapticsEnabled: boolean;
  reduceMotion: boolean;
  showConnectionBanner: boolean;
  setTheme: (theme: ThemeMode) => void;
  setAudio: (patch: Partial<AudioSettings>) => void;
  setHaptics: (enabled: boolean) => void;
  setReduceMotion: (value: boolean) => void;
  toggleMute: () => void;
  reset: () => void;
}

interface PersistedSettings {
  theme: ThemeMode;
  audio: AudioSettings;
  hapticsEnabled: boolean;
  reduceMotion: boolean;
}

const DEFAULTS: PersistedSettings = {
  theme: 'dark',
  audio: { masterVolume: 0.8, sfxVolume: 0.9, musicVolume: 0.25, muted: false },
  hapticsEnabled: true,
  reduceMotion: false,
};

const persisted = readJson<PersistedSettings>(STORAGE_KEYS.settings, DEFAULTS);

function persist(state: PersistedSettings): void {
  writeJson(STORAGE_KEYS.settings, state);
}

/** Applies settings to the imperative managers (audio/haptics/theme). */
function apply(state: PersistedSettings): void {
  audioManager.setSettings(state.audio);
  hapticsManager.setEnabled(state.hapticsEnabled);
  const root = document.documentElement;
  root.classList.toggle('dark', state.theme !== 'light');
  root.classList.toggle('light', state.theme === 'light');
  root.style.colorScheme = state.theme;
}

export const useSettingsStore = create<SettingsState>((set, get) => {
  const initial: PersistedSettings = {
    ...DEFAULTS,
    ...persisted,
    audio: { ...DEFAULTS.audio, ...(persisted.audio ?? {}) },
  };

  return {
    theme: initial.theme,
    audio: initial.audio,
    hapticsEnabled: initial.hapticsEnabled,
    reduceMotion: initial.reduceMotion,
    showConnectionBanner: true,

    setTheme: (theme) => {
      const next = { ...get(), theme } as PersistedSettings;
      persist({ theme: next.theme, audio: next.audio, hapticsEnabled: next.hapticsEnabled, reduceMotion: next.reduceMotion });
      apply(next);
      set({ theme });
    },

    setAudio: (patch) => {
      const audio = { ...get().audio, ...patch };
      const next = { ...get(), audio } as PersistedSettings;
      persist(next);
      apply(next);
      set({ audio });
    },

    setHaptics: (hapticsEnabled) => {
      const next = { ...get(), hapticsEnabled } as PersistedSettings;
      persist(next);
      apply(next);
      set({ hapticsEnabled });
    },

    setReduceMotion: (reduceMotion) => {
      const next = { ...get(), reduceMotion } as PersistedSettings;
      persist(next);
      set({ reduceMotion });
    },

    toggleMute: () => get().setAudio({ muted: !get().audio.muted }),

    reset: () => {
      persist(DEFAULTS);
      apply(DEFAULTS);
      set({ ...DEFAULTS });
    },
  };
});

// Apply once at module load (theme + audio/haptics preferences).
apply({
  theme: useSettingsStore.getState().theme,
  audio: useSettingsStore.getState().audio,
  hapticsEnabled: useSettingsStore.getState().hapticsEnabled,
  reduceMotion: useSettingsStore.getState().reduceMotion,
});
