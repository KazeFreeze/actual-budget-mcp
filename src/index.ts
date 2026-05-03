#!/usr/bin/env node
import pino from 'pino';
import { loadConfig } from './config.js';
import { createMcpServer } from './server.js';
import { createApp } from './app.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const config = loadConfig();
const logger = pino({ name: 'actual-mcp', level: config.logLevel });

async function main(): Promise<void> {
  if (config.mcpTransport === 'stdio') {
    const { server } = createMcpServer({ config });
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info('MCP server running on stdio');
    return;
  }

  const { app, cleanup } = await createApp(config, logger);

  const httpServer = app.listen(config.mcpPort, () => {
    logger.info({ port: config.mcpPort, transport: config.mcpTransport }, 'MCP server running');
  });

  const shutdown = async (): Promise<void> => {
    logger.info('Shutting down...');
    httpServer.close();
    await cleanup();
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    void shutdown();
  });
  process.on('SIGINT', () => {
    void shutdown();
  });
}

main().catch((err: unknown) => {
  logger.error(err, 'Failed to start MCP server');
  process.exit(1);
});
