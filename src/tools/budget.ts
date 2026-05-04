import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerDeps } from '../server.js';
import { ok, readTool, writeTool, adaptAudited, adaptRead } from './shared.js';

const Month = z.string().regex(/^\d{4}-\d{2}$/);

export function registerBudgetTools(server: McpServer, deps: McpServerDeps): void {
  const { client, coalescer, logger } = deps;

  server.registerTool(
    'get-budget-month',
    {
      description: 'Get budget data for a single month (YYYY-MM).',
      inputSchema: { month: Month },
    },
    adaptRead(
      readTool(coalescer, async ({ month }: { month: string }) => {
        const data = await client.getBudgetMonth(month);
        return ok(JSON.stringify(data, null, 2));
      }),
    ),
  );

  server.registerTool(
    'get-budget-months',
    {
      description: 'List all months with budget data.',
      inputSchema: {},
    },
    adaptRead(
      readTool(coalescer, async () => {
        const months = await client.getBudgetMonths();
        return ok(JSON.stringify(months, null, 2));
      }),
    ),
  );

  server.registerTool(
    'set-budget-amount',
    {
      description: 'Set the budgeted amount for a category in a month (value in cents).',
      inputSchema: {
        month: Month,
        categoryId: z.string().min(1),
        value: z.number().int(),
      },
    },
    adaptAudited(
      writeTool(
        logger,
        'set-budget-amount',
        () => client.sync(),
        async ({ month, categoryId, value }) => {
          await client.setBudgetAmount(month, categoryId, value);
          return ok(`Set budget for ${categoryId} in ${month} to ${value}`);
        },
      ),
    ),
  );

  server.registerTool(
    'set-budget-carryover',
    {
      description: 'Toggle carry-over of leftover budget for a category in a month.',
      inputSchema: {
        month: Month,
        categoryId: z.string().min(1),
        flag: z.boolean(),
      },
    },
    adaptAudited(
      writeTool(
        logger,
        'set-budget-carryover',
        () => client.sync(),
        async ({ month, categoryId, flag }) => {
          await client.setBudgetCarryover(month, categoryId, flag);
          return ok(`Set carryover for ${categoryId} in ${month} to ${String(flag)}`);
        },
      ),
    ),
  );

  server.registerTool(
    'hold-budget-for-next-month',
    {
      description: 'Hold an amount for next month (value in cents).',
      inputSchema: {
        month: Month,
        amount: z.number().int(),
      },
    },
    adaptAudited(
      writeTool(
        logger,
        'hold-budget-for-next-month',
        () => client.sync(),
        async ({ month, amount }) => {
          await client.holdBudgetForNextMonth(month, amount);
          return ok(`Held ${amount} for next month from ${month}`);
        },
      ),
    ),
  );

  server.registerTool(
    'reset-budget-hold',
    {
      description: 'Clear any held amount for the given month.',
      inputSchema: { month: Month },
    },
    adaptAudited(
      writeTool(
        logger,
        'reset-budget-hold',
        () => client.sync(),
        async ({ month }) => {
          await client.resetBudgetHold(month);
          return ok(`Reset budget hold for ${month}`);
        },
      ),
    ),
  );
}
