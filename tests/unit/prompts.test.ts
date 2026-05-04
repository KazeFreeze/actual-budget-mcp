import { describe, it, expect } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { setupPrompts } from '../../src/prompts.js';

interface PromptEntry {
  title?: string;
  description?: string;
  argsSchema?: unknown;
  callback: (
    args: Record<string, string | undefined>,
    extra?: unknown,
  ) =>
    | { messages: Array<{ role: string; content: { type: string; text: string } }> }
    | Promise<{ messages: Array<{ role: string; content: { type: string; text: string } }> }>;
}

function setupForPrompts(): {
  server: McpServer;
  prompts: Record<string, PromptEntry>;
} {
  const server = new McpServer({ name: 't', version: '0' }, { capabilities: { prompts: {} } });
  setupPrompts(server);
  const prompts = (server as unknown as { _registeredPrompts: Record<string, PromptEntry> })
    ._registeredPrompts;
  return { server, prompts };
}

async function callPrompt(
  prompts: Record<string, PromptEntry>,
  name: string,
  args: Record<string, string | undefined> = {},
): Promise<string> {
  const entry = prompts[name];
  if (!entry) throw new Error(`prompt not registered: ${name}`);
  const result = await entry.callback(args, undefined);
  return result.messages[0]?.content.text ?? '';
}

describe('prompts', () => {
  it('registers all four prompts by name', () => {
    const { prompts } = setupForPrompts();
    expect(Object.keys(prompts).sort()).toEqual([
      'actualql-reference',
      'budget-review',
      'financial-health-check',
      'spending-deep-dive',
    ]);
  });

  it('each prompt has a non-empty description', () => {
    const { prompts } = setupForPrompts();
    for (const [, entry] of Object.entries(prompts)) {
      expect(entry.description?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('financial-health-check (no args) returns a non-empty user message', async () => {
    const { prompts } = setupForPrompts();
    const text = await callPrompt(prompts, 'financial-health-check');
    expect(text.length).toBeGreaterThan(50);
    expect(text).toContain('net-worth-snapshot');
    expect(text).toContain('Savings Rate');
  });

  it('budget-review with month produces a message containing that month', async () => {
    const { prompts } = setupForPrompts();
    const text = await callPrompt(prompts, 'budget-review', { month: '2026-05' });
    expect(text).toContain('2026-05');
    expect(text).toContain('budget review');
  });

  it('budget-review with no args defaults to "the current month"', async () => {
    const { prompts } = setupForPrompts();
    const text = await callPrompt(prompts, 'budget-review', {});
    expect(text).toContain('the current month');
  });

  it('spending-deep-dive with category produces message containing that category', async () => {
    const { prompts } = setupForPrompts();
    const text = await callPrompt(prompts, 'spending-deep-dive', { category: 'Groceries' });
    expect(text).toContain('Groceries');
  });

  it('spending-deep-dive with no args uses default category and period text', async () => {
    const { prompts } = setupForPrompts();
    const text = await callPrompt(prompts, 'spending-deep-dive', {});
    expect(text).toContain('all categories');
    expect(text).toContain('the last 3 months');
  });

  it('actualql-reference (no args) returns the language reference', async () => {
    const { prompts } = setupForPrompts();
    const text = await callPrompt(prompts, 'actualql-reference');
    expect(text).toContain('ActualQL');
    expect(text).toContain('$sum');
    expect(text).toContain('groupBy');
  });

  it('budget-review declares an optional month arg in its argsSchema', () => {
    const { prompts } = setupForPrompts();
    const entry = prompts['budget-review'];
    expect(entry?.argsSchema).toBeDefined();
  });

  it('spending-deep-dive declares argsSchema (category, period optional)', () => {
    const { prompts } = setupForPrompts();
    const entry = prompts['spending-deep-dive'];
    expect(entry?.argsSchema).toBeDefined();
  });
});
