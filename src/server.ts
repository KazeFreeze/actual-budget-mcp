import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Config } from './config.js';
import { createClient, type ActualClient } from './client.js';
import { createCrudTools } from './tools/crud.js';
import { createQueryTool } from './tools/query.js';
import { createAnalyticsTools } from './tools/analytics.js';
import { setupResources } from './resources.js';
import { setupPrompts } from './prompts.js';

interface ServerOptions {
  config: Config;
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function createMcpServer(options: ServerOptions) {
  const { config } = options;

  const client: ActualClient = createClient({
    baseUrl: config.actualHttpApiUrl,
    apiKey: config.actualHttpApiKey,
    budgetSyncId: config.budgetSyncId,
  });

  // eslint-disable-next-line @typescript-eslint/no-deprecated
  const server = new Server(
    { name: 'actual-budget-mcp', version: '0.1.0' },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );

  // Collect all tools
  const crudTools = createCrudTools(client, config.currencySymbol);
  const queryTool = createQueryTool(client, config.currencySymbol);
  const analyticsTools = createAnalyticsTools(client, config.currencySymbol);
  const allTools = [...crudTools, queryTool, ...analyticsTools];

  // Register tool list handler
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: allTools.map((t) => t.schema),
  }));

  // Register tool call handler
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<any> => {
    const { name, arguments: args } = request.params;
    const tool = allTools.find((t) => t.schema.name === name);
    if (!tool) {
      return { content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }], isError: true };
    }
    return tool.handler(args ?? {});
  });

  // Register resources and prompts
  setupResources(server, client, config.currencySymbol);
  setupPrompts(server);

  return { server, client };
}
