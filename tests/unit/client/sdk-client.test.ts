/* eslint-disable @typescript-eslint/no-deprecated,
                  @typescript-eslint/no-non-null-assertion,
                  @typescript-eslint/require-await */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@actual-app/api', () => {
  return {
    init: vi.fn(async () => {}),
    shutdown: vi.fn(async () => {}),
    sync: vi.fn(async () => {}),
    downloadBudget: vi.fn(async () => {}),
    getCategories: vi.fn(async () => [{ id: 'c1', name: 'Food', group_id: 'g1' }]),
    aqlQuery: vi.fn(async () => ({ data: [{ id: 'note-1', note: 'hi' }] })),
    internal: { send: vi.fn(async () => undefined) },
    q: vi.fn((table: string) => ({
      filter: () => ({ select: () => ({ table, kind: 'query' }) }),
    })),
  };
});

import { SdkActualClient } from '../../../src/client/sdk-client.js';

describe('SdkActualClient', () => {
  it('delegates getCategories to api.getCategories', async () => {
    const c = new SdkActualClient({
      dataDir: '/tmp/x',
      serverURL: 'http://x',
      password: 'p',
      syncId: 's',
    });
    const cats = await c.getCategories();
    expect(cats).toEqual([{ id: 'c1', name: 'Food', group_id: 'g1' }]);
  });

  it('reads notes via aqlQuery on the notes table', async () => {
    const c = new SdkActualClient({
      dataDir: '/tmp/x',
      serverURL: 'http://x',
      password: 'p',
      syncId: 's',
    });
    const note = await c.getNote('note-1');
    expect(note).toBe('hi');
  });

  it('writes notes via internal.send(notes-save)', async () => {
    const api = await import('@actual-app/api');
    const c = new SdkActualClient({
      dataDir: '/tmp/x',
      serverURL: 'http://x',
      password: 'p',
      syncId: 's',
    });
    await c.setNote('note-1', 'updated');
    expect(api.internal!.send).toHaveBeenCalledWith('notes-save', {
      id: 'note-1',
      note: 'updated',
    });
  });
});
