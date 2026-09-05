/**
 * Procedural Web Audio sound design.
 *
 * Every sound is synthesised at runtime (oscillators + envelopes), so the
 * platform ships with zero audio assets and zero licensing concerns.
 */
export type SoundName =
  | 'hover'
  | 'click'
  | 'modalOpen'
  | 'modalClose'
  | 'notification'
  | 'roomCreated'
  | 'roomJoined'
  | 'playerJoined'
  | 'allReady'
  | 'playerLeft'
  | 'countdown'
  | 'gameStart'
  | 'correct'
  | 'wrong'
  | 'score'
  | 'timerWarning'
  | 'gameOver'
  | 'victory'
  | 'defeat'
  | 'draw';

export interface ToneSpec {
  freq: number;
  /** Optional glide target. */
  to?: number;
  duration: number;
  type?: OscillatorType;
  gain?: number;
  delay?: number;
  /** Low-pass filter cutoff for softer tones. */
  filter?: number;
}

const NOTE = (semitonesFromA4: number): number => 440 * Math.pow(2, semitonesFromA4 / 12);

const TONES: Record<SoundName, ToneSpec[]> = {
  hover: [{ freq: NOTE(7), duration: 0.06, type: 'sine', gain: 0.06 }],
  click: [
    { freq: NOTE(4), duration: 0.09, type: 'triangle', gain: 0.16 },
    { freq: NOTE(11), duration: 0.06, type: 'sine', gain: 0.08, delay: 0.03 },
  ],
  modalOpen: [
    { freq: NOTE(-5), to: NOTE(2), duration: 0.16, type: 'sine', gain: 0.12 },
  ],
  modalClose: [
    { freq: NOTE(2), to: NOTE(-5), duration: 0.14, type: 'sine', gain: 0.1 },
  ],
  notification: [
    { freq: NOTE(4), duration: 0.1, type: 'sine', gain: 0.12 },
    { freq: NOTE(9), duration: 0.14, type: 'sine', gain: 0.1, delay: 0.08 },
  ],
  roomCreated: [
    { freq: NOTE(0), duration: 0.1, type: 'triangle', gain: 0.14 },
    { freq: NOTE(4), duration: 0.1, type: 'triangle', gain: 0.14, delay: 0.09 },
    { freq: NOTE(7), duration: 0.16, type: 'triangle', gain: 0.16, delay: 0.18 },
  ],
  roomJoined: [
    { freq: NOTE(-3), duration: 0.1, type: 'sine', gain: 0.13 },
    { freq: NOTE(2), duration: 0.16, type: 'sine', gain: 0.14, delay: 0.08 },
  ],
  playerJoined: [
    { freq: NOTE(2), duration: 0.09, type: 'sine', gain: 0.12 },
    { freq: NOTE(9), duration: 0.12, type: 'sine', gain: 0.1, delay: 0.06 },
  ],
  allReady: [
    { freq: NOTE(4), duration: 0.1, type: 'square', gain: 0.07, filter: 1800 },
    { freq: NOTE(11), duration: 0.16, type: 'square', gain: 0.07, filter: 2200, delay: 0.09 },
  ],
  playerLeft: [
    { freq: NOTE(2), to: NOTE(-5), duration: 0.2, type: 'sine', gain: 0.12 },
  ],
  countdown: [{ freq: NOTE(0), duration: 0.14, type: 'triangle', gain: 0.2 }],
  gameStart: [
    { freq: NOTE(-5), duration: 0.1, type: 'sawtooth', gain: 0.09, filter: 1400 },
    { freq: NOTE(4), duration: 0.18, type: 'sawtooth', gain: 0.1, filter: 2000, delay: 0.1 },
    { freq: NOTE(12), duration: 0.22, type: 'sine', gain: 0.14, delay: 0.2 },
  ],
  correct: [
    { freq: NOTE(7), duration: 0.08, type: 'sine', gain: 0.14 },
    { freq: NOTE(12), duration: 0.14, type: 'sine', gain: 0.12, delay: 0.06 },
  ],
  wrong: [
    { freq: NOTE(-2), to: NOTE(-7), duration: 0.22, type: 'sawtooth', gain: 0.1, filter: 900 },
  ],
  score: [
    { freq: NOTE(9), duration: 0.07, type: 'triangle', gain: 0.12 },
    { freq: NOTE(14), duration: 0.12, type: 'triangle', gain: 0.1, delay: 0.05 },
  ],
  timerWarning: [{ freq: NOTE(3), duration: 0.12, type: 'square', gain: 0.07, filter: 1200 }],
  gameOver: [
    { freq: NOTE(0), duration: 0.18, type: 'triangle', gain: 0.14 },
    { freq: NOTE(-4), duration: 0.26, type: 'triangle', gain: 0.14, delay: 0.14 },
  ],
  victory: [
    { freq: NOTE(4), duration: 0.12, type: 'triangle', gain: 0.16 },
    { freq: NOTE(7), duration: 0.12, type: 'triangle', gain: 0.16, delay: 0.11 },
    { freq: NOTE(11), duration: 0.14, type: 'triangle', gain: 0.16, delay: 0.22 },
    { freq: NOTE(16), duration: 0.3, type: 'triangle', gain: 0.18, delay: 0.33 },
  ],
  defeat: [
    { freq: NOTE(2), duration: 0.16, type: 'sine', gain: 0.14 },
    { freq: NOTE(-1), duration: 0.18, type: 'sine', gain: 0.13, delay: 0.14 },
    { freq: NOTE(-6), duration: 0.34, type: 'sine', gain: 0.14, delay: 0.3 },
  ],
  draw: [
    { freq: NOTE(0), duration: 0.16, type: 'sine', gain: 0.13 },
    { freq: NOTE(0), duration: 0.24, type: 'sine', gain: 0.12, delay: 0.16 },
  ],
};

export function soundSpec(name: SoundName): ToneSpec[] {
  return TONES[name];
}

export const ALL_SOUNDS = Object.keys(TONES) as SoundName[];
