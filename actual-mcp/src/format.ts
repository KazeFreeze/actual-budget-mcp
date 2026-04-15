export function formatAmount(amountInCents: number, currencySymbol: string): string {
  const isNegative = amountInCents < 0;
  const abs = Math.abs(amountInCents);
  const dollars = Math.floor(abs / 100);
  const cents = abs % 100;
  const formatted = `${currencySymbol}${dollars.toLocaleString('en-US')}.${cents.toString().padStart(2, '0')}`;
  return isNegative ? `-${formatted}` : formatted;
}

export function formatMarkdownTable(
  headers: string[],
  rows: string[][],
  alignments?: ('left' | 'right' | 'center')[],
): string {
  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] || '').length)),
  );

  const pad = (str: string, width: number, align?: 'left' | 'right' | 'center') => {
    if (align === 'right') return str.padStart(width);
    return str.padEnd(width);
  };

  const headerLine = `| ${headers.map((h, i) => pad(h, colWidths[i], alignments?.[i])).join(' | ')} |`;
  const separatorLine = `|${colWidths.map((w, i) => {
    const align = alignments?.[i];
    if (align === 'right') return '-'.repeat(w + 1) + ':';
    if (align === 'center') return ':' + '-'.repeat(w) + ':';
    return '-'.repeat(w + 2);
  }).join('|')}|`;

  const dataLines = rows.map(
    (row) => `| ${row.map((cell, i) => pad(cell || '', colWidths[i], alignments?.[i])).join(' | ')} |`,
  );

  return [headerLine, separatorLine, ...dataLines].join('\n');
}

interface TransactionRow {
  date: string;
  payee: string;
  category: string;
  amount: number;
  notes: string;
  subtransactions: Array<{ payee: string; category: string; amount: number; notes: string }>;
}

export function formatTransactionTable(transactions: TransactionRow[], currencySymbol: string): string {
  const headers = ['Date', 'Payee', 'Category', 'Amount', 'Notes'];
  const rows: string[][] = [];

  for (const tx of transactions) {
    rows.push([
      tx.date,
      tx.payee,
      tx.subtransactions.length > 0 ? '' : tx.category,
      formatAmount(tx.amount, currencySymbol),
      tx.notes || '',
    ]);

    tx.subtransactions.forEach((sub, i) => {
      const isLast = i === tx.subtransactions.length - 1;
      const prefix = isLast ? ' └─' : ' ├─';
      rows.push(['', `${prefix} ${sub.payee}`, sub.category, formatAmount(sub.amount, currencySymbol), sub.notes || '']);
    });
  }

  return formatMarkdownTable(headers, rows, ['left', 'left', 'left', 'right', 'left']);
}

export function formatKeyValue(title: string, fields: Record<string, string>): string {
  const lines = [`**${title}**`];
  for (const [key, value] of Object.entries(fields)) {
    lines.push(`- **${key}:** ${value}`);
  }
  return lines.join('\n');
}

export type NameMap = Map<string, string>;

export function buildNameMap(items: Array<{ id: string; name: string }>): NameMap {
  const map = new Map<string, string>();
  for (const item of items) map.set(item.id, item.name);
  return map;
}

export function resolveName(id: string | null | undefined, nameMap: NameMap): string {
  if (!id) return '';
  return nameMap.get(id) ?? id;
}
