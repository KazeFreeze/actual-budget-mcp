import { describe, it, expect } from 'vitest';
import { setup, call } from './_helpers.js';
import { registerQueryTool } from '../../../src/tools/query.js';

describe('query tool', () => {
  it('forwards the input query to client.runQuery', async () => {
    const { server, client } = setup(registerQueryTool);
    let captured: unknown = undefined;
    client.runQuery = <T = unknown>(q: unknown): Promise<T> => {
      captured = q;
      return Promise.resolve([{ x: 1 }] as unknown as T);
    };
    const r = await call(server, 'query', { query: { foo: 'bar' } });
    expect(r.isError).toBeFalsy();
    expect(captured).toEqual({ foo: 'bar' });
    expect(r.content[0]?.text).toContain('"x"');
  });

  it('stringifies the query result as pretty JSON', async () => {
    const { server, client } = setup(registerQueryTool);
    client.runQuery = <T = unknown>(): Promise<T> =>
      Promise.resolve([{ name: 'row1' }, { name: 'row2' }] as unknown as T);
    const r = await call(server, 'query', { query: { table: 'transactions' } });
    expect(r.isError).toBeFalsy();
    const text = r.content[0]?.text ?? '';
    const parsed = JSON.parse(text) as Array<{ name: string }>;
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.name).toBe('row1');
    // Pretty-printed: contains a newline.
    expect(text).toContain('\n');
  });
});
