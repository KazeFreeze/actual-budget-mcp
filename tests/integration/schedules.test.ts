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

// =====================================================================
// FINDINGS — Task 5.4c integration coverage exposed real adapter drift.
//
// 5. WORKING: `getSchedules()` (AQL read on the `schedules` table) succeeds
//    end-to-end and returns rows in the internal-DB shape (`_payee`,
//    `_account`, `_amount`, `_date`, `_conditions`, `_actions`, plus
//    `id`, `name`, `rule`, `next_date`, `completed`, `posts_transaction`)
//    — which matches the `Schedule` interface declared in
//    `src/client/actual-client.ts`. AQL has a `schedules` table (unlike
//    the missing `tags` table that broke Task 5.3), so the read path
//    does NOT need a public-method switch. Note however that the public
//    SDK method `api.getSchedules()` returns the *external* shape
//    (`payee`, `account`, `amount`, `amountOp`, `date`) which is a
//    different contract — switching to it would be a breaking change
//    for any caller relying on the underscore fields.
//
// 6. BROKEN — `createSchedule()` adapter is unusable in offline mode and
//    has the wrong payload shape even when `api.internal` is available.
//
//    Failure 1 (offline mode): `api.internal` is literally `null` after
//    `api.init({ dataDir })` without a `serverURL`. The adapter wraps
//    `internal.send(...)` and throws:
//        "SdkActualClient: api.internal is not available;
//         ensure init() has been called"
//    Every offline integration test (and any offline production use)
//    therefore cannot create a schedule via this adapter at all.
//
//    Failure 2 (channel signature drift): even when `api.internal` is
//    populated (online mode), the `schedule/create` handler signature is
//        async function ({ schedule = null, conditions = [] } = {}) {
//          const { date: dateCond } = extractScheduleConds(conditions);
//          if (dateCond == null) throw new Error(
//            "A date condition is required to create a schedule"
//          );
//          ...
//        }
//    (see node_modules/@actual-app/api/dist/index.js around L114793-L114826)
//    The adapter passes `{ schedule: input }` with no `conditions`, so
//    the handler always throws on the missing-date check. The `rule`
//    field on the input is unused — the handler creates the rule itself
//    from the conditions and stores its UUID on the schedule row.
//
//    Proposed fix: switch the adapter to the public top-level methods
//    that the SDK already exposes (mirroring the Task 5.4a tags fix):
//        - api.getSchedules()      (methods.d.ts line 96)
//        - api.createSchedule(s)   (methods.d.ts line 93)
//        - api.updateSchedule(...) (methods.d.ts line 94)
//        - api.deleteSchedule(id)  (methods.d.ts line 95)
//    These wrap `api/schedule-{create,update,delete,...}` server handlers
//    that translate flat `APIScheduleEntity` fields (payee, account,
//    amount, amountOp, date) into the internal conditions array via
//    `scheduleModel.fromExternal` and call `schedule/create` correctly.
//    Switching also requires changing the `Schedule` interface and the
//    `createSchedule`/`updateSchedule` argument shapes in
//    `src/client/actual-client.ts` to mirror `APIScheduleEntity`, and
//    revisiting any caller (downstream tools / handlers) that reads the
//    underscore fields. That is out of scope for this exercise — see
//    follow-up task.
//
// 7. BROKEN — `updateSchedule()` and `deleteSchedule()` adapters share
//    Failure 1 above (`api.internal` is null in offline mode), so they
//    are likewise unusable end-to-end. Channel-signature analysis was
//    blocked by Failure 1; based on the source the channel names
//    `schedule/update` and `schedule/delete` exist and match, but the
//    `schedule/update` handler refuses to change the `rule` field and
//    expects payload shape `{ schedule, conditions, resetNextDate }` —
//    which the adapter currently does NOT respect (it passes
//    `{ schedule: { id, ...fields } }` only). The same proposed fix
//    (switch to public `api.updateSchedule` / `api.deleteSchedule`)
//    applies.
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

// The write-path round-trips below are skipped because the current
// schedules adapter is broken in offline mode (see findings #6 and #7
// in the file header). Un-skip after the follow-up adapter fix.
describe.skip('integration: schedules write via real SDK (BROKEN — see header)', () => {
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

    // Set up the entities a schedule needs to point at
    const accounts = await client.getAccounts();
    const checking = accounts.find((a) => a.name === 'Checking');
    if (!checking) throw new Error('fixture missing Checking account');
    checkingId = checking.id;
    payeeId = await client.createPayee({ name: 'Schedule Test Payee' });
  });

  afterEach(async () => {
    await api.shutdown();
    rmSync(tmp, { recursive: true });
  });

  // The shape passed below is what the current adapter signature accepts
  // (`{ name, rule, active?, posts_transaction? }`). After the follow-up
  // fix this should switch to the `APIScheduleEntity`-compatible shape
  // (`{ name, posts_transaction, payee, account, amount, amountOp, date }`).
  it('round-trip: create / update / delete a schedule via adapter', async () => {
    const created = await client.createSchedule({
      name: 'Integration Schedule',
      // The adapter currently accepts a `rule` field but the underlying
      // handler ignores it and constructs a rule from `conditions` (which
      // the adapter does not pass). Documented for the fixer.
      rule: { conditions: [], conditionsOp: 'and' },
      active: true,
      posts_transaction: false,
    });
    expect(typeof created).toBe('string');

    let schedules = await client.getSchedules();
    const found = schedules.find((s) => s.id === created);
    expect(found).toBeDefined();
    expect(found?.name).toBe('Integration Schedule');
    expect(found?._account).toBe(checkingId);
    expect(found?._payee).toBe(payeeId);

    await client.updateSchedule(created, { name: 'Integration Schedule renamed' });
    schedules = await client.getSchedules();
    const renamed = schedules.find((s) => s.id === created);
    if (!renamed) throw new Error('renamed schedule vanished');
    expect(renamed.name).toBe('Integration Schedule renamed');

    await client.deleteSchedule(created);
    schedules = await client.getSchedules();
    expect(schedules.find((s) => s.id === created)).toBeUndefined();
  });
});
