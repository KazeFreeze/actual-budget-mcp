import pRetry from 'p-retry';
import type { ActualClient } from './actual-client.js';

export async function withRetriedSync(fn: () => Promise<void>): Promise<void> {
  await pRetry(fn, {
    retries: 2,
    minTimeout: 200,
    factor: 2,
    maxTimeout: 800,
  });
}

export function installSignalHandlers(client: ActualClient, onShutdown: () => Promise<void>): void {
  let shuttingDown = false;
  const handler = (sig: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    void (async (): Promise<void> => {
      try {
        await onShutdown();
        await client.shutdown();
      } finally {
        process.exit(sig === 'SIGINT' ? 130 : 0);
      }
    })();
  };
  process.on('SIGTERM', () => {
    handler('SIGTERM');
  });
  process.on('SIGINT', () => {
    handler('SIGINT');
  });
}
