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
