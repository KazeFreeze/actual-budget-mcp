import { z } from 'zod';
import { format, subMonths, parse, endOfMonth, eachMonthOfInterval } from 'date-fns';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerDeps } from '../server.js';
import type { ActualClient, Transaction } from '../client/actual-client.js';
import { formatAmount, formatMarkdownTable, buildNameMap, resolveName } from '../format.js';
import { ok, err, readTool, adaptRead } from './shared.js';

const Month = z.string().regex(/^\d{4}-\d{2}$/);
const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Get current month as YYYY-MM. */
function currentMonth(): string {
  return format(new Date(), 'yyyy-MM');
}

/** Get all transactions across all non-closed accounts for a date range. */
async function getAllTransactions(
  client: ActualClient,
  sinceDate: string,
  untilDate: string,
): Promise<Transaction[]> {
  const accounts = await client.getAccounts();
  const open = accounts.filter((a) => !a.closed);
  const results = await Promise.all(
    open.map((a) => client.getTransactions(a.id, sinceDate, untilDate)),
  );
  return results.flat();
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

/**
 * Skip the parent row of a split transaction. Per v2 conventions a parent
 * carries `subtransactions: Transaction[]` whose amounts sum to the parent
 * amount; counting both would double-count. Children have no
 * `subtransactions` field (or an empty one).
 */
function isSplitParent(tx: Transaction): boolean {
  return Array.isArray(tx.subtransactions) && tx.subtransactions.length > 0;
}

export function registerAnalyticsTools(server: McpServer, deps: McpServerDeps): void {
  const { client, coalescer, config } = deps;
  const currencySymbol = config.currencySymbol;

  // 1. monthly-financial-summary
  server.registerTool(
    'monthly-financial-summary',
    {
      description:
        'Get a monthly financial summary including income, expenses, net, savings rate, and top spending categories. Defaults to current month.',
      inputSchema: { month: Month.optional() },
    },
    adaptRead(
      readTool(coalescer, async ({ month }: { month: string | undefined }) => {
        const m = month ?? currentMonth();
        const sinceDate = `${m}-01`;
        const monthDate = parse(m, 'yyyy-MM', new Date());
        const untilDate = format(endOfMonth(monthDate), 'yyyy-MM-dd');

        const groups = await client.getCategoryGroups();
        const incomeCategories = new Set<string>();
        for (const group of groups) {
          if (group.is_income) {
            for (const cat of group.categories ?? []) {
              incomeCategories.add(cat.id);
            }
          }
        }

        const cats = await client.getCategories();
        const categoryMap = buildNameMap(cats);

        const txs = await getAllTransactions(client, sinceDate, untilDate);

        let totalIncome = 0;
        let totalExpenses = 0;
        const categorySpending = new Map<string, number>();

        for (const tx of txs) {
          if (isSplitParent(tx)) continue;

          const amount = tx.amount;
          const categoryId = tx.category ?? null;

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

        const topSpending = [...categorySpending.entries()]
          .sort((a, b) => a[1] - b[1])
          .slice(0, 10);

        const lines: string[] = [
          `## Monthly Financial Summary: ${m}`,
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
            const pct =
              absExpenses > 0 ? ((Math.abs(amount) / absExpenses) * 100).toFixed(1) : '0.0';
            return [
              resolveName(catId, categoryMap),
              formatAmount(amount, currencySymbol),
              `${pct}%`,
            ];
          });
          lines.push(formatMarkdownTable(headers, rows, ['left', 'right', 'right']));
        }

        return ok(lines.join('\n'));
      }),
    ),
  );

  // 2. spending-analysis
  server.registerTool(
    'spending-analysis',
    {
      description:
        'Analyze spending grouped by category, payee, or category group for a given period. Optionally compare to a prior period.',
      inputSchema: {
        start_date: DateStr,
        end_date: DateStr,
        group_by: z.enum(['category', 'payee', 'category_group']).optional(),
        compare_start_date: DateStr.optional(),
        compare_end_date: DateStr.optional(),
      },
    },
    adaptRead(
      readTool(
        coalescer,
        async ({
          start_date,
          end_date,
          group_by,
          compare_start_date,
          compare_end_date,
        }: {
          start_date: string;
          end_date: string;
          group_by: 'category' | 'payee' | 'category_group' | undefined;
          compare_start_date: string | undefined;
          compare_end_date: string | undefined;
        }) => {
          const groupBy = group_by ?? 'category';

          const [groups, cats, payees] = await Promise.all([
            client.getCategoryGroups(),
            client.getCategories(),
            client.getPayees(),
          ]);

          const categoryMap = buildNameMap(cats);
          const payeeMap = buildNameMap(payees);
          const categoryGroupMap = buildNameMap(groups);

          const catToGroup = new Map<string, string>();
          for (const cat of cats) {
            if (cat.group_id) catToGroup.set(cat.id, cat.group_id);
          }

          const incomeCategories = new Set<string>();
          for (const group of groups) {
            if (group.is_income) {
              for (const cat of group.categories ?? []) {
                incomeCategories.add(cat.id);
              }
            }
          }

          const classify = (tx: Transaction): string | null => {
            if (isSplitParent(tx)) return null;
            if (tx.amount >= 0) return null; // skip income
            const catId = tx.category ?? null;
            if (catId && incomeCategories.has(catId)) return null;

            if (groupBy === 'payee') {
              const name = resolveName(tx.payee ?? null, payeeMap);
              return name || 'Uncategorized';
            }
            if (groupBy === 'category_group') {
              const gid = catId ? catToGroup.get(catId) : undefined;
              return gid ? resolveName(gid, categoryGroupMap) : 'Uncategorized';
            }
            return catId ? resolveName(catId, categoryMap) : 'Uncategorized';
          };

          const txs = await getAllTransactions(client, start_date, end_date);
          const spending = new Map<string, number>();
          let totalSpent = 0;
          for (const tx of txs) {
            const key = classify(tx);
            if (key === null) continue;
            spending.set(key, (spending.get(key) ?? 0) + tx.amount);
            totalSpent += tx.amount;
          }

          let compareSpending: Map<string, number> | null = null;
          if (compare_start_date && compare_end_date) {
            const compTxs = await getAllTransactions(client, compare_start_date, compare_end_date);
            compareSpending = new Map<string, number>();
            for (const tx of compTxs) {
              const key = classify(tx);
              if (key === null) continue;
              compareSpending.set(key, (compareSpending.get(key) ?? 0) + tx.amount);
            }
          }

          const sorted = [...spending.entries()].sort((a, b) => a[1] - b[1]);
          const absTotal = Math.abs(totalSpent);

          const lines: string[] = [
            `## Spending Analysis: ${start_date} to ${end_date}`,
            `**Grouped by:** ${groupBy}`,
            '',
          ];

          const headers = compareSpending
            ? ['Name', 'Amount', '% of Total', 'Prior Period', 'Change']
            : ['Name', 'Amount', '% of Total'];

          const rows: string[][] = sorted.map(([name, amount]) => {
            const pct = absTotal > 0 ? ((Math.abs(amount) / absTotal) * 100).toFixed(1) : '0.0';
            const row = [name, formatAmount(amount, currencySymbol), `${pct}%`];
            if (compareSpending) {
              const prior = compareSpending.get(name) ?? 0;
              row.push(formatAmount(prior, currencySymbol));
              const change =
                prior !== 0 ? `${(((amount - prior) / Math.abs(prior)) * 100).toFixed(1)}%` : 'N/A';
              row.push(change);
            }
            return row;
          });

          const totalRow = ['**Total**', formatAmount(totalSpent, currencySymbol), '100.0%'];
          if (compareSpending) {
            const priorTotal = [...compareSpending.values()].reduce((a, b) => a + b, 0);
            totalRow.push(formatAmount(priorTotal, currencySymbol));
            totalRow.push(
              priorTotal !== 0
                ? `${(((totalSpent - priorTotal) / Math.abs(priorTotal)) * 100).toFixed(1)}%`
                : 'N/A',
            );
          }
          rows.push(totalRow);

          const aligns: Array<'left' | 'right' | 'center'> = compareSpending
            ? ['left', 'right', 'right', 'right', 'right']
            : ['left', 'right', 'right'];

          lines.push(formatMarkdownTable(headers, rows, aligns));
          return ok(lines.join('\n'));
        },
      ),
    ),
  );

  // 3. budget-variance-report
  server.registerTool(
    'budget-variance-report',
    {
      description:
        'Compare budgeted vs actual spending for a month. Shows per-category variance and flags overspent categories with \u26a0.',
      inputSchema: { month: Month.optional() },
    },
    adaptRead(
      readTool(coalescer, async ({ month }: { month: string | undefined }) => {
        const m = month ?? currentMonth();
        const budget = await client.getBudgetMonth(m);

        const lines: string[] = [`## Budget Variance Report: ${m}`, ''];
        const headers = ['Category', 'Budgeted', 'Spent', 'Variance', 'Status'];
        const rows: string[][] = [];

        let totalBudgeted = 0;
        let totalSpent = 0;

        for (const group of budget.categoryGroups) {
          if (group.is_income) continue;
          for (const cat of group.categories) {
            if (cat.hidden) continue;
            const { budgeted, spent } = cat;
            const variance = budgeted + spent;
            const status = cat.balance < 0 ? '\u26a0 Over' : '\u2713';

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
          totalVariance < 0 ? '\u26a0 Over' : '\u2713',
        ]);

        lines.push(formatMarkdownTable(headers, rows, ['left', 'right', 'right', 'right', 'left']));
        return ok(lines.join('\n'));
      }),
    ),
  );

  // 4. net-worth-snapshot
  server.registerTool(
    'net-worth-snapshot',
    {
      description:
        'Calculate total net worth from all accounts. Groups by on-budget vs off-budget and shows assets minus liabilities.',
      inputSchema: {},
    },
    adaptRead(
      readTool(coalescer, async () => {
        const accounts = await client.getAccounts();
        const openAccounts = accounts.filter((a) => !a.closed);
        const balances = await Promise.all(openAccounts.map((a) => client.getAccountBalance(a.id)));

        const onBudget: Array<{ name: string; balance: number }> = [];
        const offBudget: Array<{ name: string; balance: number }> = [];
        let totalNetWorth = 0;

        for (let i = 0; i < openAccounts.length; i++) {
          const account = openAccounts[i];
          if (!account) continue;
          const balance = balances[i] ?? 0;
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
      }),
    ),
  );

  // 5. trend-analysis
  server.registerTool(
    'trend-analysis',
    {
      description:
        'Analyze spending trends over multiple months with rolling averages and anomaly detection. Optionally filter by categories.',
      inputSchema: {
        months: z.number().int().positive().optional(),
        categories: z.array(z.string()).optional(),
      },
    },
    adaptRead(
      readTool(
        coalescer,
        async ({
          months,
          categories,
        }: {
          months: number | undefined;
          categories: string[] | undefined;
        }) => {
          const monthCount = months ?? 6;
          const filterCategories = categories;

          const base = currentMonth();
          const monthList: string[] = [];
          for (let i = monthCount - 1; i >= 0; i--) {
            monthList.push(monthsBack(base, i));
          }

          const [groups, cats] = await Promise.all([
            client.getCategoryGroups(),
            client.getCategories(),
          ]);

          const categoryMap = buildNameMap(cats);
          const incomeCategories = new Set<string>();
          for (const group of groups) {
            if (group.is_income) {
              for (const cat of group.categories ?? []) {
                incomeCategories.add(cat.id);
              }
            }
          }

          const monthlyData: Map<string, Map<string, number>> = new Map();
          const allCategories = new Set<string>();

          for (const month of monthList) {
            const sinceDate = `${month}-01`;
            const monthDate = parse(month, 'yyyy-MM', new Date());
            const untilDate = format(endOfMonth(monthDate), 'yyyy-MM-dd');

            const txs = await getAllTransactions(client, sinceDate, untilDate);
            const catSpending = new Map<string, number>();
            for (const tx of txs) {
              if (isSplitParent(tx)) continue;
              const amount = tx.amount;
              if (amount >= 0) continue;
              const catId = tx.category ?? null;
              if (!catId || incomeCategories.has(catId)) continue;
              if (filterCategories && !filterCategories.includes(catId)) continue;

              catSpending.set(catId, (catSpending.get(catId) ?? 0) + amount);
              allCategories.add(catId);
            }
            monthlyData.set(month, catSpending);
          }

          if (allCategories.size === 0) {
            return ok('No spending data found for the specified period.');
          }

          const lines: string[] = [
            `## Spending Trend Analysis (${monthList[0]} to ${monthList[monthList.length - 1]})`,
            '',
          ];

          const sortedCategories = [...allCategories];
          for (const catId of sortedCategories) {
            const catName = resolveName(catId, categoryMap);
            lines.push(`### ${catName}`);

            const headers = ['Month', 'Spent', 'Rolling Avg', 'Anomaly'];
            const rows: string[][] = [];
            const values: number[] = [];

            for (const month of monthList) {
              const spent = monthlyData.get(month)?.get(catId) ?? 0;
              values.push(spent);
              const avg = values.reduce((a, b) => a + b, 0) / values.length;
              const rollingAvg = Math.round(avg);

              let anomaly = '';
              if (values.length > 1 && Math.abs(avg) > 0) {
                const deviation = Math.abs((spent - avg) / Math.abs(avg));
                if (deviation > 0.5) {
                  anomaly = spent < avg ? '\u2b06 High' : '\u2b07 Low';
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
      ),
    ),
  );

  // 6. income-expense-timeline
  server.registerTool(
    'income-expense-timeline',
    {
      description:
        'Show month-by-month income, expenses, net, cumulative surplus/deficit, and savings rate over a date range.',
      inputSchema: {
        start_month: Month,
        end_month: Month,
      },
    },
    adaptRead(
      readTool(
        coalescer,
        async ({ start_month, end_month }: { start_month: string; end_month: string }) => {
          if (start_month > end_month) {
            return err('Invalid month range: start_month must be before end_month');
          }
          const monthList = monthRange(start_month, end_month);
          if (monthList.length === 0) {
            return err('Invalid month range: start_month must be before end_month');
          }

          const groups = await client.getCategoryGroups();
          const incomeCategories = new Set<string>();
          for (const group of groups) {
            if (group.is_income) {
              for (const cat of group.categories ?? []) {
                incomeCategories.add(cat.id);
              }
            }
          }

          const lines: string[] = [
            `## Income & Expense Timeline: ${start_month} to ${end_month}`,
            '',
          ];
          const headers = ['Month', 'Income', 'Expenses', 'Net', 'Cumulative', 'Savings Rate'];
          const rows: string[][] = [];
          let cumulative = 0;

          for (const month of monthList) {
            const sinceDate = `${month}-01`;
            const monthDate = parse(month, 'yyyy-MM', new Date());
            const untilDate = format(endOfMonth(monthDate), 'yyyy-MM-dd');

            const txs = await getAllTransactions(client, sinceDate, untilDate);
            let income = 0;
            let expenses = 0;

            for (const tx of txs) {
              if (isSplitParent(tx)) continue;
              const amount = tx.amount;
              const catId = tx.category ?? null;

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

          lines.push(
            formatMarkdownTable(headers, rows, [
              'left',
              'right',
              'right',
              'right',
              'right',
              'right',
            ]),
          );
          return ok(lines.join('\n'));
        },
      ),
    ),
  );
}
