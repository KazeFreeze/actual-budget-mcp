import type pino from 'pino';

export type AuditedHandler<I, O> = (input: I, callerKey: string) => Promise<O>;

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
