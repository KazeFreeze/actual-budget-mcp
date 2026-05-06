import { describe, it, expect } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { FakeActualClient } from '../../src/client/fake-client.js';
import { setupResources } from '../../src/resources.js';

interface ResourceEntry {
  name: string;
  metadata?: { mimeType?: string; description?: string; title?: string };
  readCallback: (uri: URL) => Promise<{
    contents: Array<{ uri: string; mimeType?: string; text?: string }>;
  }>;
}

function setupForResources(): {
  server: McpServer;
  client: FakeActualClient;
  resources: Record<string, ResourceEntry>;
} {
  const client = new FakeActualClient();
  const server = new McpServer({ name: 't', version: '0' }, { capabilities: { resources: {} } });
  setupResources(server, client);
  const resources = (server as unknown as { _registeredResources: Record<string, ResourceEntry> })
    ._registeredResources;
  return { server, client, resources };
}

async function readUri(resources: Record<string, ResourceEntry>, uri: string): Promise<string> {
  const entry = resources[uri];
  if (!entry) throw new Error(`resource not registered: ${uri}`);
  const result = await entry.readCallback(new URL(uri));
  return result.contents[0]?.text ?? '';
}

describe('resources', () => {
  it('registers all three resources at expected URIs', () => {
    const { resources } = setupForResources();
    expect(Object.keys(resources).sort()).toEqual([
      'actual://accounts',
      'actual://categories',
      'actual://payees',
    ]);
  });

  it('all registered resources advertise text/markdown mimeType', () => {
    const { resources } = setupForResources();
    for (const [, entry] of Object.entries(resources)) {
      expect(entry.metadata?.mimeType).toBe('text/markdown');
    }
  });

  it('actual://accounts renders a markdown table including the seeded account name and balance', async () => {
    const { client, resources } = setupForResources();
    client.seedAccount({ id: 'a1', name: 'Checking', offbudget: false, closed: false });
    // Override balance so we can assert the formatted value appears.
    client.getAccountBalance = (_id: string): Promise<number> => Promise.resolve(12345);

    const text = await readUri(resources, 'actual://accounts');
    expect(text).toContain('# Accounts');
    expect(text).toContain('Checking');
    expect(text).toContain('On Budget');
    expect(text).toContain('Open');
    expect(text).toContain('123.45');
  });

  it('actual://accounts marks closed and offbudget accounts correctly', async () => {
    const { client, resources } = setupForResources();
    client.seedAccount({ id: 'a1', name: 'OldSavings', offbudget: true, closed: true });
    client.getAccountBalance = (_id: string): Promise<number> => Promise.resolve(0);

    const text = await readUri(resources, 'actual://accounts');
    expect(text).toContain('OldSavings');
    expect(text).toContain('Off Budget');
    expect(text).toContain('Closed');
  });

  it('actual://categories includes seeded group and category', async () => {
    const { client, resources } = setupForResources();
    const groupId = await client.createCategoryGroup({ name: 'Spending', is_income: false });
    await client.createCategory({ name: 'Groceries', group_id: groupId });
    // Need to expose the category via the group's `categories` list — refetch via getCategoryGroups.
    // FakeActualClient stores them separately; re-wire via override for this test.
    client.getCategoryGroups = (): Promise<
      Array<{
        id: string;
        name: string;
        is_income?: boolean;
        categories?: Array<{ id: string; name: string; group_id: string }>;
      }>
    > =>
      Promise.resolve([
        {
          id: groupId,
          name: 'Spending',
          is_income: false,
          categories: [{ id: 'c1', name: 'Groceries', group_id: groupId }],
        },
      ]);

    const text = await readUri(resources, 'actual://categories');
    expect(text).toContain('# Categories');
    expect(text).toContain('## Spending');
    expect(text).toContain('Groceries');
  });

  it('actual://categories labels income groups with "(Income)"', async () => {
    const { client, resources } = setupForResources();
    client.getCategoryGroups = (): Promise<
      Array<{ id: string; name: string; is_income?: boolean; categories?: never[] }>
    > => Promise.resolve([{ id: 'g1', name: 'Salary', is_income: true, categories: [] }]);

    const text = await readUri(resources, 'actual://categories');
    expect(text).toContain('## Salary (Income)');
    expect(text).toContain('_No categories in this group._');
  });

  it('actual://payees renders payees and excludes transfer payees', async () => {
    const { client, resources } = setupForResources();
    await client.createPayee({ name: 'Coffee Shop' });
    await client.createPayee({ name: 'Transfer to Savings', transfer_acct: 'a2' });

    const text = await readUri(resources, 'actual://payees');
    expect(text).toContain('# Payees');
    expect(text).toContain('Coffee Shop');
    expect(text).not.toContain('Transfer to Savings');
  });

  it('readCallback returns ReadResourceResult with uri and mimeType set', async () => {
    const { resources } = setupForResources();
    const entry = resources['actual://accounts'];
    if (!entry) throw new Error('accounts resource not registered');
    const result = await entry.readCallback(new URL('actual://accounts'));
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0]?.uri).toBe('actual://accounts');
    expect(result.contents[0]?.mimeType).toBe('text/markdown');
  });
});
