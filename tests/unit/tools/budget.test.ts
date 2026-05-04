import { describe, it, expect } from 'vitest';
import { registerBudgetTools } from '../../../src/tools/budget.js';
import { setup, call } from './_helpers.js';

describe('budget tools', () => {
  it('get-budget-month returns budget data for a month', async () => {
    const { server } = setup(registerBudgetTools);
    const r = await call(server, 'get-budget-month', { month: '2026-05' });
    expect(r.isError).toBeFalsy();
    expect(r.content[0]?.text).toContain('"month": "2026-05"');
  });

  it('get-budget-month rejects single-digit month component', async () => {
    const { server } = setup(registerBudgetTools);
    await expect(call(server, 'get-budget-month', { month: '2026-5' })).rejects.toThrow();
  });

  it('get-budget-month rejects slash-separated month', async () => {
    const { server } = setup(registerBudgetTools);
    await expect(call(server, 'get-budget-month', { month: '2026/05' })).rejects.toThrow();
  });

  it('get-budget-months lists all months', async () => {
    const { server, client } = setup(registerBudgetTools);
    client.getBudgetMonths = () => Promise.resolve(['2026-04', '2026-05']);
    const r = await call(server, 'get-budget-months', {});
    expect(r.isError).toBeFalsy();
    expect(r.content[0]?.text).toContain('2026-04');
    expect(r.content[0]?.text).toContain('2026-05');
  });

  it('set-budget-amount calls client with month, categoryId, value', async () => {
    const { server, client } = setup(registerBudgetTools);
    const calls: Array<[string, string, number]> = [];
    client.setBudgetAmount = (m, c, v) => {
      calls.push([m, c, v]);
      return Promise.resolve();
    };
    const r = await call(server, 'set-budget-amount', {
      month: '2026-05',
      categoryId: 'c1',
      value: 50000,
    });
    expect(r.isError).toBeFalsy();
    expect(calls).toEqual([['2026-05', 'c1', 50000]]);
  });

  it('set-budget-amount rejects non-integer value', async () => {
    const { server } = setup(registerBudgetTools);
    await expect(
      call(server, 'set-budget-amount', { month: '2026-05', categoryId: 'c1', value: 1.5 }),
    ).rejects.toThrow();
  });

  it('set-budget-amount rejects empty categoryId', async () => {
    const { server } = setup(registerBudgetTools);
    await expect(
      call(server, 'set-budget-amount', { month: '2026-05', categoryId: '', value: 100 }),
    ).rejects.toThrow();
  });

  it('set-budget-carryover calls client with month, categoryId, flag', async () => {
    const { server, client } = setup(registerBudgetTools);
    const calls: Array<[string, string, boolean]> = [];
    client.setBudgetCarryover = (m, c, f) => {
      calls.push([m, c, f]);
      return Promise.resolve();
    };
    const r = await call(server, 'set-budget-carryover', {
      month: '2026-05',
      categoryId: 'c1',
      flag: true,
    });
    expect(r.isError).toBeFalsy();
    expect(calls).toEqual([['2026-05', 'c1', true]]);
  });

  it('hold-budget-for-next-month calls client with month and amount', async () => {
    const { server, client } = setup(registerBudgetTools);
    const calls: Array<[string, number]> = [];
    client.holdBudgetForNextMonth = (m, a) => {
      calls.push([m, a]);
      return Promise.resolve();
    };
    const r = await call(server, 'hold-budget-for-next-month', {
      month: '2026-05',
      amount: 25000,
    });
    expect(r.isError).toBeFalsy();
    expect(calls).toEqual([['2026-05', 25000]]);
  });

  it('reset-budget-hold calls client with month', async () => {
    const { server, client } = setup(registerBudgetTools);
    const calls: string[] = [];
    client.resetBudgetHold = (m) => {
      calls.push(m);
      return Promise.resolve();
    };
    const r = await call(server, 'reset-budget-hold', { month: '2026-05' });
    expect(r.isError).toBeFalsy();
    expect(calls).toEqual(['2026-05']);
  });
});
