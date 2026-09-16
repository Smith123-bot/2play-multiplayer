import { useCallback, useEffect, useRef, type TouchEvent as ReactTouchEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { GameAction } from '@2play/shared';

export type ServerPaddleDirection = 'negative' | 'positive';
export type ServerPaddleAxis = 'x' | 'y';

type SendAction = (
  action: GameAction,
  options?: { silent?: boolean },
) => Promise<boolean> | boolean | void;
type PointerHandler = (event: ReactPointerEvent<HTMLElement>) => void;
type TouchHandler = (event: ReactTouchEvent<HTMLElement>) => void;

interface UseServerPaddleInputOptions {
  canPlay: boolean;
  axis: ServerPaddleAxis;
  /** Current authoritative paddle centre in game-world units. */
  paddlePosition: number | undefined;
  /** Full paddle size in the same game-world axis. */
  paddleSize: number;
  /** Current authoritative arena size in the same game-world axis. */
  arenaSize: number;
  negativeDirection: ServerPaddleDirection;
  positiveDirection: ServerPaddleDirection;
  latestInputSeq?: number;
  sendAction: SendAction;
  vibrate: (pattern: 'buttonPress') => void;
}

interface ServerPaddleInputHandlers {
  onArenaPointerDown: PointerHandler;
  onArenaPointerMove: PointerHandler;
  onArenaPointerUp: PointerHandler;
  onArenaPointerCancel: PointerHandler;
  onArenaLostPointerCapture: PointerHandler;
  onArenaPointerLeave: PointerHandler;
  onArenaTouchStart: TouchHandler;
  onArenaTouchMove: TouchHandler;
  onArenaTouchEnd: TouchHandler;
  onArenaTouchCancel: TouchHandler;
  onControlPointerDown: (direction: ServerPaddleDirection, event: ReactPointerEvent<HTMLElement>) => void;
  onControlPointerUp: PointerHandler;
  onControlPointerCancel: PointerHandler;
  onControlLostPointerCapture: PointerHandler;
  onControlPointerLeave: PointerHandler;
  onControlTouchStart: (direction: ServerPaddleDirection, event: ReactTouchEvent<HTMLElement>) => void;
  onControlTouchEnd: TouchHandler;
  onControlTouchCancel: TouchHandler;
}

const INPUT_HEARTBEAT_MS = 160;
const DRAG_DIRECTION_THROTTLE_MS = 40;

/**
 * Reliable server-authoritative paddle input for the two realtime paddle games.
 *
 * The game server owns position, collision and scoring. This hook only sends
 * direction intents. A held direction is re-sent periodically so a dropped
 * Socket.IO frame or a rejected action cannot leave the client believing that
 * the server is moving when it is not. Release, blur, visibility changes and
 * every pointer/touch cancellation path send a stop intent.
 */
export function useServerPaddleInput({
  canPlay,
  axis,
  paddlePosition,
  paddleSize,
  arenaSize,
  negativeDirection,
  positiveDirection,
  latestInputSeq,
  sendAction,
  vibrate,
}: UseServerPaddleInputOptions): ServerPaddleInputHandlers {
  const canPlayRef = useRef(canPlay);
  canPlayRef.current = canPlay;
  const vibrateRef = useRef(vibrate);
  vibrateRef.current = vibrate;
  const sendActionRef = useRef(sendAction);
  sendActionRef.current = sendAction;
  const positionRef = useRef(paddlePosition);
  positionRef.current = paddlePosition;
  const paddleSizeRef = useRef(paddleSize);
  paddleSizeRef.current = paddleSize;
  const arenaSizeRef = useRef(arenaSize);
  arenaSizeRef.current = arenaSize;

  const sources = useRef(new Map<string, ServerPaddleDirection>());
  const currentDirection = useRef<ServerPaddleDirection | null>(null);
  const inputSequence = useRef(0);
  // A failed stop must not leave the server driving the paddle forever. The
  // normal game renderer returns the Socket.IO ack promise; fire-and-forget
  // test/embedded callers still get the one immediate stop.
  const pendingStopSequence = useRef<number | null>(null);
  const pointerIds = useRef(new Set<number>());
  const touchIds = useRef(new Set<number>());
  const dragPointerId = useRef<number | null>(null);
  const dragTouchId = useRef<number | null>(null);
  const lastDragDirection = useRef<ServerPaddleDirection | null>(null);
  const lastDragAt = useRef(0);

  useEffect(() => {
    if (typeof latestInputSeq === 'number') {
      inputSequence.current = Math.max(inputSequence.current, latestInputSeq);
      if (
        pendingStopSequence.current !== null &&
        latestInputSeq >= pendingStopSequence.current
      ) {
        pendingStopSequence.current = null;
      }
    }
  }, [latestInputSeq]);

  const transmit = useCallback(
    (direction: ServerPaddleDirection | 'stop', haptic = false) => {
      if (!canPlayRef.current) return;
      inputSequence.current += 1;
      const sequence = inputSequence.current;
      const action: GameAction = {
        type: 'move',
        payload: {
          direction:
            direction === 'stop'
              ? 'stop'
              : axis === 'y'
                ? direction === negativeDirection
                  ? 'up'
                  : 'down'
                : direction === negativeDirection
                  ? 'left'
                  : 'right',
          sequence,
        },
      };

      if (direction !== 'stop') pendingStopSequence.current = null;

      // `sendAction` already handles the typed ack and user-facing errors. A
      // failed direction is retried by the heartbeat while the source remains
      // held, rather than being permanently deduplicated on the client. Stops
      // are retried too when the renderer exposes the Socket.IO ack promise;
      // this closes the small but important "release packet was lost" window.
      try {
        const result = sendActionRef.current(action);
        if (direction === 'stop' && result !== undefined) {
          pendingStopSequence.current = sequence;
          if (typeof result === 'boolean') {
            if (result) pendingStopSequence.current = null;
          } else {
            void Promise.resolve(result)
              .then((accepted) => {
                if (accepted && pendingStopSequence.current === sequence) {
                  pendingStopSequence.current = null;
                }
              })
              .catch(() => undefined);
          }
        }
      } catch {
        // A synchronous transport failure is handled by the next heartbeat
        // when an ack-capable renderer is in use.
      }
      if (haptic) vibrateRef.current('buttonPress');
    },
    [axis, negativeDirection],
  );

  const reconcile = useCallback(() => {
    const entries = [...sources.current.values()];
    const next = entries.length > 0 ? entries[entries.length - 1]! : null;
    if (next === currentDirection.current) return;
    currentDirection.current = next;
    if (next) transmit(next, true);
    else transmit('stop');
  }, [transmit]);

  const setSource = useCallback(
    (source: string, direction: ServerPaddleDirection) => {
      if (!canPlayRef.current) return;
      // Delete/reinsert makes the newest simultaneously held key/pointer win;
      // releasing it then falls back to the still-held older source.
      sources.current.delete(source);
      sources.current.set(source, direction);
      reconcile();
    },
    [reconcile],
  );

  const clearSource = useCallback(
    (source: string) => {
      if (!sources.current.delete(source)) return;
      reconcile();
    },
    [reconcile],
  );

  const clearAllSources = useCallback(() => {
    sources.current.clear();
    pointerIds.current.clear();
    touchIds.current.clear();
    dragPointerId.current = null;
    dragTouchId.current = null;
    lastDragDirection.current = null;
    // Reconcile before losing the desired direction so the stop is emitted.
    reconcile();
  }, [reconcile]);

  const directionAtClientPoint = useCallback(
    (clientCoordinate: number, element: HTMLElement): ServerPaddleDirection | null => {
      const rect = element.getBoundingClientRect();
      const start = axis === 'y' ? rect.top : rect.left;
      const size = axis === 'y' ? rect.height : rect.width;
      if (size <= 0 || !Number.isFinite(positionRef.current) || arenaSizeRef.current <= 0) return null;
      const worldCoordinate = ((clientCoordinate - start) / size) * arenaSizeRef.current;
      const delta = worldCoordinate - (positionRef.current ?? arenaSizeRef.current / 2);
      const deadZone = Math.max(0.05, paddleSizeRef.current * 0.18);
      if (delta < -deadZone) return negativeDirection;
      if (delta > deadZone) return positiveDirection;
      return null;
    },
    [axis, negativeDirection, positiveDirection],
  );

  const updateDrag = useCallback(
    (pointerId: number | string, clientCoordinate: number, element: HTMLElement) => {
      if (!canPlayRef.current) return;
      const now = Date.now();
      const direction = directionAtClientPoint(clientCoordinate, element);
      if (
        direction === lastDragDirection.current &&
        now - lastDragAt.current < DRAG_DIRECTION_THROTTLE_MS
      ) {
        return;
      }
      lastDragAt.current = now;
      lastDragDirection.current = direction;
      const source = `drag:${pointerId}`;
      if (direction) setSource(source, direction);
      else clearSource(source);
    },
    [clearSource, directionAtClientPoint, setSource],
  );

  const beginPointerCapture = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    pointerIds.current.add(event.pointerId);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is unavailable in a few embedded/older browsers. The
      // global pointerup/pointercancel listeners remain the safety net.
    }
  }, []);

  const releasePointer = useCallback(
    (pointerId: number) => {
      pointerIds.current.delete(pointerId);
      clearSource(`pointer:${pointerId}`);
      clearSource(`drag:${pointerId}`);
      if (dragPointerId.current === pointerId) dragPointerId.current = null;
    },
    [clearSource],
  );

  const onArenaPointerDown: PointerHandler = useCallback(
    (event) => {
      if (!canPlayRef.current) return;
      beginPointerCapture(event);
      dragPointerId.current = event.pointerId;
      lastDragAt.current = 0;
      lastDragDirection.current = null;
      const coordinate = axis === 'y' ? event.clientY : event.clientX;
      updateDrag(event.pointerId, coordinate, event.currentTarget);
    },
    [axis, beginPointerCapture, updateDrag],
  );

  const onArenaPointerMove: PointerHandler = useCallback(
    (event) => {
      if (event.pointerId !== dragPointerId.current || !canPlayRef.current) return;
      event.preventDefault();
      const coordinate = axis === 'y' ? event.clientY : event.clientX;
      updateDrag(event.pointerId, coordinate, event.currentTarget);
    },
    [axis, updateDrag],
  );

  const onArenaPointerUp: PointerHandler = useCallback(
    (event) => releasePointer(event.pointerId),
    [releasePointer],
  );
  const onArenaPointerCancel: PointerHandler = useCallback(
    (event) => releasePointer(event.pointerId),
    [releasePointer],
  );
  const onArenaLostPointerCapture: PointerHandler = useCallback(
    (event) => releasePointer(event.pointerId),
    [releasePointer],
  );
  const onArenaPointerLeave: PointerHandler = useCallback(
    (event) => {
      try {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) return;
      } catch {
        // Fall through to release when pointer capture cannot be queried.
      }
      releasePointer(event.pointerId);
    },
    [releasePointer],
  );

  const onControlPointerDown = useCallback(
    (direction: ServerPaddleDirection, event: ReactPointerEvent<HTMLElement>) => {
      if (!canPlayRef.current) return;
      beginPointerCapture(event);
      setSource(`pointer:${event.pointerId}`, direction);
    },
    [beginPointerCapture, setSource],
  );
  const onControlPointerUp: PointerHandler = useCallback(
    (event) => releasePointer(event.pointerId),
    [releasePointer],
  );
  const onControlPointerCancel: PointerHandler = useCallback(
    (event) => releasePointer(event.pointerId),
    [releasePointer],
  );
  const onControlLostPointerCapture: PointerHandler = useCallback(
    (event) => releasePointer(event.pointerId),
    [releasePointer],
  );
  const onControlPointerLeave: PointerHandler = useCallback(
    (event) => {
      try {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) return;
      } catch {
        // Fall through to release when pointer capture cannot be queried.
      }
      releasePointer(event.pointerId);
    },
    [releasePointer],
  );

  const touchPoint = useCallback(
    (event: ReactTouchEvent<HTMLElement>, identifier: number): { clientX: number; clientY: number } | null => {
      const touch = [...Array.from(event.touches), ...Array.from(event.changedTouches)].find(
        (entry) => entry.identifier === identifier,
      );
      return touch ? { clientX: touch.clientX, clientY: touch.clientY } : null;
    },
    [],
  );

  const onArenaTouchStart: TouchHandler = useCallback(
    (event) => {
      // Modern browsers deliver the pointer path as well. The fallback is for
      // older touch-only browsers; never create two independent sources for one
      // finger when both event families are present.
      if (pointerIds.current.size > 0 || !canPlayRef.current) return;
      event.preventDefault();
      const touch = event.changedTouches[0];
      if (!touch) return;
      touchIds.current.add(touch.identifier);
      dragTouchId.current = touch.identifier;
      lastDragAt.current = 0;
      lastDragDirection.current = null;
      const coordinate = axis === 'y' ? touch.clientY : touch.clientX;
      updateDrag(`touch-${touch.identifier}`, coordinate, event.currentTarget);
    },
    [axis, updateDrag],
  );

  const onArenaTouchMove: TouchHandler = useCallback(
    (event) => {
      if (pointerIds.current.size > 0 || dragTouchId.current === null || !canPlayRef.current) return;
      const touch = touchPoint(event, dragTouchId.current);
      if (!touch) return;
      event.preventDefault();
      const coordinate = axis === 'y' ? touch.clientY : touch.clientX;
      updateDrag(`touch-${dragTouchId.current}`, coordinate, event.currentTarget);
    },
    [axis, touchPoint, updateDrag],
  );

  const releaseTouch = useCallback(
    (identifier: number) => {
      touchIds.current.delete(identifier);
      clearSource(`pointer:${identifier}`);
      clearSource(`drag:touch-${identifier}`);
      if (dragTouchId.current === identifier) dragTouchId.current = null;
    },
    [clearSource],
  );

  const onArenaTouchEnd: TouchHandler = useCallback(
    (event) => {
      for (const touch of Array.from(event.changedTouches)) releaseTouch(touch.identifier);
    },
    [releaseTouch],
  );
  const onArenaTouchCancel: TouchHandler = useCallback(
    (event) => {
      for (const touch of Array.from(event.changedTouches)) releaseTouch(touch.identifier);
    },
    [releaseTouch],
  );

  const onControlTouchStart = useCallback(
    (direction: ServerPaddleDirection, event: ReactTouchEvent<HTMLElement>) => {
      if (pointerIds.current.size > 0 || !canPlayRef.current) return;
      event.preventDefault();
      for (const touch of Array.from(event.changedTouches)) {
        touchIds.current.add(touch.identifier);
        setSource(`pointer:${touch.identifier}`, direction);
      }
    },
    [setSource],
  );
  const onControlTouchEnd: TouchHandler = useCallback(
    (event) => {
      for (const touch of Array.from(event.changedTouches)) releaseTouch(touch.identifier);
    },
    [releaseTouch],
  );
  const onControlTouchCancel: TouchHandler = useCallback(
    (event) => {
      for (const touch of Array.from(event.changedTouches)) releaseTouch(touch.identifier);
    },
    [releaseTouch],
  );

  useEffect(() => {
    const keyDirection = (event: KeyboardEvent): ServerPaddleDirection | null => {
      const key = event.code || event.key;
      if (axis === 'y') {
        if (key === 'ArrowUp' || key === 'KeyW' || event.key === 'w' || event.key === 'W') return negativeDirection;
        if (key === 'ArrowDown' || key === 'KeyS' || event.key === 's' || event.key === 'S') return positiveDirection;
      } else {
        if (key === 'ArrowLeft' || key === 'KeyA' || event.key === 'a' || event.key === 'A') return negativeDirection;
        if (key === 'ArrowRight' || key === 'KeyD' || event.key === 'd' || event.key === 'D') return positiveDirection;
      }
      return null;
    };
    const isFormTarget = (event: KeyboardEvent): boolean => {
      const target = event.target as HTMLElement | null;
      return Boolean(
        target &&
          (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName) || target.isContentEditable),
      );
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const direction = keyDirection(event);
      if (!direction || isFormTarget(event)) return;
      event.preventDefault();
      setSource(`key:${event.code || event.key}`, direction);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (!keyDirection(event)) return;
      clearSource(`key:${event.code || event.key}`);
    };
    const onBlur = () => clearAllSources();
    const onVisibility = () => {
      if (document.hidden) clearAllSources();
    };
    const onPointerUp = (event: PointerEvent) => releasePointer(event.pointerId);
    const onPointerCancel = (event: PointerEvent) => releasePointer(event.pointerId);
    const onTouchEnd = (event: TouchEvent) => {
      for (const touch of Array.from(event.changedTouches)) releaseTouch(touch.identifier);
    };
    const onTouchCancel = (event: TouchEvent) => {
      for (const touch of Array.from(event.changedTouches)) releaseTouch(touch.identifier);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('touchend', onTouchEnd, { passive: false });
    window.addEventListener('touchcancel', onTouchCancel, { passive: false });
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchCancel);
      document.removeEventListener('visibilitychange', onVisibility);
      clearAllSources();
    };
  }, [axis, clearAllSources, clearSource, negativeDirection, positiveDirection, releasePointer, releaseTouch, setSource]);

  useEffect(() => {
    if (!canPlay) {
      clearAllSources();
      pendingStopSequence.current = null;
      return undefined;
    }
    const heartbeat = window.setInterval(() => {
      const direction = currentDirection.current;
      if (direction) transmit(direction);
      else if (pendingStopSequence.current !== null) transmit('stop');
    }, INPUT_HEARTBEAT_MS);
    return () => window.clearInterval(heartbeat);
  }, [canPlay, clearAllSources, transmit]);

  return {
    onArenaPointerDown,
    onArenaPointerMove,
    onArenaPointerUp,
    onArenaPointerCancel,
    onArenaLostPointerCapture,
    onArenaPointerLeave,
    onArenaTouchStart,
    onArenaTouchMove,
    onArenaTouchEnd,
    onArenaTouchCancel,
    onControlPointerDown,
    onControlPointerUp,
    onControlPointerCancel,
    onControlLostPointerCapture,
    onControlPointerLeave,
    onControlTouchStart,
    onControlTouchEnd,
    onControlTouchCancel,
  };
}
