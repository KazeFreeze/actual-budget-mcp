import { describe, it, expect } from 'vitest';
import { registerCategoryTools } from '../../../src/tools/categories.js';
import { setup, call } from './_helpers.js';

describe('category tools', () => {
  it('get-categories returns categories from client', async () => {
    const { server, client } = setup(registerCategoryTools);
    await client.createCategory({ name: 'Food', group_id: 'g1' });
    const r = await call(server, 'get-categories', {});
    expect(r.isError).toBeFalsy();
    const first = r.content[0];
    expect(first?.text).toContain('Food');
  });

  it('create-category creates a category and returns its id', async () => {
    const { server, client } = setup(registerCategoryTools);
    const groupId = await client.createCategoryGroup({ name: 'Spending' });
    const r = await call(server, 'create-category', { name: 'Rent', group_id: groupId });
    expect(r.isError).toBeFalsy();
    expect(await client.getCategories()).toHaveLength(1);
  });

  it('update-category updates a field', async () => {
    const { server, client } = setup(registerCategoryTools);
    const id = await client.createCategory({ name: 'Old', group_id: 'g1' });
    const r = await call(server, 'update-category', { id, fields: { name: 'New' } });
    expect(r.isError).toBeFalsy();
    const cats = await client.getCategories();
    expect(cats[0]?.name).toBe('New');
  });

  it('delete-category removes the category', async () => {
    const { server, client } = setup(registerCategoryTools);
    const id = await client.createCategory({ name: 'X', group_id: 'g1' });
    await call(server, 'delete-category', { id });
    expect(await client.getCategories()).toHaveLength(0);
  });

  it('zod rejects invalid input', async () => {
    const { server } = setup(registerCategoryTools);
    await expect(
      call(server, 'create-category', { /* missing name */ group_id: 'g' }),
    ).rejects.toThrow();
  });
});
