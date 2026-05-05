import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SyncCoalescer } from '../../../src/client/sync-coalescer.js';
import { FakeActualClient } from '../../../src/client/fake-client.js';

describe('SyncCoalescer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('first call triggers sync', async () => {
    const c = new FakeActualClient();
    const coalescer = new SyncCoalescer(c, 2000);
    await coalescer.maybeSync();
    expect(c.syncCount).toBe(1);
  });

  it('skips sync within window', async () => {
    const c = new FakeActualClient();
    const coalescer = new SyncCoalescer(c, 2000);
    await coalescer.maybeSync();
    vi.advanceTimersByTime(500);
    await coalescer.maybeSync();
    expect(c.syncCount).toBe(1);
  });

  it('syncs again after window elapses', async () => {
    const c = new FakeActualClient();
    const coalescer = new SyncCoalescer(c, 2000);
    await coalescer.maybeSync();
    vi.advanceTimersByTime(2500);
    await coalescer.maybeSync();
    expect(c.syncCount).toBe(2);
  });

  it('dedupes concurrent calls', async () => {
    const c = new FakeActualClient();
    const coalescer = new SyncCoalescer(c, 2000);
    await Promise.all([coalescer.maybeSync(), coalescer.maybeSync(), coalescer.maybeSync()]);
    expect(c.syncCount).toBe(1);
  });

  it('does not advance lastSyncAt on failure', async () => {
    const c = new FakeActualClient();
    c.failNextSyncWith(new Error('boom'));
    const coalescer = new SyncCoalescer(c, 2000);
    await expect(coalescer.maybeSync()).rejects.toThrow('boom');
    await coalescer.maybeSync(); // should retry immediately
    expect(c.syncCount).toBe(2);
  });

  it('exposes lastSyncAt and lastSyncSucceeded for /health', async () => {
    const c = new FakeActualClient();
    const coalescer = new SyncCoalescer(c, 2000);
    expect(coalescer.lastSyncAt).toBe(null);
    await coalescer.maybeSync();
    expect(coalescer.lastSyncSucceeded).toBe(true);
    expect(coalescer.lastSyncAt).toBeInstanceOf(Date);
  });
});
