import type pino from 'pino';

export type AuditedHandler<I, O> = (input: I, callerKey: string) => Promise<O>;

/**
 * Wraps a tool handler to emit one structured audit log line per call.
 *
 * SECURITY CONTRACT: callers MUST NOT throw errors whose `.message`
 * contains secrets (bearer tokens, passwords, encryption keys). The
 * message is logged verbatim. Sanitize at the throw site, not here.
 */
export function withAudit<I, O>(
  baseLogger: pino.Logger,
  tool: string,
  fn: (input: I) => Promise<O>,
): AuditedHandler<I, O> {
  const auditLogger = baseLogger.child({ audit: true });
  return async (input, callerKey) => {
    const start = Date.now();
    try {
      const result = await fn(input);
      auditLogger.info({ tool, callerKey, result: 'ok', durationMs: Date.now() - start }, 'audit');
      return result;
    } catch (err) {
      auditLogger.warn(
        {
          tool,
          callerKey,
          result: 'err',
          durationMs: Date.now() - start,
          errorMessage: err instanceof Error ? err.message : String(err),
        },
        'audit',
      );
      throw err;
    }
  };
}
