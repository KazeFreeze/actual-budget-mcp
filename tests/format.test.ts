import { describe, it, expect } from 'vitest';

describe('formatAmount', () => {
  it('should format positive cents to a plain formatted number', async () => {
    const { formatAmount } = await import('../src/format.js');
    expect(formatAmount(520000)).toBe('5,200.00');
  });

  it('should format negative amounts with a leading minus', async () => {
    const { formatAmount } = await import('../src/format.js');
    expect(formatAmount(-15678)).toBe('-156.78');
  });

  it('should format zero', async () => {
    const { formatAmount } = await import('../src/format.js');
    expect(formatAmount(0)).toBe('0.00');
  });

  it('should handle small amounts under a dollar', async () => {
    const { formatAmount } = await import('../src/format.js');
    expect(formatAmount(5)).toBe('0.05');
  });
});

describe('formatMarkdownTable', () => {
  it('should render headers, separator, and rows', async () => {
    const { formatMarkdownTable } = await import('../src/format.js');
    const result = formatMarkdownTable(
      ['Name', 'Amount'],
      [
        ['Groceries', '-500.00'],
        ['Rent', '-1,500.00'],
      ],
    );
    expect(result).toContain('| Name');
    expect(result).toContain('| Groceries');
    expect(result).toContain('| Rent');
    expect(result.split('\n')).toHaveLength(4);
  });

  it('should handle empty data with only header + separator', async () => {
    const { formatMarkdownTable } = await import('../src/format.js');
    const result = formatMarkdownTable(['Name'], []);
    expect(result.split('\n')).toHaveLength(2);
  });
});

describe('formatTransactionTable', () => {
  it('should render simple transactions in a table', async () => {
    const { formatTransactionTable } = await import('../src/format.js');
    const result = formatTransactionTable([
      {
        date: '2026-03-14',
        payee: 'Spotify',
        category: 'Subscriptions',
        amount: -1599,
        notes: '',
        subtransactions: [],
      },
    ]);
    expect(result).toContain('Spotify');
    expect(result).toContain('Subscriptions');
    expect(result).toContain('-15.99');
  });

  it('should render split transactions with tree characters', async () => {
    const { formatTransactionTable } = await import('../src/format.js');
    const result = formatTransactionTable([
      {
        date: '2026-03-15',
        payee: 'Costco',
        category: '',
        amount: -15678,
        notes: 'Weekly',
        subtransactions: [
          { payee: 'Costco', category: 'Groceries', amount: -12000, notes: '' },
          { payee: 'Gift Shop', category: 'Gifts', amount: -3678, notes: 'Birthday' },
        ],
      },
    ]);
    expect(result).toContain('├─');
    expect(result).toContain('└─');
    expect(result).toContain('Groceries');
    expect(result).toContain('Gifts');
    expect(result).toContain('-120.00');
    expect(result).toContain('-36.78');
  });
});

describe('formatKeyValue', () => {
  it('should format title and fields as markdown list', async () => {
    const { formatKeyValue } = await import('../src/format.js');
    const result = formatKeyValue('Transaction Created', { ID: 'abc-123', Payee: 'Costco' });
    expect(result).toContain('**Transaction Created**');
    expect(result).toContain('- **ID:** abc-123');
    expect(result).toContain('- **Payee:** Costco');
  });
});

describe('buildNameMap and resolveName', () => {
  it('should map IDs to names', async () => {
    const { buildNameMap, resolveName } = await import('../src/format.js');
    const map = buildNameMap([
      { id: 'cat-1', name: 'Groceries' },
      { id: 'cat-2', name: 'Rent' },
    ]);
    expect(resolveName('cat-1', map)).toBe('Groceries');
    expect(resolveName('cat-2', map)).toBe('Rent');
  });

  it('should return ID if name not found', async () => {
    const { buildNameMap, resolveName } = await import('../src/format.js');
    const map = buildNameMap([]);
    expect(resolveName('unknown-id', map)).toBe('unknown-id');
  });

  it('should return empty string for null/undefined', async () => {
    const { buildNameMap, resolveName } = await import('../src/format.js');
    const map = buildNameMap([]);
    expect(resolveName(null, map)).toBe('');
    expect(resolveName(undefined, map)).toBe('');
  });
});
