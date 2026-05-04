import { execSync } from 'node:child_process';
// eslint-disable-next-line n/no-unsupported-features/node-builtins -- cpSync is stable since Node 22.3.0; this script runs locally on the dev machine which we control
import { mkdtempSync, rmSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as api from '@actual-app/api';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const COMPOSE = join(__dirname, 'compose.yml');
const FIXTURE_DIR = join(__dirname, 'budget-cache');
const PASSWORD = 'fixture-password';

interface InternalSendApi {
  internal: { send: (h: string, p: unknown) => Promise<unknown> };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((res) => setTimeout(res, ms));
}

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch('http://localhost:5006/info');
      if (r.ok) return;
    } catch {
      /* not ready */
    }
    await sleep(1000);
  }
  throw new Error('actual-server did not become ready in 30s');
}

async function main(): Promise<void> {
  console.log('Bringing up actual-server-fixture...');
  execSync(`docker compose -f ${COMPOSE} up -d`, { stdio: 'inherit' });
  try {
    await waitForServer();

    // Bootstrap the server with a password
    const boot = await fetch('http://localhost:5006/account/bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    });
    if (!boot.ok && boot.status !== 400 /* already bootstrapped */) {
      throw new Error(`bootstrap failed: ${boot.status.toString()}`);
    }

    // Brief delay to let the SDK-facing endpoints settle after bootstrap
    await sleep(500);

    const tmp = mkdtempSync(join(tmpdir(), 'actual-fixture-'));
    await api.init({
      dataDir: tmp,
      serverURL: 'http://localhost:5006',
      password: PASSWORD,
    });

    const internal = api as unknown as InternalSendApi;

    // Create a fresh budget — uses internal.send
    const syncId = (await internal.internal.send('create-budget', {
      budgetName: 'fixture-budget',
    })) as string;

    // Populate minimal dataset
    const groupId = await api.createCategoryGroup({ name: 'Spending' });
    const cat1 = await api.createCategory({ name: 'Food', group_id: groupId });
    const cat2 = await api.createCategory({
      name: 'Transport',
      group_id: groupId,
    });
    const acctId = await api.createAccount({ name: 'Checking' }, 100000);
    await api.addTransactions(acctId, [
      {
        date: '2026-05-01',
        amount: -1500,
        payee_name: 'Coffee',
        category: cat1,
        notes: 'morning',
      },
      {
        date: '2026-05-02',
        amount: -3500,
        payee_name: 'Bus',
        category: cat2,
      },
      {
        date: '2026-05-03',
        amount: 50000,
        payee_name: 'Salary',
      },
    ]);
    await internal.internal.send('notes-save', {
      id: cat1,
      note: 'fixture note on Food',
    });

    await api.shutdown();

    // Copy the cache to fixture dir
    if (existsSync(FIXTURE_DIR)) rmSync(FIXTURE_DIR, { recursive: true });
    cpSync(tmp, FIXTURE_DIR, { recursive: true });
    rmSync(tmp, { recursive: true });
    console.log(`Fixture regenerated at ${FIXTURE_DIR} (syncId=${syncId})`);
  } finally {
    execSync(`docker compose -f ${COMPOSE} down -v`, { stdio: 'inherit' });
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
