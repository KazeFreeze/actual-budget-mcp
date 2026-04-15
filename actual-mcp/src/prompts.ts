import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListPromptsRequestSchema, GetPromptRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const PROMPTS = [
  {
    name: 'financial-health-check',
    description:
      'Guided financial health analysis: savings rate, spending patterns, budget adherence, and actionable recommendations.',
  },
  {
    name: 'budget-review',
    description:
      'Monthly budget review: overspent/underspent categories, top spending areas, and suggestions for next month.',
    arguments: [
      {
        name: 'month',
        description: 'Month to review in YYYY-MM format. Defaults to the current month.',
        required: false,
      },
    ],
  },
  {
    name: 'spending-deep-dive',
    description:
      'Deep dive into spending for a specific category or time period with trend analysis and comparisons.',
    arguments: [
      {
        name: 'category',
        description: 'Category name to analyze (e.g. "Groceries", "Dining Out").',
        required: false,
      },
      {
        name: 'period',
        description: 'Time period to analyze (e.g. "2024-Q1", "last 3 months", "2024-06").',
        required: false,
      },
    ],
  },
  {
    name: 'actualql-reference',
    description:
      'Full ActualQL query language reference with syntax, operators, examples, and best practices.',
  },
];

function getPromptMessages(
  name: string,
  args: Record<string, string> | undefined,
): { messages: Array<{ role: 'user'; content: { type: 'text'; text: string } }> } {
  switch (name) {
    case 'financial-health-check':
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Please perform a comprehensive financial health check on my budget. Follow these steps:

1. **Net Worth Snapshot** -- Use the net-worth-snapshot tool to see all account balances and total net worth.

2. **Monthly Summary** -- Use monthly-financial-summary for the current month to get income, expenses, net, and savings rate.

3. **Savings Rate Assessment** -- Evaluate the savings rate:
   - Below 10%: Needs immediate attention
   - 10-20%: Adequate but room for improvement
   - 20-30%: Good
   - Above 30%: Excellent

4. **Spending Patterns** -- Use spending-analysis with group_by "category" for the last 30 days. Identify the top 5 spending categories.

5. **Budget Adherence** -- Use budget-variance-report for the current month. Flag any categories that are overspent.

6. **Trend Check** -- Use trend-analysis for the last 6 months to spot any concerning upward trends in spending.

7. **Recommendations** -- Based on all findings, provide 3-5 specific, actionable recommendations to improve financial health. Prioritize by potential impact.

Present the analysis in a clear, structured format with sections for each area. Use the actual numbers from the budget data.`,
            },
          },
        ],
      };

    case 'budget-review': {
      const month = args?.month ?? 'the current month';
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Please perform a detailed budget review for ${month}. Follow these steps:

1. **Budget Overview** -- Use get-budget-month for ${month} to see all budgeted amounts, spending, and balances.

2. **Variance Analysis** -- Use budget-variance-report for ${month}. Identify:
   - Categories that are overspent (negative balance)
   - Categories significantly underspent (more than 50% remaining)
   - Categories on track

3. **Top Spending** -- Use monthly-financial-summary for ${month}. List the top 5 categories by spending amount.

4. **Income vs Expenses** -- Calculate the overall income-to-expense ratio for the month.

5. **Category-by-Category Notes** -- For each overspent category:
   - How much over budget?
   - Is this a recurring pattern? (Check trend-analysis if needed)
   - Suggested adjustment for next month

6. **Suggestions for Next Month** -- Based on the review:
   - Which budget amounts should be adjusted?
   - Are there categories where money could be reallocated?
   - Any categories that should be added or removed?

Present findings as a structured report with clear section headers.`,
            },
          },
        ],
      };
    }

    case 'spending-deep-dive': {
      const category = args?.category ?? 'all categories';
      const period = args?.period ?? 'the last 3 months';
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Please perform a deep dive analysis on spending for ${category} over ${period}. Follow these steps:

1. **Current Spending** -- Use spending-analysis filtered to ${category} for the specified period. Show total amount and transaction count.

2. **Transaction Details** -- Use run-query to fetch individual transactions for ${category} in this period. Look for:
   - Largest single transactions
   - Most frequent payees
   - Any unusual or unexpected charges

3. **Trend Over Time** -- Use trend-analysis focused on ${category}. Show month-over-month changes.
   - Is spending increasing, decreasing, or stable?
   - Are there seasonal patterns?
   - Flag any anomalous months

4. **Comparison** -- Use spending-analysis with comparison to show how this period compares to the prior equivalent period (e.g., this month vs last month, this quarter vs last quarter).

5. **Payee Breakdown** -- Use spending-analysis grouped by payee, filtered to ${category}. Show which payees account for the most spending.

6. **Insights & Actions** -- Based on the analysis:
   - What is driving the spending in this category?
   - Are there opportunities to reduce spending?
   - Should the budget for this category be adjusted?
   - Are there any subscriptions or recurring charges to review?

Present findings with clear data tables and specific actionable insights.`,
            },
          },
        ],
      };
    }

    case 'actualql-reference':
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Here is the complete ActualQL query language reference for querying Actual Budget data via the run-query tool.

## Tables

| Table | Description |
|-------|-------------|
| transactions | All transactions (income, expense, transfer) |
| accounts | Budget accounts |
| categories | Spending categories |
| payees | Payee entities |
| schedules | Scheduled/recurring transactions |

## Dot-Notation Joins

Access related entity fields using dot notation on the transactions table:
- \`category.name\` -- name of the category on a transaction
- \`payee.name\` -- name of the payee on a transaction
- \`account.name\` -- name of the account on a transaction

## Filter Operators

Use inside a \`filter\` object:

| Operator | Description | Example |
|----------|-------------|---------|
| $eq | Equals | \`{ "amount": { "$eq": -5000 } }\` |
| $ne | Not equals | \`{ "cleared": { "$ne": true } }\` |
| $lt | Less than | \`{ "amount": { "$lt": 0 } }\` |
| $lte | Less than or equal | \`{ "amount": { "$lte": -1000 } }\` |
| $gt | Greater than | \`{ "amount": { "$gt": 0 } }\` |
| $gte | Greater than or equal | \`{ "date": { "$gte": "2024-01-01" } }\` |
| $oneof | Value in list | \`{ "category.name": { "$oneof": ["Groceries", "Dining"] } }\` |
| $regex | Regex match | \`{ "notes": { "$regex": "coffee" } }\` |
| $like | SQL LIKE pattern | \`{ "notes": { "$like": "%coffee%" } }\` |
| $notlike | SQL NOT LIKE | \`{ "notes": { "$notlike": "%transfer%" } }\` |

## Logical Operators

| Operator | Description | Example |
|----------|-------------|---------|
| $and | All conditions must match | \`{ "$and": [{ "amount": { "$lt": 0 } }, { "cleared": true }] }\` |
| $or | Any condition matches | \`{ "$or": [{ "category.name": "Rent" }, { "category.name": "Utilities" }] }\` |

## Aggregates

Use in \`select\` with \`groupBy\`:

| Function | Description | Example |
|----------|-------------|---------|
| $sum | Sum values | \`{ "total": { "$sum": "$amount" } }\` |
| $count | Count rows | \`{ "count": { "$count": "$id" } }\` |

## Date Transforms

Extract date parts in \`select\` or \`groupBy\`:
- \`{ "month": { "$month": "$date" } }\` -- extract month
- \`{ "year": { "$year": "$date" } }\` -- extract year

## Ordering & Pagination

- \`orderBy\`: \`[{ "total": "desc" }]\`
- \`limit\`: maximum rows to return
- \`offset\`: rows to skip

## Split Transaction Options

Control split transaction handling via \`options.splits\`:
- \`"inline"\` (default) -- parent rows only
- \`"grouped"\` -- parent + children together
- \`"all"\` -- every row individually

## Calculate (Scalar)

Return a single aggregate without grouping:
\`\`\`json
{ "table": "transactions", "calculate": { "$sum": "$amount" } }
\`\`\`

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

**Top 10 payees by spend:**
\`\`\`json
{
  "table": "transactions",
  "filter": { "amount": { "$lt": 0 } },
  "groupBy": ["payee.name"],
  "select": ["payee.name", { "total": { "$sum": "$amount" } }],
  "orderBy": [{ "total": "asc" }],
  "limit": 10
}
\`\`\`

**Transactions for a specific category and date range:**
\`\`\`json
{
  "table": "transactions",
  "filter": {
    "$and": [
      { "category.name": { "$eq": "Groceries" } },
      { "date": { "$gte": "2024-01-01" } },
      { "date": { "$lte": "2024-01-31" } }
    ]
  },
  "select": ["date", "payee.name", "amount", "notes"],
  "orderBy": [{ "date": "desc" }]
}
\`\`\`

Use this reference to construct accurate ActualQL queries with the run-query tool. Amounts are stored in cents (e.g., -5000 = -$50.00). Expenses are negative, income is positive.`,
            },
          },
        ],
      };

    default:
      throw new Error(`Unknown prompt: ${name}`);
  }
}

export function setupPrompts(server: Server): void {
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: PROMPTS,
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return getPromptMessages(name, args);
  });
}
