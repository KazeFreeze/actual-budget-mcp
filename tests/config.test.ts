import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../src/config.js';

const REQUIRED_OK = {
  ACTUAL_SERVER_URL: 'http://actual:5006',
  ACTUAL_SERVER_PASSWORD: 'pw',
  ACTUAL_BUDGET_SYNC_ID: 'sync-id',
  MCP_API_KEYS: 'a'.repeat(20) + 'BCDEFGHIJKLMNOP', // 35 chars, 16 unique
  MCP_TRANSPORT: 'http',
  MCP_ALLOWED_ORIGINS: 'https://claude.ai',
};

describe('loadConfig', () => {
  const original = { ...process.env };
  beforeEach(() => {
    for (const k of Object.keys(process.env)) Reflect.deleteProperty(process.env, k);
  });
  afterEach(() => {
    for (const k of Object.keys(process.env)) Reflect.deleteProperty(process.env, k);
    Object.assign(process.env, original);
  });

  it('loads valid v2 config', () => {
    Object.assign(process.env, REQUIRED_OK);
    const cfg = loadConfig();
    expect(cfg.actualServerUrl).toBe('http://actual:5006');
    expect(cfg.mcpApiKeys).toHaveLength(1);
  });

  it('rejects v1 env vars with migration error', () => {
    Object.assign(process.env, REQUIRED_OK, { ACTUAL_HTTP_API_URL: 'x' });
    expect(() => loadConfig()).toThrow(/MIGRATION-v1-to-v2/);
  });

  it('rejects api keys with low entropy (<32 chars)', () => {
    Object.assign(process.env, REQUIRED_OK, { MCP_API_KEYS: 'short' });
    expect(() => loadConfig()).toThrow(/at least 32 characters/);
  });

  it('rejects api keys with <16 unique chars', () => {
    Object.assign(process.env, REQUIRED_OK, { MCP_API_KEYS: 'a'.repeat(40) });
    expect(() => loadConfig()).toThrow(/16 unique/);
  });

  it('requires MCP_API_KEYS when transport is http', () => {
    Object.assign(process.env, REQUIRED_OK);
    delete process.env.MCP_API_KEYS;
    expect(() => loadConfig()).toThrow(/MCP_API_KEYS/);
  });

  it('does not require MCP_API_KEYS when transport is stdio', () => {
    Object.assign(process.env, REQUIRED_OK, { MCP_TRANSPORT: 'stdio' });
    delete process.env.MCP_API_KEYS;
    expect(() => loadConfig()).not.toThrow();
  });

  it('parses comma-separated keys for rotation', () => {
    const k1 = 'a'.repeat(20) + 'BCDEFGHIJKLMNOP';
    const k2 = 'b'.repeat(20) + 'CDEFGHIJKLMNOPQ';
    Object.assign(process.env, REQUIRED_OK, { MCP_API_KEYS: `${k1},${k2}` });
    const cfg = loadConfig();
    expect(cfg.mcpApiKeys).toEqual([k1, k2]);
  });
});
