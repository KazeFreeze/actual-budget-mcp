import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerDeps } from '../server.js';
import { ok, readTool, writeTool, compact, adaptAudited, adaptRead } from './shared.js';

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
