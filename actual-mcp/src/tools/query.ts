import { z } from 'zod';
import type { ActualClient } from '../client.js';
import { formatAmount, formatMarkdownTable } from '../format.js';
import { type ToolDefinition, ok, err, zodInputSchema } from './shared.js';

const AMOUNT_FIELD_PATTERNS = ['amount', 'total', 'spent', 'budgeted', 'balance', 'sum'];

function isAmountField(fieldName: string): boolean {
  const lower = fieldName.toLowerCase();
  return AMOUNT_FIELD_PATTERNS.some((p) => lower.includes(p));
}

// --- Factory ---

export function createQueryTool(client: ActualClient, currencySymbol: string): ToolDefinition {
  return {
    schema: {
      name: 'run-query',
      description: `Execute an arbitrary ActualQL query against the budget database.

## ActualQL Reference

### Tables
- transactions — all transactions (income, expense, transfer)
- accounts — budget accounts
- categories — spending categories
- payees — payee entities
- schedules — scheduled/recurring transactions

### Dot-Notation Joins
Access related entity fields using dot notation:
- category.name — name of the category on a transaction
- payee.name — name of the payee on a transaction
- account.name — name of the account on a transaction

### Filter Operators
Use inside a \`filter\` object:
- $eq — equals: { "amount": { "$eq": -5000 } }
- $ne — not equals: { "cleared": { "$ne": true } }
- $lt / $lte — less than / less than or equal
- $gt / $gte — greater than / greater than or equal
- $oneof — value in list: { "category.name": { "$oneof": ["Groceries", "Dining"] } }
- $regex — regex match: { "notes": { "$regex": "coffee" } }
- $like / $notlike — SQL-style pattern: { "notes": { "$like": "%coffee%" } }
- $and — combine conditions: { "$and": [{ "amount": { "$lt": 0 } }, { "cleared": true }] }
- $or — any condition: { "$or": [{ "category.name": "Rent" }, { "category.name": "Utilities" }] }

### Aggregates & groupBy
Compute summaries over groups:
- $sum — sum values: { "total": { "$sum": "$amount" } }
- $count — count rows: { "count": { "$count": "$id" } }
- Use groupBy alongside select to group results: groupBy: ["category.name"]

### Date Transforms
Extract date parts inside select or filter:
- $month — { "month": { "$month": "$date" } }
- $year  — { "year": { "$year": "$date" } }
- Combine with groupBy to produce monthly/yearly summaries

### Ordering, Pagination, Split Options
- orderBy — sort: { "orderBy": [{ "total": "desc" }] }
- limit / offset — paginate: { "limit": 20, "offset": 0 }
- options.splits — control split transaction inclusion:
  - "inline" (default) — include parent rows only
  - "grouped" — include parent + children together
  - "all" — include every row

### calculate (scalar)
Return a single aggregate value without grouping:
{ "table": "transactions", "calculate": { "$sum": "$amount" } }

## Example Queries

**Spending by category this month:**
\`\`\`json
{
  "table": "transactions",
  "filter": { "date": { "$gte": "2024-01-01" }, "amount": { "$lt": 0 } },
  "groupBy": ["category.name"],
  "select": ["category.name", { "total": { "$sum": "$amount" } }],
  "orderBy": [{ "total": "asc" }]
}
\`\`\`

**Total income for the year:**
\`\`\`json
{
  "table": "transactions",
  "filter": { "date": { "$gte": "2024-01-01" }, "amount": { "$gt": 0 } },
  "calculate": { "$sum": "$amount" }
}
\`\`\`

**Monthly spending trend:**
\`\`\`json
{
  "table": "transactions",
  "filter": { "amount": { "$lt": 0 } },
  "groupBy": [{ "month": { "$month": "$date" } }],
  "select": [{ "month": { "$month": "$date" } }, { "total": { "$sum": "$amount" } }],
  "orderBy": [{ "month": "asc" }]
}
\`\`\`
`,
      inputSchema: zodInputSchema(
        z.object({
          table: z
            .enum(['transactions', 'accounts', 'categories', 'payees', 'schedules'])
            .describe('The table to query'),
          filter: z
            .looseObject({})
            .optional()
            .describe(
              'Filter conditions using ActualQL operators ($eq, $lt, $gt, $lte, $gte, $ne, $oneof, $regex, $like, $notlike, $and, $or)',
            ),
          select: z
            .array(z.any())
            .optional()
            .describe(
              'Fields or aggregate expressions to select. Use strings for plain fields, objects for aliases/aggregates.',
            ),
          groupBy: z
            .array(z.any())
            .optional()
            .describe('Fields to group by. Use dot notation for joins (e.g. category.name)'),
          orderBy: z
            .array(z.looseObject({}))
            .optional()
            .describe(
              'Sort order. Each entry is an object with field name as key and "asc"/"desc" as value.',
            ),
          calculate: z
            .looseObject({})
            .optional()
            .describe(
              'Single aggregate expression that returns a scalar value (e.g. { "$sum": "$amount" })',
            ),
          limit: z.number().optional().describe('Maximum number of rows to return'),
          offset: z.number().optional().describe('Number of rows to skip (for pagination)'),
          options: z
            .object({
              splits: z.enum(['inline', 'grouped', 'all']).optional(),
            })
            .optional()
            .describe(
              'Additional options. Use { "splits": "inline" | "grouped" | "all" } to control split transaction handling.',
            ),
        }),
      ),
    },

    handler: async (params) => {
      const query = params;
      const res = await client.runQuery(query);

      if (!res.ok) return err(res.error);

      const data = res.data;

      // Scalar result (from calculate)
      if (typeof data === 'number') {
        return ok(formatAmount(data, currencySymbol));
      }

      // Array result
      if (Array.isArray(data)) {
        if (data.length === 0) {
          return ok('Query returned 0 rows.');
        }

        // Build table from first row's keys
        const firstRow = data[0] as Record<string, unknown>;
        const headers = Object.keys(firstRow);

        const rows = data.map((row) => {
          const r = row as Record<string, unknown>;
          return headers.map((h) => {
            const val = r[h];
            if (typeof val === 'number' && isAmountField(h)) {
              return formatAmount(val, currencySymbol);
            }
            if (val == null) return '';
            return typeof val === 'object'
              ? JSON.stringify(val)
              : String(val as string | number | boolean);
          });
        });

        // Determine alignments: right-align amount fields
        const alignments = headers.map((h) =>
          isAmountField(h) ? ('right' as const) : ('left' as const),
        );

        const table = formatMarkdownTable(headers, rows, alignments);
        return ok(`${data.length} rows\n\n${table}`);
      }

      // Fallback for unexpected shapes
      return ok(JSON.stringify(data, null, 2));
    },
  };
}
