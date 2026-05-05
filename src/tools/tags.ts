import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerDeps } from '../server.js';
import { ok, readTool, writeTool, compact, adaptAudited, adaptRead } from './shared.js';

export function registerTagTools(server: McpServer, deps: McpServerDeps): void {
  const { client, coalescer, logger } = deps;

  server.registerTool(
    'get-tags',
    { description: 'List all tags.', inputSchema: {} },
    adaptRead(
      readTool(coalescer, async () => {
        const tags = await client.getTags();
        return ok(JSON.stringify(tags, null, 2));
      }),
    ),
  );

  server.registerTool(
    'create-tag',
    {
      description: 'Create a new tag.',
      inputSchema: {
        tag: z.string().min(1),
        color: z.string().nullable().optional(),
        description: z.string().nullable().optional(),
      },
    },
    adaptAudited(
      writeTool(
        logger,
        'create-tag',
        () => client.sync(),
        async (input) => {
          const id = await client.createTag(compact(input));
          return ok(`Created tag ${id}`);
        },
      ),
    ),
  );

  server.registerTool(
    'update-tag',
    {
      description: 'Update fields on an existing tag.',
      inputSchema: {
        id: z.string().min(1),
        fields: z.object({
          tag: z.string().min(1).optional(),
          color: z.string().nullable().optional(),
          description: z.string().nullable().optional(),
        }),
      },
    },
    adaptAudited(
      writeTool(
        logger,
        'update-tag',
        () => client.sync(),
        async ({ id, fields }) => {
          await client.updateTag(id, compact(fields));
          return ok(`Updated tag ${id}`);
        },
      ),
    ),
  );

  server.registerTool(
    'delete-tag',
    {
      description: 'Delete a tag.',
      inputSchema: { id: z.string().min(1) },
    },
    adaptAudited(
      writeTool(
        logger,
        'delete-tag',
        () => client.sync(),
        async ({ id }) => {
          await client.deleteTag(id);
          return ok(`Deleted tag ${id}`);
        },
      ),
    ),
  );
}
