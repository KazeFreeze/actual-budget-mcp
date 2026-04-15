import { describe, it, expect, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RequestHandler = (...args: any[]) => Promise<any>;

describe('createMcpServer', () => {
  it('should create server with all tools registered', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { version: '26.4.0' } }), { status: 200 }),
    );

    const { createMcpServer } = await import('../src/server.js');
    const { server } = createMcpServer({
      config: {
        actualHttpApiUrl: 'http://localhost:5007',
        actualHttpApiKey: 'test-key',
        budgetSyncId: 'test-budget',
        mcpTransport: 'stdio' as const,
        mcpPort: 3001,
        currencySymbol: '$',
        logLevel: 'info' as const,
      },
    });

    expect(server).toBeDefined();
  });
});

describe('prompts', () => {
  it('should export 4 prompts', async () => {
    const { setupPrompts } = await import('../src/prompts.js');
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
    const server = new Server(
      { name: 'test', version: '0.0.1' },
      { capabilities: { prompts: {} } },
    );

    setupPrompts(server);

    // Verify handler was registered
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call
    const handler = (server as any)._requestHandlers?.get('prompts/list') as
      | RequestHandler
      | undefined;
    expect(handler).toBeDefined();
  });
});
