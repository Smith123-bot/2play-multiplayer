import { TimerType } from '@2play/shared';
import { createLogger, type Logger } from '../utils/logger';

/**
 * TimerManager — the ONLY place in the server where gameplay/lifecycle timers
 * are created. Every timer:
 *   - belongs to a room (or to `system`),
 *   - is de-duplicated by an optional `key`,
 *   - cleans itself up automatically,
 *   - can be cancelled individually, by type, or all-at-once per room,
 *   - reports remaining time for UI countdowns.
 *
 * Nothing else in the codebase may call setTimeout/setInterval for gameplay.
 */
export interface TimerTickInfo {
  timerId: string;
  roomId: string;
  type: TimerType;
  remainingMs: number;
  elapsedMs: number;
  tickIndex: number;
}

export interface TimerCompleteInfo {
  timerId: string;
  roomId: string;
  type: TimerType;
  completedAt: number;
  cancelled: boolean;
}

export interface TimerOptions {
  roomId: string;
  type: TimerType;
  /** Delay before the first tick (interval timers) or before completion (one-shot). */
  delayMs: number;
  /** When set, the timer repeats every `intervalMs` until completion. */
  intervalMs?: number;
  /** Total lifetime before auto-completion (repeating timers only). */
  durationMs?: number;
  /** Uniqueness key: creating a timer with the same (roomId, type, key) cancels the old one. */
  key?: string;
  /** Human readable label used in logs. */
  label?: string;
  onTick?: (info: TimerTickInfo) => void;
  onComplete?: (info: TimerCompleteInfo) => void;
}

interface InternalTimer {
  id: string;
  roomId: string;
  type: TimerType;
  key: string;
  label: string;
  handle: NodeJS.Timeout;
  kind: 'timeout' | 'interval';
  intervalMs: number;
  createdAt: number;
  deadline: number;
  durationMs: number;
  /** Interval timers with no durationMs tick until cancelled. */
  openEnded: boolean;
  tickIndex: number;
  onTick?: (info: TimerTickInfo) => void;
  onComplete?: (info: TimerCompleteInfo) => void;
  completed: boolean;
}

let sequence = 0;

export class TimerManager {
  private readonly timers = new Map<string, InternalTimer>();
  /**
   * Lookup indexes so the hot paths (has / cancelByKey / getRemainingByKey on
   * every action and broadcast, cancelByType / cancelAllForRoom on every
   * lifecycle transition) never scan the whole timer set. With hundreds of
   * rooms live, a full scan per lookup was O(rooms × timers-per-room) work on
   * the action path; both indexes keep it proportional to the result size.
   */
  private readonly byKey = new Map<string, InternalTimer>();
  private readonly byRoom = new Map<string, Set<InternalTimer>>();
  private readonly logger: Logger = createLogger('TimerManager');

  constructor(private readonly defaultTickEmit = false) {}

  /**
   * Creates (and registers) a timer. If a timer with the same
   * (roomId, type, key) exists it is cancelled first — this is what prevents
   * duplicate countdowns, duplicate reconnect deadlines and duplicate rematch
   * timers.
   */
  create(options: TimerOptions): string {
    const {
      roomId,
      type,
      delayMs,
      intervalMs,
      durationMs,
      key = 'default',
      label,
      onTick,
      onComplete,
    } = options;

    this.cancelByKey(roomId, type, key);

    const kind: 'timeout' | 'interval' = intervalMs && intervalMs > 0 ? 'interval' : 'timeout';
    // Repeating timers without an explicit lifetime (game update loops, the
    // room-sweep) must keep ticking until cancelled — otherwise the first
    // interval fire sees remainingMs === 0 and completes without onTick.
    const openEnded = kind === 'interval' && durationMs === undefined;
    const total = openEnded ? Number.MAX_SAFE_INTEGER : Math.max(1, durationMs ?? delayMs);
    sequence += 1;
    const id = `t${sequence}_${roomId}_${type}_${key}`;
    const createdAt = Date.now();

    const timer: InternalTimer = {
      id,
      roomId,
      type,
      key,
      label: label ?? `${type}:${key}`,
      handle: undefined as unknown as NodeJS.Timeout,
      kind,
      intervalMs: intervalMs ?? delayMs,
      createdAt,
      deadline: createdAt + total,
      durationMs: total,
      openEnded,
      tickIndex: 0,
      onTick,
      onComplete,
      completed: false,
    };

    if (kind === 'interval') {
      timer.handle = setInterval(() => {
        this.handleTick(id);
      }, timer.intervalMs);
    } else {
      timer.handle = setTimeout(() => {
        this.handleTick(id);
      }, Math.max(0, delayMs));
    }

    // Node timers should never keep the event loop alive on their own.
    timer.handle.unref?.();

    this.timers.set(id, timer);
    this.byKey.set(TimerManager.keyOf(roomId, type, key), timer);
    let roomTimers = this.byRoom.get(roomId);
    if (!roomTimers) {
      roomTimers = new Set<InternalTimer>();
      this.byRoom.set(roomId, roomTimers);
    }
    roomTimers.add(timer);
    this.logger.debug('timer created', {
      id,
      roomId,
      type,
      key,
      kind,
      delayMs,
      intervalMs: timer.intervalMs,
      durationMs: total,
      emit: this.defaultTickEmit,
    });
    return id;
  }

  private handleTick(timerId: string): void {
    const timer = this.timers.get(timerId);
    if (!timer || timer.completed) return;

    const now = Date.now();
    const remainingMs = Math.max(0, timer.deadline - now);

    if (timer.kind === 'interval' && remainingMs > 0) {
      timer.tickIndex += 1;
      timer.onTick?.({
        timerId,
        roomId: timer.roomId,
        type: timer.type,
        remainingMs,
        elapsedMs: now - timer.createdAt,
        tickIndex: timer.tickIndex,
      });
      return;
    }

    this.complete(timer, false);
  }

  private static keyOf(roomId: string, type: string, key: string): string {
    return `${roomId}\u0000${type}\u0000${key}`;
  }

  private complete(timer: InternalTimer, cancelled: boolean): void {
    if (timer.completed) return;
    timer.completed = true;
    if (timer.handle) {
      if (timer.kind === 'interval') clearInterval(timer.handle);
      else clearTimeout(timer.handle);
    }
    this.timers.delete(timer.id);
    this.byKey.delete(TimerManager.keyOf(timer.roomId, timer.type, timer.key));
    const roomTimers = this.byRoom.get(timer.roomId);
    if (roomTimers) {
      roomTimers.delete(timer);
      if (roomTimers.size === 0) this.byRoom.delete(timer.roomId);
    }
    this.logger.debug('timer completed', {
      id: timer.id,
      roomId: timer.roomId,
      type: timer.type,
      key: timer.key,
      cancelled,
    });
    // Cancelling a timer must NEVER run its completion handler — otherwise a
    // cancelled "match timeout" could finish a match that is already over.
    if (cancelled) return;
    timer.onComplete?.({
      timerId: timer.id,
      roomId: timer.roomId,
      type: timer.type,
      completedAt: Date.now(),
      cancelled,
    });
  }

  cancel(timerId: string | null | undefined): boolean {
    if (!timerId) return false;
    const timer = this.timers.get(timerId);
    if (!timer) return false;
    this.complete(timer, true);
    return true;
  }

  cancelByKey(roomId: string, type: TimerType, key = 'default'): boolean {
    const timer = this.byKey.get(TimerManager.keyOf(roomId, type, key));
    if (!timer || timer.completed) return false;
    this.complete(timer, true);
    return true;
  }

  cancelByType(roomId: string, type: TimerType): number {
    const roomTimers = this.byRoom.get(roomId);
    if (!roomTimers) return 0;
    let count = 0;
    for (const timer of [...roomTimers]) {
      if (timer.type === type && !timer.completed) {
        this.complete(timer, true);
        count += 1;
      }
    }
    return count;
  }

  cancelAllForRoom(roomId: string): number {
    const roomTimers = this.byRoom.get(roomId);
    if (!roomTimers) return 0;
    const count = roomTimers.size;
    for (const timer of [...roomTimers]) {
      this.complete(timer, true);
    }
    if (count > 0) {
      this.logger.debug('cancelled all timers for room', { roomId, count });
    }
    return count;
  }

  getRemaining(timerId: string): number | null {
    const timer = this.timers.get(timerId);
    if (!timer || timer.completed) return null;
    return Math.max(0, timer.deadline - Date.now());
  }

  has(roomId: string, type: TimerType, key = 'default'): boolean {
    const timer = this.byKey.get(TimerManager.keyOf(roomId, type, key));
    return timer !== undefined && !timer.completed;
  }

  /** Reconnect deadlines / rematch countdowns expose their remaining time. */
  getRemainingByKey(roomId: string, type: TimerType, key = 'default'): number | null {
    const timer = this.byKey.get(TimerManager.keyOf(roomId, type, key));
    if (!timer || timer.completed) return null;
    return Math.max(0, timer.deadline - Date.now());
  }

  timersForRoom(roomId: string): Array<{ id: string; type: TimerType; key: string; remainingMs: number }> {
    const result: Array<{ id: string; type: TimerType; key: string; remainingMs: number }> = [];
    for (const timer of this.byRoom.get(roomId) ?? []) {
      result.push({
        id: timer.id,
        type: timer.type,
        key: timer.key,
        remainingMs: Math.max(0, timer.deadline - Date.now()),
      });
    }
    return result;
  }

  get activeCount(): number {
    return this.timers.size;
  }

  cancelAll(): void {
    for (const timer of [...this.timers.values()]) {
      this.complete(timer, true);
    }
  }

  /** Called on shutdown: nothing may survive the process. */
  dispose(): void {
    this.cancelAll();
    this.logger.info('TimerManager disposed', { remaining: this.timers.size });
  }
}
