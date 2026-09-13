import '@testing-library/jest-dom/vitest';

// A failed query prints the whole document. On the Games page that is 45 fully
// rendered cards, and the dump alone took minutes and exhausted the worker, so
// cap it at something still useful for debugging.
process.env.DEBUG_PRINT_LIMIT = process.env.DEBUG_PRINT_LIMIT ?? '3000';

// Minimal browser API stubs for jsdom.
class MockAudioContext {
  public state = 'running';
  public destination = {};
  public currentTime = 0;
  createGain() {
    return {
      gain: {
        value: 1,
        setValueAtTime: () => undefined,
        setTargetAtTime: () => undefined,
        linearRampToValueAtTime: () => undefined,
        exponentialRampToValueAtTime: () => undefined,
      },
      connect: () => undefined,
      disconnect: () => undefined,
    };
  }
  createOscillator() {
    return {
      type: 'sine',
      frequency: { setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined, linearRampToValueAtTime: () => undefined, value: 440 },
      connect: () => undefined,
      start: () => undefined,
      stop: () => undefined,
      onended: null,
    };
  }
  createBiquadFilter() {
    return { type: 'lowpass', frequency: { value: 800 }, connect: () => undefined };
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
}

Object.defineProperty(window, 'AudioContext', { writable: true, value: MockAudioContext });
Object.defineProperty(globalThis, 'AudioContext', { writable: true, value: MockAudioContext });

// jsdom *defines* window.scrollTo but throws "Not implemented" when it is
// called. framer-motion's keyframe resolver calls it for every animated
// element on every frame, which floods the output and makes suites crawl, so
// replace it outright rather than only filling a gap.
window.scrollTo = (() => undefined) as unknown as typeof window.scrollTo;

if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}
