import { describe, it, expect, vi } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { ActualClient } from '../src/client.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RequestHandler = (...args: any[]) => Promise<any>;

/** Access private _requestHandlers map on Server for testing. */
// eslint-disable-next-line @typescript-eslint/no-deprecated
function getHandler(server: Server, method: string): RequestHandler | undefined {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call
  return (server as any)._requestHandlers?.get(method) as RequestHandler | undefined;
}

interface ResourceResult {
  contents: Array<{ mimeType: string; text: string }>;
}

interface ResourceListResult {
  resources: Array<{ uri: string }>;
}

describe('setupResources', () => {
  function mockClient(): ActualClient {
    return {
      getAccounts: vi.fn().mockResolvedValue({
        ok: true,
        data: [{ id: 'a1', name: 'Checking', offbudget: false, closed: false }],
      }),
      getAccountBalance: vi.fn().mockResolvedValue({ ok: true, data: 250000 }),
      getCategoryGroups: vi.fn().mockResolvedValue({
        ok: true,
        data: [
          {
            id: 'g1',
            name: 'Bills',
            is_income: false,
            categories: [{ id: 'c1', name: 'Rent' }],
          },
        ],
      }),
      getPayees: vi.fn().mockResolvedValue({
        ok: true,
        data: [{ id: 'p1', name: 'Costco', transfer_acct: null }],
      }),
    } as unknown as ActualClient;
  }

  // eslint-disable-next-line @typescript-eslint/no-deprecated
  function createTestServer(): Server {
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    return new Server({ name: 'test', version: '0.0.1' }, { capabilities: { resources: {} } });
  }

  it('should list 4 resources', async () => {
    const { setupResources } = await import('../src/resources.js');
    const server = createTestServer();
    setupResources(server, mockClient(), '$');

    const handler = getHandler(server, 'resources/list');
    expect(handler).toBeDefined();
  });

  it('should register a read handler', async () => {
    const { setupResources } = await import('../src/resources.js');
    const server = createTestServer();
    setupResources(server, mockClient(), '$');

    const handler = getHandler(server, 'resources/read');
    expect(handler).toBeDefined();
  });

  it('list handler should return 4 resources with correct URIs', async () => {
    const { setupResources } = await import('../src/resources.js');
    const server = createTestServer();
    setupResources(server, mockClient(), '$');

    const handler = getHandler(server, 'resources/list');
    expect(handler).toBeDefined();
    if (!handler) return;

    const result = (await handler(
      { method: 'resources/list', params: {} },
      {},
    )) as ResourceListResult;
    expect(result.resources).toHaveLength(4);
    const uris = result.resources.map((r) => r.uri);
    expect(uris).toContain('actual://accounts');
    expect(uris).toContain('actual://categories');
    expect(uris).toContain('actual://payees');
    expect(uris).toContain('actual://budget-settings');
  });

  it('read handler for actual://accounts should return markdown with account data', async () => {
    const { setupResources } = await import('../src/resources.js');
    const client = mockClient();
    const server = createTestServer();
    setupResources(server, client, '$');

    const handler = getHandler(server, 'resources/read');
    expect(handler).toBeDefined();
    if (!handler) return;

    const result = (await handler(
      { method: 'resources/read', params: { uri: 'actual://accounts' } },
      {},
    )) as ResourceResult;

    expect(result.contents).toHaveLength(1);
    const content = result.contents[0];
    expect(content).toBeDefined();
    expect(content?.mimeType).toBe('text/markdown');
    expect(content?.text).toContain('Checking');
    expect(content?.text).toContain('$2,500.00');
    expect(client.getAccounts).toHaveBeenCalled();
    expect(client.getAccountBalance).toHaveBeenCalledWith('a1');
  });

  it('read handler for actual://categories should return markdown with category tree', async () => {
    const { setupResources } = await import('../src/resources.js');
    const client = mockClient();
    const server = createTestServer();
    setupResources(server, client, '$');

    const handler = getHandler(server, 'resources/read');
    expect(handler).toBeDefined();
    if (!handler) return;

    const result = (await handler(
      { method: 'resources/read', params: { uri: 'actual://categories' } },
      {},
    )) as ResourceResult;

    const content = result.contents[0];
    expect(content?.mimeType).toBe('text/markdown');
    expect(content?.text).toContain('Bills');
    expect(content?.text).toContain('Rent');
    expect(client.getCategoryGroups).toHaveBeenCalled();
  });

  it('read handler for actual://payees should return markdown with payees', async () => {
    const { setupResources } = await import('../src/resources.js');
    const client = mockClient();
    const server = createTestServer();
    setupResources(server, client, '$');

    const handler = getHandler(server, 'resources/read');
    expect(handler).toBeDefined();
    if (!handler) return;

    const result = (await handler(
      { method: 'resources/read', params: { uri: 'actual://payees' } },
      {},
    )) as ResourceResult;

    const content = result.contents[0];
    expect(content?.mimeType).toBe('text/markdown');
    expect(content?.text).toContain('Costco');
    expect(client.getPayees).toHaveBeenCalled();
  });

  it('read handler for actual://budget-settings should return currency symbol', async () => {
    const { setupResources } = await import('../src/resources.js');
    const server = createTestServer();
    setupResources(server, mockClient(), '$');

    const handler = getHandler(server, 'resources/read');
    expect(handler).toBeDefined();
    if (!handler) return;

    const result = (await handler(
      { method: 'resources/read', params: { uri: 'actual://budget-settings' } },
      {},
    )) as ResourceResult;

    const content = result.contents[0];
    expect(content?.mimeType).toBe('text/markdown');
    expect(content?.text).toContain('$');
  });

  it('read handler for unknown URI should throw an error', async () => {
    const { setupResources } = await import('../src/resources.js');
    const server = createTestServer();
    setupResources(server, mockClient(), '$');

    const handler = getHandler(server, 'resources/read');
    expect(handler).toBeDefined();
    if (!handler) return;

    await expect(
      handler({ method: 'resources/read', params: { uri: 'actual://unknown' } }, {}),
    ).rejects.toThrow();
  });
});
