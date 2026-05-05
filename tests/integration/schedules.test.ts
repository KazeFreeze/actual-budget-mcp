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
// FINDINGS — Task 5.4c integration coverage exposed real adapter drift.
//
// 5. WORKING (since Task 5.4c): `getSchedules()` reads end-to-end. As of
//    Task 5.4d the adapter delegates to the public `api.getSchedules()`,
//    which returns the *external* (flat) shape (`payee`, `account`,
//    `amount`, `amountOp`, `date`) — the `Schedule` interface in
//    `src/client/actual-client.ts` was redesigned to match.
//
// 6. FIXED in Task 5.4d: `createSchedule()` adapter now delegates to the
//    public top-level `api.createSchedule()` function (methods.d.ts L93)
//    which wraps the `api/schedule-create` server handler and translates
//    flat `APIScheduleEntity` fields into the internal conditions array
//    via `scheduleModel.fromExternal`. The previous `internal.send(...)`
//    code path failed in offline mode (`api.internal === null`) and had
//    the wrong payload shape (missing `conditions`) even online. The
//    `create-schedule` MCP tool input schema is also redesigned to mirror
//    the external shape (breaking change to v2 pre-release).
//
// 7. FIXED in Task 5.4d: `updateSchedule()` and `deleteSchedule()` adapters
//    now delegate to the public `api.updateSchedule()` (methods.d.ts L94)
//    and `api.deleteSchedule()` (L95). `update-schedule` MCP tool input
//    schema is redesigned to match (breaking change to v2 pre-release);
//    `resetNextDate` is exposed as a top-level optional flag.
// =====================================================================

describe('integration: schedules read via real SDK (offline mode)', () => {
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

  it('lists schedules from the fixture (empty initially)', async () => {
    const schedules = await client.getSchedules();
    expect(Array.isArray(schedules)).toBe(true);
    // Fixture seeds no schedules; this is the read-path smoke test that
    // would have caught a `Table "schedules" does not exist` analogue of
    // the Task 5.3 tags AQL bug.
    expect(schedules.length).toBe(0);
  });
});

describe('integration: schedules write via real SDK (offline mode)', () => {
  let tmp: string;
  let client: SdkActualClient;
  let checkingId: string;
  let payeeId: string;

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

    // Set up the entities a schedule needs to point at. The fixture seeds
    // an Checking account but no payees, so we create one inline.
    const accounts = await client.getAccounts();
    const checking = accounts.find((a) => a.name === 'Checking');
    if (!checking) throw new Error('fixture missing Checking account');
    checkingId = checking.id;
    payeeId = await client.createPayee({ name: 'Schedule Test Payee' });
    await SETTLE();
  });

  afterEach(async () => {
    await api.shutdown();
    rmSync(tmp, { recursive: true });
  });

  it('round-trip: create / update / delete a schedule via adapter', async () => {
    // VERIFIED working payload (Task 5.4c implementer's probe + Task 5.4d
    // adapter switch). `amountOp: 'is'` is required by the SDK type;
    // `date` is YYYY-MM-DD (one-off) but can also be a RecurConfig object.
    const created = await client.createSchedule({
      name: 'Integration',
      payee: payeeId,
      account: checkingId,
      amount: -1000,
      amountOp: 'is',
      date: '2026-06-01',
      posts_transaction: false,
    });
    expect(typeof created).toBe('string');
    await SETTLE();

    let schedules = await client.getSchedules();
    const found = schedules.find((s) => s.id === created);
    if (!found) throw new Error('newly created schedule not found');
    expect(found.name).toBe('Integration');
    expect(found.posts_transaction).toBe(false);
    expect(found.amount).toBe(-1000);
    expect(found.amountOp).toBe('is');
    expect(found.account).toBe(checkingId);
    expect(found.payee).toBe(payeeId);

    await client.updateSchedule(created, { name: 'Renamed' });
    await SETTLE();
    schedules = await client.getSchedules();
    const renamed = schedules.find((s) => s.id === created);
    if (!renamed) throw new Error('renamed schedule vanished');
    expect(renamed.name).toBe('Renamed');

    await client.deleteSchedule(created);
    await SETTLE();
    schedules = await client.getSchedules();
    expect(schedules.find((s) => s.id === created)).toBeUndefined();
  });
});
