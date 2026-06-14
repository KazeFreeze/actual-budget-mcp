import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { VERSION } from '../../src/version.js';

const pkg = createRequire(import.meta.url)('../../package.json') as { version: string };

describe('VERSION', () => {
  // Regression: index.ts and server.ts used to hardcode '2.0.0', so /health and
  // the MCP handshake kept reporting the wrong version after every release.
  // Force the constant to stay tied to package.json.
  it('matches the version in package.json', () => {
    expect(VERSION).toBe(pkg.version);
  });
});
