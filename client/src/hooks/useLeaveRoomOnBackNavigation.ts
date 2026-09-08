import { useEffect, useRef } from 'react';

/**
 * Detects an *intentional* browser/phone back navigation while the user is
 * inside an active room and runs `onIntentionalExit` (spec: "PHONE BACK
 * BUTTON MUST LEAVE ACTIVE ROOM").
 *
 * Implementation notes:
 *  - Uses the browser's native `popstate` event, which fires for the phone
 *    back button, the browser back button, and programmatic
 *    `history.back()` alike — one SPA-native mechanism, not a second
 *    navigation system.
 *  - Deliberately NOT a `beforeunload` handler: `beforeunload` cannot
 *    reliably deliver a network request, so it is never used as the primary
 *    (or only) way to tell the server the player left.
 *  - A *temporary network disconnect* never reaches this hook — that keeps
 *    using the existing 120s `ReconnectionManager` grace period untouched.
 *  - Exactly one listener is attached while `active` is true and removed on
 *    cleanup — no duplicate handlers pile up across renders or remounts.
 */
export function useLeaveRoomOnBackNavigation(active: boolean, onIntentionalExit: () => void): void {
  const exitRef = useRef(onIntentionalExit);
  exitRef.current = onIntentionalExit;

  useEffect(() => {
    if (!active) return undefined;

    const handlePopState = () => {
      exitRef.current();
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [active]);
}

export default useLeaveRoomOnBackNavigation;
