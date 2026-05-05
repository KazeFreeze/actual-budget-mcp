import { describe, it, expect } from 'vitest';
import { registerTransactionTools } from '../../../src/tools/transactions.js';
import { setup, call } from './_helpers.js';

describe('transaction tools', () => {
  it('get-transactions returns transactions in range', async () => {
    const { server, client } = setup(registerTransactionTools);
    client.seedAccount({ id: 'a1', name: 'Checking' });
    client.seedTransaction({
      id: 't1',
      account: 'a1',
      date: '2026-01-10',
      amount: 1234,
      notes: 'first',
    });
    client.seedTransaction({
      id: 't2',
      account: 'a1',
      date: '2026-01-20',
      amount: 5678,
      notes: 'second',
    });
    const r = await call(server, 'get-transactions', {
      accountId: 'a1',
      sinceDate: '2026-01-01',
      untilDate: '2026-01-31',
    });
    expect(r.isError).toBeFalsy();
    const text = r.content[0]?.text ?? '';
    expect(text).toContain('1234');
    expect(text).toContain('5678');
    expect(text).toContain('first');
    expect(text).toContain('second');
  });

  it('get-transactions filters by date range', async () => {
    const { server, client } = setup(registerTransactionTools);
    client.seedAccount({ id: 'a1', name: 'Checking' });
    client.seedTransaction({ id: 't1', account: 'a1', date: '2026-01-05', amount: 100 });
    client.seedTransaction({ id: 't2', account: 'a1', date: '2026-01-15', amount: 200 });
    client.seedTransaction({ id: 't3', account: 'a1', date: '2026-01-25', amount: 300 });
    const r = await call(server, 'get-transactions', {
      accountId: 'a1',
      sinceDate: '2026-01-10',
      untilDate: '2026-01-20',
    });
    expect(r.isError).toBeFalsy();
    const text = r.content[0]?.text ?? '';
    expect(text).not.toContain('100');
    expect(text).toContain('200');
    expect(text).not.toContain('300');
  });

  it('add-transactions stores a single transaction', async () => {
    const { server, client } = setup(registerTransactionTools);
    client.seedAccount({ id: 'a1', name: 'Checking' });
    const r = await call(server, 'add-transactions', {
      accountId: 'a1',
      transactions: [{ date: '2026-01-15', amount: 999, payee: 'p1' }],
    });
    expect(r.isError).toBeFalsy();
    const stored = await client.getTransactions('a1', '2020-01-01', '2099-12-31');
    expect(stored).toHaveLength(1);
    expect(stored[0]?.amount).toBe(999);
  });

  it('add-transactions stores multiple transactions', async () => {
    const { server, client } = setup(registerTransactionTools);
    client.seedAccount({ id: 'a1', name: 'Checking' });
    const r = await call(server, 'add-transactions', {
      accountId: 'a1',
      transactions: [
        { date: '2026-01-15', amount: 100, payee: 'p1' },
        { date: '2026-01-16', amount: 200, payee: 'p2' },
      ],
    });
    expect(r.isError).toBeFalsy();
    const stored = await client.getTransactions('a1', '2020-01-01', '2099-12-31');
    expect(stored).toHaveLength(2);
  });

  it('add-transactions accepts learnCategories and runTransfers opts', async () => {
    const { server, client } = setup(registerTransactionTools);
    client.seedAccount({ id: 'a1', name: 'Checking' });
    const r = await call(server, 'add-transactions', {
      accountId: 'a1',
      transactions: [{ date: '2026-01-15', amount: 50 }],
      learnCategories: true,
      runTransfers: false,
    });
    expect(r.isError).toBeFalsy();
    expect(await client.getTransactions('a1', '2020-01-01', '2099-12-31')).toHaveLength(1);
  });

  it('import-transactions stores transactions and reports added ids', async () => {
    const { server, client } = setup(registerTransactionTools);
    client.seedAccount({ id: 'a1', name: 'Checking' });
    const r = await call(server, 'import-transactions', {
      accountId: 'a1',
      transactions: [{ date: '2026-01-15', amount: 750, payee: 'p1' }],
    });
    expect(r.isError).toBeFalsy();
    const stored = await client.getTransactions('a1', '2020-01-01', '2099-12-31');
    expect(stored).toHaveLength(1);
    const text = r.content[0]?.text ?? '';
    expect(text).toContain('added');
  });

  it('update-transaction updates fields', async () => {
    const { server, client } = setup(registerTransactionTools);
    client.seedAccount({ id: 'a1', name: 'Checking' });
    client.seedTransaction({
      id: 't1',
      account: 'a1',
      date: '2026-01-15',
      amount: 100,
      notes: 'old',
    });
    const r = await call(server, 'update-transaction', { id: 't1', fields: { notes: 'updated' } });
    expect(r.isError).toBeFalsy();
    const stored = await client.getTransactions('a1', '2020-01-01', '2099-12-31');
    expect(stored[0]?.notes).toBe('updated');
  });

  it('delete-transaction removes the transaction', async () => {
    const { server, client } = setup(registerTransactionTools);
    client.seedAccount({ id: 'a1', name: 'Checking' });
    client.seedTransaction({ id: 't1', account: 'a1', date: '2026-01-15', amount: 100 });
    const r = await call(server, 'delete-transaction', { id: 't1' });
    expect(r.isError).toBeFalsy();
    expect(await client.getTransactions('a1', '2020-01-01', '2099-12-31')).toHaveLength(0);
  });

  it('zod rejects bad date format on add-transactions', async () => {
    const { server, client } = setup(registerTransactionTools);
    client.seedAccount({ id: 'a1', name: 'Checking' });
    await expect(
      call(server, 'add-transactions', {
        accountId: 'a1',
        transactions: [{ date: '2026/01/01', amount: 100 }],
      }),
    ).rejects.toThrow();
  });

  it('zod rejects non-integer amount on add-transactions', async () => {
    const { server, client } = setup(registerTransactionTools);
    client.seedAccount({ id: 'a1', name: 'Checking' });
    await expect(
      call(server, 'add-transactions', {
        accountId: 'a1',
        transactions: [{ date: '2026-01-15', amount: 1.5 }],
      }),
    ).rejects.toThrow();
  });
});
