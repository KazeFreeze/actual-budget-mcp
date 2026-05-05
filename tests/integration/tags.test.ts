import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  // eslint-disable-next-line n/no-unsupported-features/node-builtins -- cpSync is stable since Node 22.3.0; engines >=22.0.0 covers dev/test envs
  cpSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as api from '@actual-app/api';
import { SdkActualClient } from '../../src/client/sdk-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FIXTURE = join(__dirname, '../fixtures/budget-cache');

// TEST-ONLY artifact — integration tests construct `SdkActualClient` via
// `Object.create(SdkActualClient.prototype)` to skip lifecycle/auth, which
// also bypasses the `writeTool` wrapper. In production, `writeTool`
// (`src/tools/shared.ts:35-53`) calls `withRetriedSync(syncAfter)` after
// every mutation, draining pending CRDT messages before the next read.
// Tests skip that path, so this 250ms delay compensates by letting the
// SDK's fire-and-forget batch update apply before re-reading. Production
// callers do NOT see this race. See transactions.test.ts FINDINGS #4.
const SETTLE = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 250));

// =====================================================================
// FINDINGS — Task 5.3 integration coverage exposed real adapter drift.
//
// 1. FIXED in Task 5.4a (this file's commit): `getTags()` adapter now
//    delegates to the public `api.getTags()` method, which routes through
//    `api/tags-get` and runs raw SQL on the real `tags` table. The
//    previous implementation used `api.aqlQuery(api.q('tags').select('*'))`
//    which threw `Error: Table "tags" does not exist` because AQL has no
//    `tags` table.
//
// 2. FIXED in Task 5.4a (this file's commit): `createTag()` /
//    `updateTag()` / `deleteTag()` now delegate to the public
//    `api.createTag/updateTag/deleteTag` functions, which wrap the
//    correct internal channels (`api/tag-{create,update,delete}` —
//    singular!) with the right payload shapes. The previous
//    implementation used unverified `internal.send('tags-{create,update,delete}')`
//    channels, and the `tags-delete` payload was incorrectly an array
//    (`[id]`) instead of an object (`{id}`) — the array-of-ids channel
//    is `tags-delete-all`. `api.createTag` returns the new id as a
//    string (matches the SDK's `Promise<string>` signature).
//
// 3. FIXED in Task 5.4b: `addTransactions` adapter is now correctly typed
//    `Promise<void>` (was `Promise<string>`). The underlying SDK handler
//    `api/transactions-add` returns the literal `"ok"`, not a list of new
//    ids; the adapter discards that token. Callers that need the new ids
//    should re-query via `getTransactions` (see transactions.test.ts).
//
// 4. RESOLVED — upstream fire-and-forget is benign in production because
//    `writeTool` always calls `client.sync()` after the mutation. The
//    `transactions-batch-update` handler in @actual-app/api returns
//    before its internal promise resolves, but production callers funnel
//    through `writeTool` (`src/tools/shared.ts:35-53`) which wraps every
//    write in `withRetriedSync(syncAfter)` — that sync drains pending
//    CRDT messages before the next read can observe stale state. Tests
//    bypass `writeTool` and instead use a small `SETTLE` delay (see
//    constant below) to compensate.
// =====================================================================

describe('integration: tags via real SDK (offline mode)', () => {
  let tmp: string;
  let client: SdkActualClient;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'actual-int-'));
    cpSync(FIXTURE, tmp, { recursive: true });
    await api.init({ dataDir: tmp });
    const budgets = await api.getBudgets();
    const first = budgets[0];
    if (!first?.id) throw new Error('fixture has no budgets with an id');
    await api.loadBudget(first.id);
    client = Object.create(SdkActualClient.prototype) as SdkActualClient;
    (client as unknown as { initialized: boolean }).initialized = true;
  });

  afterEach(async () => {
    await api.shutdown();
    rmSync(tmp, { recursive: true });
  });

  it('lists tags from the fixture (likely empty initially)', async () => {
    const tags = await client.getTags();
    expect(Array.isArray(tags)).toBe(true);
  });

  it('round-trip: create / update / delete a tag via adapter', async () => {
    const created = await client.createTag({ tag: 'integration-tag', color: '#abcdef' });
    expect(typeof created).toBe('string');

    await SETTLE();
    let tags = await client.getTags();
    const found = tags.find((t) => t.id === created);
    expect(found).toBeDefined();
    expect(found?.tag).toBe('integration-tag');

    await client.updateTag(created, { tag: 'integration-tag-renamed' });
    await SETTLE();
    tags = await client.getTags();
    const renamed = tags.find((t) => t.id === created);
    if (!renamed) throw new Error('renamed tag vanished');
    expect(renamed.tag).toBe('integration-tag-renamed');

    await client.deleteTag(created);
    await SETTLE();
    tags = await client.getTags();
    expect(tags.find((t) => t.id === created)).toBeUndefined();
  });
});
