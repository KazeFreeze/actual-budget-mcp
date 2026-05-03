import type pino from 'pino';
import type { Express } from 'express';
import type { Config } from './config.js';
import { createMcpServer } from './server.js';
import { createAuthMiddleware } from './auth.js';

export async function createApp(
  config: Config,
  logger: pino.Logger,
): Promise<{ app: Express; cleanup: () => Promise<void> }> {
  const express = (await import('express')).default;
  const helmet = (await import('helmet')).default;
  const { rateLimit } = await import('express-rate-limit');
  const app = express();

  // Parse JSON bodies — skip for SSE /messages route (transport reads raw stream)
  app.use((req, res, next) => {
    if (req.path === '/messages') {
      next();
      return;
    }
    express.json()(req, res, next);
  });

  app.use(helmet({ contentSecurityPolicy: false }));

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later' },
  });
  app.use(limiter);

  if (config.mcpAuthToken) {
    const auth = createAuthMiddleware(config.mcpAuthToken);
    app.use((req, res, next) => {
      // Skip auth for health check and MCP OAuth discovery flow
      // SDK probes /.well-known/oauth-authorization-server then POST /register
      // Let them 404 naturally so SDK falls back to custom headers
      if (
        req.path === '/health' ||
        req.path.startsWith('/.well-known/') ||
        req.path === '/register' ||
        req.path === '/authorize' ||
        req.path === '/token'
      ) {
        next();
        return;
      }
      auth(req, res, next);
    });
  }

  const { client: healthClient } = createMcpServer({ config });

  app.get('/health', async (_req, res) => {
    const healthy = await healthClient.checkHealth();
    res.status(healthy ? 200 : 503).json({ status: healthy ? 'ok' : 'unhealthy' });
  });

  let cleanup = async (): Promise<void> => {};

  if (config.mcpTransport === 'sse') {
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const { SSEServerTransport } = await import('@modelcontextprotocol/sdk/server/sse.js');
    const transports = new Map<string, InstanceType<typeof SSEServerTransport>>();

    app.get('/sse', async (_req, res) => {
      // Fresh Server per connection: SDK's Server.connect throws if a Server
      // instance is reused across transports.
      const { server: sessionServer } = createMcpServer({ config });
      const transport = new SSEServerTransport('/messages', res);
      transports.set(transport.sessionId, transport);

      // SSE comment heartbeat: prevents Cloudflare/Traefik from dropping
      // idle TCP connections (Cloudflare's edge times out around 100s).
      // Comments (lines starting with ':') are ignored by SSE parsers.
      const ping = setInterval(() => {
        if (!res.writable) {
          clearInterval(ping);
          return;
        }
        try {
          res.write(': ping\n\n');
        } catch {
          clearInterval(ping);
        }
      }, 25_000);

      res.on('close', () => {
        clearInterval(ping);
        transports.delete(transport.sessionId);
        void sessionServer.close();
      });
      await sessionServer.connect(transport);
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
    try {
      const { StreamableHTTPServerTransport } =
        await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
      const { server } = createMcpServer({ config });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await server.connect(transport);

      app.all('/mcp', async (req, res) => {
        await transport.handleRequest(req, res);
      });

      cleanup = async (): Promise<void> => {
        await server.close();
      };
    } catch {
      logger.error('StreamableHTTPServerTransport not available in this SDK version');
      process.exit(1);
    }
  }

  return { app, cleanup };
}
