/* eslint-disable @typescript-eslint/require-await */
import { describe, it, expect, vi } from 'vitest';

const { getNoteMock, updateNoteMock } = vi.hoisted(() => {
  return {
    getNoteMock: vi.fn(
      async (_id: string): Promise<{ id: string; note: string } | null> => ({
        id: 'note-1',
        note: 'hi',
      }),
    ),
    updateNoteMock: vi.fn(async (_id: string, _note: string | null) => undefined),
  };
});

vi.mock('@actual-app/api', () => {
  return {
    init: vi.fn(async () => ({ send: vi.fn() })),
    shutdown: vi.fn(async () => {}),
    sync: vi.fn(async () => {}),
    downloadBudget: vi.fn(async () => {}),
    getCategories: vi.fn(async () => [{ id: 'c1', name: 'Food', group_id: 'g1' }]),
    getNote: getNoteMock,
    updateNote: updateNoteMock,
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

  it('reads notes via api.getNote and extracts the note string', async () => {
    getNoteMock.mockClear();
    getNoteMock.mockResolvedValue({ id: 'note-1', note: 'hello world' });
    const c = new SdkActualClient({
      dataDir: '/tmp/x',
      serverURL: 'http://x',
      password: 'p',
      syncId: 's',
    });
    const note = await c.getNote('note-1');
    expect(getNoteMock).toHaveBeenCalledWith('note-1');
    expect(note).toBe('hello world');
  });

  it('returns null from getNote when api.getNote returns null', async () => {
    getNoteMock.mockClear();
    getNoteMock.mockResolvedValue(null);
    const c = new SdkActualClient({
      dataDir: '/tmp/x',
      serverURL: 'http://x',
      password: 'p',
      syncId: 's',
    });
    const note = await c.getNote('missing');
    expect(note).toBe(null);
  });

  it('writes notes via api.updateNote', async () => {
    updateNoteMock.mockClear();
    const c = new SdkActualClient({
      dataDir: '/tmp/x',
      serverURL: 'http://x',
      password: 'p',
      syncId: 's',
    });
    await c.setNote('note-1', 'updated');
    expect(updateNoteMock).toHaveBeenCalledWith('note-1', 'updated');
  });

  it('deletes notes via api.updateNote(id, null)', async () => {
    updateNoteMock.mockClear();
    const c = new SdkActualClient({
      dataDir: '/tmp/x',
      serverURL: 'http://x',
      password: 'p',
      syncId: 's',
    });
    await c.deleteNote('note-1');
    expect(updateNoteMock).toHaveBeenCalledWith('note-1', null);
  });
});
