import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerDeps } from '../server.js';
import { ok, readTool, writeTool, compact, adaptAudited, adaptRead } from './shared.js';

export function registerPayeeTools(server: McpServer, deps: McpServerDeps): void {
  const { client, coalescer, logger } = deps;

  server.registerTool(
    'get-payees',
    { description: 'List all payees.', inputSchema: {} },
    adaptRead(
      readTool(coalescer, async () => {
        const payees = await client.getPayees();
        return ok(JSON.stringify(payees, null, 2));
      }),
    ),
  );

  server.registerTool(
    'create-payee',
    {
      description: 'Create a new payee.',
      inputSchema: {
        name: z.string().min(1),
        transfer_acct: z.string().min(1).nullable().optional(),
      },
    },
    adaptAudited(
      writeTool(
        logger,
        'create-payee',
        () => client.sync(),
        async (input) => {
          const id = await client.createPayee(compact(input));
          return ok(`Created payee ${id}`);
        },
      ),
    ),
  );

  server.registerTool(
    'update-payee',
    {
      description: 'Update fields on an existing payee.',
      inputSchema: {
        id: z.string().min(1),
        fields: z.object({
          name: z.string().min(1).optional(),
          transfer_acct: z.string().min(1).nullable().optional(),
        }),
      },
    },
    adaptAudited(
      writeTool(
        logger,
        'update-payee',
        () => client.sync(),
        async ({ id, fields }) => {
          await client.updatePayee(id, compact(fields));
          return ok(`Updated payee ${id}`);
        },
      ),
    ),
  );

  server.registerTool(
    'delete-payee',
    {
      description: 'Delete a payee.',
      inputSchema: { id: z.string().min(1) },
    },
    adaptAudited(
      writeTool(
        logger,
        'delete-payee',
        () => client.sync(),
        async ({ id }) => {
          await client.deletePayee(id);
          return ok(`Deleted payee ${id}`);
        },
      ),
    ),
  );

  server.registerTool(
    'merge-payees',
    {
      description: 'Merge one or more payees into a target payee.',
      inputSchema: {
        targetId: z.string().min(1),
        mergeIds: z.array(z.string().min(1)),
      },
    },
    adaptAudited(
      writeTool(
        logger,
        'merge-payees',
        () => client.sync(),
        async ({ targetId, mergeIds }) => {
          await client.mergePayees(targetId, mergeIds);
          return ok(`Merged ${mergeIds.length} payee(s) into ${targetId}`);
        },
      ),
    ),
  );

  server.registerTool(
    'get-common-payees',
    { description: 'List the most-commonly-used payees.', inputSchema: {} },
    adaptRead(
      readTool(coalescer, async () => {
        const payees = await client.getCommonPayees();
        return ok(JSON.stringify(payees, null, 2));
      }),
    ),
  );
}
