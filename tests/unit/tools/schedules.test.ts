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
    await client.createSchedule({ name: 'Rent', rule: { test: 1 }, active: true });
    const r = await call(server, 'get-schedules', {});
    expect(r.isError).toBeFalsy();
    expect(r.content[0]?.text).toContain('Rent');
  });

  it('create-schedule creates a schedule', async () => {
    const { server, client } = setup(registerScheduleTools);
    const r = await call(server, 'create-schedule', {
      name: 'Bills',
      rule: { foo: 'bar' },
      active: true,
      posts_transaction: false,
    });
    expect(r.isError).toBeFalsy();
    const schedules = await client.getSchedules();
    expect(schedules).toHaveLength(1);
    expect(schedules[0]?.name).toBe('Bills');
  });

  it('create-schedule accepts name:null', async () => {
    const { server, client } = setup(registerScheduleTools);
    const r = await call(server, 'create-schedule', { name: null, rule: {} });
    expect(r.isError).toBeFalsy();
    const schedules = await client.getSchedules();
    expect(schedules).toHaveLength(1);
    expect(schedules[0]?.name).toBeNull();
  });

  it('update-schedule updates fields', async () => {
    const { server, client } = setup(registerScheduleTools);
    const id = await client.createSchedule({
      name: 'Original',
      rule: { test: 1 },
      active: true,
    });
    const r = await call(server, 'update-schedule', {
      id,
      fields: { name: 'Renamed', active: false },
    });
    expect(r.isError).toBeFalsy();
    const schedules = await client.getSchedules();
    expect(schedules[0]?.name).toBe('Renamed');
    expect(schedules[0]?.active).toBe(false);
  });

  it('delete-schedule removes the schedule', async () => {
    const { server, client } = setup(registerScheduleTools);
    const id = await client.createSchedule({ name: 'Doomed', rule: {} });
    const r = await call(server, 'delete-schedule', { id });
    expect(r.isError).toBeFalsy();
    expect(await client.getSchedules()).toHaveLength(0);
  });

  it('zod rejects create-schedule with non-string non-null name', async () => {
    const { server } = setup(registerScheduleTools);
    await expect(call(server, 'create-schedule', { name: 123, rule: {} })).rejects.toThrow();
  });

  it('zod rejects update-schedule with empty id', async () => {
    const { server } = setup(registerScheduleTools);
    await expect(
      call(server, 'update-schedule', { id: '', fields: { name: 'x' } }),
    ).rejects.toThrow();
  });
});
