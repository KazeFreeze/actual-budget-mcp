import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerDeps } from '../server.js';
import { ok, readTool, writeTool, adaptAudited, adaptRead } from './shared.js';

export function registerRuleTools(server: McpServer, deps: McpServerDeps): void {
  const { client, coalescer, logger } = deps;

  server.registerTool(
    'get-rules',
    { description: 'List all rules.', inputSchema: {} },
    adaptRead(
      readTool(coalescer, async () => {
        const rules = await client.getRules();
        return ok(JSON.stringify(rules, null, 2));
      }),
    ),
  );

  server.registerTool(
    'get-payee-rules',
    {
      description: 'List rules attached to a payee.',
      inputSchema: { payeeId: z.string().min(1) },
    },
    adaptRead(
      readTool(coalescer, async ({ payeeId }: { payeeId: string }) => {
        const rules = await client.getPayeeRules(payeeId);
        return ok(JSON.stringify(rules, null, 2));
      }),
    ),
  );

  server.registerTool(
    'create-rule',
    {
      description: 'Create a new rule. Conditions and actions are passed through to Actual.',
      inputSchema: {
        stage: z.string().nullable(),
        conditionsOp: z.enum(['and', 'or']),
        conditions: z.array(z.unknown()),
        actions: z.array(z.unknown()),
      },
    },
    adaptAudited(
      writeTool(
        logger,
        'create-rule',
        () => client.sync(),
        async ({ stage, conditionsOp, conditions, actions }) => {
          const rule = await client.createRule({ stage, conditionsOp, conditions, actions });
          return ok(`Created rule ${rule.id}`);
        },
      ),
    ),
  );

  server.registerTool(
    'update-rule',
    {
      description: 'Replace an existing rule (full overwrite).',
      inputSchema: {
        id: z.string().min(1),
        stage: z.string().nullable(),
        conditionsOp: z.enum(['and', 'or']),
        conditions: z.array(z.unknown()),
        actions: z.array(z.unknown()),
      },
    },
    adaptAudited(
      writeTool(
        logger,
        'update-rule',
        () => client.sync(),
        async ({ id, stage, conditionsOp, conditions, actions }) => {
          await client.updateRule({ id, stage, conditionsOp, conditions, actions });
          return ok(`Updated rule ${id}`);
        },
      ),
    ),
  );

  server.registerTool(
    'delete-rule',
    {
      description: 'Delete a rule.',
      inputSchema: { id: z.string().min(1) },
    },
    adaptAudited(
      writeTool(
        logger,
        'delete-rule',
        () => client.sync(),
        async ({ id }) => {
          await client.deleteRule(id);
          return ok(`Deleted rule ${id}`);
        },
      ),
    ),
  );
}
