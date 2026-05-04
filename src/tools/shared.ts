import type pino from 'pino';
import { withAudit, type AuditedHandler } from '../audit.js';
import { withRetriedSync } from '../client/lifecycle.js';
import type { SyncCoalescer } from '../client/sync-coalescer.js';

export interface CallToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export function ok(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] };
}
export function err(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

export function readTool<I>(
  coalescer: SyncCoalescer,
  fn: (input: I) => Promise<CallToolResult>,
): (input: I) => Promise<CallToolResult> {
  return async (input) => {
    try {
      await withRetriedSync(() => coalescer.maybeSync());
    } catch (e) {
      return err(
        `sync failed: ${e instanceof Error ? e.message : String(e)}; refusing to serve stale data`,
      );
    }
    return fn(input);
  };
}

export function writeTool<I>(
  logger: pino.Logger,
  toolName: string,
  syncAfter: () => Promise<void>,
  fn: (input: I) => Promise<CallToolResult>,
): AuditedHandler<I, CallToolResult> {
  const audited = withAudit(logger, toolName, async (input: I) => {
    const result = await fn(input);
    try {
      await withRetriedSync(syncAfter);
    } catch (e) {
      return err(
        `write committed locally but failed to sync to server: ${e instanceof Error ? e.message : String(e)}; will retry on next call`,
      );
    }
    return result;
  });
  return audited;
}
