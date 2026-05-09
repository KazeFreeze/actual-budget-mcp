import { describe, it, expect, vi } from 'vitest';
import pino from 'pino';
import { checkServerVersionCompatibility, parseMajor } from '../../src/client/version-check.js';
import { FakeActualClient } from '../../src/client/fake-client.js';

function silentLogger(): pino.Logger {
  return pino({ level: 'silent' });
}

describe('parseMajor', () => {
  it('parses 26.5.2 as 26', () => {
    expect(parseMajor('26.5.2')).toBe(26);
  });

  it('parses single-segment version', () => {
    expect(parseMajor('7')).toBe(7);
  });

  it('returns null for empty string', () => {
    expect(parseMajor('')).toBeNull();
  });

  it('returns null for null', () => {
    expect(parseMajor(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(parseMajor(undefined)).toBeNull();
  });

  it('returns null for non-numeric leading segment', () => {
    expect(parseMajor('vNext.0.0')).toBeNull();
  });
});

describe('checkServerVersionCompatibility', () => {
  it('resolves and logs info when majors match', async () => {
    const client = new FakeActualClient();
    client.seedServerVersion('26.0.0');
    const logger = silentLogger();
    const infoSpy = vi.spyOn(logger, 'info');
    const warnSpy = vi.spyOn(logger, 'warn');

    await expect(checkServerVersionCompatibility(client, logger, false)).resolves.toBeUndefined();

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('resolves and logs warn when majors mismatch and not strict', async () => {
    const client = new FakeActualClient();
    client.seedServerVersion('25.4.0');
    const logger = silentLogger();
    const infoSpy = vi.spyOn(logger, 'info');
    const warnSpy = vi.spyOn(logger, 'warn');

    await expect(checkServerVersionCompatibility(client, logger, false)).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('rejects when majors mismatch and strict is true', async () => {
    const client = new FakeActualClient();
    client.seedServerVersion('25.4.0');
    const logger = silentLogger();
    const warnSpy = vi.spyOn(logger, 'warn');

    await expect(checkServerVersionCompatibility(client, logger, true)).rejects.toThrow(
      /Refusing to start/,
    );

    // Warn must still be emitted before the throw.
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('resolves and logs warn when getServerVersion throws (non-strict)', async () => {
    const client = new FakeActualClient();
    client.seedServerVersion(() => Promise.reject(new Error('network down')));
    const logger = silentLogger();
    const warnSpy = vi.spyOn(logger, 'warn');

    await expect(checkServerVersionCompatibility(client, logger, false)).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('resolves and logs warn when getServerVersion throws even in strict mode', async () => {
    const client = new FakeActualClient();
    client.seedServerVersion(() => Promise.reject(new Error('network down')));
    const logger = silentLogger();
    const warnSpy = vi.spyOn(logger, 'warn');

    await expect(checkServerVersionCompatibility(client, logger, true)).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('resolves and logs warn when getServerVersion returns empty string', async () => {
    const client = new FakeActualClient();
    client.seedServerVersion('');
    const logger = silentLogger();
    const warnSpy = vi.spyOn(logger, 'warn');

    await expect(checkServerVersionCompatibility(client, logger, true)).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('resolves and logs warn when getServerVersion returns null', async () => {
    const client = new FakeActualClient();
    client.seedServerVersion(null);
    const logger = silentLogger();
    const warnSpy = vi.spyOn(logger, 'warn');

    await expect(checkServerVersionCompatibility(client, logger, true)).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
