import { ApplicationManager } from './core/ApplicationManager';
import { env } from './config/env';
import { createLogger } from './utils/logger';

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

process.on('unhandledRejection', (reason: unknown) => {
  logger.error('unhandled rejection', {
    message: reason instanceof Error ? reason.message : String(reason),
  });
});

process.on('uncaughtException', (error: Error) => {
  logger.error('uncaught exception', { message: error.message, stack: error.stack });
});

void bootstrap().catch((error: unknown) => {
  logger.error('failed to start server', {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
});

export { application };
