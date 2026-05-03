import { describe, it, expect } from 'vitest';
import pino from 'pino';
import type { AddressInfo } from 'node:net';
import type { Config } from '../src/config.js';

describe('SSE multi-connect (regression)', () => {
  // Pre-fix: the second concurrent /sse request crashed with
  // "Already connected to a transport" because a single shared Server
  // instance was reused across connections. This test opens two parallel
  // SSE connections and asserts both receive a 200 + event-stream response.
  it('serves two concurrent /sse connections without 500', async () => {
    const { createApp } = await import('../src/app.js');

    const config: Config = {
      actualHttpApiUrl: 'http://localhost:5007',
      actualHttpApiKey: 'test-key',
      budgetSyncId: 'test-budget',
      mcpTransport: 'sse',
      mcpPort: 0,
      currencySymbol: '$',
      logLevel: 'error',
    };
    const logger = pino({ level: 'silent' });

    const { app, cleanup } = await createApp(config, logger);
    const httpServer = app.listen(0);
    await new Promise<void>((resolve) => httpServer.once('listening', resolve));
    const { port } = httpServer.address() as AddressInfo;
    const url = `http://127.0.0.1:${port}/sse`;

    const ac1 = new AbortController();
    const ac2 = new AbortController();
    try {
      const [r1, r2] = await Promise.all([
        fetch(url, { signal: ac1.signal }),
        fetch(url, { signal: ac2.signal }),
      ]);

      expect(r1.status).toBe(200);
      expect(r1.headers.get('content-type')).toContain('text/event-stream');
      expect(r2.status).toBe(200);
      expect(r2.headers.get('content-type')).toContain('text/event-stream');
    } finally {
      ac1.abort();
      ac2.abort();
      await cleanup();
      httpServer.closeAllConnections();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  }, 10_000);
});
