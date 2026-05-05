import { describe, it, expect } from 'vitest';
import { registerScheduleTools } from '../../../src/tools/schedules.js';
import { setup, call } from './_helpers.js';

describe('schedule tools', () => {
  it('get-schedules returns empty array when no schedules', async () => {
    const { server } = setup(registerScheduleTools);
    const r = await call(server, 'get-schedules', {});
    expect(r.isError).toBeFalsy();
    expect(r.content[0]?.text).toBe('[]');
  });

  it('get-schedules returns schedules from client', async () => {
    const { server, client } = setup(registerScheduleTools);
    await client.createSchedule({
      name: 'Rent',
      amountOp: 'is',
      date: '2026-06-01',
      payee: 'p1',
      account: 'a1',
      amount: -1000,
      posts_transaction: false,
    });
    const r = await call(server, 'get-schedules', {});
    expect(r.isError).toBeFalsy();
    expect(r.content[0]?.text).toContain('Rent');
  });

  it('create-schedule creates a schedule with full external shape', async () => {
    const { server, client } = setup(registerScheduleTools);
    const r = await call(server, 'create-schedule', {
      name: 'Bills',
      payee: 'payee-1',
      account: 'account-1',
      amount: -2500,
      amountOp: 'is',
      date: '2026-07-01',
      posts_transaction: false,
    });
    expect(r.isError).toBeFalsy();
    const schedules = await client.getSchedules();
    expect(schedules).toHaveLength(1);
    const created = schedules[0];
    if (!created) throw new Error('schedule vanished');
    expect(created.name).toBe('Bills');
    expect(created.amount).toBe(-2500);
    expect(created.amountOp).toBe('is');
    expect(created.date).toBe('2026-07-01');
    expect(created.posts_transaction).toBe(false);
  });

  it('create-schedule omits name when not provided', async () => {
    const { server, client } = setup(registerScheduleTools);
    const r = await call(server, 'create-schedule', {
      amountOp: 'is',
      date: '2026-08-01',
      payee: 'p2',
      account: 'a2',
      amount: -100,
    });
    expect(r.isError).toBeFalsy();
    const schedules = await client.getSchedules();
    expect(schedules).toHaveLength(1);
    expect(schedules[0]?.name).toBeUndefined();
    // posts_transaction defaults to false in the tool wrapper
    expect(schedules[0]?.posts_transaction).toBe(false);
  });

  it('create-schedule accepts a RecurConfig date object', async () => {
    const { server, client } = setup(registerScheduleTools);
    const r = await call(server, 'create-schedule', {
      name: 'Weekly',
      amountOp: 'isapprox',
      date: { frequency: 'weekly', start: '2026-06-01', interval: 2 },
      payee: 'p3',
      account: 'a3',
      amount: -500,
    });
    expect(r.isError).toBeFalsy();
    const schedules = await client.getSchedules();
    expect(schedules).toHaveLength(1);
    const created = schedules[0];
    if (!created) throw new Error('schedule vanished');
    expect(created.date).toEqual({ frequency: 'weekly', start: '2026-06-01', interval: 2 });
    expect(created.amountOp).toBe('isapprox');
  });

  it('update-schedule updates fields', async () => {
    const { server, client } = setup(registerScheduleTools);
    const id = await client.createSchedule({
      name: 'Original',
      amountOp: 'is',
      date: '2026-06-01',
      payee: 'p4',
      account: 'a4',
      amount: -1000,
      posts_transaction: false,
    });
    const r = await call(server, 'update-schedule', {
      id,
      fields: { name: 'Renamed', amount: -2000 },
    });
    expect(r.isError).toBeFalsy();
    const schedules = await client.getSchedules();
    expect(schedules[0]?.name).toBe('Renamed');
    expect(schedules[0]?.amount).toBe(-2000);
  });

  it('update-schedule honors resetNextDate flag', async () => {
    const { server, client } = setup(registerScheduleTools);
    const id = await client.createSchedule({
      name: 'Reset',
      amountOp: 'is',
      date: '2026-06-01',
      payee: 'p5',
      account: 'a5',
      amount: -100,
      posts_transaction: false,
    });
    // Seed a next_date on the fake by calling update without resetNextDate
    // first (the fake retains it on a no-op update)
    const r = await call(server, 'update-schedule', {
      id,
      fields: { name: 'Reset Renamed' },
      resetNextDate: true,
    });
    expect(r.isError).toBeFalsy();
    const schedules = await client.getSchedules();
    expect(schedules[0]?.name).toBe('Reset Renamed');
    // The fake clears next_date when resetNextDate is true
    expect(schedules[0]?.next_date).toBeUndefined();
  });

  it('delete-schedule removes the schedule', async () => {
    const { server, client } = setup(registerScheduleTools);
    const id = await client.createSchedule({
      name: 'Doomed',
      amountOp: 'is',
      date: '2026-06-01',
      payee: 'p6',
      account: 'a6',
      amount: -100,
      posts_transaction: false,
    });
    const r = await call(server, 'delete-schedule', { id });
    expect(r.isError).toBeFalsy();
    expect(await client.getSchedules()).toHaveLength(0);
  });

  it('zod rejects create-schedule with invalid amountOp', async () => {
    const { server } = setup(registerScheduleTools);
    await expect(
      call(server, 'create-schedule', {
        amountOp: 'wrong',
        date: '2026-06-01',
      }),
    ).rejects.toThrow();
  });

  it('zod rejects create-schedule when amountOp is missing', async () => {
    const { server } = setup(registerScheduleTools);
    await expect(
      call(server, 'create-schedule', {
        date: '2026-06-01',
      }),
    ).rejects.toThrow();
  });

  it('zod rejects create-schedule with malformed date string', async () => {
    const { server } = setup(registerScheduleTools);
    await expect(
      call(server, 'create-schedule', {
        amountOp: 'is',
        date: 'not-a-date',
      }),
    ).rejects.toThrow();
  });

  it('zod rejects update-schedule with empty id', async () => {
    const { server } = setup(registerScheduleTools);
    await expect(
      call(server, 'update-schedule', { id: '', fields: { name: 'x' } }),
    ).rejects.toThrow();
  });
});
