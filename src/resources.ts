import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ActualClient } from './client/actual-client.js';

export function setupResources(
  _server: McpServer,
  _client: ActualClient,
  _currencySymbol: string,
): void {
  // Filled in during Phase 4.11 (port to McpServer.resource() API).
}
