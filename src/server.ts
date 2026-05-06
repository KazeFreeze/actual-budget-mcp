import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type pino from 'pino';
import type { Config } from './config.js';
import type { ActualClient } from './client/actual-client.js';
import type { SyncCoalescer } from './client/sync-coalescer.js';
import { registerAllTools } from './tools/register.js';
import { setupResources } from './resources.js';
import { setupPrompts } from './prompts.js';
import { currencyCodeToSymbol } from './currency.js';

export interface McpServerDeps {
  config: Config;
  client: ActualClient;
  coalescer: SyncCoalescer;
  logger: pino.Logger;
  /**
   * The resolved currency symbol used by tools and resources. Computed once
   * at startup by `resolveCurrencySymbol`; threaded through here so the
   * tool/resource registration path doesn't need to repeat the resolution.
   */
  currencySymbol: string;
}

const DEFAULT_CURRENCY_SYMBOL = '$';

/**
 * Resolve the currency symbol used for amount formatting.
 *
 * Priority (highest first):
 *   1. `CURRENCY_SYMBOL` env var, when explicitly set by the operator. The
 *      Zod schema treats this as `string | undefined` (no default), so a
 *      `string` here means "user explicitly set it" — including `'$'`.
 *   2. Auto-detected from the budget's `defaultCurrencyCode` synced
 *      preference, mapped through `Intl.NumberFormat`.
 *   3. Hard fallback `'$'` when both sources are unavailable.
 */
export async function resolveCurrencySymbol(
  config: Config,
  client: ActualClient,
  logger: pino.Logger,
): Promise<string> {
  if (config.currencySymbol !== undefined) {
    logger.info({ symbol: config.currencySymbol }, 'currency: env override');
    return config.currencySymbol;
  }

  const code = await client.getCurrencyCode();
  if (code !== null && code.length > 0) {
    const symbol = currencyCodeToSymbol(code);
    logger.info({ code, symbol }, `currency: detected ${code} -> ${symbol}`);
    return symbol;
  }

  logger.info(
    { symbol: DEFAULT_CURRENCY_SYMBOL },
    'currency: no preference detected, using fallback',
  );
  return DEFAULT_CURRENCY_SYMBOL;
}

export function createMcpServer(deps: McpServerDeps): McpServer {
  const server = new McpServer(
    { name: 'actual-budget-mcp', version: '2.0.0' },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );

  registerAllTools(server, deps);
  setupResources(server, deps.client, deps.currencySymbol);
  setupPrompts(server);

  return server;
}
