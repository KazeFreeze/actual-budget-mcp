import type pino from 'pino';
import type { CallToolResult as SdkCallToolResult } from '@modelcontextprotocol/sdk/types.js';
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

/**
 * Strip keys whose value is `undefined`. Required because we run with
 * `exactOptionalPropertyTypes: true` — Zod's `.optional()` produces
 * `string | undefined`, but the `ActualClient` interface declares fields
 * with `?:` (which forbids explicit `undefined` values).
 */
export function compact<T extends object>(obj: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  const out = {} as { [K in keyof T]: Exclude<T[K], undefined> };
  for (const key of Object.keys(obj) as Array<keyof T>) {
    const v = obj[key];
    if (v !== undefined) {
      (out as Record<keyof T, unknown>)[key] = v;
    }
  }
  return out;
}

/**
 * Cast our local `CallToolResult` (defined in `shared.ts`) into the SDK's
 * structural `CallToolResult` (which carries an open index signature from
 * `z.core.$loose`). The shapes are identical at runtime.
 */
export function toSdk(r: CallToolResult): SdkCallToolResult {
  return r as unknown as SdkCallToolResult;
}

/**
 * Adapter: the MCP SDK invokes tool callbacks as `(args, extra)` where
 * `extra` is `RequestHandlerExtra`, but `writeTool` returns an
 * `AuditedHandler<I, O>` whose second parameter is a `callerKey: string`.
 * We bridge by extracting `sessionId` from `extra` (or accepting a string
 * directly when called via the test harness).
 */
export function adaptAudited<I>(
  handler: AuditedHandler<I, CallToolResult>,
): (input: I, extra: unknown) => Promise<SdkCallToolResult> {
  return async (input, extra) => {
    let callerKey = 'unknown';
    if (typeof extra === 'string') {
      callerKey = extra;
    } else if (extra && typeof extra === 'object' && 'sessionId' in extra) {
      const sid = (extra as { sessionId?: unknown }).sessionId;
      if (typeof sid === 'string') callerKey = sid;
    }
    return toSdk(await handler(input, callerKey));
  };
}

/** Wraps a `readTool` result so its return type satisfies the SDK overload. */
export function adaptRead<I>(
  fn: (input: I) => Promise<CallToolResult>,
): (input: I) => Promise<SdkCallToolResult> {
  return async (input) => toSdk(await fn(input));
}
