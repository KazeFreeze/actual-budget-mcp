#!/usr/bin/env node
import pino from 'pino';
import { loadConfig } from './config.js';
import { createMcpServer } from './server.js';
import { createAuthMiddleware } from './auth.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const config = loadConfig();
const logger = pino({ name: 'actual-mcp', level: config.logLevel });
const { server, client } = createMcpServer({ config });

async function main() {
  if (config.mcpTransport === 'stdio') {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info('MCP server running on stdio');
  } else {
    const express = (await import('express')).default;
    const helmet = (await import('helmet')).default;
    const { rateLimit } = await import('express-rate-limit');
    const app = express();

    // Parse JSON bodies for HTTP transport
    app.use(express.json());

    // Security headers
    app.use(helmet({ contentSecurityPolicy: false }));

    // Rate limiting
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      limit: 100, // 100 requests per window per IP
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Too many requests, please try again later' },
    });
    app.use(limiter);

    if (config.mcpAuthToken) {
      const auth = createAuthMiddleware(config.mcpAuthToken);
      app.use((req, res, next) => {
        // Skip auth for health check
        if (req.path === '/health') return next();
        auth(req, res, next);
      });
    }

    app.get('/health', async (_req, res) => {
      const healthy = await client.checkHealth();
      res.status(healthy ? 200 : 503).json({ status: healthy ? 'ok' : 'unhealthy' });
    });

    if (config.mcpTransport === 'sse') {
      const { SSEServerTransport } = await import('@modelcontextprotocol/sdk/server/sse.js');
      const transports = new Map<string, InstanceType<typeof SSEServerTransport>>();

      app.get('/sse', async (_req, res) => {
        const transport = new SSEServerTransport('/messages', res);
        transports.set(transport.sessionId, transport);
        res.on('close', () => transports.delete(transport.sessionId));
        await server.connect(transport);
      });

      app.post('/messages', async (req, res) => {
        const sessionId = req.query['sessionId'] as string;
        const transport = transports.get(sessionId);
        if (!transport) {
          res.status(404).json({ error: 'Session not found' });
          return;
        }
        await transport.handlePostMessage(req, res);
      });
    } else {
      // Streamable HTTP transport
      try {
        const { StreamableHTTPServerTransport } = await import(
          '@modelcontextprotocol/sdk/server/streamableHttp.js'
        );

        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined, // stateless mode
        });

        await server.connect(transport);

        app.all('/mcp', async (req, res) => {
          await transport.handleRequest(req, res);
        });
      } catch {
        logger.error('StreamableHTTPServerTransport not available in this SDK version');
        process.exit(1);
      }
    }

    const httpServer = app.listen(config.mcpPort, () => {
      logger.info(
        { port: config.mcpPort, transport: config.mcpTransport },
        'MCP server running',
      );
    });

    const shutdown = async () => {
      logger.info('Shutting down...');
      httpServer.close();
      await server.close();
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  }
}

main().catch((err) => {
  logger.error(err, 'Failed to start MCP server');
  process.exit(1);
});
