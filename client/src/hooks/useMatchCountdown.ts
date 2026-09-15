import { useEffect, useRef, useState } from 'react';
import type { RoomState } from '@2play/shared';
import { useConnectionStore } from '../stores/connectionStore';

/**
 * Server-authoritative match countdown state machine.
 *
 * The server owns the GO timestamp (`room.countdownEndsAt`, server clock);
 * this hook only *renders* the phase smoothly. Every player — including slow,
 * late-joining and reconnecting clients — derives the same phase from the
 * same snapshot field, so no client-side decrementing interval can drift and
 * skip a number.
 */
export type MatchCountdownPhase =
  | 'COUNTDOWN_3'
  | 'COUNTDOWN_2'
  | 'COUNTDOWN_1'
  | 'COUNTDOWN_GO'
  | 'PLAYING';

export interface MatchCountdown {
  phase: MatchCountdownPhase;
  /** 3, 2, 1 or 0 (GO). */
  value: number;
  visible: boolean;
}

/** Rendering refresh rate — 10 Hz is plenty for whole-second phases. */
const UPDATE_INTERVAL_MS = 100;
/** How long GO stays on screen after the match starts. */
const GO_HOLD_MS = 900;

export function phaseForRemaining(remainingMs: number): { phase: MatchCountdownPhase; value: number } {
  if (remainingMs > 2000) return { phase: 'COUNTDOWN_3', value: 3 };
  if (remainingMs > 1000) return { phase: 'COUNTDOWN_2', value: 2 };
  if (remainingMs > 0) return { phase: 'COUNTDOWN_1', value: 1 };
  return { phase: 'COUNTDOWN_GO', value: 0 };
}

export function useMatchCountdown(room: RoomState | null): MatchCountdown {
  const serverNow = useConnectionStore((state) => state.serverNow);
  const [model, setModel] = useState<MatchCountdown>({ phase: 'PLAYING', value: 0, visible: false });
  const frame = useRef<number | null>(null);

  const status = room?.status ?? null;
  const countdownEndsAt = room?.countdownEndsAt ?? null;
  const countdownValue = room?.countdownValue ?? 0;

  useEffect(() => {
    // Outside a countdown there is nothing to animate.
    if (status !== 'COUNTDOWN' && status !== 'NEW_MATCH' && status !== 'PLAYING') {
      setModel({ phase: 'PLAYING', value: 0, visible: false });
      return;
    }

    let active = true;
    let lastEmit = 0;
    let lastKey = '';
    const tick = () => {
      if (!active) return;
      const now = serverNow();
      let next: MatchCountdown;
      if (status === 'PLAYING') {
        // The GO beat: brief, then gameplay takes over.
        const freshGo =
          countdownEndsAt !== null && now - countdownEndsAt >= 0 && now - countdownEndsAt < GO_HOLD_MS;
        next = freshGo
          ? { phase: 'COUNTDOWN_GO', value: 0, visible: true }
          : { phase: 'PLAYING', value: 0, visible: false };
      } else if (countdownEndsAt !== null) {
        const { phase, value } = phaseForRemaining(countdownEndsAt - now);
        next = { phase, value, visible: true };
      } else {
        // Legacy fallback: snapshots without the timestamp (should not
        // happen, but never show a stuck overlay because of it).
        const value = Math.max(0, Math.min(3, countdownValue));
        next =
          value > 0
            ? { phase: `COUNTDOWN_${value}` as MatchCountdownPhase, value, visible: true }
            : { phase: 'PLAYING', value: 0, visible: false };
      }
      const key = `${next.phase}:${next.visible}`;
      const wall = Date.now();
      if ((key !== lastKey || wall - lastEmit >= UPDATE_INTERVAL_MS) && active) {
        lastKey = key;
        lastEmit = wall;
        setModel(next);
      }
      // A settled hidden state needs no loop — any snapshot change (status or
      // timestamp) restarts the effect.
      const settled = !next.visible && next.phase === 'PLAYING';
      if (!settled) frame.current = requestAnimationFrame(tick);
      else frame.current = null;
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      active = false;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [status, countdownEndsAt, countdownValue, serverNow]);

  return model;
}
