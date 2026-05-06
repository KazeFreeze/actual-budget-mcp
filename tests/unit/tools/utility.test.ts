import { describe, it, expect } from 'vitest';
import { setup, call } from './_helpers.js';
import { registerUtilityTools } from '../../../src/tools/utility.js';
import { SyncCoalescer } from '../../../src/client/sync-coalescer.js';
import { FakeActualClient } from '../../../src/client/fake-client.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import pino from 'pino';
import type { Config } from '../../../src/config.js';

describe('get-id-by-name', () => {
  it('returns the id for a unique category match', async () => {
    const { server, client } = setup(registerUtilityTools);
    const id = await client.createCategory({ name: 'Food', group_id: 'g1' });
    const r = await call(server, 'get-id-by-name', { type: 'category', name: 'Food' });
    expect(r.isError).toBeFalsy();
    expect(r.content[0]?.text).toBe(id);
  });

  it('returns the id for a unique account match', async () => {
    const { server, client } = setup(registerUtilityTools);
    const id = await client.createAccount({ name: 'Checking' });
    const r = await call(server, 'get-id-by-name', { type: 'account', name: 'Checking' });
    expect(r.isError).toBeFalsy();
    expect(r.content[0]?.text).toBe(id);
  });

  it('returns the id for a unique payee match', async () => {
    const { server, client } = setup(registerUtilityTools);
    const id = await client.createPayee({ name: 'Walmart' });
    const r = await call(server, 'get-id-by-name', { type: 'payee', name: 'Walmart' });
    expect(r.isError).toBeFalsy();
    expect(r.content[0]?.text).toBe(id);
  });

  it('returns "not found" when no entity matches', async () => {
    const { server } = setup(registerUtilityTools);
    const r = await call(server, 'get-id-by-name', { type: 'category', name: 'Nonexistent' });
    expect(r.isError).toBeFalsy();
    expect(r.content[0]?.text).toBe('not found');
  });

  it('returns "ambiguous: ..." when multiple entities match', async () => {
    const { server, client } = setup(registerUtilityTools);
    const id1 = await client.createCategory({ name: 'Misc', group_id: 'g1' });
    const id2 = await client.createCategory({ name: 'Misc', group_id: 'g2' });
    const r = await call(server, 'get-id-by-name', { type: 'category', name: 'Misc' });
    expect(r.isError).toBeFalsy();
    const text = r.content[0]?.text ?? '';
    expect(text.startsWith('ambiguous:')).toBe(true);
    expect(text).toContain(id1);
    expect(text).toContain(id2);
  });

  it('zod rejects an invalid type', async () => {
    const { server } = setup(registerUtilityTools);
    await expect(
      call(server, 'get-id-by-name', { type: 'invalid', name: 'Food' }),
    ).rejects.toThrow();
  });

  it('zod rejects an empty name', async () => {
    const { server } = setup(registerUtilityTools);
    await expect(call(server, 'get-id-by-name', { type: 'category', name: '' })).rejects.toThrow();
  });
});

describe('get-server-version', () => {
  it('returns mcpVersion, sdkVersion, and lastSyncAt as null before any sync', async () => {
    const { server } = setup(registerUtilityTools);
    const r = await call(server, 'get-server-version', {});
    expect(r.isError).toBeFalsy();
    const parsed = JSON.parse(r.content[0]?.text ?? '') as {
      mcpVersion: string;
      sdkVersion: string;
      lastSyncAt: string | null;
    };
    expect(parsed.mcpVersion).toBe('2.0.0');
    expect(typeof parsed.sdkVersion).toBe('string');
    expect(parsed.sdkVersion.length).toBeGreaterThan(0);
    expect(parsed.lastSyncAt).toBeNull();
  });

  it('reflects coalescer.lastSyncAt after a sync', async () => {
    // Build the wiring manually so we can drive the coalescer directly.
    const client = new FakeActualClient();
    const coalescer = new SyncCoalescer(client, 2000);
    const logger = pino({ level: 'silent' });
    const server = new McpServer({ name: 't', version: '0' }, { capabilities: { tools: {} } });
    registerUtilityTools(server, {
      config: {} as Config,
      client,
      coalescer,
      logger,
      currencySymbol: '$',
    });

    await coalescer.maybeSync();
    const syncCountBefore = client.syncCount;

    const r = await call(server, 'get-server-version', {});
    expect(r.isError).toBeFalsy();
    const parsed = JSON.parse(r.content[0]?.text ?? '') as { lastSyncAt: string | null };
    expect(parsed.lastSyncAt).not.toBeNull();
    expect(typeof parsed.lastSyncAt).toBe('string');

    // Calling get-server-version must NOT itself trigger a sync.
    expect(client.syncCount).toBe(syncCountBefore);
  });
});
