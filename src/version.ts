import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Walk up from the current file looking for the nearest package.json.
// The relative path differs between dev (src/version.ts → ../package.json)
// and the Docker runtime (build/src/version.js → ../../package.json), so a
// fixed `../package.json` literal is wrong in one or the other. A bounded
// walk works in both.
function findPackageJson(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'package.json');
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- bounded walk-up of internal paths
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('package.json not found while resolving VERSION');
}

const pkg = JSON.parse(
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is resolved by findPackageJson above
  readFileSync(findPackageJson(), 'utf-8'),
) as { version: string };

export const VERSION = pkg.version;
