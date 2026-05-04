import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mountHealth } from '../../src/health.js';
import { SyncCoalescer } from '../../src/client/sync-coalescer.js';
import { FakeActualClient } from '../../src/client/fake-client.js';

describe('GET /health', () => {
  it('reports ok when sdk initialized + last sync succeeded', async () => {
    const app = express();
    const fake = new FakeActualClient();
    const coalescer = new SyncCoalescer(fake, 2000);
    await coalescer.maybeSync();
    mountHealth(app, { coalescer, sdkInitialized: () => true, syncId: 'sid', version: '2.0.0' });
    const r = await request(app).get('/health');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      status: 'ok',
      sdkInitialized: true,
      lastSyncSucceeded: true,
      budgetSyncId: 'sid',
      version: '2.0.0',
    });
  });

  it('reports degraded (HTTP 200) when last sync failed', async () => {
    const app = express();
    const fake = new FakeActualClient();
    fake.failNextSyncWith(new Error('net'));
    const coalescer = new SyncCoalescer(fake, 2000);
    await coalescer.maybeSync().catch(() => {});
    mountHealth(app, { coalescer, sdkInitialized: () => true, syncId: 'sid', version: '2.0.0' });
    const r = await request(app).get('/health');
    expect(r.status).toBe(200);
    expect((r.body as { status?: string }).status).toBe('degraded');
  });

  it('reports down (HTTP 503) when sdk not initialized', async () => {
    const app = express();
    const fake = new FakeActualClient();
    const coalescer = new SyncCoalescer(fake, 2000);
    mountHealth(app, { coalescer, sdkInitialized: () => false, syncId: 'sid', version: '2.0.0' });
    const r = await request(app).get('/health');
    expect(r.status).toBe(503);
    expect((r.body as { status?: string }).status).toBe('down');
  });
});
