import { useEffect, useMemo, useRef, useState } from 'react';
import { useConnectionStore } from '../stores/connectionStore';

/**
 * Client-side mirror of a server deadline.
 *
 * The server remains authoritative (it decides when a timer expires); this hook
 * only renders the remaining time smoothly using requestAnimationFrame.
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
    const tick = () => {
      if (!active) return;
      const next = Math.max(0, deadline - serverNow());
      setRemaining(next);
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
