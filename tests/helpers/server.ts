import { ApplicationManager } from '../../server/src/core/ApplicationManager';
import type { Platform } from '../../server/src/core/Platform';

export interface TestServer {
  platform: Platform;
  port: number;
  url: string;
  stop: () => Promise<void>;
}

/** Boots a real 2PLAY server on an ephemeral port for integration tests. */
export async function startTestServer(): Promise<TestServer> {
  process.env.PORT = '0';
  process.env.NODE_ENV = 'test';
  if (!process.env.LOG_LEVEL) process.env.LOG_LEVEL = 'error';
  const application = new ApplicationManager();
  const { port } = await application.start();
  return {
    platform: application.getPlatform(),
    port,
    url: `http://127.0.0.1:${port}`,
    stop: () => application.stop(),
  };
}
