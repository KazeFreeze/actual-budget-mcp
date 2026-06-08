import { describe, it, expect, beforeEach } from 'vitest';
import { FakeActualClient } from '../../../src/client/fake-client.js';

describe('FakeActualClient', () => {
  let c: FakeActualClient;
  beforeEach(() => {
    c = new FakeActualClient();
  });

  it('creates and lists categories', async () => {
    const id = await c.createCategory({ name: 'Food', group_id: 'g1' });
    const cats = await c.getCategories();
    expect(cats).toHaveLength(1);
    expect(cats[0]).toMatchObject({ id, name: 'Food', group_id: 'g1' });
  });

  it('getCategories filters by hidden: true', async () => {
    await c.createCategory({ name: 'Visible', group_id: 'g1', hidden: false });
    await c.createCategory({ name: 'Hidden', group_id: 'g1', hidden: true });
    const hidden = await c.getCategories({ hidden: true });
    expect(hidden).toHaveLength(1);
    expect(hidden[0]?.name).toBe('Hidden');
  });

  it('getCategories filters by hidden: false', async () => {
    await c.createCategory({ name: 'Visible', group_id: 'g1', hidden: false });
    await c.createCategory({ name: 'Hidden', group_id: 'g1', hidden: true });
    const visible = await c.getCategories({ hidden: false });
    expect(visible).toHaveLength(1);
    expect(visible[0]?.name).toBe('Visible');
  });

  it('getCategories with no options returns all', async () => {
    await c.createCategory({ name: 'Visible', group_id: 'g1', hidden: false });
    await c.createCategory({ name: 'Hidden', group_id: 'g1', hidden: true });
    expect(await c.getCategories()).toHaveLength(2);
  });

  it('getCategories({ hidden: false }) treats absent hidden field as visible', async () => {
    await c.createCategory({ name: 'NoHiddenField', group_id: 'g1' });
    await c.createCategory({ name: 'ExplicitlyHidden', group_id: 'g1', hidden: true });
    const visible = await c.getCategories({ hidden: false });
    expect(visible).toHaveLength(1);
    expect(visible[0]?.name).toBe('NoHiddenField');
  });

  it('getCategoryGroups filters by hidden: true', async () => {
    c.seedCategoryGroup({ id: 'g1', name: 'Visible Group', hidden: false });
    c.seedCategoryGroup({ id: 'g2', name: 'Hidden Group', hidden: true });
    const hidden = await c.getCategoryGroups({ hidden: true });
    expect(hidden).toHaveLength(1);
    expect(hidden[0]?.name).toBe('Hidden Group');
  });

  it('getCategoryGroups filters by hidden: false', async () => {
    c.seedCategoryGroup({ id: 'g1', name: 'Visible Group', hidden: false });
    c.seedCategoryGroup({ id: 'g2', name: 'Hidden Group', hidden: true });
    const visible = await c.getCategoryGroups({ hidden: false });
    expect(visible).toHaveLength(1);
    expect(visible[0]?.name).toBe('Visible Group');
  });

  it('getCategoryGroups with no options returns all', async () => {
    c.seedCategoryGroup({ id: 'g1', name: 'Visible Group', hidden: false });
    c.seedCategoryGroup({ id: 'g2', name: 'Hidden Group', hidden: true });
    expect(await c.getCategoryGroups()).toHaveLength(2);
  });

  it('getCategoryGroups({ hidden: false }) treats absent hidden field as visible', async () => {
    c.seedCategoryGroup({ id: 'g1', name: 'NoHiddenField Group' });
    c.seedCategoryGroup({ id: 'g2', name: 'Explicitly Hidden Group', hidden: true });
    const visible = await c.getCategoryGroups({ hidden: false });
    expect(visible).toHaveLength(1);
    expect(visible[0]?.name).toBe('NoHiddenField Group');
  });

  it('round-trips notes via setNote/getNote/deleteNote', async () => {
    await c.setNote('cat-1', 'hello');
    expect(await c.getNote('cat-1')).toBe('hello');
    await c.deleteNote('cat-1');
    expect(await c.getNote('cat-1')).toBe(null);
  });

  it('records sync calls', async () => {
    await c.sync();
    await c.sync();
    expect(c.syncCount).toBe(2);
  });

  it('throws an error from a configurable hook', async () => {
    c.failNextSyncWith(new Error('network'));
    await expect(c.sync()).rejects.toThrow('network');
    await expect(c.sync()).resolves.toBeUndefined();
  });
});
