import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerDeps } from '../server.js';
import type { Transaction } from '../client/actual-client.js';
import { ok, readTool, writeTool, compact, adaptAudited, adaptRead } from './shared.js';

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const TxInput = z.object({
  date: z.string().regex(dateRegex),
  amount: z.number().int(),
  payee: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  cleared: z.boolean().optional(),
  reconciled: z.boolean().optional(),
  imported_id: z.string().nullable().optional(),
  subtransactions: z.array(z.unknown()).optional(),
});

type TxInputT = z.infer<typeof TxInput>;

function toClientTxs(accountId: string, txs: TxInputT[]): Omit<Transaction, 'id'>[] {
  return txs.map((t) => ({ ...compact(t), account: accountId })) as Omit<Transaction, 'id'>[];
}

export function registerTransactionTools(server: McpServer, deps: McpServerDeps): void {
  const { client, coalescer, logger } = deps;

  server.registerTool(
    'get-transactions',
    {
      description:
        'Get transactions for an account within a date range (YYYY-MM-DD, both bounds inclusive).',
      inputSchema: {
        accountId: z.string().min(1),
        sinceDate: z.string().regex(dateRegex),
        untilDate: z.string().regex(dateRegex),
      },
    },
    adaptRead(
      readTool(
        coalescer,
        async ({
          accountId,
          sinceDate,
          untilDate,
        }: {
          accountId: string;
          sinceDate: string;
          untilDate: string;
        }) => {
          const txs = await client.getTransactions(accountId, sinceDate, untilDate);
          return ok(JSON.stringify(txs, null, 2));
        },
      ),
    ),
  );

  server.registerTool(
    'add-transactions',
    {
      description:
        'Add one or more transactions to an account. Amounts are integer cents. ' +
        'learnCategories enables automatic category learning; runTransfers links transfer pairs.',
      inputSchema: {
        accountId: z.string().min(1),
        transactions: z.array(TxInput).min(1),
        learnCategories: z.boolean().optional(),
        runTransfers: z.boolean().optional(),
      },
    },
    adaptAudited(
      writeTool(
        logger,
        'add-transactions',
        () => client.sync(),
        async ({
          accountId,
          transactions,
          learnCategories,
          runTransfers,
        }: {
          accountId: string;
          transactions: TxInputT[];
          learnCategories: boolean | undefined;
          runTransfers: boolean | undefined;
        }) => {
          const opts = compact({ learnCategories, runTransfers });
          const result = await client.addTransactions(
            accountId,
            toClientTxs(accountId, transactions),
            opts,
          );
          return ok(`Added: ${result}`);
        },
      ),
    ),
  );

  server.registerTool(
    'import-transactions',
    {
      description:
        'Import transactions to an account using Actual\u2019s reconciliation logic ' +
        '(deduplicates by imported_id and matches existing rows).',
      inputSchema: {
        accountId: z.string().min(1),
        transactions: z.array(TxInput).min(1),
      },
    },
    adaptAudited(
      writeTool(
        logger,
        'import-transactions',
        () => client.sync(),
        async ({ accountId, transactions }: { accountId: string; transactions: TxInputT[] }) => {
          const result = await client.importTransactions(
            accountId,
            toClientTxs(accountId, transactions),
          );
          return ok(JSON.stringify(result, null, 2));
        },
      ),
    ),
  );

  server.registerTool(
    'update-transaction',
    {
      description: 'Update fields on an existing transaction.',
      inputSchema: {
        id: z.string().min(1),
        fields: TxInput.partial(),
      },
    },
    adaptAudited(
      writeTool(
        logger,
        'update-transaction',
        () => client.sync(),
        async ({ id, fields }) => {
          // Cast: zod's inferred Partial type carries `subtransactions?: unknown[]`,
          // which is not assignable to `Transaction[]` on the client interface.
          // The actual SDK accepts arbitrary subtransaction shapes; this is a
          // TypeScript-only narrowing.
          await client.updateTransaction(id, compact(fields) as Partial<Omit<Transaction, 'id'>>);
          return ok(`Updated transaction ${id}`);
        },
      ),
    ),
  );

  server.registerTool(
    'delete-transaction',
    {
      description: 'Delete a transaction.',
      inputSchema: { id: z.string().min(1) },
    },
    adaptAudited(
      writeTool(
        logger,
        'delete-transaction',
        () => client.sync(),
        async ({ id }: { id: string }) => {
          await client.deleteTransaction(id);
          return ok(`Deleted transaction ${id}`);
        },
      ),
    ),
  );
}
