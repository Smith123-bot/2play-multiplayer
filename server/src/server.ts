import { ApplicationManager } from './core/ApplicationManager';
import { env } from './config/env';
import { createLogger } from './utils/logger';
import { recordProcessError } from './core/Health';

const logger = createLogger('Bootstrap');
const application = new ApplicationManager();

async function bootstrap(): Promise<void> {
  await application.start();
  logger.info('2PLAY backend ready', {
    health: `http://localhost:${env.PORT}/api/health`,
    client: env.CLIENT_URL,
  });
}

const shutdown = (signal: string) => {
  logger.info('received shutdown signal', { signal });
  application
    .stop()
    .catch((error: unknown) => {
      logger.error('shutdown failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => process.exit(0));
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Both handlers are deliberately non-fatal: the process stays up so live rooms
// and sockets survive one bad operation. Every error is counted on the shared
// health signals and surfaced through /api/health instead of being silently
// swallowed — "stable" and "stable but degraded" must be distinguishable.
// The signals object can be absent before bootstrap finishes; these handlers
// must never throw themselves, so that case falls back to logging only.
function handleProcessError(
  kind: 'uncaughtException' | 'unhandledRejection',
  message: string,
  stack?: string,
): void {
  const signals = application.getPlatform().healthSignals;
  if (!signals) {
    logger.error(kind, stack ? { message, stack } : { message });
    return;
  }
  recordProcessError(signals, kind, message, (name, meta) =>
    logger.error(name, stack ? { ...meta, stack } : meta),
  );
}

process.on('unhandledRejection', (reason: unknown) => {
  handleProcessError(
    'unhandledRejection',
    reason instanceof Error ? reason.message : String(reason),
  );
});

process.on('uncaughtException', (error: Error) => {
  handleProcessError('uncaughtException', error.message, error.stack);
});

void bootstrap().catch((error: unknown) => {
  logger.error('failed to start server', {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
});

export { application };
