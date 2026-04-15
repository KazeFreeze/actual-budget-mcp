import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { ActualClient } from './client.js';
import { formatAmount, formatMarkdownTable } from './format.js';

const RESOURCES = [
  {
    uri: 'actual://accounts',
    name: 'Accounts',
    description: 'All budget accounts with their types and current balances.',
    mimeType: 'text/markdown',
  },
  {
    uri: 'actual://categories',
    name: 'Categories',
    description: 'Full category tree including groups and individual categories.',
    mimeType: 'text/markdown',
  },
  {
    uri: 'actual://payees',
    name: 'Payees',
    description: 'All payees used in transactions.',
    mimeType: 'text/markdown',
  },
  {
    uri: 'actual://budget-settings',
    name: 'Budget Settings',
    description: 'Budget configuration including currency format.',
    mimeType: 'text/markdown',
  },
];

async function readAccounts(client: ActualClient, currencySymbol: string): Promise<string> {
  const accountsResult = await client.getAccounts();
  if (!accountsResult.ok) throw new Error(`Failed to fetch accounts: ${accountsResult.error}`);

  const accounts = accountsResult.data;
  const rows: string[][] = [];

  for (const account of accounts) {
    const balanceResult = await client.getAccountBalance(account.id);
    const balance = balanceResult.ok ? formatAmount(balanceResult.data, currencySymbol) : 'N/A';
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
  const result = await client.getCategoryGroups();
  if (!result.ok) throw new Error(`Failed to fetch category groups: ${result.error}`);

  const lines: string[] = ['# Categories'];

  for (const group of result.data) {
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
  const result = await client.getPayees();
  if (!result.ok) throw new Error(`Failed to fetch payees: ${result.error}`);

  const regularPayees = result.data.filter((p) => !p.transfer_acct);
  const rows = regularPayees.map((p) => [p.name]);

  const table = formatMarkdownTable(['Payee'], rows, ['left']);
  return `# Payees\n\n${table}`;
}

function readBudgetSettings(currencySymbol: string): string {
  return `# Budget Settings\n\n- **Currency Symbol:** ${currencySymbol}`;
}

// eslint-disable-next-line @typescript-eslint/no-deprecated
export function setupResources(server: Server, client: ActualClient, currencySymbol: string): void {
  server.setRequestHandler(ListResourcesRequestSchema, () => {
    return { resources: RESOURCES };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    let text: string;

    switch (uri) {
      case 'actual://accounts':
        text = await readAccounts(client, currencySymbol);
        break;
      case 'actual://categories':
        text = await readCategories(client);
        break;
      case 'actual://payees':
        text = await readPayees(client);
        break;
      case 'actual://budget-settings':
        text = readBudgetSettings(currencySymbol);
        break;
      default:
        throw new Error(`Unknown resource URI: ${uri}`);
    }

    return {
      contents: [
        {
          uri,
          mimeType: 'text/markdown',
          text,
        },
      ],
    };
  });
}
