import { soundSpec, type SoundName, type ToneSpec } from './sounds';

export interface AudioSettings {
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  muted: boolean;
}

const DEFAULT_SETTINGS: AudioSettings = {
  masterVolume: 0.8,
  sfxVolume: 0.9,
  musicVolume: 0.25,
  muted: false,
};

/**
 * AudioManager — procedural Web Audio playback.
 *
 * Browsers block audio until a user gesture, so the context is created lazily
 * on the first interaction (`unlock()`), which the app calls on first tap/click.
 */
class AudioManagerImpl {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private settings: AudioSettings = { ...DEFAULT_SETTINGS };
  private musicTimer: number | null = null;
  private musicStep = 0;
  private unlocked = false;

  getSettings(): AudioSettings {
    return { ...this.settings };
  }

  setSettings(patch: Partial<AudioSettings>): void {
    this.settings = { ...this.settings, ...patch };
    this.applyGains();
    if (this.settings.muted || this.settings.musicVolume <= 0) this.stopMusic();
    else if (this.unlocked) this.startMusic();
  }

  /** Must be called from a user gesture handler (tap / click / keydown). */
  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    this.ensureContext();
    if (!this.settings.muted && this.settings.musicVolume > 0) this.startMusic();
  }

  get isUnlocked(): boolean {
    return this.unlocked;
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    }
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;

    try {
      this.ctx = new Ctor();
    } catch {
      return null;
    }

    this.masterGain = this.ctx.createGain();
    this.sfxGain = this.ctx.createGain();
    this.musicGain = this.ctx.createGain();
    this.sfxGain.connect(this.masterGain);
    this.musicGain.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);
    this.applyGains();
    return this.ctx;
  }

  private applyGains(): void {
    if (!this.masterGain || !this.sfxGain || !this.musicGain) return;
    const { masterVolume, sfxVolume, musicVolume, muted } = this.settings;
    const now = this.ctx?.currentTime ?? 0;
    this.masterGain.gain.setTargetAtTime(muted ? 0 : masterVolume, now, 0.02);
    this.sfxGain.gain.setTargetAtTime(sfxVolume, now, 0.02);
    this.musicGain.gain.setTargetAtTime(musicVolume * 0.4, now, 0.05);
  }

  play(name: SoundName, options: { volume?: number } = {}): void {
    if (this.settings.muted) return;
    if (!this.unlocked) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;

    const scale = options.volume ?? 1;
    for (const spec of soundSpec(name)) this.playTone(spec, scale);
  }

  private playTone(spec: ToneSpec, scale: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxGain) return;

    const startAt = ctx.currentTime + (spec.delay ?? 0);
    const duration = Math.max(0.03, spec.duration);
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = spec.type ?? 'sine';
    oscillator.frequency.setValueAtTime(spec.freq, startAt);
    if (spec.to !== undefined) {
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, spec.to), startAt + duration);
    }

    const peak = Math.max(0.0001, (spec.gain ?? 0.12) * scale);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(peak, startAt + Math.min(0.02, duration / 3));
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

    let node: AudioNode = oscillator;
    if (spec.filter !== undefined && typeof ctx.createBiquadFilter === 'function') {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = spec.filter;
      node.connect(filter);
      node = filter;
    }
    node.connect(gain);
    gain.connect(this.sfxGain);

    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.02);
    oscillator.onended = () => {
      try {
        gain.disconnect();
        oscillator.disconnect();
      } catch {
        /* already disconnected */
      }
    };
  }

  /** Gentle procedural ambient loop (no assets, no licensing). */
  private startMusic(): void {
    if (this.musicTimer !== null) return;
    const chords = [
      [0, 4, 7],
      [-3, 2, 5],
      [-5, 0, 4],
      [-1, 3, 7],
    ];
    const tick = () => {
      const chord = chords[this.musicStep % chords.length];
      this.musicStep += 1;
      const ctx = this.ctx;
      if (!ctx || !this.musicGain) return;
      const startAt = ctx.currentTime;
      chord.forEach((semitone, index) => {
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = 'sine';
        const freq = 220 * Math.pow(2, semitone / 12);
        oscillator.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(0.05, startAt + 0.6);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 2.6);
        oscillator.connect(gain);
        gain.connect(this.musicGain as GainNode);
        oscillator.start(startAt + index * 0.05);
        oscillator.stop(startAt + 2.7);
        oscillator.onended = () => {
          try {
            gain.disconnect();
            oscillator.disconnect();
          } catch {
            /* no-op */
          }
        };
      });
    };
    tick();
    this.musicTimer = window.setInterval(tick, 2800);
  }

  private stopMusic(): void {
    if (this.musicTimer !== null) {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  dispose(): void {
    this.stopMusic();
    void this.ctx?.close();
    this.ctx = null;
    this.masterGain = null;
    this.sfxGain = null;
    this.musicGain = null;
    this.unlocked = false;
  }
}

export const audioManager = new AudioManagerImpl();
