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

describe('integration: categories via real SDK (offline mode)', () => {
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

  it('lists the seeded categories Food and Transport', async () => {
    const cats = await client.getCategories();
    const names = cats.map((c) => c.name);
    expect(names).toContain('Food');
    expect(names).toContain('Transport');
    const food = cats.find((c) => c.name === 'Food');
    if (!food) throw new Error('Food not found');
    // Shape sanity: required keys exist and have correct types
    expect(typeof food.id).toBe('string');
    expect(typeof food.group_id).toBe('string');
  });

  it('creates, updates, and deletes a category in the Spending group', async () => {
    const groups = await client.getCategoryGroups();
    const spending = groups.find((g) => g.name === 'Spending');
    if (!spending) throw new Error('fixture missing Spending group');

    // create
    const newId = await client.createCategory({
      name: 'IntegrationNew',
      group_id: spending.id,
    });
    expect(typeof newId).toBe('string');
    expect(newId.length).toBeGreaterThan(0);

    let cats = await client.getCategories();
    const created = cats.find((c) => c.id === newId);
    if (!created) throw new Error('created category did not appear in list');
    expect(created.name).toBe('IntegrationNew');
    expect(created.group_id).toBe(spending.id);

    // update
    await client.updateCategory(newId, { name: 'IntegrationRenamed' });
    cats = await client.getCategories();
    const renamed = cats.find((c) => c.id === newId);
    if (!renamed) throw new Error('renamed category vanished');
    expect(renamed.name).toBe('IntegrationRenamed');

    // delete
    await client.deleteCategory(newId);
    cats = await client.getCategories();
    expect(cats.find((c) => c.id === newId)).toBeUndefined();
  });
});
