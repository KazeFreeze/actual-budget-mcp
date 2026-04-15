import { z } from 'zod';
import { format, subMonths, parse, endOfMonth, eachMonthOfInterval } from 'date-fns';
import type { ActualClient } from '../client.js';
import {
  formatAmount,
  formatMarkdownTable,
  buildNameMap,
  resolveName,
} from '../format.js';
import { type ToolDefinition, ok, err, str, num, zodInputSchema } from './shared.js';

/** Get current month as YYYY-MM. */
function currentMonth(): string {
  return format(new Date(), 'yyyy-MM');
}

/** Get all transactions across all non-closed accounts for a date range. */
async function getAllTransactions(
  client: ActualClient,
  sinceDate: string,
  untilDate?: string,
): Promise<{ ok: true; data: Array<Record<string, unknown>> } | { ok: false; error: string }> {
  const accountsRes = await client.getAccounts();
  if (!accountsRes.ok) return { ok: false, error: accountsRes.error };

  const openAccounts = accountsRes.data.filter((a) => !a.closed);
  const results = await Promise.all(
    openAccounts.map((a) => client.getTransactions(a.id, sinceDate, untilDate)),
  );

  const allTx: Array<Record<string, unknown>> = [];
  for (const res of results) {
    if (!res.ok) return { ok: false, error: res.error };
    for (const tx of res.data) {
      allTx.push(tx as unknown as Record<string, unknown>);
    }
  }
  return { ok: true, data: allTx };
}

/** Compute month string N months back from a given YYYY-MM. */
function monthsBack(baseMonth: string, n: number): string {
  const date = parse(baseMonth, 'yyyy-MM', new Date());
  return format(subMonths(date, n), 'yyyy-MM');
}

/** Generate a range of months from start_month to end_month inclusive. */
function monthRange(startMonth: string, endMonth: string): string[] {
  const start = parse(startMonth, 'yyyy-MM', new Date());
  const end = parse(endMonth, 'yyyy-MM', new Date());
  return eachMonthOfInterval({ start, end }).map((d) => format(d, 'yyyy-MM'));
}

// --- Factory ---

export function createAnalyticsTools(client: ActualClient, currencySymbol: string): ToolDefinition[] {
  return [
    // 1. monthly-financial-summary
    {
      schema: {
        name: 'monthly-financial-summary',
        description:
          'Get a monthly financial summary including income, expenses, net, savings rate, and top spending categories. Defaults to current month.',
        inputSchema: zodInputSchema(z.object({
          month: z.string().optional().describe('Month in YYYY-MM format (defaults to current month)'),
        })),
      },
      handler: async (params) => {
        const month = str(params, 'month') ?? currentMonth();
        const sinceDate = `${month}-01`;
        const monthDate = parse(month, 'yyyy-MM', new Date());
        const untilDate = format(endOfMonth(monthDate), 'yyyy-MM-dd');

        // Fetch category groups to identify income categories
        const groupsRes = await client.getCategoryGroups();
        if (!groupsRes.ok) return err(groupsRes.error);

        const incomeCategories = new Set<string>();
        for (const group of groupsRes.data) {
          if (group.is_income) {
            for (const cat of group.categories ?? []) {
              incomeCategories.add(cat.id);
            }
          }
        }

        // Build category name map
        const catRes = await client.getCategories();
        const categoryMap = catRes.ok ? buildNameMap(catRes.data) : buildNameMap([]);

        // Fetch all transactions for this month
        const txRes = await getAllTransactions(client, sinceDate, untilDate);
        if (!txRes.ok) return err(txRes.error);

        let totalIncome = 0;
        let totalExpenses = 0;
        const categorySpending = new Map<string, number>();

        for (const tx of txRes.data) {
          const amount = tx.amount as number;
          const categoryId = tx.category as string | null;
          const isChild = tx.is_child as boolean | undefined;

          // Skip parent transactions of splits (children carry the actual amounts)
          if (isChild === false && Array.isArray(tx.subtransactions) && (tx.subtransactions as unknown[]).length > 0) {
            continue;
          }

          if (categoryId && incomeCategories.has(categoryId)) {
            totalIncome += amount;
          } else if (amount < 0) {
            totalExpenses += amount;
            if (categoryId) {
              categorySpending.set(categoryId, (categorySpending.get(categoryId) ?? 0) + amount);
            }
          }
        }

        const absExpenses = Math.abs(totalExpenses);
        const net = totalIncome - absExpenses;
        const savingsRate = totalIncome > 0 ? ((net / totalIncome) * 100).toFixed(1) : '0.0';

        // Top spending categories (sorted by absolute spend, descending)
        const topSpending = [...categorySpending.entries()]
          .sort((a, b) => a[1] - b[1]) // most negative first
          .slice(0, 10);

        const lines: string[] = [
          `## Monthly Financial Summary: ${month}`,
          '',
          '### Overview',
          `- **Income:** ${formatAmount(totalIncome, currencySymbol)}`,
          `- **Expenses:** ${formatAmount(totalExpenses, currencySymbol)}`,
          `- **Net:** ${formatAmount(net, currencySymbol)}`,
          `- **Savings Rate:** ${savingsRate}%`,
        ];

        if (topSpending.length > 0) {
          lines.push('', '### Top Spending Categories');
          const headers = ['Category', 'Amount', '% of Expenses'];
          const rows = topSpending.map(([catId, amount]) => {
            const pct = absExpenses > 0 ? ((Math.abs(amount) / absExpenses) * 100).toFixed(1) : '0.0';
            return [resolveName(catId, categoryMap), formatAmount(amount, currencySymbol), `${pct}%`];
          });
          lines.push(formatMarkdownTable(headers, rows, ['left', 'right', 'right']));
        }

        return ok(lines.join('\n'));
      },
    },

    // 2. spending-analysis
    {
      schema: {
        name: 'spending-analysis',
        description:
          'Analyze spending grouped by category, payee, or category group for a given period. Optionally compare to a prior period.',
        inputSchema: zodInputSchema(z.object({
          start_date: z.string().describe('Start date (YYYY-MM-DD)'),
          end_date: z.string().describe('End date (YYYY-MM-DD)'),
          group_by: z.enum(['category', 'payee', 'category_group']).optional().describe('How to group spending (default: category)'),
          compare_start_date: z.string().optional().describe('Comparison period start date (YYYY-MM-DD)'),
          compare_end_date: z.string().optional().describe('Comparison period end date (YYYY-MM-DD)'),
        })),
      },
      handler: async (params) => {
        const startDate = str(params, 'start_date');
        const endDate = str(params, 'end_date');
        if (!startDate || !endDate) return err('Missing required parameters: start_date and end_date');

        const groupBy = str(params, 'group_by') ?? 'category';
        const compareStart = str(params, 'compare_start_date');
        const compareEnd = str(params, 'compare_end_date');

        // Fetch reference data
        const [groupsRes, catRes, payeesRes] = await Promise.all([
          client.getCategoryGroups(),
          client.getCategories(),
          client.getPayees(),
        ]);
        if (!groupsRes.ok) return err(groupsRes.error);

        const categoryMap = catRes.ok ? buildNameMap(catRes.data) : buildNameMap([]);
        const payeeMap = payeesRes.ok ? buildNameMap(payeesRes.data) : buildNameMap([]);
        const categoryGroupMap = buildNameMap(groupsRes.data);

        // Map category id -> group id
        const catToGroup = new Map<string, string>();
        if (catRes.ok) {
          for (const cat of catRes.data) {
            if (cat.group_id) catToGroup.set(cat.id, cat.group_id);
          }
        }

        // Income categories to exclude
        const incomeCategories = new Set<string>();
        for (const group of groupsRes.data) {
          if (group.is_income) {
            for (const cat of group.categories ?? []) {
              incomeCategories.add(cat.id);
            }
          }
        }

        // Get transactions
        const txRes = await getAllTransactions(client, startDate, endDate);
        if (!txRes.ok) return err(txRes.error);

        const spending = new Map<string, number>();
        let totalSpent = 0;

        for (const tx of txRes.data) {
          // Skip parent transactions of splits (children carry the actual amounts)
          if (tx.is_child === false && Array.isArray(tx.subtransactions) && (tx.subtransactions as unknown[]).length > 0) continue;

          const amount = tx.amount as number;
          if (amount >= 0) continue; // skip income
          const catId = tx.category as string | null;
          if (catId && incomeCategories.has(catId)) continue;

          let key: string;
          if (groupBy === 'payee') {
            const payeeId = (tx.payee_name as string) || resolveName(tx.payee as string, payeeMap);
            key = payeeId || 'Uncategorized';
          } else if (groupBy === 'category_group') {
            const gid = catId ? catToGroup.get(catId) : undefined;
            key = gid ? resolveName(gid, categoryGroupMap) : 'Uncategorized';
          } else {
            key = catId ? resolveName(catId, categoryMap) : 'Uncategorized';
          }

          spending.set(key, (spending.get(key) ?? 0) + amount);
          totalSpent += amount;
        }

        // Comparison period
        let compareSpending: Map<string, number> | null = null;
        if (compareStart && compareEnd) {
          const compTxRes = await getAllTransactions(client, compareStart, compareEnd);
          if (compTxRes.ok) {
            compareSpending = new Map<string, number>();
            for (const tx of compTxRes.data) {
              if (tx.is_child === false && Array.isArray(tx.subtransactions) && (tx.subtransactions as unknown[]).length > 0) continue;
              const amount = tx.amount as number;
              if (amount >= 0) continue;
              const catId = tx.category as string | null;
              if (catId && incomeCategories.has(catId)) continue;

              let key: string;
              if (groupBy === 'payee') {
                const payeeId = (tx.payee_name as string) || resolveName(tx.payee as string, payeeMap);
                key = payeeId || 'Uncategorized';
              } else if (groupBy === 'category_group') {
                const gid = catId ? catToGroup.get(catId) : undefined;
                key = gid ? resolveName(gid, categoryGroupMap) : 'Uncategorized';
              } else {
                key = catId ? resolveName(catId, categoryMap) : 'Uncategorized';
              }

              compareSpending.set(key, (compareSpending.get(key) ?? 0) + amount);
            }
          }
        }

        // Build table
        const sorted = [...spending.entries()].sort((a, b) => a[1] - b[1]);
        const absTotal = Math.abs(totalSpent);

        const lines: string[] = [
          `## Spending Analysis: ${startDate} to ${endDate}`,
          `**Grouped by:** ${groupBy}`,
          '',
        ];

        const headers = compareSpending
          ? ['Name', 'Amount', '% of Total', 'Prior Period', 'Change']
          : ['Name', 'Amount', '% of Total'];

        const rows = sorted.map(([name, amount]) => {
          const pct = absTotal > 0 ? ((Math.abs(amount) / absTotal) * 100).toFixed(1) : '0.0';
          const row = [name, formatAmount(amount, currencySymbol), `${pct}%`];
          if (compareSpending) {
            const prior = compareSpending.get(name) ?? 0;
            row.push(formatAmount(prior, currencySymbol));
            const change = prior !== 0 ? (((amount - prior) / Math.abs(prior)) * 100).toFixed(1) : 'N/A';
            row.push(typeof change === 'string' && change !== 'N/A' ? `${change}%` : change);
          }
          return row;
        });

        const totalRow = ['**Total**', formatAmount(totalSpent, currencySymbol), '100.0%'];
        if (compareSpending) {
          const priorTotal = [...compareSpending.values()].reduce((a, b) => a + b, 0);
          totalRow.push(formatAmount(priorTotal, currencySymbol));
          totalRow.push(priorTotal !== 0 ? `${(((totalSpent - priorTotal) / Math.abs(priorTotal)) * 100).toFixed(1)}%` : 'N/A');
        }
        rows.push(totalRow);

        const aligns: Array<'left' | 'right' | 'center'> = compareSpending
          ? ['left', 'right', 'right', 'right', 'right']
          : ['left', 'right', 'right'];

        lines.push(formatMarkdownTable(headers, rows, aligns));

        return ok(lines.join('\n'));
      },
    },

    // 3. budget-variance-report
    {
      schema: {
        name: 'budget-variance-report',
        description:
          'Compare budgeted vs actual spending for a month. Shows per-category variance and flags overspent categories with ⚠.',
        inputSchema: zodInputSchema(z.object({
          month: z.string().optional().describe('Month in YYYY-MM format (defaults to current month)'),
        })),
      },
      handler: async (params) => {
        const month = str(params, 'month') ?? currentMonth();

        const res = await client.getBudgetMonth(month);
        if (!res.ok) return err(res.error);

        const budget = res.data;
        const lines: string[] = [
          `## Budget Variance Report: ${month}`,
          '',
        ];

        const headers = ['Category', 'Budgeted', 'Spent', 'Variance', 'Status'];
        const rows: string[][] = [];

        let totalBudgeted = 0;
        let totalSpent = 0;

        for (const group of budget.categoryGroups ?? []) {
          if (group.is_income) continue;
          for (const cat of group.categories ?? []) {
            if (cat.hidden) continue;
            const budgeted = cat.budgeted ?? 0;
            const spent = cat.spent ?? 0;
            const variance = budgeted + spent; // spent is negative, so variance = budgeted - |spent|
            const status = (cat.balance ?? variance) < 0 ? '⚠ Over' : '✓';

            totalBudgeted += budgeted;
            totalSpent += spent;

            rows.push([
              cat.name,
              formatAmount(budgeted, currencySymbol),
              formatAmount(spent, currencySymbol),
              formatAmount(variance, currencySymbol),
              status,
            ]);
          }
        }

        const totalVariance = totalBudgeted + totalSpent;
        rows.push([
          '**Total**',
          formatAmount(totalBudgeted, currencySymbol),
          formatAmount(totalSpent, currencySymbol),
          formatAmount(totalVariance, currencySymbol),
          totalVariance < 0 ? '⚠ Over' : '✓',
        ]);

        lines.push(formatMarkdownTable(headers, rows, ['left', 'right', 'right', 'right', 'left']));

        return ok(lines.join('\n'));
      },
    },

    // 4. net-worth-snapshot
    {
      schema: {
        name: 'net-worth-snapshot',
        description:
          'Calculate total net worth from all accounts. Groups by on-budget vs off-budget and shows assets minus liabilities.',
        inputSchema: zodInputSchema(z.object({})),
      },
      handler: async () => {
        const accountsRes = await client.getAccounts();
        if (!accountsRes.ok) return err(accountsRes.error);

        const openAccounts = accountsRes.data.filter((a) => !a.closed);
        const balances = await Promise.all(
          openAccounts.map((a) => client.getAccountBalance(a.id)),
        );

        const onBudget: Array<{ name: string; balance: number }> = [];
        const offBudget: Array<{ name: string; balance: number }> = [];
        let totalNetWorth = 0;

        for (let i = 0; i < openAccounts.length; i++) {
          const account = openAccounts[i];
          const balRes = balances[i];
          const balance = balRes.ok ? balRes.data : 0;
          totalNetWorth += balance;

          const entry = { name: account.name, balance };
          if (account.offbudget) {
            offBudget.push(entry);
          } else {
            onBudget.push(entry);
          }
        }

        const lines: string[] = ['## Net Worth Snapshot', ''];

        if (onBudget.length > 0) {
          lines.push('### On-Budget Accounts');
          const headers = ['Account', 'Balance'];
          const rows = onBudget.map((a) => [a.name, formatAmount(a.balance, currencySymbol)]);
          const subtotal = onBudget.reduce((s, a) => s + a.balance, 0);
          rows.push(['**Subtotal**', formatAmount(subtotal, currencySymbol)]);
          lines.push(formatMarkdownTable(headers, rows, ['left', 'right']));
          lines.push('');
        }

        if (offBudget.length > 0) {
          lines.push('### Off-Budget Accounts');
          const headers = ['Account', 'Balance'];
          const rows = offBudget.map((a) => [a.name, formatAmount(a.balance, currencySymbol)]);
          const subtotal = offBudget.reduce((s, a) => s + a.balance, 0);
          rows.push(['**Subtotal**', formatAmount(subtotal, currencySymbol)]);
          lines.push(formatMarkdownTable(headers, rows, ['left', 'right']));
          lines.push('');
        }

        lines.push(`### Total Net Worth: ${formatAmount(totalNetWorth, currencySymbol)}`);

        return ok(lines.join('\n'));
      },
    },

    // 5. trend-analysis
    {
      schema: {
        name: 'trend-analysis',
        description:
          'Analyze spending trends over multiple months with rolling averages and anomaly detection. Optionally filter by categories.',
        inputSchema: zodInputSchema(z.object({
          months: z.number().optional().describe('Number of months to analyze (default: 6)'),
          categories: z.array(z.string()).optional().describe('Optional list of category IDs to filter'),
        })),
      },
      handler: async (params) => {
        const monthCount = num(params, 'months') ?? 6;
        const filterCategories = params.categories as string[] | undefined;

        const base = currentMonth();
        const months: string[] = [];
        for (let i = monthCount - 1; i >= 0; i--) {
          months.push(monthsBack(base, i));
        }

        // Fetch category info
        const [groupsRes, catRes] = await Promise.all([
          client.getCategoryGroups(),
          client.getCategories(),
        ]);
        if (!groupsRes.ok) return err(groupsRes.error);

        const categoryMap = catRes.ok ? buildNameMap(catRes.data) : buildNameMap([]);
        const incomeCategories = new Set<string>();
        for (const group of groupsRes.data) {
          if (group.is_income) {
            for (const cat of group.categories ?? []) {
              incomeCategories.add(cat.id);
            }
          }
        }

        // For each month, get spending by category
        const monthlyData: Map<string, Map<string, number>> = new Map();
        const allCategories = new Set<string>();

        for (const month of months) {
          const sinceDate = `${month}-01`;
          const monthDate = parse(month, 'yyyy-MM', new Date());
          const untilDate = format(endOfMonth(monthDate), 'yyyy-MM-dd');

          const txRes = await getAllTransactions(client, sinceDate, untilDate);
          if (!txRes.ok) return err(txRes.error);

          const catSpending = new Map<string, number>();
          for (const tx of txRes.data) {
            if (tx.is_child === false && Array.isArray(tx.subtransactions) && (tx.subtransactions as unknown[]).length > 0) continue;
            const amount = tx.amount as number;
            if (amount >= 0) continue;
            const catId = tx.category as string | null;
            if (!catId || incomeCategories.has(catId)) continue;
            if (filterCategories && !filterCategories.includes(catId)) continue;

            catSpending.set(catId, (catSpending.get(catId) ?? 0) + amount);
            allCategories.add(catId);
          }
          monthlyData.set(month, catSpending);
        }

        if (allCategories.size === 0) return ok('No spending data found for the specified period.');

        const lines: string[] = [
          `## Spending Trend Analysis (${months[0]} to ${months[months.length - 1]})`,
          '',
        ];

        // Per-category trend table
        const sortedCategories = [...allCategories];
        for (const catId of sortedCategories) {
          const catName = resolveName(catId, categoryMap);
          lines.push(`### ${catName}`);

          const headers = ['Month', 'Spent', 'Rolling Avg', 'Anomaly'];
          const rows: string[][] = [];
          const values: number[] = [];

          for (const month of months) {
            const spent = monthlyData.get(month)?.get(catId) ?? 0;
            values.push(spent);
            const avg = values.reduce((a, b) => a + b, 0) / values.length;
            const rollingAvg = Math.round(avg);

            // Anomaly: deviation > 50% from rolling average
            let anomaly = '';
            if (values.length > 1 && Math.abs(avg) > 0) {
              const deviation = Math.abs((spent - avg) / Math.abs(avg));
              if (deviation > 0.5) {
                anomaly = spent < avg ? '⬆ High' : '⬇ Low';
              }
            }

            rows.push([
              month,
              formatAmount(spent, currencySymbol),
              formatAmount(rollingAvg, currencySymbol),
              anomaly,
            ]);
          }

          lines.push(formatMarkdownTable(headers, rows, ['left', 'right', 'right', 'left']));
          lines.push('');
        }

        return ok(lines.join('\n'));
      },
    },

    // 6. income-expense-timeline
    {
      schema: {
        name: 'income-expense-timeline',
        description:
          'Show month-by-month income, expenses, net, cumulative surplus/deficit, and savings rate over a date range.',
        inputSchema: zodInputSchema(z.object({
          start_month: z.string().describe('Start month (YYYY-MM)'),
          end_month: z.string().describe('End month (YYYY-MM)'),
        })),
      },
      handler: async (params) => {
        const startMonth = str(params, 'start_month');
        const endMonth = str(params, 'end_month');
        if (!startMonth || !endMonth) return err('Missing required parameters: start_month and end_month');

        const months = monthRange(startMonth, endMonth);
        if (months.length === 0) return err('Invalid month range: start_month must be before end_month');

        // Fetch category groups to identify income categories
        const groupsRes = await client.getCategoryGroups();
        if (!groupsRes.ok) return err(groupsRes.error);

        const incomeCategories = new Set<string>();
        for (const group of groupsRes.data) {
          if (group.is_income) {
            for (const cat of group.categories ?? []) {
              incomeCategories.add(cat.id);
            }
          }
        }

        const lines: string[] = [
          `## Income & Expense Timeline: ${startMonth} to ${endMonth}`,
          '',
        ];

        const headers = ['Month', 'Income', 'Expenses', 'Net', 'Cumulative', 'Savings Rate'];
        const rows: string[][] = [];
        let cumulative = 0;

        for (const month of months) {
          const sinceDate = `${month}-01`;
          const monthDate = parse(month, 'yyyy-MM', new Date());
          const untilDate = format(endOfMonth(monthDate), 'yyyy-MM-dd');

          const txRes = await getAllTransactions(client, sinceDate, untilDate);
          if (!txRes.ok) return err(txRes.error);

          let income = 0;
          let expenses = 0;

          for (const tx of txRes.data) {
            if (tx.is_child === false && Array.isArray(tx.subtransactions) && (tx.subtransactions as unknown[]).length > 0) continue;
            const amount = tx.amount as number;
            const catId = tx.category as string | null;

            if (catId && incomeCategories.has(catId)) {
              income += amount;
            } else if (amount < 0) {
              expenses += amount;
            }
          }

          const absExpenses = Math.abs(expenses);
          const net = income - absExpenses;
          cumulative += net;
          const savingsRate = income > 0 ? ((net / income) * 100).toFixed(1) : '0.0';

          rows.push([
            month,
            formatAmount(income, currencySymbol),
            formatAmount(expenses, currencySymbol),
            formatAmount(net, currencySymbol),
            formatAmount(cumulative, currencySymbol),
            `${savingsRate}%`,
          ]);
        }

        lines.push(formatMarkdownTable(headers, rows, ['left', 'right', 'right', 'right', 'right', 'right']));

        return ok(lines.join('\n'));
      },
    },
  ];
}
