import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should load valid config from env vars', async () => {
    process.env.ACTUAL_HTTP_API_URL = 'http://localhost:5007';
    process.env.ACTUAL_HTTP_API_KEY = 'test-key';
    process.env.ACTUAL_BUDGET_SYNC_ID = 'test-sync-id';

    const { loadConfig } = await import('../src/config.js');
    const config = loadConfig();

    expect(config.actualHttpApiUrl).toBe('http://localhost:5007');
    expect(config.actualHttpApiKey).toBe('test-key');
    expect(config.budgetSyncId).toBe('test-sync-id');
    expect(config.mcpTransport).toBe('stdio');
    expect(config.mcpPort).toBe(3001);
    expect(config.currencySymbol).toBe('$');
    expect(config.logLevel).toBe('info');
  });

  it('should throw on missing required env vars', async () => {
    delete process.env.ACTUAL_HTTP_API_URL;
    delete process.env.ACTUAL_HTTP_API_KEY;
    delete process.env.ACTUAL_BUDGET_SYNC_ID;

    const { loadConfig } = await import('../src/config.js');
    expect(() => loadConfig()).toThrow('Invalid configuration');
  });

  it('should throw on invalid URL', async () => {
    process.env.ACTUAL_HTTP_API_URL = 'not-a-url';
    process.env.ACTUAL_HTTP_API_KEY = 'test-key';
    process.env.ACTUAL_BUDGET_SYNC_ID = 'test-sync-id';

    const { loadConfig } = await import('../src/config.js');
    expect(() => loadConfig()).toThrow('Invalid configuration');
  });

  it('should accept optional overrides', async () => {
    process.env.ACTUAL_HTTP_API_URL = 'http://localhost:5007';
    process.env.ACTUAL_HTTP_API_KEY = 'test-key';
    process.env.ACTUAL_BUDGET_SYNC_ID = 'test-sync-id';
    process.env.MCP_TRANSPORT = 'sse';
    process.env.MCP_PORT = '4000';
    process.env.CURRENCY_SYMBOL = '£';
    process.env.LOG_LEVEL = 'debug';

    const { loadConfig } = await import('../src/config.js');
    const config = loadConfig();

    expect(config.mcpTransport).toBe('sse');
    expect(config.mcpPort).toBe(4000);
    expect(config.currencySymbol).toBe('£');
    expect(config.logLevel).toBe('debug');
  });
});
