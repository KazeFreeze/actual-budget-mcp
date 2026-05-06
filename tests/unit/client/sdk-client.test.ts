/* eslint-disable @typescript-eslint/require-await */
import { describe, it, expect, vi } from 'vitest';

// `init` returns a `lib` object whose `send` method we capture on the client.
// Using a single shared sendMock across the module so each test can assert it.
const sendMock = vi.fn(async () => undefined);

vi.mock('@actual-app/api', () => {
  return {
    init: vi.fn(async () => ({ send: sendMock })),
    shutdown: vi.fn(async () => {}),
    sync: vi.fn(async () => {}),
    downloadBudget: vi.fn(async () => {}),
    getCategories: vi.fn(async () => [{ id: 'c1', name: 'Food', group_id: 'g1' }]),
    aqlQuery: vi.fn(async () => ({ data: [{ id: 'note-1', note: 'hi' }] })),
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

  it('writes notes via the lib.send(notes-save) returned from init()', async () => {
    sendMock.mockClear();
    const c = new SdkActualClient({
      dataDir: '/tmp/x',
      serverURL: 'http://x',
      password: 'p',
      syncId: 's',
    });
    await c.init();
    await c.setNote('note-1', 'updated');
    expect(sendMock).toHaveBeenCalledWith('notes-save', {
      id: 'note-1',
      note: 'updated',
    });
  });

  it('reads defaultCurrencyCode via lib.send(preferences/get)', async () => {
    sendMock.mockClear();
    sendMock.mockResolvedValueOnce({ defaultCurrencyCode: 'PHP' } as never);
    const c = new SdkActualClient({
      dataDir: '/tmp/x',
      serverURL: 'http://x',
      password: 'p',
      syncId: 's',
    });
    await c.init();
    const code = await c.getCurrencyCode();
    expect(sendMock).toHaveBeenCalledWith('preferences/get', undefined);
    expect(code).toBe('PHP');
  });

  it('returns null when defaultCurrencyCode is missing', async () => {
    sendMock.mockClear();
    sendMock.mockResolvedValueOnce({} as never);
    const c = new SdkActualClient({
      dataDir: '/tmp/x',
      serverURL: 'http://x',
      password: 'p',
      syncId: 's',
    });
    await c.init();
    expect(await c.getCurrencyCode()).toBeNull();
  });

  it('returns null (does not throw) when the SDK send call fails', async () => {
    sendMock.mockClear();
    sendMock.mockRejectedValueOnce(new Error('boom'));
    const c = new SdkActualClient({
      dataDir: '/tmp/x',
      serverURL: 'http://x',
      password: 'p',
      syncId: 's',
    });
    await c.init();
    expect(await c.getCurrencyCode()).toBeNull();
  });
});
