import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerDeps } from '../server.js';
import { ok, readTool, adaptRead } from './shared.js';

export function registerQueryTool(server: McpServer, deps: McpServerDeps): void {
  const { client, coalescer } = deps;

  server.registerTool(
    'query',
    {
      description: 'Run a free-form ActualQL query against the budget. Read-only.',
      inputSchema: { query: z.unknown() },
    },
    adaptRead(
      readTool(coalescer, async ({ query }) => {
        const result = await client.runQuery(query);
        return ok(JSON.stringify(result, null, 2));
      }),
    ),
  );
}
