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

describe('integration: notes via real SDK (offline mode)', () => {
  let tmp: string;
  let client: SdkActualClient;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'actual-int-'));
    cpSync(FIXTURE, tmp, { recursive: true });
    // Offline mode: serverURL omitted via no-op init; we hand-init the SDK.
    // api.init's TS return type is `Promise<void>` but at runtime it returns
    // the internal bridge ({ send, ... }) — the same value SdkActualClient
    // captures on `this.lib`. We need to capture it here so we can hand it
    // to the manually-constructed client below (since we're bypassing
    // client.init() to point at a pre-existing offline fixture budget).
    const lib = await (
      api.init as unknown as (cfg: unknown) => Promise<{
        send: (m: string, p?: unknown) => Promise<unknown>;
      }>
    )({ dataDir: tmp });
    // Open the budget that lives in the fixture cache
    const budgets = await api.getBudgets();
    const first = budgets[0];
    if (!first?.id) throw new Error('fixture has no budgets with an id');
    await api.loadBudget(first.id);
    // Construct the client without re-initing — but plant the captured
    // `lib` so internalSend (used by setNote/deleteNote) has its bridge.
    client = Object.create(SdkActualClient.prototype) as SdkActualClient;
    (client as unknown as { initialized: boolean; lib: typeof lib }).initialized = true;
    (client as unknown as { initialized: boolean; lib: typeof lib }).lib = lib;
  });

  afterEach(async () => {
    await api.shutdown();
    rmSync(tmp, { recursive: true });
  });

  it('writes then reads a note for an existing category', async () => {
    const cats = await client.getCategories();
    const target = cats[0];
    if (!target) throw new Error('fixture has no categories');
    await client.setNote(target.id, 'integration test note');
    expect(await client.getNote(target.id)).toBe('integration test note');
  });

  it('reads the seeded note from the fixture', async () => {
    const cats = await client.getCategories();
    const food = cats.find((c) => c.name === 'Food');
    if (!food) throw new Error('fixture missing Food category');
    expect(await client.getNote(food.id)).toBe('fixture note on Food');
  });

  it('deleteNote clears it', async () => {
    const cats = await client.getCategories();
    const food = cats.find((c) => c.name === 'Food');
    if (!food) throw new Error('fixture missing Food category');
    await client.deleteNote(food.id);
    expect(await client.getNote(food.id)).toBe(null);
  });
});
