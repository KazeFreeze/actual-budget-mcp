import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import type pino from 'pino';
import type { ActualClient } from './actual-client.js';

const require = createRequire(import.meta.url);
const sdkMain = require.resolve('@actual-app/api');
const sdkPkgPath = resolve(dirname(sdkMain), '..', 'package.json');
// eslint-disable-next-line security/detect-non-literal-fs-filename
const sdkPkg = JSON.parse(readFileSync(sdkPkgPath, 'utf8')) as { version: string };

export function parseMajor(version: string | null | undefined): number | null {
  if (typeof version !== 'string') return null;
  const trimmed = version.trim();
  if (trimmed.length === 0) return null;
  const head = trimmed.split('.')[0];
  if (head === undefined) return null;
  const n = Number.parseInt(head, 10);
  return Number.isFinite(n) ? n : null;
}

export async function checkServerVersionCompatibility(
  client: ActualClient,
  logger: pino.Logger,
  strict: boolean,
): Promise<void> {
  const sdkVersion = sdkPkg.version;
  const sdkMajor = parseMajor(sdkVersion);
  if (sdkMajor === null) {
    logger.warn(
      { sdkVersion, msg: 'could not determine SDK version — skipping compat check' },
      'could not determine SDK version — skipping compat check',
    );
    return;
  }

  let serverVersion: string | null;
  try {
    serverVersion = await client.getServerVersion();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(
      { error: message, msg: 'could not determine server version — skipping compat check' },
      'could not determine server version — skipping compat check',
    );
    return;
  }

  const serverMajor = parseMajor(serverVersion);
  if (serverMajor === null) {
    logger.warn(
      {
        serverVersion,
        msg: 'could not determine server version — skipping compat check',
      },
      'could not determine server version — skipping compat check',
    );
    return;
  }

  if (serverMajor === sdkMajor) {
    logger.info(
      { serverVersion, sdkVersion, msg: 'server/SDK versions compatible' },
      'server/SDK versions compatible',
    );
    return;
  }

  logger.warn(
    {
      serverVersion,
      sdkVersion,
      msg: 'server/SDK major version mismatch — proceed with caution',
    },
    'server/SDK major version mismatch — proceed with caution',
  );

  if (strict) {
    throw new Error(
      `Refusing to start: server major (${serverMajor}) != SDK major (${sdkMajor}). ` +
        'Either upgrade actual-server, downgrade the MCP image, or unset MCP_STRICT_VERSION_CHECK.',
    );
  }
}
