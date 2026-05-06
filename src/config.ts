import { z } from 'zod';
import 'dotenv/config';

const V1_VARS = ['ACTUAL_HTTP_API_URL', 'ACTUAL_HTTP_API_KEY', 'MCP_AUTH_TOKEN'] as const;

const apiKey = z
  .string()
  .min(32, 'MCP_API_KEYS entries must be at least 32 characters')
  .refine(
    (s) => new Set(s).size >= 16,
    'MCP_API_KEYS entries must contain at least 16 unique characters',
  );

const ConfigSchema = z
  .object({
    actualServerUrl: z.url(),
    actualServerPassword: z.string().min(1),
    budgetSyncId: z.string().min(1),
    budgetEncryptionPassword: z.string().min(1).optional(),
    mcpApiKeys: z
      .string()
      .optional()
      .transform((s) =>
        s
          ? s
              .split(',')
              .map((k) => k.trim())
              .filter(Boolean)
          : [],
      )
      .pipe(z.array(apiKey)),
    mcpAllowedOrigins: z
      .string()
      .optional()
      .transform((s) =>
        s
          ? s
              .split(',')
              .map((o) => o.trim())
              .filter(Boolean)
          : [],
      )
      .pipe(z.array(z.url('MCP_ALLOWED_ORIGINS entries must be valid URLs'))),
    mcpTransport: z.enum(['stdio', 'sse', 'http']).default('stdio'),
    mcpPort: z.coerce.number().int().positive().default(3000),
    mcpRateLimitPerMin: z.coerce.number().int().positive().default(120),
    mcpDataDir: z.string().default('/var/lib/actual-mcp'),
    // Optional override. When unset (the common case) the resolved symbol is
    // auto-detected from the budget's `defaultCurrencyCode` synced
    // preference at startup; see `resolveCurrencySymbol` in `server.ts`.
    currencySymbol: z.string().optional(),
    logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  })
  .refine((c) => c.mcpTransport === 'stdio' || c.mcpApiKeys.length > 0, {
    message: 'MCP_API_KEYS is required when transport is http or sse',
    path: ['mcpApiKeys'],
  });

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  const offending = V1_VARS.filter((v) => process.env[v] !== undefined);
  if (offending.length > 0) {
    throw new Error(
      `v1 environment variables detected: ${offending.join(', ')}. ` +
        'See docs/MIGRATION-v1-to-v2.md for the new env var names.',
    );
  }

  const result = ConfigSchema.safeParse({
    actualServerUrl: process.env.ACTUAL_SERVER_URL,
    actualServerPassword: process.env.ACTUAL_SERVER_PASSWORD,
    budgetSyncId: process.env.ACTUAL_BUDGET_SYNC_ID,
    budgetEncryptionPassword: process.env.ACTUAL_BUDGET_ENCRYPTION_PASSWORD,
    mcpApiKeys: process.env.MCP_API_KEYS,
    mcpAllowedOrigins: process.env.MCP_ALLOWED_ORIGINS,
    mcpTransport: process.env.MCP_TRANSPORT,
    mcpPort: process.env.MCP_PORT,
    mcpRateLimitPerMin: process.env.MCP_RATE_LIMIT_PER_MIN,
    mcpDataDir: process.env.MCP_DATA_DIR,
    currencySymbol: process.env.CURRENCY_SYMBOL,
    logLevel: process.env.LOG_LEVEL,
  });

  if (!result.success) {
    const errors = result.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${errors}`);
  }
  return result.data;
}
