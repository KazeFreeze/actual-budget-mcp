#!/usr/bin/env node
import pino from 'pino';
import { loadConfig } from './config.js';
import { SdkActualClient } from './client/sdk-client.js';
import { SyncCoalescer } from './client/sync-coalescer.js';
import { installSignalHandlers } from './client/lifecycle.js';
import { createMcpServer } from './server.js';
import { createApp } from './app.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const VERSION = '2.0.0';

const config = loadConfig();
const logger = pino({ name: 'actual-mcp', level: config.logLevel });

let sdkReady = false;

async function main(): Promise<void> {
  const client = new SdkActualClient({
    dataDir: config.mcpDataDir,
    serverURL: config.actualServerUrl,
    password: config.actualServerPassword,
    syncId: config.budgetSyncId,
    ...(config.budgetEncryptionPassword
      ? { encryptionPassword: config.budgetEncryptionPassword }
      : {}),
  });

  await client.init();
  sdkReady = true;

  const coalescer = new SyncCoalescer(client, 2000);

  installSignalHandlers(client, () => {
    logger.info('Shutting down...');
    return Promise.resolve();
  });

  if (config.mcpTransport === 'stdio') {
    const server = createMcpServer({ config, client, coalescer, logger });
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info('MCP server running on stdio');
    return;
  }

  const { app } = await createApp({
    config,
    client,
    coalescer,
    sdkInitialized: () => sdkReady,
    logger,
    version: VERSION,
  });

  app.listen(config.mcpPort, () => {
    logger.info({ port: config.mcpPort, transport: config.mcpTransport }, 'MCP server running');
  });
}

main().catch((err: unknown) => {
  logger.error(err, 'Failed to start MCP server');
  process.exit(1);
});
