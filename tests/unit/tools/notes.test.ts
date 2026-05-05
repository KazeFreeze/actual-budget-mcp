import { describe, it, expect } from 'vitest';
import { setup, call } from './_helpers.js';
import { registerNoteTools } from '../../../src/tools/notes.js';

describe('notes tools', () => {
  it('set-notes then get-notes round-trips for category', async () => {
    const { server } = setup(registerNoteTools);
    await call(server, 'set-notes', { type: 'category', id: 'cat-1', notes: 'hello' });
    const r = await call(server, 'get-notes', { type: 'category', id: 'cat-1' });
    expect(r.content[0]?.text).toContain('hello');
  });

  it('get-notes for budget month uses budget-YYYY-MM id form', async () => {
    const { server, client } = setup(registerNoteTools);
    await client.setNote('budget-2026-05', 'May plan');
    const r = await call(server, 'get-notes', { type: 'budgetmonth', id: '2026-05' });
    expect(r.content[0]?.text).toContain('May plan');
  });

  it('delete-notes clears the note', async () => {
    const { server, client } = setup(registerNoteTools);
    await client.setNote('cat-1', 'x');
    await call(server, 'delete-notes', { type: 'category', id: 'cat-1' });
    expect(await client.getNote('cat-1')).toBe(null);
  });

  it('set-notes empty string deletes the note', async () => {
    const { server, client } = setup(registerNoteTools);
    await client.setNote('cat-1', 'x');
    await call(server, 'set-notes', { type: 'category', id: 'cat-1', notes: '' });
    expect(await client.getNote('cat-1')).toBe(null);
  });

  it('get-notes returns empty string when no note exists', async () => {
    const { server } = setup(registerNoteTools);
    const r = await call(server, 'get-notes', { type: 'category', id: 'missing' });
    expect(r.isError).toBeFalsy();
    expect(r.content[0]?.text).toBe('');
  });

  it('type=account routes through plain id (no prefix)', async () => {
    const { server, client } = setup(registerNoteTools);
    await client.setNote('acc-1', 'note');
    const r = await call(server, 'get-notes', { type: 'account', id: 'acc-1' });
    expect(r.content[0]?.text).toContain('note');
  });

  it('type=budgetmonth on set-notes prefixes id with budget-', async () => {
    const { server, client } = setup(registerNoteTools);
    await call(server, 'set-notes', { type: 'budgetmonth', id: '2026-05', notes: 'plan' });
    expect(await client.getNote('budget-2026-05')).toBe('plan');
  });

  it('type=budgetmonth on delete-notes prefixes id with budget-', async () => {
    const { server, client } = setup(registerNoteTools);
    await client.setNote('budget-2026-05', 'x');
    await call(server, 'delete-notes', { type: 'budgetmonth', id: '2026-05' });
    expect(await client.getNote('budget-2026-05')).toBe(null);
  });

  it('zod rejects invalid type', async () => {
    const { server } = setup(registerNoteTools);
    await expect(call(server, 'get-notes', { type: 'invalid', id: 'cat-1' })).rejects.toThrow();
  });

  it('zod rejects empty id', async () => {
    const { server } = setup(registerNoteTools);
    await expect(call(server, 'get-notes', { type: 'category', id: '' })).rejects.toThrow();
  });

  it('set-notes requires notes field', async () => {
    const { server } = setup(registerNoteTools);
    await expect(call(server, 'set-notes', { type: 'category', id: 'cat-1' })).rejects.toThrow();
  });
});
