import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ActualClient } from './client/actual-client.js';
import { formatAmount, formatMarkdownTable } from './format.js';

async function readAccounts(client: ActualClient): Promise<string> {
  const accounts = await client.getAccounts();
  const rows: string[][] = [];

  for (const account of accounts) {
    let balance: string;
    try {
      const value = await client.getAccountBalance(account.id);
      balance = formatAmount(value);
    } catch {
      balance = 'N/A';
    }
    const type = account.offbudget ? 'Off Budget' : 'On Budget';
    const status = account.closed ? 'Closed' : 'Open';
    rows.push([account.name, type, status, balance]);
  }

  const table = formatMarkdownTable(['Account', 'Type', 'Status', 'Balance'], rows, [
    'left',
    'left',
    'left',
    'right',
  ]);

  return `# Accounts\n\n${table}`;
}

async function readCategories(client: ActualClient): Promise<string> {
  const groups = await client.getCategoryGroups();
  const lines: string[] = ['# Categories'];

  for (const group of groups) {
    const groupLabel = group.is_income ? `${group.name} (Income)` : group.name;
    lines.push(`\n## ${groupLabel}`);

    if (group.categories && group.categories.length > 0) {
      const rows = group.categories.map((cat) => [cat.name]);
      const table = formatMarkdownTable(['Category'], rows, ['left']);
      lines.push(table);
    } else {
      lines.push('_No categories in this group._');
    }
  }

  return lines.join('\n');
}

async function readPayees(client: ActualClient): Promise<string> {
  const payees = await client.getPayees();
  const regularPayees = payees.filter((p) => !p.transfer_acct);
  const rows = regularPayees.map((p) => [p.name]);

  const table = formatMarkdownTable(['Payee'], rows, ['left']);
  return `# Payees\n\n${table}`;
}

export function setupResources(server: McpServer, client: ActualClient): void {
  server.registerResource(
    'accounts',
    'actual://accounts',
    {
      title: 'Accounts',
      description: 'All budget accounts with their types and current balances.',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.toString(),
          mimeType: 'text/markdown',
          text: await readAccounts(client),
        },
      ],
    }),
  );

  server.registerResource(
    'categories',
    'actual://categories',
    {
      title: 'Categories',
      description: 'Full category tree including groups and individual categories.',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.toString(),
          mimeType: 'text/markdown',
          text: await readCategories(client),
        },
      ],
    }),
  );

  server.registerResource(
    'payees',
    'actual://payees',
    {
      title: 'Payees',
      description: 'All payees used in transactions.',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.toString(),
          mimeType: 'text/markdown',
          text: await readPayees(client),
        },
      ],
    }),
  );
}
