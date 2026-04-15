import type { ActualClient } from '../client.js';
import {
  formatAmount,
  formatMarkdownTable,
  formatKeyValue,
  formatTransactionTable,
  buildNameMap,
  resolveName,
} from '../format.js';

// --- Types ---

interface ToolContent {
  type: 'text';
  text: string;
}

interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
}

interface ToolDefinition {
  schema: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  };
  handler: (params: Record<string, unknown>) => Promise<ToolResult>;
}

// --- Helpers ---

function ok(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

function err(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

function str(params: Record<string, unknown>, key: string): string | undefined {
  const v = params[key];
  return typeof v === 'string' ? v : undefined;
}

function num(params: Record<string, unknown>, key: string): number | undefined {
  const v = params[key];
  return typeof v === 'number' ? v : undefined;
}

function bool(params: Record<string, unknown>, key: string): boolean | undefined {
  const v = params[key];
  return typeof v === 'boolean' ? v : undefined;
}

// --- Factory ---

export function createCrudTools(client: ActualClient, currencySymbol: string): ToolDefinition[] {
  return [
    // 1. get-accounts
    {
      schema: {
        name: 'get-accounts',
        description: 'List all budget accounts with their current balances. Use this to see an overview of all accounts.',
        inputSchema: { type: 'object', properties: {}, required: [] },
      },
      handler: async () => {
        const res = await client.getAccounts();
        if (!res.ok) return err(res.error);

        const accounts = res.data;
        const balances = await Promise.all(
          accounts.map((a) => client.getAccountBalance(a.id)),
        );

        const headers = ['Name', 'Balance', 'Off Budget', 'Closed'];
        const rows = accounts.map((a, i) => {
          const bal = balances[i];
          const balanceStr = bal.ok ? formatAmount(bal.data, currencySymbol) : 'N/A';
          return [a.name, balanceStr, a.offbudget ? 'Yes' : 'No', a.closed ? 'Yes' : 'No'];
        });

        return ok(formatMarkdownTable(headers, rows, ['left', 'right', 'left', 'left']));
      },
    },

    // 2. get-transactions
    {
      schema: {
        name: 'get-transactions',
        description: 'Query transactions for an account with optional date filters. Returns a formatted transaction list.',
        inputSchema: {
          type: 'object',
          properties: {
            account_id: { type: 'string', description: 'Account ID to query transactions for' },
            since_date: { type: 'string', description: 'Start date (YYYY-MM-DD). Defaults to 30 days ago.' },
            until_date: { type: 'string', description: 'End date (YYYY-MM-DD)' },
          },
          required: ['account_id'],
        },
      },
      handler: async (params) => {
        const accountId = str(params, 'account_id');
        if (!accountId) return err('Missing required parameter: account_id');

        const sinceDate = str(params, 'since_date') ?? new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
        const untilDate = str(params, 'until_date');

        const res = await client.getTransactions(accountId, sinceDate, untilDate);
        if (!res.ok) return err(res.error);

        if (res.data.length === 0) return ok('No transactions found for the given filters.');

        // Build name maps for payees and categories
        const [payeesRes, categoriesRes] = await Promise.all([
          client.getPayees(),
          client.getCategories(),
        ]);
        const payeeMap = payeesRes.ok ? buildNameMap(payeesRes.data) : buildNameMap([]);
        const categoryMap = categoriesRes.ok ? buildNameMap(categoriesRes.data) : buildNameMap([]);

        const txRows = res.data.map((tx) => ({
          date: tx.date,
          payee: tx.payee_name || resolveName(tx.payee, payeeMap),
          category: resolveName(tx.category, categoryMap),
          amount: tx.amount,
          notes: tx.notes || '',
          subtransactions: (tx.subtransactions || []).map((sub: Record<string, unknown>) => ({
            payee: (sub.payee_name as string) || resolveName(sub.payee as string, payeeMap),
            category: resolveName(sub.category as string, categoryMap),
            amount: sub.amount as number,
            notes: (sub.notes as string) || '',
          })),
        }));

        return ok(formatTransactionTable(txRows, currencySymbol));
      },
    },

    // 3. create-transaction
    {
      schema: {
        name: 'create-transaction',
        description: 'Create a new transaction in an account. Supports split transactions via subtransactions array.',
        inputSchema: {
          type: 'object',
          properties: {
            account_id: { type: 'string', description: 'Account ID' },
            date: { type: 'string', description: 'Transaction date (YYYY-MM-DD)' },
            amount: { type: 'number', description: 'Amount in cents (negative for expenses)' },
            payee_name: { type: 'string', description: 'Payee name' },
            category_id: { type: 'string', description: 'Category ID' },
            notes: { type: 'string', description: 'Optional notes' },
            subtransactions: {
              type: 'array',
              description: 'Split transaction items',
              items: {
                type: 'object',
                properties: {
                  amount: { type: 'number' },
                  category_id: { type: 'string' },
                  payee_name: { type: 'string' },
                  notes: { type: 'string' },
                },
              },
            },
          },
          required: ['account_id', 'date', 'amount'],
        },
      },
      handler: async (params) => {
        const accountId = str(params, 'account_id');
        if (!accountId) return err('Missing required parameter: account_id');

        const transaction: Record<string, unknown> = {
          date: str(params, 'date'),
          amount: num(params, 'amount'),
          payee_name: str(params, 'payee_name'),
          category_id: str(params, 'category_id'),
          notes: str(params, 'notes'),
        };

        if (params.subtransactions && Array.isArray(params.subtransactions)) {
          transaction.subtransactions = params.subtransactions;
        }

        const res = await client.createTransaction(accountId, transaction, undefined);
        if (!res.ok) return err(res.error);

        return ok(formatKeyValue('Transaction Created', {
          ID: res.data,
          Date: String(transaction.date || ''),
          Amount: formatAmount(transaction.amount as number, currencySymbol),
          Payee: String(transaction.payee_name || ''),
        }));
      },
    },

    // 4. update-transaction
    {
      schema: {
        name: 'update-transaction',
        description: 'Update an existing transaction by ID. Pass only the fields you want to change.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Transaction ID' },
            date: { type: 'string' },
            amount: { type: 'number' },
            payee_name: { type: 'string' },
            category_id: { type: 'string' },
            notes: { type: 'string' },
          },
          required: ['id'],
        },
      },
      handler: async (params) => {
        const id = str(params, 'id');
        if (!id) return err('Missing required parameter: id');

        const fields: Record<string, unknown> = {};
        for (const key of ['date', 'amount', 'payee_name', 'category_id', 'notes']) {
          if (params[key] !== undefined) fields[key] = params[key];
        }

        const res = await client.updateTransaction(id, fields);
        if (!res.ok) return err(res.error);

        return ok(formatKeyValue('Transaction Updated', { ID: id, ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, String(v)])) }));
      },
    },

    // 5. delete-transaction
    {
      schema: {
        name: 'delete-transaction',
        description: 'Delete a transaction by ID.',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string', description: 'Transaction ID' } },
          required: ['id'],
        },
      },
      handler: async (params) => {
        const id = str(params, 'id');
        if (!id) return err('Missing required parameter: id');

        const res = await client.deleteTransaction(id);
        if (!res.ok) return err(res.error);

        return ok(formatKeyValue('Transaction Deleted', { ID: id }));
      },
    },

    // 6. get-categories
    {
      schema: {
        name: 'get-categories',
        description: 'List all category groups and their categories.',
        inputSchema: { type: 'object', properties: {}, required: [] },
      },
      handler: async () => {
        const res = await client.getCategoryGroups();
        if (!res.ok) return err(res.error);

        const headers = ['Group', 'Category', 'ID'];
        const rows: string[][] = [];
        for (const group of res.data) {
          for (const cat of group.categories || []) {
            rows.push([group.name, cat.name, cat.id]);
          }
        }

        if (rows.length === 0) return ok('No categories found.');
        return ok(formatMarkdownTable(headers, rows));
      },
    },

    // 7. manage-category
    {
      schema: {
        name: 'manage-category',
        description: 'Create, update, or delete categories and category groups. Use the action parameter to specify the operation.',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['create', 'update', 'delete', 'create_group', 'update_group', 'delete_group'] },
            id: { type: 'string', description: 'Category or group ID (for update/delete)' },
            name: { type: 'string', description: 'Name (for create/update)' },
            group_id: { type: 'string', description: 'Group ID (required for category create)' },
            is_income: { type: 'boolean' },
            transfer_category_id: { type: 'string', description: 'Category to transfer existing transactions to (for delete)' },
          },
          required: ['action'],
        },
      },
      handler: async (params) => {
        const action = str(params, 'action');

        switch (action) {
          case 'create': {
            const name = str(params, 'name');
            const groupId = str(params, 'group_id');
            if (!name || !groupId) return err('Missing required fields: name and group_id are required for category creation.');
            const res = await client.createCategory({ name, group_id: groupId, is_income: bool(params, 'is_income') });
            if (!res.ok) return err(res.error);
            return ok(formatKeyValue('Category Created', { ID: res.data, Name: name, Group: groupId }));
          }
          case 'update': {
            const id = str(params, 'id');
            if (!id) return err('Missing required field: id');
            const fields: Record<string, unknown> = {};
            if (params.name !== undefined) fields.name = params.name;
            if (params.is_income !== undefined) fields.is_income = params.is_income;
            const res = await client.updateCategory(id, fields);
            if (!res.ok) return err(res.error);
            return ok(formatKeyValue('Category Updated', { ID: id }));
          }
          case 'delete': {
            const id = str(params, 'id');
            if (!id) return err('Missing required field: id');
            const res = await client.deleteCategory(id, str(params, 'transfer_category_id'));
            if (!res.ok) return err(res.error);
            return ok(formatKeyValue('Category Deleted', { ID: id }));
          }
          case 'create_group': {
            const name = str(params, 'name');
            if (!name) return err('Missing required field: name');
            const res = await client.createCategoryGroup({ name, is_income: bool(params, 'is_income') });
            if (!res.ok) return err(res.error);
            return ok(formatKeyValue('Category Group Created', { ID: res.data, Name: name }));
          }
          case 'update_group': {
            const id = str(params, 'id');
            if (!id) return err('Missing required field: id');
            const fields: Record<string, unknown> = {};
            if (params.name !== undefined) fields.name = params.name;
            if (params.is_income !== undefined) fields.is_income = params.is_income;
            const res = await client.updateCategoryGroup(id, fields);
            if (!res.ok) return err(res.error);
            return ok(formatKeyValue('Category Group Updated', { ID: id }));
          }
          case 'delete_group': {
            const id = str(params, 'id');
            if (!id) return err('Missing required field: id');
            const res = await client.deleteCategoryGroup(id, str(params, 'transfer_category_id'));
            if (!res.ok) return err(res.error);
            return ok(formatKeyValue('Category Group Deleted', { ID: id }));
          }
          default:
            return err(`Unknown action: ${action}. Valid actions: create, update, delete, create_group, update_group, delete_group`);
        }
      },
    },

    // 8. get-payees
    {
      schema: {
        name: 'get-payees',
        description: 'List all payees.',
        inputSchema: { type: 'object', properties: {}, required: [] },
      },
      handler: async () => {
        const res = await client.getPayees();
        if (!res.ok) return err(res.error);

        if (res.data.length === 0) return ok('No payees found.');

        const headers = ['Name', 'ID'];
        const rows = res.data.map((p) => [p.name, p.id]);
        return ok(formatMarkdownTable(headers, rows));
      },
    },

    // 9. manage-payee
    {
      schema: {
        name: 'manage-payee',
        description: 'Create, update, delete, or merge payees.',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['create', 'update', 'delete', 'merge'] },
            id: { type: 'string', description: 'Payee ID (for update/delete)' },
            name: { type: 'string', description: 'Payee name (for create/update)' },
            target_id: { type: 'string', description: 'Target payee ID (for merge)' },
            merge_ids: { type: 'array', items: { type: 'string' }, description: 'Payee IDs to merge into target (for merge)' },
          },
          required: ['action'],
        },
      },
      handler: async (params) => {
        const action = str(params, 'action');

        switch (action) {
          case 'create': {
            const name = str(params, 'name');
            if (!name) return err('Missing required field: name');
            const res = await client.createPayee({ name });
            if (!res.ok) return err(res.error);
            return ok(formatKeyValue('Payee Created', { ID: res.data, Name: name }));
          }
          case 'update': {
            const id = str(params, 'id');
            if (!id) return err('Missing required field: id');
            const fields: Record<string, unknown> = {};
            if (params.name !== undefined) fields.name = params.name;
            const res = await client.updatePayee(id, fields);
            if (!res.ok) return err(res.error);
            return ok(formatKeyValue('Payee Updated', { ID: id }));
          }
          case 'delete': {
            const id = str(params, 'id');
            if (!id) return err('Missing required field: id');
            const res = await client.deletePayee(id);
            if (!res.ok) return err(res.error);
            return ok(formatKeyValue('Payee Deleted', { ID: id }));
          }
          case 'merge': {
            const targetId = str(params, 'target_id');
            const mergeIds = params.merge_ids;
            if (!targetId || !Array.isArray(mergeIds)) return err('Missing required fields: target_id and merge_ids');
            const res = await client.mergePayees(targetId, mergeIds as string[]);
            if (!res.ok) return err(res.error);
            return ok(formatKeyValue('Payees Merged', { Target: targetId, 'Merged Count': String(mergeIds.length) }));
          }
          default:
            return err(`Unknown action: ${action}. Valid actions: create, update, delete, merge`);
        }
      },
    },

    // 10. get-budget-month
    {
      schema: {
        name: 'get-budget-month',
        description: 'Get budget data for a specific month, including category budgeted/spent/balance amounts.',
        inputSchema: {
          type: 'object',
          properties: {
            month: { type: 'string', description: 'Month in YYYY-MM format' },
          },
          required: ['month'],
        },
      },
      handler: async (params) => {
        const month = str(params, 'month');
        if (!month) return err('Missing required parameter: month');

        const res = await client.getBudgetMonth(month);
        if (!res.ok) return err(res.error);

        const budget = res.data;
        const lines: string[] = [`## Budget: ${budget.month}`];

        if (budget.toBudget !== undefined) lines.push(`**To Budget:** ${formatAmount(budget.toBudget, currencySymbol)}`);
        if (budget.totalIncome !== undefined) lines.push(`**Total Income:** ${formatAmount(budget.totalIncome, currencySymbol)}`);
        if (budget.totalSpent !== undefined) lines.push(`**Total Spent:** ${formatAmount(budget.totalSpent, currencySymbol)}`);
        if (budget.totalBalance !== undefined) lines.push(`**Total Balance:** ${formatAmount(budget.totalBalance, currencySymbol)}`);

        if (budget.categoryGroups && budget.categoryGroups.length > 0) {
          lines.push('');
          const headers = ['Group', 'Category', 'Budgeted', 'Spent', 'Balance'];
          const rows: string[][] = [];
          for (const group of budget.categoryGroups) {
            for (const cat of group.categories || []) {
              rows.push([
                group.name,
                cat.name,
                formatAmount(cat.budgeted || 0, currencySymbol),
                formatAmount(cat.spent || 0, currencySymbol),
                formatAmount(cat.balance || 0, currencySymbol),
              ]);
            }
          }
          if (rows.length > 0) {
            lines.push(formatMarkdownTable(headers, rows, ['left', 'left', 'right', 'right', 'right']));
          }
        }

        return ok(lines.join('\n'));
      },
    },

    // 11. set-budget-amount
    {
      schema: {
        name: 'set-budget-amount',
        description: 'Set the budgeted amount for a category in a specific month.',
        inputSchema: {
          type: 'object',
          properties: {
            month: { type: 'string', description: 'Month in YYYY-MM format' },
            category_id: { type: 'string', description: 'Category ID' },
            amount: { type: 'number', description: 'Budget amount in cents' },
            carryover: { type: 'boolean', description: 'Enable rollover for this category' },
          },
          required: ['month', 'category_id', 'amount'],
        },
      },
      handler: async (params) => {
        const month = str(params, 'month');
        const categoryId = str(params, 'category_id');
        const amount = num(params, 'amount');
        if (!month || !categoryId || amount === undefined) return err('Missing required parameters: month, category_id, amount');

        const res = await client.setBudgetAmount(month, categoryId, amount, bool(params, 'carryover'));
        if (!res.ok) return err(res.error);

        return ok(formatKeyValue('Budget Amount Set', {
          Month: month,
          Category: categoryId,
          Amount: formatAmount(amount, currencySymbol),
        }));
      },
    },

    // 12. transfer-budget
    {
      schema: {
        name: 'transfer-budget',
        description: 'Move money between budget categories within a month.',
        inputSchema: {
          type: 'object',
          properties: {
            month: { type: 'string', description: 'Month in YYYY-MM format' },
            from_category_id: { type: 'string', description: 'Source category ID' },
            to_category_id: { type: 'string', description: 'Destination category ID' },
            amount: { type: 'number', description: 'Amount in cents to transfer' },
          },
          required: ['month', 'from_category_id', 'to_category_id', 'amount'],
        },
      },
      handler: async (params) => {
        const month = str(params, 'month');
        const fromId = str(params, 'from_category_id');
        const toId = str(params, 'to_category_id');
        const amount = num(params, 'amount');
        if (!month || !fromId || !toId || amount === undefined) return err('Missing required parameters');

        const res = await client.transferBudget(month, fromId, toId, amount);
        if (!res.ok) return err(res.error);

        return ok(formatKeyValue('Budget Transfer Complete', {
          Month: month,
          From: fromId,
          To: toId,
          Amount: formatAmount(amount, currencySymbol),
        }));
      },
    },

    // 13. get-schedules
    {
      schema: {
        name: 'get-schedules',
        description: 'List all scheduled transactions.',
        inputSchema: { type: 'object', properties: {}, required: [] },
      },
      handler: async () => {
        const res = await client.getSchedules();
        if (!res.ok) return err(res.error);

        if (res.data.length === 0) return ok('No schedules found.');

        const headers = ['ID', 'Name', 'Next Date', 'Completed'];
        const rows = res.data.map((s) => [
          s.id,
          s.name || '',
          s.next_date || '',
          s.completed ? 'Yes' : 'No',
        ]);
        return ok(formatMarkdownTable(headers, rows));
      },
    },

    // 14. manage-schedule
    {
      schema: {
        name: 'manage-schedule',
        description: 'Create, update, or delete scheduled transactions.',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['create', 'update', 'delete'] },
            id: { type: 'string', description: 'Schedule ID (for update/delete)' },
            schedule: { type: 'object', description: 'Schedule data (for create/update)' },
          },
          required: ['action'],
        },
      },
      handler: async (params) => {
        const action = str(params, 'action');

        switch (action) {
          case 'create': {
            const schedule = params.schedule as Record<string, unknown> | undefined;
            if (!schedule) return err('Missing required field: schedule');
            const res = await client.createSchedule(schedule);
            if (!res.ok) return err(res.error);
            return ok(formatKeyValue('Schedule Created', { ID: res.data }));
          }
          case 'update': {
            const id = str(params, 'id');
            const schedule = params.schedule as Record<string, unknown> | undefined;
            if (!id) return err('Missing required field: id');
            if (!schedule) return err('Missing required field: schedule');
            const res = await client.updateSchedule(id, schedule);
            if (!res.ok) return err(res.error);
            return ok(formatKeyValue('Schedule Updated', { ID: id }));
          }
          case 'delete': {
            const id = str(params, 'id');
            if (!id) return err('Missing required field: id');
            const res = await client.deleteSchedule(id);
            if (!res.ok) return err(res.error);
            return ok(formatKeyValue('Schedule Deleted', { ID: id }));
          }
          default:
            return err(`Unknown action: ${action}. Valid actions: create, update, delete`);
        }
      },
    },

    // 15. get-rules
    {
      schema: {
        name: 'get-rules',
        description: 'List all transaction rules.',
        inputSchema: { type: 'object', properties: {}, required: [] },
      },
      handler: async () => {
        const res = await client.getRules();
        if (!res.ok) return err(res.error);

        if (res.data.length === 0) return ok('No rules found.');

        const headers = ['ID', 'Stage', 'Conditions Op'];
        const rows = res.data.map((r) => [
          r.id,
          r.stage || '',
          r.conditionsOp || '',
        ]);
        return ok(formatMarkdownTable(headers, rows));
      },
    },

    // 16. manage-rule
    {
      schema: {
        name: 'manage-rule',
        description: 'Create, update, or delete transaction rules.',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['create', 'update', 'delete'] },
            id: { type: 'string', description: 'Rule ID (for update/delete)' },
            rule: { type: 'object', description: 'Rule data (for create/update)' },
          },
          required: ['action'],
        },
      },
      handler: async (params) => {
        const action = str(params, 'action');

        switch (action) {
          case 'create': {
            const rule = params.rule as Record<string, unknown> | undefined;
            if (!rule) return err('Missing required field: rule');
            const res = await client.createRule(rule);
            if (!res.ok) return err(res.error);
            return ok(formatKeyValue('Rule Created', { ID: res.data.id }));
          }
          case 'update': {
            const id = str(params, 'id');
            const rule = params.rule as Record<string, unknown> | undefined;
            if (!id) return err('Missing required field: id');
            if (!rule) return err('Missing required field: rule');
            const res = await client.updateRule(id, rule);
            if (!res.ok) return err(res.error);
            return ok(formatKeyValue('Rule Updated', { ID: id }));
          }
          case 'delete': {
            const id = str(params, 'id');
            if (!id) return err('Missing required field: id');
            const res = await client.deleteRule(id);
            if (!res.ok) return err(res.error);
            return ok(formatKeyValue('Rule Deleted', { ID: id }));
          }
          default:
            return err(`Unknown action: ${action}. Valid actions: create, update, delete`);
        }
      },
    },

    // 17. get-notes
    {
      schema: {
        name: 'get-notes',
        description: 'Get notes for a category, account, or budget month.',
        inputSchema: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['category', 'account', 'budgetmonth'], description: 'Entity type' },
            id: { type: 'string', description: 'Entity ID' },
          },
          required: ['type', 'id'],
        },
      },
      handler: async (params) => {
        const type = str(params, 'type') as 'category' | 'account' | 'budgetmonth' | undefined;
        const id = str(params, 'id');
        if (!type || !id) return err('Missing required parameters: type and id');

        const res = await client.getNotes(type, id);
        if (!res.ok) return err(res.error);

        if (!res.data) return ok('No notes found.');
        return ok(formatKeyValue('Notes', { Type: type, ID: id, Content: res.data }));
      },
    },

    // 18. set-notes
    {
      schema: {
        name: 'set-notes',
        description: 'Set or update notes for a category, account, or budget month.',
        inputSchema: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['category', 'account', 'budgetmonth'], description: 'Entity type' },
            id: { type: 'string', description: 'Entity ID' },
            notes: { type: 'string', description: 'Note content' },
          },
          required: ['type', 'id', 'notes'],
        },
      },
      handler: async (params) => {
        const type = str(params, 'type') as 'category' | 'account' | 'budgetmonth' | undefined;
        const id = str(params, 'id');
        const notes = str(params, 'notes');
        if (!type || !id || notes === undefined) return err('Missing required parameters: type, id, and notes');

        const res = await client.setNotes(type, id, notes);
        if (!res.ok) return err(res.error);

        return ok(formatKeyValue('Notes Updated', { Type: type, ID: id }));
      },
    },

    // 19. run-bank-sync
    {
      schema: {
        name: 'run-bank-sync',
        description: 'Trigger bank sync for all accounts or a specific account.',
        inputSchema: {
          type: 'object',
          properties: {
            account_id: { type: 'string', description: 'Optional account ID to sync a specific account' },
          },
          required: [],
        },
      },
      handler: async (params) => {
        const accountId = str(params, 'account_id');
        const res = await client.runBankSync(accountId);
        if (!res.ok) return err(res.error);

        return ok(formatKeyValue('Bank Sync Complete', {
          Scope: accountId ? `Account ${accountId}` : 'All accounts',
        }));
      },
    },
  ];
}
