import { describe, it, expect } from 'vitest';
import pino from 'pino';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { z } from 'zod';
import { FakeActualClient } from '../../../src/client/fake-client.js';
import { SyncCoalescer } from '../../../src/client/sync-coalescer.js';
import { registerCategoryTools } from '../../../src/tools/categories.js';
import type { Config } from '../../../src/config.js';

interface ToolEntry {
  inputSchema?: z.ZodType;
  handler: (
    a: unknown,
    extra: unknown,
  ) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;
}

function setup(): { server: McpServer; client: FakeActualClient } {
  const client = new FakeActualClient();
  const coalescer = new SyncCoalescer(client, 2000);
  const logger = pino({ level: 'silent' });
  const server = new McpServer({ name: 't', version: '0' }, { capabilities: { tools: {} } });
  registerCategoryTools(server, {
    config: {} as Config,
    client,
    coalescer,
    logger,
  });
  return { server, client };
}

async function call(
  server: McpServer,
  tool: string,
  args: unknown,
): Promise<{ content: Array<{ text: string }>; isError?: boolean }> {
  const tools = (server as unknown as { _registeredTools: Record<string, ToolEntry> })
    ._registeredTools;
  const entry = tools[tool];
  if (!entry) throw new Error(`tool not registered: ${tool}`);
  // Mimic the SDK's CallToolRequest path: validate input via the stored
  // zod schema before invoking the handler. The SDK does this in
  // validateToolInput() (see node_modules/@modelcontextprotocol/sdk/.../server/mcp.js).
  const parsed = entry.inputSchema ? await entry.inputSchema.parseAsync(args) : args;
  return entry.handler(parsed, 'test-caller-12');
}

describe('category tools', () => {
  it('get-categories returns categories from client', async () => {
    const { server, client } = setup();
    await client.createCategory({ name: 'Food', group_id: 'g1' });
    const r = await call(server, 'get-categories', {});
    expect(r.isError).toBeFalsy();
    const first = r.content[0];
    expect(first?.text).toContain('Food');
  });

  it('create-category creates a category and returns its id', async () => {
    const { server, client } = setup();
    const groupId = await client.createCategoryGroup({ name: 'Spending' });
    const r = await call(server, 'create-category', { name: 'Rent', group_id: groupId });
    expect(r.isError).toBeFalsy();
    expect(await client.getCategories()).toHaveLength(1);
  });

  it('update-category updates a field', async () => {
    const { server, client } = setup();
    const id = await client.createCategory({ name: 'Old', group_id: 'g1' });
    const r = await call(server, 'update-category', { id, fields: { name: 'New' } });
    expect(r.isError).toBeFalsy();
    const cats = await client.getCategories();
    expect(cats[0]?.name).toBe('New');
  });

  it('delete-category removes the category', async () => {
    const { server, client } = setup();
    const id = await client.createCategory({ name: 'X', group_id: 'g1' });
    await call(server, 'delete-category', { id });
    expect(await client.getCategories()).toHaveLength(0);
  });

  it('zod rejects invalid input', async () => {
    const { server } = setup();
    await expect(
      call(server, 'create-category', { /* missing name */ group_id: 'g' }),
    ).rejects.toThrow();
  });
});
