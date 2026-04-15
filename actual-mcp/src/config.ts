import { z } from 'zod';
import 'dotenv/config';

const ConfigSchema = z.object({
  actualHttpApiUrl: z.url(),
  actualHttpApiKey: z.string().min(1),
  budgetSyncId: z.string().min(1),
  mcpAuthToken: z.string().min(1).optional(),
  mcpTransport: z.enum(['stdio', 'sse', 'http']).default('stdio'),
  mcpPort: z.coerce.number().int().positive().default(3001),
  currencySymbol: z.string().default('$'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  const result = ConfigSchema.safeParse({
    actualHttpApiUrl: process.env.ACTUAL_HTTP_API_URL,
    actualHttpApiKey: process.env.ACTUAL_HTTP_API_KEY,
    budgetSyncId: process.env.ACTUAL_BUDGET_SYNC_ID,
    mcpAuthToken: process.env.MCP_AUTH_TOKEN,
    mcpTransport: process.env.MCP_TRANSPORT,
    mcpPort: process.env.MCP_PORT,
    currencySymbol: process.env.CURRENCY_SYMBOL,
    logLevel: process.env.LOG_LEVEL,
  });

  if (!result.success) {
    const errors = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${errors}`);
  }

  return result.data;
}
