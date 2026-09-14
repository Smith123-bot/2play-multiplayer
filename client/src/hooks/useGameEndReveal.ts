import { useEffect, useRef, useState } from 'react';
import type { RoomState } from '@2play/shared';

const PLAYING_STATUSES: RoomState['status'][] = ['PLAYING', 'PAUSED'];
const RESULT_STATUSES: RoomState['status'][] = ['GAME_FINISHED', 'RESULT', 'REMATCH_WAITING'];

/**
 * How long the final board stays on screen between the decisive event and the
 * result panel. This is the platform-wide GAME-END REVEAL: every match ends
 * with GAMEPLAY -> DECISIVE EVENT -> REVEAL -> RESULT. The game's own state
 * carries the specifics (Sim's losing triangle, Ludo's finished tokens, the
 * last move on any board); this hold simply gives that moment screen time
 * before the result UI replaces it. Short enough not to stall the flow.
 */
export const REVEAL_HOLD_MS = 1_800;

/**
 * True while the end-of-match reveal should keep the final game board mounted.
 *
 * Fires only on a PLAYING -> result-status transition observed while mounted,
 * so a viewer who joins mid-reveal (or remounts on the result screen) goes
 * straight to the result instead of a stale half-second of board. The hold
 * clears by itself after REVEAL_HOLD_MS, or immediately if the room leaves
 * the result status (e.g. a rematch accepted mid-reveal).
 */
export function useGameEndReveal(roomStatus: RoomState['status'] | undefined): boolean {
  const [revealHold, setRevealHold] = useState(false);
  // Initialised with the CURRENT status so mounting straight onto a result
  // screen is not mistaken for a live -> result transition.
  const previousStatus = useRef<RoomState['status'] | undefined>(roomStatus);

  useEffect(() => {
    const previous = previousStatus.current;
    previousStatus.current = roomStatus;
    if (roomStatus === undefined) return;
    if (
      previous !== undefined &&
      PLAYING_STATUSES.includes(previous) &&
      RESULT_STATUSES.includes(roomStatus)
    ) {
      setRevealHold(true);
      const timer = window.setTimeout(() => setRevealHold(false), REVEAL_HOLD_MS);
      // Cleanup only runs on the NEXT room-status change or unmount — never
      // on the hold-state flip, which would cancel the pending expiry.
      return () => window.clearTimeout(timer);
    }
  }, [roomStatus]);

  useEffect(() => {
    if (roomStatus !== undefined && !RESULT_STATUSES.includes(roomStatus) && revealHold) {
      setRevealHold(false);
    }
  }, [roomStatus, revealHold]);

  return revealHold;
}
