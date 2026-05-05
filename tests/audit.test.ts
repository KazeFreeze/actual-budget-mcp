import { describe, it, expect } from 'vitest';
import pino from 'pino';
import { Writable } from 'node:stream';
import { withAudit } from '../src/audit.js';

interface AuditEntry {
  audit?: boolean;
  tool?: string;
  result?: string;
  callerKey?: string;
  durationMs?: number;
  errorMessage?: string;
}

function captureLogger(): { logger: pino.Logger; lines: string[] } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer | string, _enc, cb): void {
      lines.push(chunk.toString());
      cb();
    },
  });
  return { logger: pino({ level: 'info' }, stream), lines };
}

describe('withAudit', () => {
  it('logs ok result with tool, durationMs, callerKey', async () => {
    const { logger, lines } = captureLogger();
    const handler = withAudit(logger, 'set-notes', () => Promise.resolve('done'));
    const result = await handler({ id: 'x', note: 'hi' }, 'abc123def456');
    expect(result).toBe('done');
    const entry = JSON.parse(lines[0] ?? '{}') as AuditEntry;
    expect(entry.audit).toBe(true);
    expect(entry.tool).toBe('set-notes');
    expect(entry.result).toBe('ok');
    expect(entry.callerKey).toBe('abc123def456');
    expect(typeof entry.durationMs).toBe('number');
  });

  it('logs err result on throw and re-throws', async () => {
    const { logger, lines } = captureLogger();
    const handler = withAudit(logger, 'set-notes', () => {
      throw new Error('boom');
    });
    await expect(handler({}, 'k')).rejects.toThrow('boom');
    const entry = JSON.parse(lines[0] ?? '{}') as AuditEntry;
    expect(entry.result).toBe('err');
    expect(entry.errorMessage).toBe('boom');
  });

  it('never includes the bearer token in any log line', async () => {
    const { logger, lines } = captureLogger();
    const SECRET = 'super-secret-bearer-token-aaaaaaaaaaa';
    const handler = withAudit(logger, 'set-notes', () => Promise.resolve(SECRET));
    await handler({ note: SECRET }, 'k');
    for (const line of lines) {
      expect(line).not.toContain(SECRET);
    }
  });

  it('logs errorMessage verbatim — callers are responsible for redacting secrets', async () => {
    const { logger, lines } = captureLogger();
    const handler = withAudit(logger, 'set-notes', () => {
      throw new Error('upstream said: bad-token-LEAKED');
    });
    await expect(handler({}, 'k')).rejects.toThrow();
    const entry = JSON.parse(lines[0] ?? '{}') as { errorMessage: string };
    // This pins the trust boundary — change deliberately, not accidentally.
    expect(entry.errorMessage).toBe('upstream said: bad-token-LEAKED');
  });
});
