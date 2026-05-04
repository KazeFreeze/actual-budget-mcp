import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerDeps } from '../server.js';
import { ok, readTool, adaptRead } from './shared.js';

// `@actual-app/api`'s `exports` map does not expose `./package.json`, so we
// resolve the main entry first, then walk up to read the package.json
// directly off disk. createRequire gives us a `require.resolve` that honors
// the package's `exports` field for the main entry.
const require = createRequire(import.meta.url);
const sdkMain = require.resolve('@actual-app/api');
const sdkPkgPath = resolve(dirname(sdkMain), '..', 'package.json');
// Path is derived from `require.resolve('@actual-app/api')` (a static
// dependency) — not user input.
// eslint-disable-next-line security/detect-non-literal-fs-filename
const sdkPkg = JSON.parse(readFileSync(sdkPkgPath, 'utf8')) as { version: string };

const MCP_VERSION = '2.0.0';

const EntityType = z.enum(['category', 'account', 'payee']);

export function registerUtilityTools(server: McpServer, deps: McpServerDeps): void {
  const { client, coalescer } = deps;

  server.registerTool(
    'get-id-by-name',
    {
      description:
        'Look up an entity id by name. Returns the id, "not found", or "ambiguous: id1, id2" on multiple matches.',
      inputSchema: { type: EntityType, name: z.string().min(1) },
    },
    adaptRead(
      readTool(coalescer, async ({ type, name }) => {
        let matches: Array<{ id: string; name: string }>;
        if (type === 'category') {
          matches = (await client.getCategories()).filter((c) => c.name === name);
        } else if (type === 'account') {
          matches = (await client.getAccounts()).filter((a) => a.name === name);
        } else {
          matches = (await client.getPayees()).filter((p) => p.name === name);
        }
        if (matches.length === 0) return ok('not found');
        const [first] = matches;
        if (matches.length === 1 && first) return ok(first.id);
        return ok(`ambiguous: ${matches.map((m) => m.id).join(', ')}`);
      }),
    ),
  );

  server.registerTool(
    'get-server-version',
    {
      description: 'Return MCP server version, SDK version, and last sync timestamp.',
      inputSchema: {},
    },
    adaptRead((_input) =>
      Promise.resolve(
        ok(
          JSON.stringify(
            {
              mcpVersion: MCP_VERSION,
              sdkVersion: sdkPkg.version,
              lastSyncAt: coalescer.lastSyncAt?.toISOString() ?? null,
            },
            null,
            2,
          ),
        ),
      ),
    ),
  );
}
