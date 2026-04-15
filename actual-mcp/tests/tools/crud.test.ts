import { describe, it, expect, vi } from 'vitest';

function mockClient(overrides: Record<string, unknown> = {}) {
  return {
    getAccounts: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 'a1', name: 'Checking', offbudget: false, closed: false }] }),
    getAccountBalance: vi.fn().mockResolvedValue({ ok: true, data: 250000 }),
    getTransactions: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    createTransaction: vi.fn().mockResolvedValue({ ok: true, data: 'tx-1' }),
    updateTransaction: vi.fn().mockResolvedValue({ ok: true, data: 'ok' }),
    deleteTransaction: vi.fn().mockResolvedValue({ ok: true, data: 'ok' }),
    getCategories: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 'c1', name: 'Groceries' }] }),
    getCategoryGroups: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 'g1', name: 'Bills', categories: [{ id: 'c1', name: 'Groceries' }] }] }),
    createCategory: vi.fn().mockResolvedValue({ ok: true, data: 'new-cat-id' }),
    updateCategory: vi.fn().mockResolvedValue({ ok: true, data: 'ok' }),
    deleteCategory: vi.fn().mockResolvedValue({ ok: true, data: 'ok' }),
    createCategoryGroup: vi.fn().mockResolvedValue({ ok: true, data: 'new-group-id' }),
    updateCategoryGroup: vi.fn().mockResolvedValue({ ok: true, data: 'ok' }),
    deleteCategoryGroup: vi.fn().mockResolvedValue({ ok: true, data: 'ok' }),
    getPayees: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 'p1', name: 'Costco' }] }),
    createPayee: vi.fn().mockResolvedValue({ ok: true, data: 'new-payee-id' }),
    updatePayee: vi.fn().mockResolvedValue({ ok: true, data: 'ok' }),
    deletePayee: vi.fn().mockResolvedValue({ ok: true, data: 'ok' }),
    mergePayees: vi.fn().mockResolvedValue({ ok: true, data: 'ok' }),
    getBudgetMonth: vi.fn().mockResolvedValue({ ok: true, data: { month: '2026-03', categoryGroups: [] } }),
    setBudgetAmount: vi.fn().mockResolvedValue({ ok: true, data: 'ok' }),
    transferBudget: vi.fn().mockResolvedValue({ ok: true, data: 'ok' }),
    getSchedules: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    createSchedule: vi.fn().mockResolvedValue({ ok: true, data: 'sched-1' }),
    updateSchedule: vi.fn().mockResolvedValue({ ok: true, data: 'ok' }),
    deleteSchedule: vi.fn().mockResolvedValue({ ok: true, data: 'ok' }),
    getRules: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    createRule: vi.fn().mockResolvedValue({ ok: true, data: { id: 'rule-1' } }),
    updateRule: vi.fn().mockResolvedValue({ ok: true, data: { id: 'rule-1' } }),
    deleteRule: vi.fn().mockResolvedValue({ ok: true, data: 'ok' }),
    getNotes: vi.fn().mockResolvedValue({ ok: true, data: 'My note content' }),
    setNotes: vi.fn().mockResolvedValue({ ok: true, data: 'ok' }),
    deleteNotes: vi.fn().mockResolvedValue({ ok: true, data: 'ok' }),
    runBankSync: vi.fn().mockResolvedValue({ ok: true, data: 'ok' }),
    ...overrides,
  } as any;
}

describe('CRUD tools', () => {
  it('get-accounts should return markdown table with balances', async () => {
    const { createCrudTools } = await import('../../src/tools/crud.js');
    const client = mockClient();
    const tools = createCrudTools(client, '$');
    const tool = tools.find((t) => t.schema.name === 'get-accounts')!;

    const result = await tool.handler({});

    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('Checking');
    expect(text).toContain('$2,500.00');
  });

  it('create-transaction should call client and return confirmation', async () => {
    const { createCrudTools } = await import('../../src/tools/crud.js');
    const client = mockClient();
    const tools = createCrudTools(client, '$');
    const tool = tools.find((t) => t.schema.name === 'create-transaction')!;

    const result = await tool.handler({
      account_id: 'a1',
      date: '2026-03-15',
      amount: -5000,
      payee_name: 'Costco',
    });

    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('Transaction Created');
    expect(text).toContain('-$50.00');
    expect(client.createTransaction).toHaveBeenCalledWith('a1', expect.objectContaining({ amount: -5000 }), undefined);
  });

  it('create-transaction should pass subtransactions for splits', async () => {
    const { createCrudTools } = await import('../../src/tools/crud.js');
    const client = mockClient();
    const tools = createCrudTools(client, '$');
    const tool = tools.find((t) => t.schema.name === 'create-transaction')!;

    await tool.handler({
      account_id: 'a1',
      date: '2026-03-15',
      amount: -10000,
      payee_name: 'Costco',
      subtransactions: [
        { amount: -7000, category_id: 'c1', payee_name: 'Costco' },
        { amount: -3000, category_id: 'c2', payee_name: 'Gift Shop', notes: 'Birthday' },
      ],
    });

    expect(client.createTransaction).toHaveBeenCalledWith(
      'a1',
      expect.objectContaining({
        subtransactions: expect.arrayContaining([
          expect.objectContaining({ amount: -7000 }),
          expect.objectContaining({ amount: -3000, notes: 'Birthday' }),
        ]),
      }),
      undefined,
    );
  });

  it('manage-category create should call createCategory', async () => {
    const { createCrudTools } = await import('../../src/tools/crud.js');
    const client = mockClient();
    const tools = createCrudTools(client, '$');
    const tool = tools.find((t) => t.schema.name === 'manage-category')!;

    const result = await tool.handler({ action: 'create', name: 'Entertainment', group_id: 'g1' });

    expect(result.isError).toBeUndefined();
    expect(client.createCategory).toHaveBeenCalledWith({ name: 'Entertainment', group_id: 'g1', is_income: undefined });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('Category Created');
  });

  it('manage-category should error when required fields missing', async () => {
    const { createCrudTools } = await import('../../src/tools/crud.js');
    const client = mockClient();
    const tools = createCrudTools(client, '$');
    const tool = tools.find((t) => t.schema.name === 'manage-category')!;

    const result = await tool.handler({ action: 'create' });

    expect(result.isError).toBe(true);
  });

  it('get-notes should return note content', async () => {
    const { createCrudTools } = await import('../../src/tools/crud.js');
    const client = mockClient();
    const tools = createCrudTools(client, '$');
    const tool = tools.find((t) => t.schema.name === 'get-notes')!;

    const result = await tool.handler({ type: 'category', id: 'c1' });

    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('My note content');
  });

  it('should return error when client call fails', async () => {
    const { createCrudTools } = await import('../../src/tools/crud.js');
    const client = mockClient({
      getAccounts: vi.fn().mockResolvedValue({ ok: false, error: 'HTTP 500: Server error' }),
    });
    const tools = createCrudTools(client, '$');
    const tool = tools.find((t) => t.schema.name === 'get-accounts')!;

    const result = await tool.handler({});

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('500');
  });

  it('should expose correct number of tools', async () => {
    const { createCrudTools } = await import('../../src/tools/crud.js');
    const tools = createCrudTools(mockClient(), '$');
    const names = tools.map((t) => t.schema.name);

    expect(names).toContain('get-accounts');
    expect(names).toContain('get-transactions');
    expect(names).toContain('create-transaction');
    expect(names).toContain('update-transaction');
    expect(names).toContain('delete-transaction');
    expect(names).toContain('get-categories');
    expect(names).toContain('manage-category');
    expect(names).toContain('get-payees');
    expect(names).toContain('manage-payee');
    expect(names).toContain('get-budget-month');
    expect(names).toContain('set-budget-amount');
    expect(names).toContain('transfer-budget');
    expect(names).toContain('get-schedules');
    expect(names).toContain('manage-schedule');
    expect(names).toContain('get-rules');
    expect(names).toContain('manage-rule');
    expect(names).toContain('get-notes');
    expect(names).toContain('set-notes');
    expect(names).toContain('run-bank-sync');
  });
});
