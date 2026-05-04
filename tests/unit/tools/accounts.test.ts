import { describe, it, expect } from 'vitest';
import { registerAccountTools } from '../../../src/tools/accounts.js';
import { setup, call } from './_helpers.js';

describe('account tools', () => {
  it('get-accounts returns accounts from client', async () => {
    const { server, client } = setup(registerAccountTools);
    client.seedAccount({ id: 'a1', name: 'Checking' });
    const r = await call(server, 'get-accounts', {});
    expect(r.isError).toBeFalsy();
    expect(r.content[0]?.text).toContain('Checking');
  });

  it('create-account creates an account', async () => {
    const { server, client } = setup(registerAccountTools);
    const r = await call(server, 'create-account', { name: 'Savings', type: 'savings' });
    expect(r.isError).toBeFalsy();
    expect(await client.getAccounts()).toHaveLength(1);
  });

  it('create-account accepts initialBalance', async () => {
    const { server, client } = setup(registerAccountTools);
    const r = await call(server, 'create-account', { name: 'X', initialBalance: 5000 });
    expect(r.isError).toBeFalsy();
    expect(await client.getAccounts()).toHaveLength(1);
  });

  it('update-account updates a field', async () => {
    const { server, client } = setup(registerAccountTools);
    client.seedAccount({ id: 'a1', name: 'Old' });
    const r = await call(server, 'update-account', { id: 'a1', fields: { name: 'Renamed' } });
    expect(r.isError).toBeFalsy();
    const accounts = await client.getAccounts();
    expect(accounts[0]?.name).toBe('Renamed');
  });

  it('close-account marks account closed', async () => {
    const { server, client } = setup(registerAccountTools);
    client.seedAccount({ id: 'a1', name: 'Checking' });
    const r = await call(server, 'close-account', { id: 'a1' });
    expect(r.isError).toBeFalsy();
    const accounts = await client.getAccounts();
    expect(accounts[0]?.closed).toBe(true);
  });

  it('reopen-account un-closes the account', async () => {
    const { server, client } = setup(registerAccountTools);
    client.seedAccount({ id: 'a1', name: 'Checking', closed: true });
    const r = await call(server, 'reopen-account', { id: 'a1' });
    expect(r.isError).toBeFalsy();
    const accounts = await client.getAccounts();
    expect(accounts[0]?.closed).toBe(false);
  });

  it('delete-account removes the account', async () => {
    const { server, client } = setup(registerAccountTools);
    client.seedAccount({ id: 'a1', name: 'Checking' });
    const r = await call(server, 'delete-account', { id: 'a1' });
    expect(r.isError).toBeFalsy();
    expect(await client.getAccounts()).toHaveLength(0);
  });

  it('get-account-balance returns the balance for the account', async () => {
    const { server, client } = setup(registerAccountTools);
    client.seedAccount({ id: 'a1', name: 'Checking' });
    client.seedTransaction({ id: 't1', account: 'a1', date: '2026-01-15', amount: 1500 });
    const r = await call(server, 'get-account-balance', { id: 'a1' });
    expect(r.isError).toBeFalsy();
    expect(r.content[0]?.text).toContain('1500');
  });

  it('get-account-balance accepts ISO date cutoff', async () => {
    const { server, client } = setup(registerAccountTools);
    client.seedAccount({ id: 'a1', name: 'Checking' });
    const r = await call(server, 'get-account-balance', { id: 'a1', cutoff: '2026-01-01' });
    expect(r.isError).toBeFalsy();
  });

  it('run-bank-sync succeeds without arguments', async () => {
    const { server } = setup(registerAccountTools);
    const r = await call(server, 'run-bank-sync', {});
    expect(r.isError).toBeFalsy();
  });

  it('run-bank-sync succeeds with an accountId', async () => {
    const { server } = setup(registerAccountTools);
    const r = await call(server, 'run-bank-sync', { accountId: 'a1' });
    expect(r.isError).toBeFalsy();
  });

  it('zod rejects invalid create-account input', async () => {
    const { server } = setup(registerAccountTools);
    await expect(call(server, 'create-account', { name: '' })).rejects.toThrow();
  });
});
