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

const SINCE = '2026-01-01';
const UNTIL = '2026-12-31';

// =====================================================================
// FINDINGS — Task 5.3 integration coverage exposed real adapter drift.
//
// 3. FIXED in Task 5.4b: `addTransactions` adapter is now correctly typed
//    `Promise<void>`. The underlying SDK handler `api/transactions-add`
//    returns the literal string "ok", not a list of new ids; we discard
//    that token. Callers that need the new ids should re-query via
//    `getTransactions` (as this round-trip test demonstrates).
//
// 4. RESOLVED — upstream fire-and-forget is benign in production because
//    `writeTool` always calls `client.sync()` after the mutation. The
//    `transactions-batch-update` handler in @actual-app/api returns
//    before its internal promise resolves, but production callers funnel
//    through `writeTool` (`src/tools/shared.ts:35-53`) which wraps every
//    write in `withRetriedSync(syncAfter)` — that sync drains pending
//    CRDT messages before the next read can observe stale state. See
//    SETTLE comment below for why tests still need the workaround.
// =====================================================================
//
// The `SETTLE` delay is a TEST-ONLY artifact. Integration tests construct
// the `SdkActualClient` directly via `Object.create(SdkActualClient.prototype)`
// to skip the lifecycle/auth boilerplate, which means they also bypass the
// `writeTool` wrapper that production callers go through. `writeTool`
// (`src/tools/shared.ts:35-53`) calls `withRetriedSync(syncAfter)` after
// every mutation, naturally draining pending fire-and-forget batch updates
// before the next read. Tests skip that path, so we compensate with a
// small delay to give the SDK's async writes time to apply. Production
// callers do NOT see this race.
const SETTLE = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 250));

describe('integration: transactions via real SDK (offline mode)', () => {
  let tmp: string;
  let client: SdkActualClient;
  let checkingId: string;

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

    const accounts = await client.getAccounts();
    const checking = accounts.find((a) => a.name === 'Checking');
    if (!checking) throw new Error('fixture missing Checking account');
    checkingId = checking.id;
  });

  afterEach(async () => {
    await api.shutdown();
    rmSync(tmp, { recursive: true });
  });

  it('lists the 3 seeded transactions from the fixture', async () => {
    const txs = await client.getTransactions(checkingId, SINCE, UNTIL);
    expect(txs.length).toBeGreaterThanOrEqual(3);
    // Shape sanity on the first row
    const first = txs[0];
    if (!first) throw new Error('no transactions returned');
    expect(typeof first.id).toBe('string');
    expect(typeof first.account).toBe('string');
    expect(typeof first.date).toBe('string');
    expect(typeof first.amount).toBe('number');
    // Amounts are integer cents
    expect(Number.isInteger(first.amount)).toBe(true);
  });

  it('adds, updates, and deletes a transaction round-trip', async () => {
    const before = await client.getTransactions(checkingId, SINCE, UNTIL);
    const beforeIds = new Set(before.map((t) => t.id));

    // add — adapter returns Promise<void> (Task 5.4b); the SDK channel does
    // not surface the new ids, so we round-trip through getTransactions to
    // verify the row landed.
    await client.addTransactions(
      checkingId,
      [
        {
          account: checkingId,
          date: '2026-05-04',
          amount: -1234,
          payee: 'Integration Payee',
          notes: 'integration note v1',
        },
      ],
      { learnCategories: false, runTransfers: false },
    );

    const after = await client.getTransactions(checkingId, SINCE, UNTIL);
    expect(after.length).toBe(before.length + 1);
    const newTx = after.find((t) => !beforeIds.has(t.id));
    if (!newTx) throw new Error('newly added transaction not found');
    expect(newTx.amount).toBe(-1234);
    expect(newTx.date).toBe('2026-05-04');
    expect(newTx.notes).toBe('integration note v1');

    // update — see SETTLE comment above re: race in @actual-app/api
    await client.updateTransaction(newTx.id, { notes: 'integration note v2' });
    await SETTLE();
    const afterUpdate = await client.getTransactions(checkingId, SINCE, UNTIL);
    const updated = afterUpdate.find((t) => t.id === newTx.id);
    if (!updated) throw new Error('updated transaction vanished');
    expect(updated.notes).toBe('integration note v2');

    // delete
    await client.deleteTransaction(newTx.id);
    await SETTLE();
    const afterDelete = await client.getTransactions(checkingId, SINCE, UNTIL);
    expect(afterDelete.find((t) => t.id === newTx.id)).toBeUndefined();
    expect(afterDelete.length).toBe(before.length);
  });
});
