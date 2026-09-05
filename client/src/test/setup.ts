import '@testing-library/jest-dom/vitest';

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
