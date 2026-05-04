import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult as SdkCallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { McpServerDeps } from '../server.js';
import type { AuditedHandler } from '../audit.js';
import { ok, readTool, writeTool, type CallToolResult } from './shared.js';

/**
 * Strip keys whose value is `undefined`. Required because we run with
 * `exactOptionalPropertyTypes: true` — Zod's `.optional()` produces
 * `string | undefined`, but the `ActualClient` interface declares fields
 * with `?:` (which forbids explicit `undefined` values).
 */
function compact<T extends object>(obj: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  const out = {} as { [K in keyof T]: Exclude<T[K], undefined> };
  for (const key of Object.keys(obj) as Array<keyof T>) {
    const v = obj[key];
    if (v !== undefined) {
      (out as Record<keyof T, unknown>)[key] = v;
    }
  }
  return out;
}

/**
 * Cast our local `CallToolResult` (defined in `shared.ts`) into the SDK's
 * structural `CallToolResult` (which carries an open index signature from
 * `z.core.$loose`). The shapes are identical at runtime.
 */
function toSdk(r: CallToolResult): SdkCallToolResult {
  return r as unknown as SdkCallToolResult;
}

/**
 * Adapter: the MCP SDK invokes tool callbacks as `(args, extra)` where
 * `extra` is `RequestHandlerExtra`, but `writeTool` returns an
 * `AuditedHandler<I, O>` whose second parameter is a `callerKey: string`.
 * We bridge by extracting `sessionId` from `extra` (or accepting a string
 * directly when called via the test harness).
 */
function adaptAudited<I>(
  handler: AuditedHandler<I, CallToolResult>,
): (input: I, extra: unknown) => Promise<SdkCallToolResult> {
  return async (input, extra) => {
    let callerKey = 'unknown';
    if (typeof extra === 'string') {
      callerKey = extra;
    } else if (extra && typeof extra === 'object' && 'sessionId' in extra) {
      const sid = (extra as { sessionId?: unknown }).sessionId;
      if (typeof sid === 'string') callerKey = sid;
    }
    return toSdk(await handler(input, callerKey));
  };
}

/** Wraps a `readTool` result so its return type satisfies the SDK overload. */
function adaptRead<I>(
  fn: (input: I) => Promise<CallToolResult>,
): (input: I) => Promise<SdkCallToolResult> {
  return async (input) => toSdk(await fn(input));
}

export function registerCategoryTools(server: McpServer, deps: McpServerDeps): void {
  const { client, coalescer, logger } = deps;

  server.registerTool(
    'get-categories',
    { description: 'List all categories.', inputSchema: {} },
    adaptRead(
      readTool(coalescer, async () => {
        const cats = await client.getCategories();
        return ok(JSON.stringify(cats, null, 2));
      }),
    ),
  );

  server.registerTool(
    'get-category-groups',
    { description: 'List all category groups (with their categories).', inputSchema: {} },
    adaptRead(
      readTool(coalescer, async () => {
        const groups = await client.getCategoryGroups();
        return ok(JSON.stringify(groups, null, 2));
      }),
    ),
  );

  server.registerTool(
    'create-category',
    {
      description: 'Create a new category in the given group.',
      inputSchema: {
        name: z.string().min(1),
        group_id: z.string().min(1),
        is_income: z.boolean().optional(),
        hidden: z.boolean().optional(),
      },
    },
    adaptAudited(
      writeTool(
        logger,
        'create-category',
        () => client.sync(),
        async (input) => {
          const id = await client.createCategory(compact(input));
          return ok(`Created category ${id}`);
        },
      ),
    ),
  );

  server.registerTool(
    'update-category',
    {
      description: 'Update fields on an existing category.',
      inputSchema: {
        id: z.string().min(1),
        fields: z.object({
          name: z.string().min(1).optional(),
          group_id: z.string().min(1).optional(),
          is_income: z.boolean().optional(),
          hidden: z.boolean().optional(),
        }),
      },
    },
    adaptAudited(
      writeTool(
        logger,
        'update-category',
        () => client.sync(),
        async ({ id, fields }) => {
          await client.updateCategory(id, compact(fields));
          return ok(`Updated category ${id}`);
        },
      ),
    ),
  );

  server.registerTool(
    'delete-category',
    {
      description: 'Delete a category. Optionally re-assign its transactions to another category.',
      inputSchema: { id: z.string().min(1), transferCategoryId: z.string().optional() },
    },
    adaptAudited(
      writeTool(
        logger,
        'delete-category',
        () => client.sync(),
        async ({ id, transferCategoryId }) => {
          if (transferCategoryId === undefined) {
            await client.deleteCategory(id);
          } else {
            await client.deleteCategory(id, transferCategoryId);
          }
          return ok(`Deleted category ${id}`);
        },
      ),
    ),
  );

  server.registerTool(
    'create-category-group',
    {
      description: 'Create a new category group.',
      inputSchema: { name: z.string().min(1), is_income: z.boolean().optional() },
    },
    adaptAudited(
      writeTool(
        logger,
        'create-category-group',
        () => client.sync(),
        async (input) => {
          const id = await client.createCategoryGroup(compact(input));
          return ok(`Created category group ${id}`);
        },
      ),
    ),
  );

  server.registerTool(
    'update-category-group',
    {
      description: 'Update fields on an existing category group.',
      inputSchema: {
        id: z.string().min(1),
        fields: z.object({ name: z.string().optional(), is_income: z.boolean().optional() }),
      },
    },
    adaptAudited(
      writeTool(
        logger,
        'update-category-group',
        () => client.sync(),
        async ({ id, fields }) => {
          await client.updateCategoryGroup(id, compact(fields));
          return ok(`Updated group ${id}`);
        },
      ),
    ),
  );

  server.registerTool(
    'delete-category-group',
    {
      description: 'Delete a category group. Optionally re-assign its categories.',
      inputSchema: { id: z.string().min(1), transferCategoryId: z.string().optional() },
    },
    adaptAudited(
      writeTool(
        logger,
        'delete-category-group',
        () => client.sync(),
        async ({ id, transferCategoryId }) => {
          if (transferCategoryId === undefined) {
            await client.deleteCategoryGroup(id);
          } else {
            await client.deleteCategoryGroup(id, transferCategoryId);
          }
          return ok(`Deleted group ${id}`);
        },
      ),
    ),
  );
}
