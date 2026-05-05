import { execSync } from 'node:child_process';
import {
  mkdtempSync,
  rmSync,
  // eslint-disable-next-line n/no-unsupported-features/node-builtins -- cpSync is stable since Node 22.3.0; this script runs locally on the dev machine which we control
  cpSync,
  existsSync,
  writeFileSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as api from '@actual-app/api';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const COMPOSE = join(__dirname, 'compose.yml');
const FIXTURE_DIR = join(__dirname, 'budget-cache');
const PASSWORD = 'fixture-password';

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
    const lib = await api.init({
      dataDir: tmp,
      serverURL: 'http://localhost:5006',
      password: PASSWORD,
    });

    // Create a fresh budget — uses the lib.send returned from init
    // (the deprecated `api.internal` export is null until first use)
    const send = lib.send as unknown as (h: string, p: unknown) => Promise<unknown>;
    const syncId = (await send('create-budget', {
      budgetName: 'fixture-budget',
    })) as string;

    // create-budget seeds the budget with a default category template
    // (Usual Expenses → Food/General/Bills/etc, Income, Investments and
    // Savings). Delete any defaults whose names would collide with the
    // categories we're about to create so getCategories().find(name === ...)
    // resolves uniquely in integration tests.
    const ourCategoryNames = new Set(['Food', 'Transport']);
    const existing = await api.getCategories();
    for (const c of existing) {
      // Only APICategoryEntity has group_id; APICategoryGroupEntity does not
      if ('group_id' in c && ourCategoryNames.has(c.name)) {
        await api.deleteCategory(c.id);
      }
    }

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
    await send('notes-save', {
      id: cat1,
      note: 'fixture note on Food',
    });

    await api.shutdown();

    // Copy the cache to fixture dir
    if (existsSync(FIXTURE_DIR)) rmSync(FIXTURE_DIR, { recursive: true });
    cpSync(tmp, FIXTURE_DIR, { recursive: true });
    rmSync(tmp, { recursive: true });

    // The SDK only writes metadata.json on subsequent prefs changes, not at
    // budget creation. getBudgets() requires it (parses JSON; null entries are
    // filtered out), so write a minimal valid prefs file post-copy so
    // integration tests can discover the budget.
    const budgetSubdirs = readdirSync(FIXTURE_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    for (const budgetId of budgetSubdirs) {
      const metadataPath = join(FIXTURE_DIR, budgetId, 'metadata.json');
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is constructed from FIXTURE_DIR + names we just listed
      writeFileSync(metadataPath, JSON.stringify({ id: budgetId, budgetName: 'fixture-budget' }));
    }

    console.log(`Fixture regenerated at ${FIXTURE_DIR} (syncId=${JSON.stringify(syncId)})`);
  } finally {
    execSync(`docker compose -f ${COMPOSE} down -v`, { stdio: 'inherit' });
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
