// Tests for the v2 analytics tool group. All six tools are read-only and
// stitch together transactions/categories/category-groups/budgets fetched
// via ActualClient. Split-parent skipping uses `subtransactions.length > 0`
// (per the v2 translation rules) rather than the SDK's `is_child` flag —
// this keeps us off any field not declared on the v2 Transaction interface.
import { describe, it, expect } from 'vitest';
import { format } from 'date-fns';
import { registerAnalyticsTools } from '../../../src/tools/analytics.js';
import { setup, call } from './_helpers.js';

const today = (): string => format(new Date(), 'yyyy-MM');

describe('monthly-financial-summary', () => {
  it('summarises income, expenses, net, savings rate and top categories', async () => {
    const { server, client } = setup(registerAnalyticsTools);
    client.seedAccount({ id: 'a1', name: 'Checking' });
    client.seedCategoryGroup({
      id: 'gi',
      name: 'Income',
      is_income: true,
      categories: [{ id: 'c-pay', name: 'Salary', group_id: 'gi', is_income: true }],
    });
    client.seedCategoryGroup({
      id: 'gs',
      name: 'Spending',
      categories: [
        { id: 'c-food', name: 'Food', group_id: 'gs' },
        { id: 'c-fuel', name: 'Fuel', group_id: 'gs' },
      ],
    });
    client.seedCategory({ id: 'c-pay', name: 'Salary', group_id: 'gi', is_income: true });
    client.seedCategory({ id: 'c-food', name: 'Food', group_id: 'gs' });
    client.seedCategory({ id: 'c-fuel', name: 'Fuel', group_id: 'gs' });

    client.seedTransaction({
      id: 't1',
      account: 'a1',
      date: '2026-05-01',
      amount: 500000,
      category: 'c-pay',
    });
    client.seedTransaction({
      id: 't2',
      account: 'a1',
      date: '2026-05-05',
      amount: -30000,
      category: 'c-food',
    });
    client.seedTransaction({
      id: 't3',
      account: 'a1',
      date: '2026-05-12',
      amount: -10000,
      category: 'c-fuel',
    });

    const r = await call(server, 'monthly-financial-summary', { month: '2026-05' });
    expect(r.isError).toBeFalsy();
    const text = r.content[0]?.text ?? '';
    expect(text).toContain('Monthly Financial Summary: 2026-05');
    expect(text).toContain('**Income:** $5,000.00');
    expect(text).toContain('**Expenses:** -$400.00');
    expect(text).toContain('**Net:** $4,600.00');
    expect(text).toContain('**Savings Rate:** 92.0%');
    expect(text).toContain('Top Spending Categories');
    expect(text).toContain('Food');
    expect(text).toContain('Fuel');
  });

  it('returns ok with zeroed summary when no accounts are seeded', async () => {
    const { server } = setup(registerAnalyticsTools);
    const r = await call(server, 'monthly-financial-summary', { month: '2026-05' });
    expect(r.isError).toBeFalsy();
    const text = r.content[0]?.text ?? '';
    expect(text).toContain('**Income:** $0.00');
    expect(text).toContain('**Expenses:** $0.00');
    expect(text).toContain('**Savings Rate:** 0.0%');
  });

  it('defaults to the current month when month omitted', async () => {
    const { server } = setup(registerAnalyticsTools);
    const r = await call(server, 'monthly-financial-summary', {});
    expect(r.isError).toBeFalsy();
    expect(r.content[0]?.text).toContain(`Monthly Financial Summary: ${today()}`);
  });
});

describe('spending-analysis', () => {
  function seedSpending(client: ReturnType<typeof setup>['client']): void {
    client.seedAccount({ id: 'a1', name: 'Checking' });
    client.seedCategoryGroup({
      id: 'gi',
      name: 'Income',
      is_income: true,
      categories: [{ id: 'c-pay', name: 'Salary', group_id: 'gi', is_income: true }],
    });
    client.seedCategoryGroup({
      id: 'gs',
      name: 'Spending',
      categories: [
        { id: 'c-food', name: 'Food', group_id: 'gs' },
        { id: 'c-fuel', name: 'Fuel', group_id: 'gs' },
      ],
    });
    client.seedCategory({ id: 'c-pay', name: 'Salary', group_id: 'gi', is_income: true });
    client.seedCategory({ id: 'c-food', name: 'Food', group_id: 'gs' });
    client.seedCategory({ id: 'c-fuel', name: 'Fuel', group_id: 'gs' });
  }

  it('groups by category and totals correctly', async () => {
    const { server, client } = setup(registerAnalyticsTools);
    seedSpending(client);
    client.seedTransaction({
      id: 't1',
      account: 'a1',
      date: '2026-05-05',
      amount: -10000,
      category: 'c-food',
    });
    client.seedTransaction({
      id: 't2',
      account: 'a1',
      date: '2026-05-06',
      amount: -20000,
      category: 'c-fuel',
    });

    const r = await call(server, 'spending-analysis', {
      start_date: '2026-05-01',
      end_date: '2026-05-31',
      group_by: 'category',
    });
    expect(r.isError).toBeFalsy();
    const text = r.content[0]?.text ?? '';
    expect(text).toContain('Spending Analysis: 2026-05-01 to 2026-05-31');
    expect(text).toContain('**Grouped by:** category');
    expect(text).toContain('Food');
    expect(text).toContain('Fuel');
    expect(text).toContain('-$300.00'); // total
    expect(text).toContain('**Total**');
  });

  it('adds Prior Period and Change columns when comparison range provided', async () => {
    const { server, client } = setup(registerAnalyticsTools);
    seedSpending(client);
    client.seedTransaction({
      id: 'tnow',
      account: 'a1',
      date: '2026-05-05',
      amount: -20000,
      category: 'c-food',
    });
    client.seedTransaction({
      id: 'tprev',
      account: 'a1',
      date: '2026-04-05',
      amount: -10000,
      category: 'c-food',
    });

    const r = await call(server, 'spending-analysis', {
      start_date: '2026-05-01',
      end_date: '2026-05-31',
      group_by: 'category',
      compare_start_date: '2026-04-01',
      compare_end_date: '2026-04-30',
    });
    expect(r.isError).toBeFalsy();
    const text = r.content[0]?.text ?? '';
    expect(text).toContain('Prior Period');
    expect(text).toContain('Change');
    // -200 vs -100 prior -> change is (-200 - -100) / |-100| = -1.0 = -100.0%
    expect(text).toContain('-100.0%');
  });

  it('group_by payee resolves payee names', async () => {
    const { server, client } = setup(registerAnalyticsTools);
    seedSpending(client);
    const payeeId = await client.createPayee({ name: 'Acme Grocery' });
    client.seedTransaction({
      id: 't1',
      account: 'a1',
      date: '2026-05-05',
      amount: -10000,
      category: 'c-food',
      payee: payeeId,
    });
    const r = await call(server, 'spending-analysis', {
      start_date: '2026-05-01',
      end_date: '2026-05-31',
      group_by: 'payee',
    });
    expect(r.isError).toBeFalsy();
    const text = r.content[0]?.text ?? '';
    expect(text).toContain('Acme Grocery');
    expect(text).toContain('**Grouped by:** payee');
  });

  it('group_by category_group rolls up to group name', async () => {
    const { server, client } = setup(registerAnalyticsTools);
    seedSpending(client);
    client.seedTransaction({
      id: 't1',
      account: 'a1',
      date: '2026-05-05',
      amount: -10000,
      category: 'c-food',
    });
    client.seedTransaction({
      id: 't2',
      account: 'a1',
      date: '2026-05-06',
      amount: -20000,
      category: 'c-fuel',
    });
    const r = await call(server, 'spending-analysis', {
      start_date: '2026-05-01',
      end_date: '2026-05-31',
      group_by: 'category_group',
    });
    expect(r.isError).toBeFalsy();
    const text = r.content[0]?.text ?? '';
    expect(text).toContain('Spending');
    expect(text).not.toContain('| Food '); // child names should not appear as rows
    expect(text).toContain('-$300.00');
  });

  it('excludes positive (income) amounts and income-category transactions', async () => {
    const { server, client } = setup(registerAnalyticsTools);
    seedSpending(client);
    client.seedTransaction({
      id: 'tinc',
      account: 'a1',
      date: '2026-05-01',
      amount: 500000,
      category: 'c-pay',
    });
    // Negative amount but tagged with an income category should still be excluded.
    client.seedTransaction({
      id: 'trefund',
      account: 'a1',
      date: '2026-05-02',
      amount: -5000,
      category: 'c-pay',
    });
    client.seedTransaction({
      id: 'tspend',
      account: 'a1',
      date: '2026-05-05',
      amount: -10000,
      category: 'c-food',
    });
    const r = await call(server, 'spending-analysis', {
      start_date: '2026-05-01',
      end_date: '2026-05-31',
      group_by: 'category',
    });
    expect(r.isError).toBeFalsy();
    const text = r.content[0]?.text ?? '';
    expect(text).toContain('Food');
    expect(text).not.toContain('Salary');
    expect(text).toContain('-$100.00'); // total = only the food spend
  });
});

describe('budget-variance-report', () => {
  it('flags overspent and ok categories with variance status', async () => {
    const { server, client } = setup(registerAnalyticsTools);
    client.seedBudgetMonth({
      month: '2026-05',
      incomeAvailable: 0,
      lastMonthOverspent: 0,
      forNextMonth: 0,
      totalBudgeted: 60000,
      toBudget: 0,
      fromLastMonth: 0,
      totalIncome: 0,
      totalSpent: -50000,
      totalBalance: 0,
      categoryGroups: [
        {
          id: 'gs',
          name: 'Spending',
          is_income: false,
          budgeted: 60000,
          spent: -50000,
          balance: 10000,
          categories: [
            {
              id: 'c-food',
              name: 'Food',
              is_income: false,
              hidden: false,
              budgeted: 20000,
              spent: -30000, // overspent
              balance: -10000,
            },
            {
              id: 'c-fuel',
              name: 'Fuel',
              is_income: false,
              hidden: false,
              budgeted: 40000,
              spent: -20000, // ok
              balance: 20000,
            },
          ],
        },
      ],
    });
    const r = await call(server, 'budget-variance-report', { month: '2026-05' });
    expect(r.isError).toBeFalsy();
    const text = r.content[0]?.text ?? '';
    expect(text).toContain('Budget Variance Report: 2026-05');
    expect(text).toContain('Food');
    expect(text).toContain('Fuel');
    expect(text).toContain('\u26a0 Over');
    expect(text).toContain('\u2713');
  });

  it('skips income groups', async () => {
    const { server, client } = setup(registerAnalyticsTools);
    client.seedBudgetMonth({
      month: '2026-05',
      incomeAvailable: 0,
      lastMonthOverspent: 0,
      forNextMonth: 0,
      totalBudgeted: 0,
      toBudget: 0,
      fromLastMonth: 0,
      totalIncome: 100000,
      totalSpent: 0,
      totalBalance: 0,
      categoryGroups: [
        {
          id: 'gi',
          name: 'Income',
          is_income: true,
          budgeted: 0,
          spent: 100000,
          balance: 0,
          categories: [
            {
              id: 'c-pay',
              name: 'Salary',
              is_income: true,
              hidden: false,
              budgeted: 0,
              spent: 100000,
              balance: 0,
            },
          ],
        },
      ],
    });
    const r = await call(server, 'budget-variance-report', { month: '2026-05' });
    expect(r.isError).toBeFalsy();
    expect(r.content[0]?.text ?? '').not.toContain('Salary');
  });

  it('skips hidden categories', async () => {
    const { server, client } = setup(registerAnalyticsTools);
    client.seedBudgetMonth({
      month: '2026-05',
      incomeAvailable: 0,
      lastMonthOverspent: 0,
      forNextMonth: 0,
      totalBudgeted: 10000,
      toBudget: 0,
      fromLastMonth: 0,
      totalIncome: 0,
      totalSpent: 0,
      totalBalance: 0,
      categoryGroups: [
        {
          id: 'gs',
          name: 'Spending',
          is_income: false,
          budgeted: 10000,
          spent: 0,
          balance: 10000,
          categories: [
            {
              id: 'c-hidden',
              name: 'HiddenCat',
              is_income: false,
              hidden: true,
              budgeted: 5000,
              spent: 0,
              balance: 5000,
            },
            {
              id: 'c-visible',
              name: 'VisibleCat',
              is_income: false,
              hidden: false,
              budgeted: 5000,
              spent: 0,
              balance: 5000,
            },
          ],
        },
      ],
    });
    const r = await call(server, 'budget-variance-report', { month: '2026-05' });
    expect(r.isError).toBeFalsy();
    const text = r.content[0]?.text ?? '';
    expect(text).not.toContain('HiddenCat');
    expect(text).toContain('VisibleCat');
  });
});

describe('net-worth-snapshot', () => {
  it('subtotals on-budget and off-budget accounts', async () => {
    const { server, client } = setup(registerAnalyticsTools);
    client.seedAccount({ id: 'a1', name: 'Checking' });
    client.seedAccount({ id: 'a2', name: 'Savings' });
    client.seedAccount({ id: 'a3', name: 'Brokerage', offbudget: true });
    client.seedTransaction({ id: 't1', account: 'a1', date: '2026-01-01', amount: 100000 });
    client.seedTransaction({ id: 't2', account: 'a2', date: '2026-01-01', amount: 200000 });
    client.seedTransaction({ id: 't3', account: 'a3', date: '2026-01-01', amount: 500000 });
    const r = await call(server, 'net-worth-snapshot', {});
    expect(r.isError).toBeFalsy();
    const text = r.content[0]?.text ?? '';
    expect(text).toContain('On-Budget Accounts');
    expect(text).toContain('Off-Budget Accounts');
    expect(text).toContain('Checking');
    expect(text).toContain('Savings');
    expect(text).toContain('Brokerage');
    expect(text).toContain('Total Net Worth: $8,000.00');
    // Subtotals
    expect(text).toMatch(/Subtotal.*\$3,000\.00/);
    expect(text).toMatch(/Subtotal.*\$5,000\.00/);
  });

  it('excludes closed accounts', async () => {
    const { server, client } = setup(registerAnalyticsTools);
    client.seedAccount({ id: 'a1', name: 'Open', closed: false });
    client.seedAccount({ id: 'a2', name: 'Old', closed: true });
    client.seedTransaction({ id: 't1', account: 'a1', date: '2026-01-01', amount: 100000 });
    client.seedTransaction({ id: 't2', account: 'a2', date: '2026-01-01', amount: 999999 });
    const r = await call(server, 'net-worth-snapshot', {});
    expect(r.isError).toBeFalsy();
    const text = r.content[0]?.text ?? '';
    expect(text).toContain('Open');
    expect(text).not.toContain('Old');
    expect(text).toContain('Total Net Worth: $1,000.00');
  });

  it('returns zero total when there are no accounts', async () => {
    const { server } = setup(registerAnalyticsTools);
    const r = await call(server, 'net-worth-snapshot', {});
    expect(r.isError).toBeFalsy();
    const text = r.content[0]?.text ?? '';
    expect(text).not.toContain('On-Budget Accounts');
    expect(text).not.toContain('Off-Budget Accounts');
    expect(text).toContain('Total Net Worth: $0.00');
  });
});

describe('trend-analysis', () => {
  it('renders a per-category trend table for each spent category', async () => {
    const { server, client } = setup(registerAnalyticsTools);
    client.seedAccount({ id: 'a1', name: 'Checking' });
    client.seedCategoryGroup({
      id: 'gs',
      name: 'Spending',
      categories: [{ id: 'c-food', name: 'Food', group_id: 'gs' }],
    });
    client.seedCategory({ id: 'c-food', name: 'Food', group_id: 'gs' });
    // Seed one transaction in the current month so the trend has data.
    const now = format(new Date(), 'yyyy-MM-dd');
    client.seedTransaction({
      id: 't1',
      account: 'a1',
      date: now,
      amount: -5000,
      category: 'c-food',
    });

    const r = await call(server, 'trend-analysis', { months: 3 });
    expect(r.isError).toBeFalsy();
    const text = r.content[0]?.text ?? '';
    expect(text).toContain('Spending Trend Analysis');
    expect(text).toContain('### Food');
    // Anomaly column header should be present.
    expect(text).toContain('Anomaly');
  });

  it('respects the categories filter', async () => {
    const { server, client } = setup(registerAnalyticsTools);
    client.seedAccount({ id: 'a1', name: 'Checking' });
    client.seedCategoryGroup({
      id: 'gs',
      name: 'Spending',
      categories: [
        { id: 'c-food', name: 'Food', group_id: 'gs' },
        { id: 'c-fuel', name: 'Fuel', group_id: 'gs' },
      ],
    });
    client.seedCategory({ id: 'c-food', name: 'Food', group_id: 'gs' });
    client.seedCategory({ id: 'c-fuel', name: 'Fuel', group_id: 'gs' });
    const now = format(new Date(), 'yyyy-MM-dd');
    client.seedTransaction({
      id: 't1',
      account: 'a1',
      date: now,
      amount: -5000,
      category: 'c-food',
    });
    client.seedTransaction({
      id: 't2',
      account: 'a1',
      date: now,
      amount: -7500,
      category: 'c-fuel',
    });

    const r = await call(server, 'trend-analysis', { months: 3, categories: ['c-food'] });
    expect(r.isError).toBeFalsy();
    const text = r.content[0]?.text ?? '';
    expect(text).toContain('### Food');
    expect(text).not.toContain('### Fuel');
  });

  it('returns the no-data message when there is no spending', async () => {
    const { server, client } = setup(registerAnalyticsTools);
    client.seedAccount({ id: 'a1', name: 'Checking' });
    const r = await call(server, 'trend-analysis', { months: 3 });
    expect(r.isError).toBeFalsy();
    expect(r.content[0]?.text).toContain('No spending data found for the specified period.');
  });
});

describe('income-expense-timeline', () => {
  it('emits one row per month with cumulative totals', async () => {
    const { server, client } = setup(registerAnalyticsTools);
    client.seedAccount({ id: 'a1', name: 'Checking' });
    client.seedCategoryGroup({
      id: 'gi',
      name: 'Income',
      is_income: true,
      categories: [{ id: 'c-pay', name: 'Salary', group_id: 'gi', is_income: true }],
    });
    client.seedCategoryGroup({
      id: 'gs',
      name: 'Spending',
      categories: [{ id: 'c-food', name: 'Food', group_id: 'gs' }],
    });
    client.seedCategory({ id: 'c-pay', name: 'Salary', group_id: 'gi', is_income: true });
    client.seedCategory({ id: 'c-food', name: 'Food', group_id: 'gs' });
    client.seedTransaction({
      id: 't1',
      account: 'a1',
      date: '2026-04-01',
      amount: 100000,
      category: 'c-pay',
    });
    client.seedTransaction({
      id: 't2',
      account: 'a1',
      date: '2026-04-15',
      amount: -25000,
      category: 'c-food',
    });
    client.seedTransaction({
      id: 't3',
      account: 'a1',
      date: '2026-05-01',
      amount: 100000,
      category: 'c-pay',
    });
    client.seedTransaction({
      id: 't4',
      account: 'a1',
      date: '2026-05-20',
      amount: -50000,
      category: 'c-food',
    });

    const r = await call(server, 'income-expense-timeline', {
      start_month: '2026-04',
      end_month: '2026-05',
    });
    expect(r.isError).toBeFalsy();
    const text = r.content[0]?.text ?? '';
    expect(text).toContain('Income & Expense Timeline: 2026-04 to 2026-05');
    expect(text).toContain('2026-04');
    expect(text).toContain('2026-05');
    // April: net = 1000 - 250 = 750.00
    expect(text).toContain('$750.00');
    // Cumulative through May: 750 + (1000-500) = 1250.00
    expect(text).toContain('$1,250.00');
  });

  it('returns an error when end_month precedes start_month', async () => {
    const { server } = setup(registerAnalyticsTools);
    const r = await call(server, 'income-expense-timeline', {
      start_month: '2026-05',
      end_month: '2026-04',
    });
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text ?? '').toContain('Invalid month range');
  });
});
