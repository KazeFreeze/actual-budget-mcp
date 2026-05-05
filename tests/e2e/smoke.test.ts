// E2E smoke suite — exercises the v2 MCP server end-to-end against a real
// actual-server instance over Streamable HTTP.
//
// Run via `npm run test:e2e` — requires Docker. NOT part of `npm test`
// (vitest.config.ts excludes tests/e2e/**). CI invokes the e2e script
// explicitly after the integration tests pass.
//
// What this catches that integration tests don't:
//   - HTTP wire format (auth headers, Bearer rejection, session lifecycle)
//   - Container startup ordering (actual-mcp waiting for actual-server sync)
//   - Real network round-trips through the SDK rather than in-process calls
//   - Health endpoint reachability without auth (Docker healthcheck path)
//
// Pre-req: image `actual-budget-mcp:e2e` must exist. The harness builds it
// in beforeAll (a no-op if already cached).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startStack, stopStack, type BootstrappedStack } from './setup.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '../..');

const MCP_URL = 'http://localhost:3000/mcp';

let stack: BootstrappedStack;

async function newClient(
  apiKey: string,
): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: { headers: { Authorization: `Bearer ${apiKey}` } },
  });
  const client = new Client({ name: 'e2e-smoke', version: '1.0.0' });
  // Cast: SDK's StreamableHTTPClientTransport declares `sessionId: string | undefined`
  // (a property), but the Transport interface expects `sessionId?: string` (optional).
  // Under `exactOptionalPropertyTypes`, these are incompatible despite being
  // structurally equivalent. Same workaround as src/app.ts uses for the server side.
  await client.connect(transport as unknown as Parameters<typeof client.connect>[0]);
  return { client, transport };
}

beforeAll(async () => {
  // Ensure the image is built. Docker layer cache makes this near-instant
  // when nothing changed; ensures the suite is self-contained regardless of
  // whether Task 7.1 already tagged the image.
  execSync(`docker build -t actual-budget-mcp:e2e ${REPO_ROOT}`, { stdio: 'inherit' });
  stack = await startStack();
}, 300_000);

afterAll(() => {
  stopStack();
});

describe('e2e: actual-budget-mcp v2 over Streamable HTTP', () => {
  it('rejects requests without a Bearer token (401)', async () => {
    // Use raw fetch — the SDK client would auto-handle 401 and obscure the
    // failure mode. We want to see the wire-level response.
    const res = await fetch(MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'raw', version: '0' },
        },
      }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toMatch(/Bearer/i);
  });

  it('lists tools when authenticated', async () => {
    const { client, transport } = await newClient(stack.apiKey);
    try {
      const result = await client.listTools();
      // We register ~52 tools across categories/accounts/transactions/etc.
      expect(result.tools.length).toBeGreaterThanOrEqual(30);
      const names = result.tools.map((t) => t.name);
      expect(names).toContain('get-categories');
      expect(names).toContain('set-notes');
      expect(names).toContain('get-notes');
    } finally {
      await transport.close();
    }
  });

  it('get-categories returns the seeded E2E Food category', async () => {
    const { client, transport } = await newClient(stack.apiKey);
    try {
      const result = await client.callTool({ name: 'get-categories', arguments: {} });
      expect(result.isError).not.toBe(true);
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0]?.type).toBe('text');
      const text = content[0]?.text ?? '';
      const cats = JSON.parse(text) as Array<{ id: string; name: string; group_id?: string }>;
      expect(Array.isArray(cats)).toBe(true);
      const names = cats.map((c) => c.name);
      const food = cats.find((c) => c.name === 'E2E Food');
      if (!food) {
        throw new Error(`E2E Food not found. Categories returned: ${JSON.stringify(names)}`);
      }
      expect(typeof food.id).toBe('string');
    } finally {
      await transport.close();
    }
  });

  it('set-notes / get-notes / delete-notes round-trip on a real category', async () => {
    const { client, transport } = await newClient(stack.apiKey);
    try {
      // Find the E2E Food category id from the live server.
      const catsResult = await client.callTool({ name: 'get-categories', arguments: {} });
      const catsContent = catsResult.content as Array<{ type: string; text: string }>;
      const cats = JSON.parse(catsContent[0]?.text ?? '[]') as Array<{ id: string; name: string }>;
      const food = cats.find((c) => c.name === 'E2E Food');
      if (!food) throw new Error('seed category E2E Food not found — bootstrap broken');

      const NOTE = 'smoke test note ' + Date.now().toString();

      // set-notes
      const setRes = await client.callTool({
        name: 'set-notes',
        arguments: { type: 'category', id: food.id, notes: NOTE },
      });
      expect(setRes.isError).not.toBe(true);

      // get-notes returns the note
      const getRes = await client.callTool({
        name: 'get-notes',
        arguments: { type: 'category', id: food.id },
      });
      expect(getRes.isError).not.toBe(true);
      const getContent = getRes.content as Array<{ type: string; text: string }>;
      expect(getContent[0]?.text).toBe(NOTE);

      // delete-notes clears it
      const delRes = await client.callTool({
        name: 'delete-notes',
        arguments: { type: 'category', id: food.id },
      });
      expect(delRes.isError).not.toBe(true);

      const getAfter = await client.callTool({
        name: 'get-notes',
        arguments: { type: 'category', id: food.id },
      });
      const afterContent = getAfter.content as Array<{ type: string; text: string }>;
      expect(afterContent[0]?.text).toBe('');
    } finally {
      await transport.close();
    }
  });

  it('terminates the session with HTTP DELETE', async () => {
    const { client, transport } = await newClient(stack.apiKey);
    // Trigger at least one round-trip so the server has assigned a session id.
    await client.listTools();
    const sessionId = transport.sessionId;
    expect(sessionId).toBeTruthy();

    // The SDK exposes terminateSession() which issues DELETE /mcp with the
    // Mcp-Session-Id header. A 405 would mean the server refused — we want
    // a clean 200/204 since our StreamableHTTPServerTransport supports it.
    await expect(transport.terminateSession()).resolves.not.toThrow();

    // After termination, sessionId should be cleared on the transport.
    expect(transport.sessionId).toBeUndefined();

    await transport.close();
  });
});
