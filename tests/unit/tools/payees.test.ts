import { describe, it, expect } from 'vitest';
import { registerPayeeTools } from '../../../src/tools/payees.js';
import { setup, call } from './_helpers.js';

describe('payee tools', () => {
  it('get-payees returns payees from client', async () => {
    const { server, client } = setup(registerPayeeTools);
    await client.createPayee({ name: 'Walmart' });
    const r = await call(server, 'get-payees', {});
    expect(r.isError).toBeFalsy();
    expect(r.content[0]?.text).toContain('Walmart');
  });

  it('create-payee creates a payee and returns its id', async () => {
    const { server, client } = setup(registerPayeeTools);
    const r = await call(server, 'create-payee', { name: 'Target' });
    expect(r.isError).toBeFalsy();
    const payees = await client.getPayees();
    expect(payees).toHaveLength(1);
    const id = payees[0]?.id;
    expect(id).toBeDefined();
    expect(r.content[0]?.text).toContain(id ?? '');
  });

  it('create-payee accepts transfer_acct', async () => {
    const { server, client } = setup(registerPayeeTools);
    const r = await call(server, 'create-payee', { name: 'Bank Transfer', transfer_acct: 'a1' });
    expect(r.isError).toBeFalsy();
    const payees = await client.getPayees();
    expect(payees).toHaveLength(1);
    expect(payees[0]?.transfer_acct).toBe('a1');
  });

  it('update-payee updates the name field', async () => {
    const { server, client } = setup(registerPayeeTools);
    const id = await client.createPayee({ name: 'Old' });
    const r = await call(server, 'update-payee', { id, fields: { name: 'Renamed' } });
    expect(r.isError).toBeFalsy();
    const payees = await client.getPayees();
    expect(payees[0]?.name).toBe('Renamed');
  });

  it('update-payee preserves transfer_acct: null (clearing the link)', async () => {
    const { server, client } = setup(registerPayeeTools);
    const id = await client.createPayee({ name: 'P', transfer_acct: 'a1' });
    const r = await call(server, 'update-payee', { id, fields: { transfer_acct: null } });
    expect(r.isError).toBeFalsy();
    const payees = await client.getPayees();
    expect(payees[0]?.transfer_acct).toBeNull();
  });

  it('delete-payee removes the payee', async () => {
    const { server, client } = setup(registerPayeeTools);
    const id = await client.createPayee({ name: 'Gone' });
    const r = await call(server, 'delete-payee', { id });
    expect(r.isError).toBeFalsy();
    expect(await client.getPayees()).toHaveLength(0);
  });

  it('merge-payees merges multiple payees into a target, leaving only target', async () => {
    const { server, client } = setup(registerPayeeTools);
    const targetId = await client.createPayee({ name: 'Target' });
    const id1 = await client.createPayee({ name: 'Dup1' });
    const id2 = await client.createPayee({ name: 'Dup2' });
    const r = await call(server, 'merge-payees', { targetId, mergeIds: [id1, id2] });
    expect(r.isError).toBeFalsy();
    const payees = await client.getPayees();
    expect(payees).toHaveLength(1);
    expect(payees[0]?.id).toBe(targetId);
  });

  it('merge-payees succeeds with an empty mergeIds array (no-op)', async () => {
    const { server, client } = setup(registerPayeeTools);
    const targetId = await client.createPayee({ name: 'Solo' });
    const r = await call(server, 'merge-payees', { targetId, mergeIds: [] });
    expect(r.isError).toBeFalsy();
    expect(await client.getPayees()).toHaveLength(1);
  });

  it('get-common-payees returns payees from the common-payees endpoint', async () => {
    const { server, client } = setup(registerPayeeTools);
    await client.createPayee({ name: 'Frequent' });
    const r = await call(server, 'get-common-payees', {});
    expect(r.isError).toBeFalsy();
    expect(r.content[0]?.text).toContain('Frequent');
  });

  it('zod rejects empty name on create-payee', async () => {
    const { server } = setup(registerPayeeTools);
    await expect(call(server, 'create-payee', { name: '' })).rejects.toThrow();
  });
});
