import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type pino from 'pino';
import type { Config } from './config.js';
import type { ActualClient } from './client/actual-client.js';
import type { SyncCoalescer } from './client/sync-coalescer.js';
import { registerAllTools } from './tools/register.js';
import { setupResources } from './resources.js';
import { setupPrompts } from './prompts.js';
import { VERSION } from './version.js';

export interface McpServerDeps {
  config: Config;
  client: ActualClient;
  coalescer: SyncCoalescer;
  logger: pino.Logger;
}

export function createMcpServer(deps: McpServerDeps): McpServer {
  const server = new McpServer(
    { name: 'actual-budget-mcp', version: VERSION },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );

  registerAllTools(server, deps);
  setupResources(server, deps.client);
  setupPrompts(server);

  return server;
}
