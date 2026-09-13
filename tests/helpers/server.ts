import type { Platform } from '../../server/src/core/Platform';

export interface TestServer {
  platform: Platform;
  port: number;
  url: string;
  stop: () => Promise<void>;
}

/**
 * Boots a real 2PLAY server on an ephemeral port for integration tests.
 *
 * The runtime config (`server/src/config/env.ts`) is parsed exactly once, at
 * module load. A static import of `ApplicationManager` therefore evaluates it
 * *before* this function runs, so assigning `process.env.PORT` here used to be a
 * silent no-op: every suite bound the ambient port (4000 by default) and failed
 * with EADDRINUSE whenever anything else held it — including a dev server
 * started for manual QA. The manager is imported dynamically *after* PORT is set
 * to 0 so the kernel assigns a free port and the suites stay hermetic.
 */
export async function startTestServer(): Promise<TestServer> {
  process.env.PORT = '0';
  process.env.NODE_ENV = 'test';
  if (!process.env.LOG_LEVEL) process.env.LOG_LEVEL = 'error';
  const { ApplicationManager } = await import('../../server/src/core/ApplicationManager');
  const application = new ApplicationManager();
  const { port } = await application.start();
  return {
    platform: application.getPlatform(),
    port,
    url: `http://127.0.0.1:${port}`,
    stop: () => application.stop(),
  };
}
