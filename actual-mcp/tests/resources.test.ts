import { describe, it, expect, vi } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

describe('setupResources', () => {
  function mockClient() {
    return {
      getAccounts: vi.fn().mockResolvedValue({
        ok: true,
        data: [{ id: 'a1', name: 'Checking', offbudget: false, closed: false }],
      }),
      getAccountBalance: vi.fn().mockResolvedValue({ ok: true, data: 250000 }),
      getCategoryGroups: vi.fn().mockResolvedValue({
        ok: true,
        data: [{ id: 'g1', name: 'Bills', is_income: false, categories: [{ id: 'c1', name: 'Rent' }] }],
      }),
      getPayees: vi.fn().mockResolvedValue({
        ok: true,
        data: [{ id: 'p1', name: 'Costco', transfer_acct: null }],
      }),
    } as any;
  }

  it('should list 4 resources', async () => {
    const { setupResources } = await import('../src/resources.js');
    const server = new Server({ name: 'test', version: '0.0.1' }, { capabilities: { resources: {} } });
    setupResources(server, mockClient(), '$');

    // Trigger the list handler
    const handler = (server as any)._requestHandlers?.get('resources/list');
    expect(handler).toBeDefined();
  });

  it('should register a read handler', async () => {
    const { setupResources } = await import('../src/resources.js');
    const server = new Server({ name: 'test', version: '0.0.1' }, { capabilities: { resources: {} } });
    setupResources(server, mockClient(), '$');

    const handler = (server as any)._requestHandlers?.get('resources/read');
    expect(handler).toBeDefined();
  });

  it('list handler should return 4 resources with correct URIs', async () => {
    const { setupResources } = await import('../src/resources.js');
    const server = new Server({ name: 'test', version: '0.0.1' }, { capabilities: { resources: {} } });
    setupResources(server, mockClient(), '$');

    const handler = (server as any)._requestHandlers?.get('resources/list');
    const result = await handler({ method: 'resources/list', params: {} }, {});
    expect(result.resources).toHaveLength(4);
    const uris = result.resources.map((r: { uri: string }) => r.uri);
    expect(uris).toContain('actual://accounts');
    expect(uris).toContain('actual://categories');
    expect(uris).toContain('actual://payees');
    expect(uris).toContain('actual://budget-settings');
  });

  it('read handler for actual://accounts should return markdown with account data', async () => {
    const { setupResources } = await import('../src/resources.js');
    const client = mockClient();
    const server = new Server({ name: 'test', version: '0.0.1' }, { capabilities: { resources: {} } });
    setupResources(server, client, '$');

    const handler = (server as any)._requestHandlers?.get('resources/read');
    const result = await handler({ method: 'resources/read', params: { uri: 'actual://accounts' } }, {});

    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].mimeType).toBe('text/markdown');
    expect(result.contents[0].text).toContain('Checking');
    expect(result.contents[0].text).toContain('$2,500.00');
    expect(client.getAccounts).toHaveBeenCalled();
    expect(client.getAccountBalance).toHaveBeenCalledWith('a1');
  });

  it('read handler for actual://categories should return markdown with category tree', async () => {
    const { setupResources } = await import('../src/resources.js');
    const client = mockClient();
    const server = new Server({ name: 'test', version: '0.0.1' }, { capabilities: { resources: {} } });
    setupResources(server, client, '$');

    const handler = (server as any)._requestHandlers?.get('resources/read');
    const result = await handler({ method: 'resources/read', params: { uri: 'actual://categories' } }, {});

    expect(result.contents[0].mimeType).toBe('text/markdown');
    expect(result.contents[0].text).toContain('Bills');
    expect(result.contents[0].text).toContain('Rent');
    expect(client.getCategoryGroups).toHaveBeenCalled();
  });

  it('read handler for actual://payees should return markdown with payees', async () => {
    const { setupResources } = await import('../src/resources.js');
    const client = mockClient();
    const server = new Server({ name: 'test', version: '0.0.1' }, { capabilities: { resources: {} } });
    setupResources(server, client, '$');

    const handler = (server as any)._requestHandlers?.get('resources/read');
    const result = await handler({ method: 'resources/read', params: { uri: 'actual://payees' } }, {});

    expect(result.contents[0].mimeType).toBe('text/markdown');
    expect(result.contents[0].text).toContain('Costco');
    expect(client.getPayees).toHaveBeenCalled();
  });

  it('read handler for actual://budget-settings should return currency symbol', async () => {
    const { setupResources } = await import('../src/resources.js');
    const server = new Server({ name: 'test', version: '0.0.1' }, { capabilities: { resources: {} } });
    setupResources(server, mockClient(), '$');

    const handler = (server as any)._requestHandlers?.get('resources/read');
    const result = await handler({ method: 'resources/read', params: { uri: 'actual://budget-settings' } }, {});

    expect(result.contents[0].mimeType).toBe('text/markdown');
    expect(result.contents[0].text).toContain('$');
  });

  it('read handler for unknown URI should throw an error', async () => {
    const { setupResources } = await import('../src/resources.js');
    const server = new Server({ name: 'test', version: '0.0.1' }, { capabilities: { resources: {} } });
    setupResources(server, mockClient(), '$');

    const handler = (server as any)._requestHandlers?.get('resources/read');
    await expect(
      handler({ method: 'resources/read', params: { uri: 'actual://unknown' } }, {}),
    ).rejects.toThrow();
  });
});
