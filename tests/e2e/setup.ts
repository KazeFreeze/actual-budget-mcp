// E2E bootstrap helper.
//
// Reusable helpers that the smoke test (and any future E2E tests) imports
// from beforeAll/afterAll. The flow is unavoidably stateful: we cannot start
// actual-mcp until we have a sync ID, and we cannot have a sync ID until
// actual-server is up and a budget has been created on it.
//
// Pattern mirrors `tests/fixtures/regenerate.ts` (which builds the offline
// fixture cache for integration tests) but here we keep both containers up
// and connect to actual-mcp over Streamable HTTP from the host.
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as api from '@actual-app/api';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const COMPOSE = join(__dirname, 'compose.yml');
export const ACTUAL_PASSWORD = 'e2e-password';

// API key meets config validation: ≥32 chars, ≥16 unique. Generated as a
// fixed test constant rather than randomized so failure modes are
// reproducible. Not a secret — the stack only listens on localhost during
// the test run and the containers are torn down in afterAll.
export const E2E_API_KEY = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEF';

async function sleep(ms: number): Promise<void> {
  await new Promise((res) => setTimeout(res, ms));
}

async function waitForUrl(url: string, label: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
      lastErr = new Error(`HTTP ${r.status.toString()}`);
    } catch (e) {
      lastErr = e;
    }
    await sleep(1000);
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(`${label} did not become ready within ${(timeoutMs / 1000).toString()}s: ${msg}`);
}

/**
 * Phase 1: bring up actual-server only, bootstrap admin password, create a
 * fresh budget via the SDK, return the sync ID. actual-mcp is intentionally
 * NOT started yet because its config requires the sync ID at startup.
 */
async function bootstrapBudget(): Promise<string> {
  // @actual-app/api inspects process.env.NODE_ENV at runtime and switches
  // its sync scheduler to a synchronous-but-once()-wrapped mode under
  // NODE_ENV=test. Vitest sets NODE_ENV=test by default, which causes our
  // post-create-budget mutations to silently NOT reach the server (the
  // auto-sync attaches to an already-in-flight fullSync promise that
  // started before the mutation's crdt messages existed). Force production
  // mode so scheduleFullSync uses the timer-based path that batches
  // mutations correctly.
  process.env.NODE_ENV = 'production';
  console.log('[e2e-setup] NODE_ENV =', process.env.NODE_ENV);

  // Up actual-server only — depends_on: [actual-server] in compose means
  // `up actual-server` is enough; actual-mcp will not start until we
  // explicitly bring it up in phase 2.
  execSync(`docker compose -f ${COMPOSE} up -d actual-server`, { stdio: 'inherit' });

  await waitForUrl('http://localhost:5006/info', 'actual-server', 60_000);

  const boot = await fetch('http://localhost:5006/account/bootstrap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: ACTUAL_PASSWORD }),
  });
  if (!boot.ok && boot.status !== 400 /* already bootstrapped */) {
    throw new Error(`bootstrap failed: ${boot.status.toString()}`);
  }
  await sleep(500);

  const tmp = mkdtempSync(join(tmpdir(), 'actual-e2e-bootstrap-'));
  let syncId: string;
  try {
    const lib = await api.init({
      dataDir: tmp,
      serverURL: 'http://localhost:5006',
      password: ACTUAL_PASSWORD,
    });
    // Mirrors the pattern in tests/fixtures/regenerate.ts. The deprecated
    // `api.internal` export is null until first use, so we go through the
    // `lib.send` returned from init().
    //
    // NOTE: `create-budget` returns `{}`, not the sync ID. The actual sync
    // ID we want to set as ACTUAL_BUDGET_SYNC_ID is the `cloudFileId` from
    // getBudgets() — that's what the SDK passes to api.downloadBudget()
    // (see src/client/sdk-client.ts).
    const send = lib.send as unknown as (h: string, p: unknown) => Promise<unknown>;
    await send('create-budget', { budgetName: 'e2e-budget' });

    // getBudgets() returns BOTH a local entry (with `id`, no `cloudFileId`)
    // and a remote entry (with `cloudFileId` + `groupId`) for the same budget.
    //
    // The user-facing "Sync ID" (what actual-server's Advanced settings page
    // shows, and what api.downloadBudget() consumes) is `groupId`, NOT
    // `cloudFileId`. The SDK's download-budget handler does
    // `files.find(f => f.groupId === syncId)`. cloudFileId is the internal
    // file storage id; passing it to downloadBudget yields "Budget not found".
    //
    // The TS type for APIFileEntity declares `groupId?: string` (optional),
    // hence the runtime check below.
    const budgets = await api.getBudgets();
    const remote = budgets.find(
      (b): b is typeof b & { groupId: string } =>
        b.name === 'e2e-budget' && typeof b.groupId === 'string',
    );
    if (!remote) {
      throw new Error(
        `bootstrap failed: no remote e2e-budget with groupId in getBudgets() result: ${JSON.stringify(budgets)}`,
      );
    }
    syncId = remote.groupId;

    // Seed a minimal dataset so smoke tests have something to query.
    const groupId = await api.createCategoryGroup({ name: 'E2E Spending' });
    await api.createCategory({ name: 'E2E Food', group_id: groupId });

    // Wait for the SDK's debounced auto-sync (FULL_SYNC_DELAY = 1000ms in
    // production NODE_ENV) to fire and drain its message queue, then issue
    // an explicit sync as a belt-and-suspenders push.
    await sleep(1500);
    await api.sync();

    const cats = await api.getCategories();
    const namesAfterSync = cats
      .filter((c): c is typeof c & { group_id: string } => 'group_id' in c)
      .map((c) => c.name);
    console.log('[e2e-setup] local categories after sync:', JSON.stringify(namesAfterSync));

    await api.shutdown();

    // Sanity-check the round trip: open a SECOND fresh dataDir, downloadBudget
    // from the server (just like actual-mcp will do), and confirm E2E Food
    // is present. If it's not, the bootstrap's sync didn't actually push and
    // there's no point bringing up actual-mcp.
    const verify = mkdtempSync(join(tmpdir(), 'actual-e2e-verify-'));
    try {
      await api.init({
        dataDir: verify,
        serverURL: 'http://localhost:5006',
        password: ACTUAL_PASSWORD,
      });
      await api.downloadBudget(syncId);
      const verifyCats = (await api.getCategories())
        .filter((c): c is typeof c & { group_id: string } => 'group_id' in c)
        .map((c) => c.name);
      console.log('[e2e-setup] server-side verify categories:', JSON.stringify(verifyCats));
      if (!verifyCats.includes('E2E Food')) {
        throw new Error(
          `bootstrap inconsistent: E2E Food on local but not server. Got: ${JSON.stringify(verifyCats)}`,
        );
      }
      await api.shutdown();
    } finally {
      rmSync(verify, { recursive: true, force: true });
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  return syncId;
}

/**
 * Phase 2: bring up actual-mcp with the sync ID + API key in its environment,
 * then wait for its /health endpoint to report ok (sync to actual-server has
 * succeeded).
 */
async function bringUpMcp(syncId: string): Promise<void> {
  // Pass env vars via the shell environment to docker compose. The compose
  // file references them as ${E2E_SYNC_ID} / ${E2E_API_KEY}.
  const env = { ...process.env, E2E_SYNC_ID: syncId, E2E_API_KEY };
  execSync(`docker compose -f ${COMPOSE} up -d actual-mcp`, { stdio: 'inherit', env });

  // /health returns 503 until SDK has initialized (i.e. budget downloaded).
  // Poll until 200 ok.
  await waitForUrl('http://localhost:3000/health', 'actual-mcp', 120_000);
}

export interface BootstrappedStack {
  syncId: string;
  apiKey: string;
}

export async function startStack(): Promise<BootstrappedStack> {
  // Tear down any leftover stack from a previous (possibly aborted) run so
  // we always start clean. -v removes volumes so actual-server starts fresh.
  try {
    execSync(`docker compose -f ${COMPOSE} down -v`, { stdio: 'ignore' });
  } catch {
    /* nothing to tear down */
  }

  const syncId = await bootstrapBudget();
  await bringUpMcp(syncId);

  return { syncId, apiKey: E2E_API_KEY };
}

export function stopStack(): void {
  // Capture logs before teardown so failure modes survive `down -v`.
  try {
    const logs = execSync('docker logs e2e-actual-mcp-1 2>&1 | tail -30', {
      encoding: 'utf-8',
    });
    console.log('[e2e-setup] actual-mcp logs (last 30):\n' + logs);
  } catch {
    /* container already gone */
  }
  execSync(`docker compose -f ${COMPOSE} down -v`, { stdio: 'inherit' });
}
