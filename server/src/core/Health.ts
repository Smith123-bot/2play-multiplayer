/**
 * Non-secret process-health counters.
 *
 * The server intentionally SURVIVES uncaught exceptions and unhandled
 * rejections (live rooms and sockets must not die because of one bad
 * operation), but survival without visibility is how a degraded process
 * silently pretends to be healthy. These counters are incremented by the
 * process-level handlers and exposed through /api/health so monitoring —
 * and humans — can tell "stable" from "stable but hurt".
 */
export interface HealthSignals {
  uncaughtExceptions: number;
  unhandledRejections: number;
  /** Epoch ms of the most recent process-level error. */
  lastErrorAt: number | null;
}

export function createHealthSignals(): HealthSignals {
  return { uncaughtExceptions: 0, unhandledRejections: 0, lastErrorAt: null };
}

/** Records a process-level error on the shared, mutable signals object. */
export function recordProcessError(
  signals: HealthSignals,
  kind: 'uncaughtException' | 'unhandledRejection',
  message: string,
  log: (message: string, meta: Record<string, unknown>) => void,
): void {
  signals.lastErrorAt = Date.now();
  if (kind === 'uncaughtException') signals.uncaughtExceptions += 1;
  else signals.unhandledRejections += 1;
  log(kind, { message, ...signals });
}
