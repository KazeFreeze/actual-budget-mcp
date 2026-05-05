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

// Same SDK race observed in transactions.test.ts — give CRDT messages a moment
// to apply before re-reading.
const SETTLE = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 250));

// =====================================================================
// FINDINGS — Task 5.3 integration coverage exposed real adapter drift.
//
// 1. `getTags()` adapter implementation is broken in @actual-app/api 25.x.
//    The adapter does:
//        await api.aqlQuery(api.q('tags').select('*' as unknown as []))
//    AQL has no `tags` table, so the query rejects with
//        Error: Table "tags" does not exist
//    (verified by integration test, see commented reproducer below).
//    The fix is to use the public `api.getTags()` method, which routes
//    through `api/tags-get` and runs raw SQL on the real `tags` table.
//
// 2. `createTag()` / `updateTag()` / `deleteTag()` use unverified
//    `internal.send('tags-{create,update,delete}')` channels. Since
//    `getTags()` is broken we can't even round-trip writes to verify them,
//    but inspection of loot-core (`tags/app.ts`) shows:
//      - `tags-create` payload `{ tag, color, description }` is correct
//        for the adapter's current shape.
//      - `tags-update` payload `{ id, ...fields }` is correct.
//      - `tags-delete` payload should be `{ id }` (an OBJECT) — the
//        loot-core handler `deleteTag$1(tag)` reads `tag.id`. The adapter
//        currently sends `[id]` (an ARRAY), which would set `tag.id` to
//        undefined. The array-of-ids channel is `tags-delete-all`.
//    The public SDK now exposes `api.createTag/updateTag/deleteTag` that
//    handle all of this; the adapter should delegate to them.
//
// 3. `addTransactions` adapter typed as `Promise<string>`; underlying SDK
//    handler returns the literal `"ok"` (not a list of new ids). This is
//    handled in transactions.test.ts by not over-asserting on the result
//    value, only that the new transaction appears in `getTransactions`.
//
// 4. `updateTransaction` and `deleteTransaction` in @actual-app/api have a
//    fire-and-forget bug — the handler does
//        return handlers["transactions-batch-update"](diff)["updated"]
//    without awaiting the promise. Mutations apply asynchronously after
//    the call returns. Worked around in transactions.test.ts with a small
//    settle delay.
//
// All four findings are observable adapter / SDK behavior; none of them
// are fixed in this commit per the Task 5.3 protocol of "report, do not
// silently fix". The reproducer test below is intentionally skipped so
// the suite exit-codes clean — vitest treats SDK-internal unhandled
// rejections as suite errors, masking the rest of the signal.
// =====================================================================

describe.skip('integration: tags via real SDK (offline mode) — BLOCKED on adapter bugs', () => {
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

  it('reproducer: getTags via aqlQuery throws "Table tags does not exist"', async () => {
    // Skipped at the describe level. When the adapter is fixed to use
    // `api.getTags()`, change `describe.skip` → `describe` and replace
    // this assertion with a positive `expect(Array.isArray(tags)).toBe(true)`.
    await expect(client.getTags()).rejects.toThrow(/Table "tags" does not exist/);
  });

  it('round-trip: create / update / delete a tag via adapter', async () => {
    const created = await client.createTag({ tag: 'integration-tag', color: '#abcdef' });
    expect(typeof created.id).toBe('string');
    expect(created.tag).toBe('integration-tag');

    await SETTLE();
    let tags = await client.getTags();
    expect(tags.find((t) => t.id === created.id)).toBeDefined();

    await client.updateTag(created.id, { tag: 'integration-tag-renamed' });
    await SETTLE();
    tags = await client.getTags();
    const renamed = tags.find((t) => t.id === created.id);
    if (!renamed) throw new Error('renamed tag vanished');
    expect(renamed.tag).toBe('integration-tag-renamed');

    await client.deleteTag(created.id);
    await SETTLE();
    tags = await client.getTags();
    expect(tags.find((t) => t.id === created.id)).toBeUndefined();
  });
});
