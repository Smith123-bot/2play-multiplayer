import { beforeEach, describe, expect, it, vi } from 'vitest';
import { audioManager } from './AudioManager';
import { ALL_SOUNDS } from './sounds';

describe('AudioManager', () => {
  beforeEach(() => {
    audioManager.setSettings({ muted: false, masterVolume: 0.8, sfxVolume: 0.9, musicVolume: 0 });
    audioManager.dispose();
  });

  it('does nothing before the first user gesture', () => {
    expect(audioManager.isUnlocked).toBe(false);
    expect(() => audioManager.play('click')).not.toThrow();
  });

  it('unlocks on a user gesture and plays procedural sounds', () => {
    audioManager.unlock();
    expect(audioManager.isUnlocked).toBe(true);
    for (const sound of ALL_SOUNDS) {
      expect(() => audioManager.play(sound)).not.toThrow();
    }
  });

  it('respects the mute switch', () => {
    audioManager.unlock();
    audioManager.setSettings({ muted: true });
    expect(audioManager.getSettings().muted).toBe(true);
    expect(() => audioManager.play('victory')).not.toThrow();
    audioManager.setSettings({ muted: false });
  });

  it('stores volume settings', () => {
    audioManager.setSettings({ sfxVolume: 0.25 });
    expect(audioManager.getSettings().sfxVolume).toBe(0.25);
  });

  it('survives repeated disposals', () => {
    audioManager.unlock();
    audioManager.dispose();
    audioManager.dispose();
    expect(audioManager.isUnlocked).toBe(false);
    expect(() => audioManager.play('click')).not.toThrow();
  });
});

describe('sound catalogue', () => {
  it('covers every documented sound', () => {
    expect(ALL_SOUNDS).toContain('victory');
    expect(ALL_SOUNDS).toContain('countdown');
    expect(ALL_SOUNDS.length).toBeGreaterThan(15);
  });

  it('never references audio files', () => {
    const source = ALL_SOUNDS.join(',');
    expect(source).not.toContain('.mp3');
    expect(source).not.toContain('.wav');
    expect(vi.isMockFunction(audioManager.play)).toBe(false);
  });
});
