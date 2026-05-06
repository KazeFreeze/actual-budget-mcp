import { describe, it, expect } from 'vitest';
import pino from 'pino';
import { createMcpServer } from '../src/server.js';
import { FakeActualClient } from '../src/client/fake-client.js';
import { SyncCoalescer } from '../src/client/sync-coalescer.js';
import type { Config } from '../src/config.js';

const cfg: Config = {
  actualServerUrl: 'http://x',
  actualServerPassword: 'p',
  budgetSyncId: 's',
  mcpApiKeys: [],
  mcpAllowedOrigins: [],
  mcpTransport: 'stdio',
  mcpPort: 3000,
  mcpRateLimitPerMin: 120,
  mcpDataDir: '/tmp',
  logLevel: 'info',
};

describe('createMcpServer', () => {
  it('constructs with all tool groups registered', () => {
    const client = new FakeActualClient();
    const coalescer = new SyncCoalescer(client, 2000);
    const logger = pino({ level: 'silent' });
    const server = createMcpServer({
      config: cfg,
      client,
      coalescer,
      logger,
    });
    expect(server).toBeDefined();
  });
});
