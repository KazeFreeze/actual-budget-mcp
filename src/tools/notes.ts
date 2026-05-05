import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerDeps } from '../server.js';
import { ok, readTool, writeTool, adaptAudited, adaptRead } from './shared.js';

const NoteType = z.enum(['category', 'account', 'budgetmonth']);

function noteId(type: 'category' | 'account' | 'budgetmonth', id: string): string {
  return type === 'budgetmonth' ? `budget-${id}` : id;
}

export function registerNoteTools(server: McpServer, deps: McpServerDeps): void {
  const { client, coalescer, logger } = deps;

  server.registerTool(
    'get-notes',
    {
      description: 'Get notes for a category, account, or budget month.',
      inputSchema: { type: NoteType, id: z.string().min(1) },
    },
    adaptRead(
      readTool(coalescer, async ({ type, id }) => {
        const note = await client.getNote(noteId(type, id));
        return ok(note ?? '');
      }),
    ),
  );

  server.registerTool(
    'set-notes',
    {
      description:
        'Set notes on a category, account, or budget month. Empty string clears the note.',
      inputSchema: { type: NoteType, id: z.string().min(1), notes: z.string() },
    },
    adaptAudited(
      writeTool(
        logger,
        'set-notes',
        () => client.sync(),
        async ({ type, id, notes }) => {
          const target = noteId(type, id);
          if (notes === '') {
            await client.deleteNote(target);
            return ok(`Cleared notes for ${type} ${id}`);
          }
          await client.setNote(target, notes);
          return ok(`Notes updated for ${type} ${id}`);
        },
      ),
    ),
  );

  server.registerTool(
    'delete-notes',
    {
      description: 'Delete notes from a category, account, or budget month.',
      inputSchema: { type: NoteType, id: z.string().min(1) },
    },
    adaptAudited(
      writeTool(
        logger,
        'delete-notes',
        () => client.sync(),
        async ({ type, id }) => {
          await client.deleteNote(noteId(type, id));
          return ok(`Deleted notes for ${type} ${id}`);
        },
      ),
    ),
  );
}
