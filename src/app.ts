import type pino from 'pino';
import type { Express } from 'express';
import type { Config } from './config.js';
import type { ActualClient } from './client/actual-client.js';
import type { SyncCoalescer } from './client/sync-coalescer.js';
import { createMcpServer } from './server.js';
import { createAuthMiddleware, originAllowlist } from './auth.js';
import { mountHealth } from './health.js';

export interface AppDeps {
  config: Config;
  client: ActualClient;
  coalescer: SyncCoalescer;
  sdkInitialized: () => boolean;
  logger: pino.Logger;
  version: string;
  currencySymbol: string;
}

export async function createApp(
  deps: AppDeps,
): Promise<{ app: Express; cleanup: () => Promise<void> }> {
  const { config, client, coalescer, sdkInitialized, logger, version, currencySymbol } = deps;
  const express = (await import('express')).default;
  const helmet = (await import('helmet')).default;
  const { rateLimit } = await import('express-rate-limit');
  const app = express();

  app.use((req, res, next) => {
    if (req.path === '/messages') {
      next();
      return;
    }
    express.json()(req, res, next);
  });

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(originAllowlist(config.mcpAllowedOrigins));

  const limiter = rateLimit({
    windowMs: 60_000,
    limit: config.mcpRateLimitPerMin,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) =>
      (req as unknown as { callerKey?: string }).callerKey ?? req.ip ?? 'anonymous',
    message: { error: 'Too many requests' },
  });

  // Mount /health BEFORE auth so it's reachable for Docker healthcheck.
  mountHealth(app, { coalescer, sdkInitialized, syncId: config.budgetSyncId, version });

  if (config.mcpApiKeys.length > 0) {
    const auth = createAuthMiddleware(config.mcpApiKeys);
    app.use((req, res, next) => {
      if (req.path === '/health') {
        next();
        return;
      }
      auth(req, res, next);
    });
  }
  app.use((req, res, next) => {
    if (req.path === '/health') next();
    else limiter(req, res, next);
  });

  let cleanup = async (): Promise<void> => {};

  if (config.mcpTransport === 'sse') {
    logger.warn(
      'SSE transport is deprecated and will be removed in v2.1; migrate to Streamable HTTP at /mcp',
    );
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const { SSEServerTransport } = await import('@modelcontextprotocol/sdk/server/sse.js');
    const transports = new Map<string, InstanceType<typeof SSEServerTransport>>();

    const setSunsetHeaders = (res: Parameters<Parameters<typeof app.get>[1]>[1]): void => {
      res.setHeader('Deprecation', 'true');
      res.setHeader('Sunset', 'Sat, 01 Aug 2026 00:00:00 GMT');
    };

    app.get('/sse', async (_req, res) => {
      setSunsetHeaders(res);
      const sessionServer = createMcpServer({ config, client, coalescer, logger, currencySymbol });
      const transport = new SSEServerTransport('/messages', res);
      transports.set(transport.sessionId, transport);
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
      setSunsetHeaders(res);
      const sessionId = req.query['sessionId'] as string;
      const transport = transports.get(sessionId);
      if (!transport) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      await transport.handlePostMessage(req, res);
    });
  } else {
    const { StreamableHTTPServerTransport } =
      await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
    const { randomUUID } = await import('node:crypto');

    // Per-session server + transport pairs.
    //
    // A SINGLE shared StreamableHTTPServerTransport cannot be reused across
    // multiple clients: in stateless mode it throws after the first request
    // ("Stateless transport cannot be reused"), and in stateful mode it
    // rejects every subsequent `initialize` ("Server already initialized").
    // The correct pattern (mirrored from the SSE branch above) is to spin
    // up a fresh server+transport per session, keyed by the SDK-generated
    // session id, and dispatch incoming requests by Mcp-Session-Id header.
    type Transport = InstanceType<typeof StreamableHTTPServerTransport>;
    const sessions = new Map<
      string,
      { transport: Transport; server: ReturnType<typeof createMcpServer> }
    >();

    app.all('/mcp', async (req, res) => {
      const sessionHeader = req.headers['mcp-session-id'];
      const sessionId = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;

      let entry = sessionId ? sessions.get(sessionId) : undefined;

      if (!entry) {
        // No (or unknown) session — must be an `initialize` request. The
        // transport will assign a session id during handleRequest and emit
        // it via the `onsessioninitialized` callback so we can route
        // subsequent requests for this session.
        const sessionServer = createMcpServer({
          config,
          client,
          coalescer,
          logger,
          currencySymbol,
        });
        const sessionTransport: Transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid: string) => {
            sessions.set(sid, { transport: sessionTransport, server: sessionServer });
          },
          onsessionclosed: (sid: string) => {
            sessions.delete(sid);
            void sessionServer.close();
          },
        });
        // Cast: SDK's transport declares `onclose: (() => void) | undefined`
        // but the Transport interface uses `onclose?: () => void`. Under
        // `exactOptionalPropertyTypes` these are incompatible despite being
        // structurally equivalent.
        await sessionServer.connect(
          sessionTransport as Parameters<typeof sessionServer.connect>[0],
        );
        entry = { transport: sessionTransport, server: sessionServer };
      }

      // Pass `req.body` explicitly: express.json() (mounted above) consumes
      // the underlying request stream, so the SDK cannot re-read it.
      await entry.transport.handleRequest(req, res, req.body);
    });

    cleanup = async (): Promise<void> => {
      // Tear down every still-open session on shutdown so no MCP server
      // instance leaks (each holds a reference to the SDK client/coalescer).
      const closes = Array.from(sessions.values()).map(({ server: s }) => s.close());
      sessions.clear();
      await Promise.allSettled(closes);
    };
  }

  return { app, cleanup };
}
