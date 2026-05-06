import pino from 'pino';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { z } from 'zod';
import { FakeActualClient } from '../../../src/client/fake-client.js';
import { SyncCoalescer } from '../../../src/client/sync-coalescer.js';
import type { McpServerDeps } from '../../../src/server.js';
import type { Config } from '../../../src/config.js';

export interface ToolEntry {
  inputSchema?: z.ZodType;
  handler: (
    a: unknown,
    extra: unknown,
  ) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;
}

export function setup(register: (server: McpServer, deps: McpServerDeps) => void): {
  server: McpServer;
  client: FakeActualClient;
} {
  const client = new FakeActualClient();
  const coalescer = new SyncCoalescer(client, 2000);
  const logger = pino({ level: 'silent' });
  const server = new McpServer({ name: 't', version: '0' }, { capabilities: { tools: {} } });
  register(server, {
    config: {} as Config,
    client,
    coalescer,
    logger,
    currencySymbol: '$',
  });
  return { server, client };
}

export async function call(
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
