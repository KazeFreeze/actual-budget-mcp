import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerDeps } from '../server.js';
import { ok, readTool, writeTool, compact, adaptAudited, adaptRead } from './shared.js';

export function registerAccountTools(server: McpServer, deps: McpServerDeps): void {
  const { client, coalescer, logger } = deps;

  server.registerTool(
    'get-accounts',
    { description: 'List all accounts.', inputSchema: {} },
    adaptRead(
      readTool(coalescer, async () => {
        const accounts = await client.getAccounts();
        return ok(JSON.stringify(accounts, null, 2));
      }),
    ),
  );

  server.registerTool(
    'create-account',
    {
      description: 'Create a new account, optionally with an initial balance (in cents).',
      inputSchema: {
        name: z.string().min(1),
        type: z.string().optional(),
        offbudget: z.boolean().optional(),
        initialBalance: z.number().default(0),
      },
    },
    adaptAudited(
      writeTool(
        logger,
        'create-account',
        () => client.sync(),
        async (input) => {
          const { initialBalance, ...rest } = input;
          const id = await client.createAccount(compact(rest), initialBalance);
          return ok(`Created account ${id}`);
        },
      ),
    ),
  );

  server.registerTool(
    'update-account',
    {
      description: 'Update fields on an existing account.',
      inputSchema: {
        id: z.string().min(1),
        fields: z.object({
          name: z.string().min(1).optional(),
          type: z.string().optional(),
          offbudget: z.boolean().optional(),
          closed: z.boolean().optional(),
        }),
      },
    },
    adaptAudited(
      writeTool(
        logger,
        'update-account',
        () => client.sync(),
        async ({ id, fields }) => {
          await client.updateAccount(id, compact(fields));
          return ok(`Updated account ${id}`);
        },
      ),
    ),
  );

  server.registerTool(
    'close-account',
    {
      description:
        'Close an account. Optionally transfer remaining balance to another account/category. ' +
        'If transferCategoryId is supplied, transferAccountId is required.',
      inputSchema: {
        id: z.string().min(1),
        transferAccountId: z.string().min(1).optional(),
        transferCategoryId: z.string().min(1).optional(),
      },
    },
    adaptAudited(
      writeTool(
        logger,
        'close-account',
        () => client.sync(),
        async ({ id, transferAccountId, transferCategoryId }) => {
          if (transferCategoryId !== undefined && transferAccountId === undefined) {
            throw new Error('transferCategoryId requires transferAccountId');
          }
          if (transferAccountId !== undefined && transferCategoryId !== undefined) {
            await client.closeAccount(id, transferAccountId, transferCategoryId);
          } else if (transferAccountId !== undefined) {
            await client.closeAccount(id, transferAccountId);
          } else {
            await client.closeAccount(id);
          }
          return ok(`Closed account ${id}`);
        },
      ),
    ),
  );

  server.registerTool(
    'reopen-account',
    {
      description: 'Reopen a closed account.',
      inputSchema: { id: z.string().min(1) },
    },
    adaptAudited(
      writeTool(
        logger,
        'reopen-account',
        () => client.sync(),
        async ({ id }) => {
          await client.reopenAccount(id);
          return ok(`Reopened account ${id}`);
        },
      ),
    ),
  );

  server.registerTool(
    'delete-account',
    {
      description: 'Delete an account.',
      inputSchema: { id: z.string().min(1) },
    },
    adaptAudited(
      writeTool(
        logger,
        'delete-account',
        () => client.sync(),
        async ({ id }) => {
          await client.deleteAccount(id);
          return ok(`Deleted account ${id}`);
        },
      ),
    ),
  );

  server.registerTool(
    'get-account-balance',
    {
      description:
        'Get the balance of an account, optionally as of a cutoff date (YYYY-MM-DD), inclusive.',
      inputSchema: {
        id: z.string().min(1),
        cutoff: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      },
    },
    adaptRead(
      readTool(coalescer, async ({ id, cutoff }: { id: string; cutoff: string | undefined }) => {
        const balance =
          cutoff === undefined
            ? await client.getAccountBalance(id)
            : await client.getAccountBalance(id, new Date(cutoff));
        return ok(JSON.stringify(balance, null, 2));
      }),
    ),
  );

  server.registerTool(
    'run-bank-sync',
    {
      description: 'Trigger a bank sync, optionally for a single account.',
      inputSchema: { accountId: z.string().optional() },
    },
    adaptAudited(
      writeTool(
        logger,
        'run-bank-sync',
        () => client.sync(),
        async ({ accountId }) => {
          await client.runBankSync(accountId);
          return ok(accountId ? `Bank sync triggered for ${accountId}` : 'Bank sync triggered');
        },
      ),
    ),
  );
}
