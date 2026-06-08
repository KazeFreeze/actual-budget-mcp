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

  it('get-categories with no input returns all categories', async () => {
    const { server, client } = setup(registerCategoryTools);
    await client.createCategory({ name: 'Visible', group_id: 'g1', hidden: false });
    await client.createCategory({ name: 'Hidden', group_id: 'g1', hidden: true });
    const r = await call(server, 'get-categories', {});
    expect(r.isError).toBeFalsy();
    expect(r.content[0]?.text).toContain('Visible');
    expect(r.content[0]?.text).toContain('Hidden');
  });

  it('get-categories with hidden: false returns only visible categories', async () => {
    const { server, client } = setup(registerCategoryTools);
    await client.createCategory({ name: 'Visible', group_id: 'g1', hidden: false });
    await client.createCategory({ name: 'Hidden', group_id: 'g1', hidden: true });
    const r = await call(server, 'get-categories', { hidden: false });
    expect(r.isError).toBeFalsy();
    expect(r.content[0]?.text).toContain('Visible');
    expect(r.content[0]?.text).not.toContain('Hidden');
  });

  it('get-categories with hidden: true returns only hidden categories', async () => {
    const { server, client } = setup(registerCategoryTools);
    await client.createCategory({ name: 'Visible', group_id: 'g1', hidden: false });
    await client.createCategory({ name: 'Hidden', group_id: 'g1', hidden: true });
    const r = await call(server, 'get-categories', { hidden: true });
    expect(r.isError).toBeFalsy();
    expect(r.content[0]?.text).not.toContain('Visible');
    expect(r.content[0]?.text).toContain('Hidden');
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

  it('get-category-groups with no input returns all groups', async () => {
    const { server, client } = setup(registerCategoryTools);
    client.seedCategoryGroup({ id: 'g1', name: 'Visible Group', hidden: false });
    client.seedCategoryGroup({ id: 'g2', name: 'Hidden Group', hidden: true });
    const r = await call(server, 'get-category-groups', {});
    expect(r.isError).toBeFalsy();
    expect(r.content[0]?.text).toContain('Visible Group');
    expect(r.content[0]?.text).toContain('Hidden Group');
  });

  it('get-category-groups with hidden: false returns only visible groups', async () => {
    const { server, client } = setup(registerCategoryTools);
    client.seedCategoryGroup({ id: 'g1', name: 'Visible Group', hidden: false });
    client.seedCategoryGroup({ id: 'g2', name: 'Hidden Group', hidden: true });
    const r = await call(server, 'get-category-groups', { hidden: false });
    expect(r.isError).toBeFalsy();
    expect(r.content[0]?.text).toContain('Visible Group');
    expect(r.content[0]?.text).not.toContain('Hidden Group');
  });

  it('get-category-groups with hidden: true returns only hidden groups', async () => {
    const { server, client } = setup(registerCategoryTools);
    client.seedCategoryGroup({ id: 'g1', name: 'Visible Group', hidden: false });
    client.seedCategoryGroup({ id: 'g2', name: 'Hidden Group', hidden: true });
    const r = await call(server, 'get-category-groups', { hidden: true });
    expect(r.isError).toBeFalsy();
    expect(r.content[0]?.text).not.toContain('Visible Group');
    expect(r.content[0]?.text).toContain('Hidden Group');
  });

  it('create-category-group accepts hidden flag', async () => {
    const { server, client } = setup(registerCategoryTools);
    const r = await call(server, 'create-category-group', { name: 'Hidden Group', hidden: true });
    expect(r.isError).toBeFalsy();
    const groups = await client.getCategoryGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0]?.hidden).toBe(true);
  });

  it('update-category-group can toggle hidden', async () => {
    const { server, client } = setup(registerCategoryTools);
    const id = await client.createCategoryGroup({ name: 'Group', hidden: false });
    const r = await call(server, 'update-category-group', { id, fields: { hidden: true } });
    expect(r.isError).toBeFalsy();
    const groups = await client.getCategoryGroups();
    expect(groups[0]?.hidden).toBe(true);
  });

  it('zod rejects invalid input', async () => {
    const { server } = setup(registerCategoryTools);
    await expect(
      call(server, 'create-category', { /* missing name */ group_id: 'g' }),
    ).rejects.toThrow();
  });
});
