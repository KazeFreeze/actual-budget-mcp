import { describe, it, expect, vi } from 'vitest';
import type { ActualClient } from '../../src/client.js';
import type { ToolDefinition } from '../../src/tools/shared.js';

function mockClient(overrides: Record<string, unknown> = {}): ActualClient {
  return {
    getAccounts: vi.fn().mockResolvedValue({
      ok: true,
      data: [
        { id: 'a1', name: 'Checking', offbudget: false, closed: false },
        { id: 'a2', name: 'Savings', offbudget: true, closed: false },
      ],
    }),
    getAccountBalance: vi
      .fn()
      .mockResolvedValueOnce({ ok: true, data: 500000 })
      .mockResolvedValueOnce({ ok: true, data: 1000000 }),
    getTransactions: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    getCategories: vi.fn().mockResolvedValue({
      ok: true,
      data: [
        { id: 'c1', name: 'Groceries', group_id: 'g1' },
        { id: 'c2', name: 'Salary', group_id: 'g-inc' },
      ],
    }),
    getCategoryGroups: vi.fn().mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'g1',
          name: 'Expenses',
          is_income: false,
          categories: [{ id: 'c1', name: 'Groceries' }],
        },
        {
          id: 'g-inc',
          name: 'Income',
          is_income: true,
          categories: [{ id: 'c2', name: 'Salary' }],
        },
      ],
    }),
    getPayees: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 'p1', name: 'Costco' }] }),
    getBudgetMonth: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        month: '2026-03',
        totalIncome: 500000,
        totalSpent: -300000,
        toBudget: 0,
        totalBudgeted: -500000,
        categoryGroups: [
          {
            id: 'g1',
            name: 'Expenses',
            is_income: false,
            budgeted: 400000,
            spent: -300000,
            balance: 100000,
            categories: [
              {
                id: 'c1',
                name: 'Groceries',
                budgeted: 400000,
                spent: -300000,
                balance: 100000,
                hidden: false,
              },
            ],
          },
        ],
      },
    }),
    ...overrides,
  } as unknown as ActualClient;
}

function findTool(tools: ToolDefinition[], name: string): ToolDefinition {
  const tool = tools.find((t) => t.schema.name === name);
  if (!tool) throw new Error(`Tool "${name}" not found`);
  return tool;
}

describe('analytics tools', () => {
  it('should export exactly 6 tools', async () => {
    const { createAnalyticsTools } = await import('../../src/tools/analytics.js');
    const tools = createAnalyticsTools(mockClient(), '$');
    expect(tools).toHaveLength(6);
    expect(tools.map((t) => t.schema.name)).toEqual([
      'monthly-financial-summary',
      'spending-analysis',
      'budget-variance-report',
      'net-worth-snapshot',
      'trend-analysis',
      'income-expense-timeline',
    ]);
  });

  it('net-worth-snapshot should calculate assets minus liabilities', async () => {
    const { createAnalyticsTools } = await import('../../src/tools/analytics.js');
    const client = mockClient();
    const tools = createAnalyticsTools(client, '$');
    const tool = findTool(tools, 'net-worth-snapshot');

    const result = await tool.handler({});

    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('Checking');
    expect(text).toContain('Savings');
    expect(text).toContain('$5,000.00');
    expect(text).toContain('$10,000.00');
    expect(text).toContain('$15,000.00'); // net worth
  });

  it('budget-variance-report should show budgeted vs spent and flag overspent', async () => {
    const { createAnalyticsTools } = await import('../../src/tools/analytics.js');
    const client = mockClient({
      getBudgetMonth: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          month: '2026-03',
          categoryGroups: [
            {
              id: 'g1',
              name: 'Expenses',
              is_income: false,
              categories: [
                {
                  id: 'c1',
                  name: 'Groceries',
                  budgeted: 30000,
                  spent: -45000,
                  balance: -15000,
                  hidden: false,
                },
              ],
            },
          ],
        },
      }),
    });
    const tools = createAnalyticsTools(client, '$');
    const tool = findTool(tools, 'budget-variance-report');

    const result = await tool.handler({ month: '2026-03' });

    const text = result.content[0]?.text ?? '';
    expect(text).toContain('Groceries');
    expect(text).toContain('$300.00'); // budgeted
    expect(text).toContain('-$450.00'); // spent
    expect(text).toContain('\u26A0'); // overspent flag
  });

  it('monthly-financial-summary should separate income from expenses', async () => {
    const { createAnalyticsTools } = await import('../../src/tools/analytics.js');
    const client = mockClient({
      getTransactions: vi.fn().mockResolvedValue({
        ok: true,
        data: [
          {
            id: 't1',
            account: 'a1',
            date: '2026-03-01',
            amount: 500000,
            category: 'c2',
            is_child: false,
            subtransactions: [],
          },
          {
            id: 't2',
            account: 'a1',
            date: '2026-03-05',
            amount: -15000,
            category: 'c1',
            is_child: false,
            subtransactions: [],
          },
        ],
      }),
    });
    const tools = createAnalyticsTools(client, '$');
    const tool = findTool(tools, 'monthly-financial-summary');

    const result = await tool.handler({ month: '2026-03' });

    const text = result.content[0]?.text ?? '';
    expect(text).toContain('Income:');
    expect(text).toContain('Expenses:');
    expect(text).toContain('Savings Rate:');
  });

  it('should return error when client fails', async () => {
    const { createAnalyticsTools } = await import('../../src/tools/analytics.js');
    const client = mockClient({
      getAccounts: vi.fn().mockResolvedValue({ ok: false, error: 'HTTP 500: Server error' }),
    });
    const tools = createAnalyticsTools(client, '$');
    const tool = findTool(tools, 'net-worth-snapshot');

    const result = await tool.handler({});

    expect(result.isError).toBe(true);
  });
});
