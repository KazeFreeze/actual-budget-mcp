import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const thisDir = dirname(fileURLToPath(import.meta.url));
const root = join(thisDir, '..', '..');
const builtVersion = join(root, 'build', 'src', 'version.js');
const pkg = createRequire(import.meta.url)('../../package.json') as { version: string };

describe('VERSION (compiled output)', () => {
  // Regression: the previous implementation used createRequire('../package.json')
  // which resolved correctly from src/version.ts under vitest but to a
  // nonexistent path from build/src/version.js at runtime, crash-looping the
  // production container. This exercises the *compiled* artifact so the path
  // bug can't recur silently.
  beforeAll(() => {
    if (!existsSync(builtVersion)) {
      execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
    }
  });

  it('loads the compiled version module and returns package.json version', () => {
    const out = execFileSync(
      'node',
      ['-e', `import('${builtVersion}').then(m => process.stdout.write(m.VERSION))`],
      { cwd: root, encoding: 'utf-8' },
    );
    expect(out.trim()).toBe(pkg.version);
  });
});
