import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerDeps } from '../server.js';
import type { ScheduleRecurConfig } from '../client/actual-client.js';
import { ok, readTool, writeTool, compact, adaptAudited, adaptRead } from './shared.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const recurConfigSchema = z.object({
  frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  interval: z.number().int().positive().optional(),
  patterns: z
    .array(
      z.object({
        value: z.number().int(),
        type: z.enum(['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'day']),
      }),
    )
    .optional(),
  skipWeekend: z.boolean().optional(),
  start: isoDate,
  endMode: z.enum(['never', 'after_n_occurrences', 'on_date']).optional(),
  endOccurrences: z.number().int().positive().optional(),
  endDate: isoDate.optional(),
  weekendSolveMode: z.enum(['before', 'after']).optional(),
});

const amountSchema = z.union([
  z.number().int(),
  z.object({ num1: z.number().int(), num2: z.number().int() }),
]);

const dateSchema = z.union([isoDate, recurConfigSchema]);

const amountOpSchema = z.enum(['is', 'isapprox', 'isbetween']);

/**
 * The zod-inferred type for the date union has nested optional fields whose
 * types include `undefined` (e.g. `interval: number | undefined`). Under
 * `exactOptionalPropertyTypes: true` this is incompatible with our
 * `ScheduleRecurConfig` (`interval?: number`). When the input is the
 * RecurConfig branch, deep-strip the undefined keys before forwarding.
 */
function normalizeDate(
  date: string | z.infer<typeof recurConfigSchema>,
): string | ScheduleRecurConfig {
  if (typeof date === 'string') return date;
  return compact(date) as ScheduleRecurConfig;
}

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
      description:
        'Create a new recurring schedule. `amount` is in integer cents (negative for expenses). ' +
        '`date` is either a YYYY-MM-DD string for a one-off schedule or a RecurConfig object ' +
        '(`{ frequency, start, ... }`) for recurring schedules. `amountOp` is required and must be ' +
        "one of 'is' | 'isapprox' | 'isbetween'.",
      inputSchema: {
        name: z.string().optional(),
        payee: z.string().min(1).optional(),
        account: z.string().min(1).optional(),
        amount: amountSchema.optional(),
        amountOp: amountOpSchema,
        date: dateSchema,
        posts_transaction: z.boolean().optional(),
      },
    },
    adaptAudited(
      writeTool(
        logger,
        'create-schedule',
        () => client.sync(),
        async (input) => {
          // `posts_transaction` is required on the underlying Schedule
          // interface; default to false when the caller omits it. Read
          // before `compact` strips undefined keys (compact's signature
          // claims the value is non-undefined, which is a useful lie but
          // not safe to rely on for the default).
          const postsTransactionDefault = input.posts_transaction ?? false;
          const compacted = compact(input);
          const id = await client.createSchedule({
            ...compacted,
            date: normalizeDate(compacted.date),
            posts_transaction: postsTransactionDefault,
          });
          return ok(`Created schedule ${id}`);
        },
      ),
    ),
  );

  server.registerTool(
    'update-schedule',
    {
      description:
        'Update fields on an existing schedule. All fields under `fields` are optional. ' +
        'See `create-schedule` for field semantics. Pass `resetNextDate: true` to recompute ' +
        '`next_date` from the (possibly updated) `date` recurrence.',
      inputSchema: {
        id: z.string().min(1),
        fields: z.object({
          name: z.string().optional(),
          payee: z.string().min(1).optional(),
          account: z.string().min(1).optional(),
          amount: amountSchema.optional(),
          amountOp: amountOpSchema.optional(),
          date: dateSchema.optional(),
          posts_transaction: z.boolean().optional(),
        }),
        resetNextDate: z.boolean().optional(),
      },
    },
    adaptAudited(
      writeTool(
        logger,
        'update-schedule',
        () => client.sync(),
        async ({ id, fields, resetNextDate }) => {
          const compacted = compact(fields);
          // Strip the original (zod-inferred) `date` and re-attach a
          // normalized version when present — see `normalizeDate`.
          const { date: rawDate, ...rest } = compacted;
          const normalized: Partial<Omit<typeof rest, never>> & {
            date?: string | ScheduleRecurConfig;
          } = { ...rest };
          if (rawDate !== undefined) normalized.date = normalizeDate(rawDate);
          await client.updateSchedule(id, normalized, resetNextDate);
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
