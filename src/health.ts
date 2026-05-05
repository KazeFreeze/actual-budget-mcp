import type { Express } from 'express';
import type { SyncCoalescer } from './client/sync-coalescer.js';

export interface HealthOptions {
  coalescer: SyncCoalescer;
  sdkInitialized: () => boolean;
  syncId: string;
  version: string;
}

export function mountHealth(app: Express, opts: HealthOptions): void {
  app.get('/health', (_req, res) => {
    const sdkUp = opts.sdkInitialized();
    if (!sdkUp) {
      res.status(503).json({
        status: 'down',
        sdkInitialized: false,
        lastSyncAt: opts.coalescer.lastSyncAt,
        lastSyncSucceeded: opts.coalescer.lastSyncSucceeded,
        budgetSyncId: opts.syncId,
        version: opts.version,
      });
      return;
    }
    const status = opts.coalescer.lastSyncSucceeded ? 'ok' : 'degraded';
    res.status(200).json({
      status,
      sdkInitialized: true,
      lastSyncAt: opts.coalescer.lastSyncAt,
      lastSyncSucceeded: opts.coalescer.lastSyncSucceeded,
      budgetSyncId: opts.syncId,
      version: opts.version,
    });
  });
}
