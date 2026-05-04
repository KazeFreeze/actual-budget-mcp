import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerDeps } from '../server.js';
import { ok, readTool, writeTool, compact, adaptAudited, adaptRead } from './shared.js';

export function registerScheduleTools(server: McpServer, deps: McpServerDeps): void {
  const { client, coalescer, logger } = deps;

  server.registerTool(
    'get-schedules',
    { description: 'List all schedules.', inputSchema: {} },
    adaptRead(
      readTool(coalescer, async () => {
        const schedules = await client.getSchedules();
        return ok(JSON.stringify(schedules, null, 2));
      }),
    ),
  );

  server.registerTool(
    'create-schedule',
    {
      description: 'Create a new recurring schedule. Rule shape is passed through to Actual.',
      inputSchema: {
        name: z.string().nullable(),
        rule: z.unknown(),
        active: z.boolean().optional(),
        posts_transaction: z.boolean().optional(),
      },
    },
    adaptAudited(
      writeTool(
        logger,
        'create-schedule',
        () => client.sync(),
        async (input) => {
          const id = await client.createSchedule(compact(input));
          return ok(`Created schedule ${id}`);
        },
      ),
    ),
  );

  server.registerTool(
    'update-schedule',
    {
      description: 'Update fields on an existing schedule.',
      inputSchema: {
        id: z.string().min(1),
        fields: z.object({
          name: z.string().nullable().optional(),
          rule: z.unknown().optional(),
          active: z.boolean().optional(),
          posts_transaction: z.boolean().optional(),
        }),
      },
    },
    adaptAudited(
      writeTool(
        logger,
        'update-schedule',
        () => client.sync(),
        async ({ id, fields }) => {
          await client.updateSchedule(id, compact(fields));
          return ok(`Updated schedule ${id}`);
        },
      ),
    ),
  );

  server.registerTool(
    'delete-schedule',
    {
      description: 'Delete a schedule.',
      inputSchema: { id: z.string().min(1) },
    },
    adaptAudited(
      writeTool(
        logger,
        'delete-schedule',
        () => client.sync(),
        async ({ id }) => {
          await client.deleteSchedule(id);
          return ok(`Deleted schedule ${id}`);
        },
      ),
    ),
  );
}
