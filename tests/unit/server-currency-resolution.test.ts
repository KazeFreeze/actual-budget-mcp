import { describe, it, expect } from 'vitest';
import pino from 'pino';
import { resolveCurrencySymbol } from '../../src/server.js';
import { FakeActualClient } from '../../src/client/fake-client.js';
import type { Config } from '../../src/config.js';

const baseCfg: Config = {
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

const silentLogger = pino({ level: 'silent' });

describe('resolveCurrencySymbol', () => {
  it('uses CURRENCY_SYMBOL env override when set, even when budget has a code', async () => {
    const client = new FakeActualClient();
    client.seedCurrencyCode('PHP');
    const cfg: Config = { ...baseCfg, currencySymbol: '€' };
    const symbol = await resolveCurrencySymbol(cfg, client, silentLogger);
    expect(symbol).toBe('€');
  });

  it('treats an explicit env value of "$" as a real override (not the historical default)', async () => {
    // Regression: prior to v2.0.1, currencySymbol defaulted to '$' in the
    // schema, so we couldn't tell "user set $" from "default applied". Now
    // any non-undefined value is honored verbatim — including '$'.
    const client = new FakeActualClient();
    client.seedCurrencyCode('PHP');
    const cfg: Config = { ...baseCfg, currencySymbol: '$' };
    const symbol = await resolveCurrencySymbol(cfg, client, silentLogger);
    expect(symbol).toBe('$');
  });

  it('auto-detects from the budget preference when env is not set', async () => {
    const client = new FakeActualClient();
    client.seedCurrencyCode('PHP');
    const symbol = await resolveCurrencySymbol(baseCfg, client, silentLogger);
    expect(symbol).toBe('₱');
  });

  it('falls back to "$" when env is unset and budget reports no currency code', async () => {
    const client = new FakeActualClient();
    client.seedCurrencyCode(null);
    const symbol = await resolveCurrencySymbol(baseCfg, client, silentLogger);
    expect(symbol).toBe('$');
  });

  it('falls back to the code itself when Intl cannot resolve the detected code', async () => {
    const client = new FakeActualClient();
    client.seedCurrencyCode('ZZZ'); // reserved non-currency
    const symbol = await resolveCurrencySymbol(baseCfg, client, silentLogger);
    expect(symbol).toBe('ZZZ');
  });
});
