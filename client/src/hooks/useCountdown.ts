import { useEffect, useMemo, useRef, useState } from 'react';
import { useConnectionStore } from '../stores/connectionStore';

/**
 * How often the mirrored deadline may trigger a React update.
 *
 * Every consumer displays second- (or coarser) resolution values, but a raw
 * rAF loop re-rendered mounted timers at display refresh rate (60-120 Hz) —
 * measurable CPU on low-end mobile for pixel-identical output. 10 Hz keeps
 * countdowns visually smooth (and progress bars fluid) at a tenth of the work.
 */
const UPDATE_INTERVAL_MS = 100;

/**
 * Client-side mirror of a server deadline.
 *
 * The server remains authoritative (it decides when a timer expires); this hook
 * only renders the remaining time smoothly using requestAnimationFrame, rate
 * limited to one state update per UPDATE_INTERVAL_MS.
 */
export function useServerDeadline(deadline: number | null): number {
  const serverNow = useConnectionStore((state) => state.serverNow);
  const [remaining, setRemaining] = useState(() => (deadline ? Math.max(0, deadline - serverNow()) : 0));
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (!deadline) {
      setRemaining(0);
      return;
    }
    let active = true;
    let lastEmit = 0;
    const tick = () => {
      if (!active) return;
      const next = Math.max(0, deadline - serverNow());
      // Throttle to one state update per UPDATE_INTERVAL_MS (the final
      // reach-zero update always passes).
      const now = Date.now();
      if (next === 0 || now - lastEmit >= UPDATE_INTERVAL_MS) {
        lastEmit = now;
        setRemaining(next);
      }
      if (next > 0) frame.current = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      active = false;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [deadline, serverNow]);

  return remaining;
}

/** Formats milliseconds as `m:ss`. */
export function useFormattedRemaining(deadline: number | null): string {
  const remaining = useServerDeadline(deadline);
  return useMemo(() => {
    const totalSeconds = Math.ceil(remaining / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }, [remaining]);
}
