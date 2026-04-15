import { describe, it, expect, vi } from 'vitest';

describe('run-query tool', () => {
  function mockClient(queryResult: unknown = []) {
    return {
      runQuery: vi.fn().mockResolvedValue({ ok: true, data: queryResult }),
    } as any;
  }

  it('should render array results as markdown table', async () => {
    const { createQueryTool } = await import('../../src/tools/query.js');
    const client = mockClient([
      { 'category.name': 'Groceries', total: -50000 },
      { 'category.name': 'Rent', total: -150000 },
    ]);
    const tool = createQueryTool(client, '$');

    const result = await tool.handler({
      table: 'transactions',
      groupBy: ['category.name'],
      select: ['category.name', { total: { $sum: '$amount' } }],
    });

    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('2 rows');
    expect(text).toContain('Groceries');
    expect(text).toContain('-$500.00');
    expect(text).toContain('-$1,500.00');
  });

  it('should render scalar results (from calculate)', async () => {
    const { createQueryTool } = await import('../../src/tools/query.js');
    const client = mockClient(-200000);
    const tool = createQueryTool(client, '£');

    const result = await tool.handler({
      table: 'transactions',
      calculate: { $sum: '$amount' },
    });

    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('-£2,000.00');
  });

  it('should handle empty results', async () => {
    const { createQueryTool } = await import('../../src/tools/query.js');
    const client = mockClient([]);
    const tool = createQueryTool(client, '$');

    const result = await tool.handler({ table: 'transactions' });

    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('0 rows');
  });

  it('should return error when query fails', async () => {
    const { createQueryTool } = await import('../../src/tools/query.js');
    const client = { runQuery: vi.fn().mockResolvedValue({ ok: false, error: 'HTTP 501: Not Implemented' }) } as any;
    const tool = createQueryTool(client, '$');

    const result = await tool.handler({ table: 'transactions' });

    expect(result.isError).toBe(true);
  });

  it('should have ActualQL reference in description', async () => {
    const { createQueryTool } = await import('../../src/tools/query.js');
    const tool = createQueryTool(mockClient(), '$');

    expect(tool.schema.description).toContain('$eq');
    expect(tool.schema.description).toContain('$sum');
    expect(tool.schema.description).toContain('groupBy');
    expect(tool.schema.description).toContain('category.name');
  });
});
