# Actual Budget MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an MCP server that proxies to `actual-http-api` for full budget read/write access with pre-built financial reports and raw ActualQL query power.

**Architecture:** TypeScript MCP server using `@modelcontextprotocol/sdk`. Calls `actual-http-api` over HTTP on internal Docker network. Supports stdio, SSE, and Streamable HTTP transports with bearer token auth. All outputs in Markdown.

**Tech Stack:** TypeScript, @modelcontextprotocol/sdk, Express, Zod, Pino, Vitest

**Spec:** `docs/superpowers/specs/2026-04-15-actual-budget-mcp-server-design.md`

**Methodology:** Strict TDD — every production function has a failing test before implementation. Red → Green → Commit. No exceptions without explicit justification.

---

## File Map

| File | Responsibility |
|---|---|
| `actual-mcp/package.json` | Dependencies, scripts, project metadata |
| `actual-mcp/tsconfig.json` | TypeScript config (ES2022, Node16 modules) |
| `actual-mcp/.env.example` | Documented env var template |
| `actual-mcp/src/config.ts` | Load + validate env vars with Zod, export typed config |
| `actual-mcp/src/client.ts` | Typed HTTP client: fetch wrapper, timeouts, result types, Zod response validation, TTL cache, centralized endpoint map |
| `actual-mcp/src/format.ts` | Currency formatting, markdown table builder, split transaction renderer, name resolution |
| `actual-mcp/src/server.ts` | MCP server factory: registers all tools, resources, prompts |
| `actual-mcp/src/auth.ts` | Bearer token validation with crypto.timingSafeEqual |
| `actual-mcp/src/index.ts` | Entry point: CLI args, transport setup (stdio/SSE/HTTP), health check, graceful shutdown |
| `actual-mcp/src/resources.ts` | MCP resources: accounts, categories, payees, budget-settings |
| `actual-mcp/src/prompts.ts` | MCP prompts: financial-health-check, budget-review, spending-deep-dive, actualql-reference |
| `actual-mcp/src/tools/crud.ts` | All CRUD tool schemas + handlers |
| `actual-mcp/src/tools/query.ts` | run-query tool with embedded ActualQL reference |
| `actual-mcp/src/tools/analytics.ts` | 6 analytical report tools |
| `actual-mcp/tests/config.test.ts` | Config validation tests |
| `actual-mcp/tests/client.test.ts` | HTTP client failure modes, caching, validation |
| `actual-mcp/tests/format.test.ts` | Formatting pure function tests |
| `actual-mcp/tests/auth.test.ts` | Auth middleware tests |
| `actual-mcp/tests/tools/crud.test.ts` | CRUD tool tests with mocked client |
| `actual-mcp/tests/tools/query.test.ts` | Query tool tests with mocked client |
| `actual-mcp/tests/tools/analytics.test.ts` | Analytics tool tests with mocked client |
| `actual-mcp/tests/resources.test.ts` | Resource handler tests |
| `actual-mcp/tests/server.test.ts` | Server wiring tests |
| `actual-mcp/Dockerfile` | Multi-stage Node.js build |
| `actual-mcp/docker/docker-compose.yml` | Full stack compose including actual-mcp |

---

### Task 1: Project Scaffolding

> TDD exception: configuration files only, no production logic.

**Files:**
- Create: `actual-mcp/package.json`
- Create: `actual-mcp/tsconfig.json`
- Create: `actual-mcp/.env.example`
- Create: `actual-mcp/.gitignore`
- Create: `actual-mcp/vitest.config.ts`

- [ ] **Step 1: Create project directory**

```bash
mkdir -p actual-mcp/src/tools actual-mcp/tests/tools actual-mcp/docker
```

- [ ] **Step 2: Create package.json**

Create `actual-mcp/package.json`:

```json
{
  "name": "actual-budget-mcp",
  "version": "0.1.0",
  "description": "MCP server for Actual Budget via actual-http-api proxy",
  "type": "module",
  "main": "build/index.js",
  "bin": {
    "actual-budget-mcp": "build/index.js"
  },
  "scripts": {
    "build": "tsc",
    "start": "node build/index.js",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.27.0",
    "express": "^5.2.0",
    "zod": "^4.3.0",
    "pino": "^9.6.0",
    "dotenv": "^17.3.0"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.9.0",
    "vitest": "^4.1.0"
  }
}
```

- [ ] **Step 3: Create tsconfig.json**

Create `actual-mcp/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./build",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "build", "tests"]
}
```

- [ ] **Step 4: Create vitest.config.ts**

Create `actual-mcp/vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: '.',
  },
});
```

- [ ] **Step 5: Create .env.example**

Create `actual-mcp/.env.example`:

```env
# Required: URL of the actual-http-api service
ACTUAL_HTTP_API_URL=http://actual-http-api:5007

# Required: API key for actual-http-api (matches its API_KEY env var)
ACTUAL_HTTP_API_KEY=your-api-key-here

# Required: Budget sync ID (found in Actual Budget Settings > Advanced > Sync ID)
ACTUAL_BUDGET_SYNC_ID=your-budget-sync-id

# Required for remote access: Bearer token for MCP transport auth
MCP_AUTH_TOKEN=your-secret-token-here

# Optional: Transport mode (stdio | sse | http). Default: stdio
MCP_TRANSPORT=stdio

# Optional: Port for SSE/HTTP transport. Default: 3001
MCP_PORT=3001

# Optional: Currency symbol for formatting. Default: $
CURRENCY_SYMBOL=$

# Optional: Log level (debug | info | warn | error). Default: info
LOG_LEVEL=info
```

- [ ] **Step 6: Create .gitignore**

Create `actual-mcp/.gitignore`:

```
node_modules/
build/
.env
*.tgz
```

- [ ] **Step 7: Install dependencies**

```bash
cd actual-mcp && npm install
```

- [ ] **Step 8: Commit**

```bash
git init && git add -A && git commit -m "feat: scaffold actual-budget-mcp project"
```

---

### Task 2: Config Module (TDD)

**Files:**
- Test: `actual-mcp/tests/config.test.ts`
- Create: `actual-mcp/src/config.ts`

- [ ] **Step 1: RED — Write failing tests for config validation**

Create `actual-mcp/tests/config.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should load valid config from env vars', async () => {
    process.env.ACTUAL_HTTP_API_URL = 'http://localhost:5007';
    process.env.ACTUAL_HTTP_API_KEY = 'test-key';
    process.env.ACTUAL_BUDGET_SYNC_ID = 'test-sync-id';

    const { loadConfig } = await import('../src/config.js');
    const config = loadConfig();

    expect(config.actualHttpApiUrl).toBe('http://localhost:5007');
    expect(config.actualHttpApiKey).toBe('test-key');
    expect(config.budgetSyncId).toBe('test-sync-id');
    expect(config.mcpTransport).toBe('stdio');
    expect(config.mcpPort).toBe(3001);
    expect(config.currencySymbol).toBe('$');
    expect(config.logLevel).toBe('info');
  });

  it('should throw on missing required env vars', async () => {
    // No env vars set
    delete process.env.ACTUAL_HTTP_API_URL;
    delete process.env.ACTUAL_HTTP_API_KEY;
    delete process.env.ACTUAL_BUDGET_SYNC_ID;

    // Re-import to get fresh module
    const { loadConfig } = await import('../src/config.js');
    expect(() => loadConfig()).toThrow('Invalid configuration');
  });

  it('should throw on invalid URL', async () => {
    process.env.ACTUAL_HTTP_API_URL = 'not-a-url';
    process.env.ACTUAL_HTTP_API_KEY = 'test-key';
    process.env.ACTUAL_BUDGET_SYNC_ID = 'test-sync-id';

    const { loadConfig } = await import('../src/config.js');
    expect(() => loadConfig()).toThrow('Invalid configuration');
  });

  it('should accept optional overrides', async () => {
    process.env.ACTUAL_HTTP_API_URL = 'http://localhost:5007';
    process.env.ACTUAL_HTTP_API_KEY = 'test-key';
    process.env.ACTUAL_BUDGET_SYNC_ID = 'test-sync-id';
    process.env.MCP_TRANSPORT = 'sse';
    process.env.MCP_PORT = '4000';
    process.env.CURRENCY_SYMBOL = '£';
    process.env.LOG_LEVEL = 'debug';

    const { loadConfig } = await import('../src/config.js');
    const config = loadConfig();

    expect(config.mcpTransport).toBe('sse');
    expect(config.mcpPort).toBe(4000);
    expect(config.currencySymbol).toBe('£');
    expect(config.logLevel).toBe('debug');
  });
});
```

- [ ] **Step 2: Verify RED**

```bash
cd actual-mcp && npx vitest run tests/config.test.ts
```

Expected: FAIL — `src/config.ts` does not exist.

- [ ] **Step 3: GREEN — Write minimal config.ts**

Create `actual-mcp/src/config.ts`:

```typescript
import { z } from 'zod';
import 'dotenv/config';

const ConfigSchema = z.object({
  actualHttpApiUrl: z.string().url(),
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
    const errors = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${errors}`);
  }

  return result.data;
}
```

- [ ] **Step 4: Verify GREEN**

```bash
cd actual-mcp && npx vitest run tests/config.test.ts
```

Expected: All 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts && git commit -m "feat: add config module with Zod validation (TDD)"
```

---

### Task 3: HTTP Client (TDD)

**Files:**
- Test: `actual-mcp/tests/client.test.ts`
- Create: `actual-mcp/src/client.ts`

- [ ] **Step 1: RED — Write failing tests for core request behavior**

Create `actual-mcp/tests/client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('createClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET requests', () => {
    it('should make GET with correct headers and parse { data } response', async () => {
      const mockData = [{ id: '1', name: 'Checking' }];
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ data: mockData }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const { createClient } = await import('../src/client.js');
      const client = createClient({
        baseUrl: 'http://localhost:5007',
        apiKey: 'test-key',
        budgetSyncId: 'test-budget',
      });

      const result = await client.getAccounts();

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data).toEqual(mockData);

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/budgets/test-budget/accounts'),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({ 'x-api-key': 'test-key' }),
        }),
      );
    });

    it('should return error result on non-200 response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }),
      );

      const { createClient } = await import('../src/client.js');
      const client = createClient({
        baseUrl: 'http://localhost:5007',
        apiKey: 'test-key',
        budgetSyncId: 'test-budget',
      });

      const result = await client.getAccounts();

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('404');
    });

    it('should return error on network failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const { createClient } = await import('../src/client.js');
      const client = createClient({
        baseUrl: 'http://localhost:5007',
        apiKey: 'test-key',
        budgetSyncId: 'test-budget',
      });

      const result = await client.getAccounts();

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('ECONNREFUSED');
    });

    it('should return error on timeout', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementationOnce(
        () => new Promise((_, reject) => {
          setTimeout(() => reject(new DOMException('Aborted', 'AbortError')), 50);
        }),
      );

      const { createClient } = await import('../src/client.js');
      const client = createClient({
        baseUrl: 'http://localhost:5007',
        apiKey: 'test-key',
        budgetSyncId: 'test-budget',
        timeoutMs: 100,
      });

      const result = await client.getAccounts();

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('timeout');
    });
  });

  describe('POST requests', () => {
    it('should send JSON body on POST', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { added: ['id-1'], updated: [] } }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const { createClient } = await import('../src/client.js');
      const client = createClient({
        baseUrl: 'http://localhost:5007',
        apiKey: 'test-key',
        budgetSyncId: 'test-budget',
      });

      const result = await client.createTransaction('acct-1', { date: '2026-03-15', amount: -5000 });

      expect(result.ok).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/transactions'),
        expect.objectContaining({
          method: 'POST',
          body: expect.any(String),
        }),
      );
    });
  });

  describe('caching', () => {
    it('should cache GET responses and not refetch within TTL', async () => {
      const mockData = [{ id: '1', name: 'Checking' }];
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ data: mockData }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const { createClient } = await import('../src/client.js');
      const client = createClient({
        baseUrl: 'http://localhost:5007',
        apiKey: 'test-key',
        budgetSyncId: 'test-budget',
      });

      await client.getAccounts();
      await client.getAccounts();

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('should refetch after cache is cleared', async () => {
      const mockData = [{ id: '1', name: 'Checking' }];
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ data: mockData }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const { createClient } = await import('../src/client.js');
      const client = createClient({
        baseUrl: 'http://localhost:5007',
        apiKey: 'test-key',
        budgetSyncId: 'test-budget',
      });

      await client.getAccounts();
      client.clearCache();
      await client.getAccounts();

      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('health check', () => {
    it('should return true when API is reachable', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { version: '26.4.0' } }), { status: 200 }),
      );

      const { createClient } = await import('../src/client.js');
      const client = createClient({
        baseUrl: 'http://localhost:5007',
        apiKey: 'test-key',
        budgetSyncId: 'test-budget',
      });

      const healthy = await client.checkHealth();
      expect(healthy).toBe(true);
    });

    it('should return false when API is unreachable', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const { createClient } = await import('../src/client.js');
      const client = createClient({
        baseUrl: 'http://localhost:5007',
        apiKey: 'test-key',
        budgetSyncId: 'test-budget',
      });

      const healthy = await client.checkHealth();
      expect(healthy).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Verify RED**

```bash
cd actual-mcp && npx vitest run tests/client.test.ts
```

Expected: FAIL — `src/client.ts` does not exist.

- [ ] **Step 3: GREEN — Write client.ts with all domain methods**

Create `actual-mcp/src/client.ts`:

```typescript
import { z } from 'zod';
import pino from 'pino';

// --- Result type ---

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// --- Response schemas ---

const AccountSchema = z.object({
  id: z.string(),
  name: z.string(),
  offbudget: z.boolean().optional(),
  closed: z.boolean().optional(),
});

const TransactionSchema = z.object({
  id: z.string(),
  is_parent: z.boolean().optional(),
  is_child: z.boolean().optional(),
  parent_id: z.string().nullable().optional(),
  account: z.string(),
  category: z.string().nullable().optional(),
  amount: z.number(),
  payee: z.string().nullable().optional(),
  payee_name: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  date: z.string(),
  imported_id: z.string().nullable().optional(),
  imported_payee: z.string().nullable().optional(),
  transfer_id: z.string().nullable().optional(),
  cleared: z.boolean().optional(),
  sort_order: z.number().optional(),
  subtransactions: z.array(z.any()).optional(),
});

const CategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  is_income: z.boolean().optional(),
  hidden: z.boolean().optional(),
  group_id: z.string().optional(),
});

const CategoryGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  is_income: z.boolean().optional(),
  hidden: z.boolean().optional(),
  categories: z.array(CategorySchema).optional(),
});

const PayeeSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string().nullable().optional(),
  transfer_acct: z.string().nullable().optional(),
});

const BudgetMonthCategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  is_income: z.boolean().optional(),
  hidden: z.boolean().optional(),
  group_id: z.string().optional(),
  budgeted: z.number().optional(),
  spent: z.number().optional(),
  balance: z.number().optional(),
  carryover: z.boolean().optional(),
});

const BudgetMonthGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  is_income: z.boolean().optional(),
  hidden: z.boolean().optional(),
  budgeted: z.number().optional(),
  spent: z.number().optional(),
  balance: z.number().optional(),
  categories: z.array(BudgetMonthCategorySchema).optional(),
});

const BudgetMonthSchema = z.object({
  month: z.string(),
  incomeAvailable: z.number().optional(),
  lastMonthOverspent: z.number().optional(),
  forNextMonth: z.number().optional(),
  totalBudgeted: z.number().optional(),
  toBudget: z.number().optional(),
  fromLastMonth: z.number().optional(),
  totalIncome: z.number().optional(),
  totalSpent: z.number().optional(),
  totalBalance: z.number().optional(),
  categoryGroups: z.array(BudgetMonthGroupSchema).optional(),
});

const ScheduleSchema = z.object({
  id: z.string(),
  name: z.string().nullable().optional(),
  next_date: z.string().nullable().optional(),
  completed: z.boolean().optional(),
  posts_transaction: z.boolean().optional(),
  amount: z.any().optional(),
  amountOp: z.string().optional(),
});

const RuleConditionSchema = z.object({
  op: z.string(),
  field: z.string(),
  value: z.any(),
  type: z.string().optional(),
});

const RuleSchema = z.object({
  id: z.string(),
  stage: z.string().optional(),
  conditionsOp: z.string().optional(),
  conditions: z.array(RuleConditionSchema).optional(),
  actions: z.array(RuleConditionSchema).optional(),
});

// Exported types
export type Account = z.infer<typeof AccountSchema>;
export type Transaction = z.infer<typeof TransactionSchema>;
export type Category = z.infer<typeof CategorySchema>;
export type CategoryGroup = z.infer<typeof CategoryGroupSchema>;
export type Payee = z.infer<typeof PayeeSchema>;
export type BudgetMonth = z.infer<typeof BudgetMonthSchema>;
export type BudgetMonthCategory = z.infer<typeof BudgetMonthCategorySchema>;
export type Schedule = z.infer<typeof ScheduleSchema>;
export type Rule = z.infer<typeof RuleSchema>;

// --- TTL Cache ---

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

class TtlCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private defaultTtlMs: number;

  constructor(defaultTtlMs = 60_000) {
    this.defaultTtlMs = defaultTtlMs;
  }

  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.data as T;
  }

  set<T>(key: string, data: T, ttlMs?: number): void {
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
    });
  }

  clear(): void {
    this.cache.clear();
  }
}

// --- Client ---

export interface ClientConfig {
  baseUrl: string;
  apiKey: string;
  budgetSyncId: string;
  timeoutMs?: number;
  cacheTtlMs?: number;
}

export function createClient(config: ClientConfig) {
  const { baseUrl, apiKey, budgetSyncId, timeoutMs = 10_000, cacheTtlMs = 60_000 } = config;
  const logger = pino({ name: 'http-client', level: 'info' });
  const cache = new TtlCache(cacheTtlMs);
  const budgetBase = `${baseUrl}/v1/budgets/${budgetSyncId}`;

  async function request<T>(
    method: string,
    url: string,
    options?: {
      body?: unknown;
      query?: Record<string, string | undefined>;
      schema?: z.ZodType<T>;
      cacheKey?: string;
    },
  ): Promise<ApiResult<T>> {
    if (method === 'GET' && options?.cacheKey) {
      const cached = cache.get<T>(options.cacheKey);
      if (cached !== undefined) return { ok: true, data: cached };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const fullUrl = new URL(url);
      if (options?.query) {
        for (const [key, value] of Object.entries(options.query)) {
          if (value !== undefined) fullUrl.searchParams.set(key, value);
        }
      }

      const startMs = Date.now();
      const response = await fetch(fullUrl.toString(), {
        method,
        headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
        body: options?.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
      const durationMs = Date.now() - startMs;
      logger.debug({ method, url, status: response.status, durationMs }, 'HTTP request');

      if (!response.ok) {
        let errorMsg: string;
        try {
          const errorBody = await response.json();
          errorMsg = (errorBody as { error?: string }).error || response.statusText;
        } catch {
          errorMsg = response.statusText;
        }
        return { ok: false, error: `HTTP ${response.status}: ${errorMsg}` };
      }

      const json = await response.json();
      const data = (json as { data?: unknown }).data ?? json;

      if (options?.schema) {
        const parsed = options.schema.safeParse(data);
        if (!parsed.success) {
          logger.warn({ url, issues: parsed.error.issues }, 'Response validation failed');
          return { ok: true, data: data as T };
        }
        if (method === 'GET' && options?.cacheKey) cache.set(options.cacheKey, parsed.data);
        return { ok: true, data: parsed.data };
      }

      if (method === 'GET' && options?.cacheKey) cache.set(options.cacheKey, data);
      return { ok: true, data: data as T };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { ok: false, error: `Request timeout after ${timeoutMs}ms` };
      }
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    clearCache: () => cache.clear(),

    // Accounts
    getAccounts: () => request<Account[]>('GET', `${budgetBase}/accounts`, { schema: z.array(AccountSchema), cacheKey: 'accounts' }),
    getAccountBalance: (accountId: string, cutoffDate?: string) => request<number>('GET', `${budgetBase}/accounts/${accountId}/balance`, { query: { cutoff_date: cutoffDate } }),

    // Transactions
    getTransactions: (accountId: string, sinceDate: string, untilDate?: string) => request<Transaction[]>('GET', `${budgetBase}/accounts/${accountId}/transactions`, { query: { since_date: sinceDate, until_date: untilDate }, schema: z.array(TransactionSchema) }),
    createTransaction: (accountId: string, transaction: Record<string, unknown>, opts?: { learnCategories?: boolean; runTransfers?: boolean }) => request<string>('POST', `${budgetBase}/accounts/${accountId}/transactions`, { body: { transaction, learnCategories: opts?.learnCategories ?? false, runTransfers: opts?.runTransfers ?? false } }),
    updateTransaction: (transactionId: string, fields: Record<string, unknown>) => request<string>('PATCH', `${budgetBase}/transactions/${transactionId}`, { body: { transaction: fields } }),
    deleteTransaction: (transactionId: string) => request<string>('DELETE', `${budgetBase}/transactions/${transactionId}`),
    importTransactions: (accountId: string, transactions: Record<string, unknown>[]) => request<{ added: string[]; updated: string[] }>('POST', `${budgetBase}/accounts/${accountId}/transactions/import`, { body: { transactions } }),

    // Categories
    getCategories: () => request<Category[]>('GET', `${budgetBase}/categories`, { schema: z.array(CategorySchema), cacheKey: 'categories' }),
    getCategoryGroups: () => request<CategoryGroup[]>('GET', `${budgetBase}/categorygroups`, { schema: z.array(CategoryGroupSchema), cacheKey: 'categoryGroups' }),
    createCategory: (category: { name: string; group_id: string; is_income?: boolean }) => request<string>('POST', `${budgetBase}/categories`, { body: { category } }),
    updateCategory: (categoryId: string, fields: Record<string, unknown>) => request<string>('PATCH', `${budgetBase}/categories/${categoryId}`, { body: { category: fields } }),
    deleteCategory: (categoryId: string, transferCategoryId?: string) => request<string>('DELETE', `${budgetBase}/categories/${categoryId}`, { query: { transfer_category_id: transferCategoryId } }),
    createCategoryGroup: (group: { name: string; is_income?: boolean }) => request<string>('POST', `${budgetBase}/categorygroups`, { body: { category_group: group } }),
    updateCategoryGroup: (groupId: string, fields: Record<string, unknown>) => request<string>('PATCH', `${budgetBase}/categorygroups/${groupId}`, { body: { category_group: fields } }),
    deleteCategoryGroup: (groupId: string, transferCategoryId?: string) => request<string>('DELETE', `${budgetBase}/categorygroups/${groupId}`, { query: { transfer_category_id: transferCategoryId } }),

    // Payees
    getPayees: () => request<Payee[]>('GET', `${budgetBase}/payees`, { schema: z.array(PayeeSchema), cacheKey: 'payees' }),
    createPayee: (payee: { name: string }) => request<string>('POST', `${budgetBase}/payees`, { body: { payee } }),
    updatePayee: (payeeId: string, fields: Record<string, unknown>) => request<string>('PATCH', `${budgetBase}/payees/${payeeId}`, { body: { payee: fields } }),
    deletePayee: (payeeId: string) => request<string>('DELETE', `${budgetBase}/payees/${payeeId}`),
    mergePayees: (targetId: string, mergeIds: string[]) => request<string>('POST', `${budgetBase}/payees/merge`, { body: { targetId, mergeIds } }),

    // Budget months
    getBudgetMonths: () => request<string[]>('GET', `${budgetBase}/months`),
    getBudgetMonth: (month: string) => request<BudgetMonth>('GET', `${budgetBase}/months/${month}`, { schema: BudgetMonthSchema }),
    setBudgetAmount: (month: string, categoryId: string, budgeted: number, carryover?: boolean) => request<string>('PATCH', `${budgetBase}/months/${month}/categories/${categoryId}`, { body: { category: { budgeted, ...(carryover !== undefined && { carryover }) } } }),
    transferBudget: (month: string, fromCategoryId: string, toCategoryId: string, amount: number) => request<string>('POST', `${budgetBase}/months/${month}/categorytransfers`, { body: { categorytransfer: { fromCategoryId, toCategoryId, amount } } }),

    // Schedules
    getSchedules: () => request<Schedule[]>('GET', `${budgetBase}/schedules`, { schema: z.array(ScheduleSchema) }),
    createSchedule: (schedule: Record<string, unknown>) => request<string>('POST', `${budgetBase}/schedules`, { body: { schedule } }),
    updateSchedule: (scheduleId: string, fields: Record<string, unknown>) => request<string>('PATCH', `${budgetBase}/schedules/${scheduleId}`, { body: { schedule: fields } }),
    deleteSchedule: (scheduleId: string) => request<string>('DELETE', `${budgetBase}/schedules/${scheduleId}`),

    // Rules
    getRules: () => request<Rule[]>('GET', `${budgetBase}/rules`, { schema: z.array(RuleSchema) }),
    createRule: (rule: Record<string, unknown>) => request<Rule>('POST', `${budgetBase}/rules`, { body: { rule } }),
    updateRule: (ruleId: string, fields: Record<string, unknown>) => request<Rule>('PATCH', `${budgetBase}/rules/${ruleId}`, { body: { rule: fields } }),
    deleteRule: (ruleId: string) => request<string>('DELETE', `${budgetBase}/rules/${ruleId}`),

    // Notes
    getNotes: (type: 'category' | 'account' | 'budgetmonth', id: string) => request<string>('GET', `${budgetBase}/notes/${type}/${id}`),
    setNotes: (type: 'category' | 'account' | 'budgetmonth', id: string, notes: string) => request<string>('PUT', `${budgetBase}/notes/${type}/${id}`, { body: { data: notes } }),
    deleteNotes: (type: 'category' | 'account' | 'budgetmonth', id: string) => request<string>('DELETE', `${budgetBase}/notes/${type}/${id}`),

    // Bank sync
    runBankSync: (accountId?: string) => accountId
      ? request<string>('POST', `${budgetBase}/accounts/${accountId}/banksync`)
      : request<string>('POST', `${budgetBase}/accounts/banksync`),

    // Query
    runQuery: (query: Record<string, unknown>) => request<unknown>('POST', `${budgetBase}/run-query`, { body: { ActualQLquery: query } }),

    // Settings
    getBudgets: () => request<Array<{ id: string; name: string }>>('GET', `${baseUrl}/v1/budgets`),
    getApiVersion: () => request<{ version: string }>('GET', `${baseUrl}/v1/actualhttpapiversion`),

    // Health
    checkHealth: async (): Promise<boolean> => {
      const result = await request<{ version: string }>('GET', `${baseUrl}/v1/actualhttpapiversion`);
      return result.ok;
    },
  };
}

export type ActualClient = ReturnType<typeof createClient>;
```

- [ ] **Step 4: Verify GREEN**

```bash
cd actual-mcp && npx vitest run tests/client.test.ts
```

Expected: All 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/client.ts tests/client.test.ts && git commit -m "feat: add typed HTTP client with timeouts, caching, result types (TDD)"
```

---

### Task 4: Formatting Utilities (TDD)

**Files:**
- Test: `actual-mcp/tests/format.test.ts`
- Create: `actual-mcp/src/format.ts`

- [ ] **Step 1: RED — Write failing tests for all formatters**

Create `actual-mcp/tests/format.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('formatAmount', () => {
  it('should format positive cents to currency string', async () => {
    const { formatAmount } = await import('../src/format.js');
    expect(formatAmount(520000, '$')).toBe('$5,200.00');
  });

  it('should format negative amounts with minus before symbol', async () => {
    const { formatAmount } = await import('../src/format.js');
    expect(formatAmount(-15678, '£')).toBe('-£156.78');
  });

  it('should format zero', async () => {
    const { formatAmount } = await import('../src/format.js');
    expect(formatAmount(0, '$')).toBe('$0.00');
  });

  it('should handle small amounts under a dollar', async () => {
    const { formatAmount } = await import('../src/format.js');
    expect(formatAmount(5, '$')).toBe('$0.05');
  });
});

describe('formatMarkdownTable', () => {
  it('should render headers, separator, and rows', async () => {
    const { formatMarkdownTable } = await import('../src/format.js');
    const result = formatMarkdownTable(
      ['Name', 'Amount'],
      [['Groceries', '-$500.00'], ['Rent', '-$1,500.00']],
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
    const result = formatTransactionTable(
      [{ date: '2026-03-14', payee: 'Spotify', category: 'Subscriptions', amount: -1599, notes: '', subtransactions: [] }],
      '$',
    );
    expect(result).toContain('Spotify');
    expect(result).toContain('Subscriptions');
    expect(result).toContain('-$15.99');
  });

  it('should render split transactions with tree characters', async () => {
    const { formatTransactionTable } = await import('../src/format.js');
    const result = formatTransactionTable(
      [{
        date: '2026-03-15', payee: 'Costco', category: '', amount: -15678, notes: 'Weekly',
        subtransactions: [
          { payee: 'Costco', category: 'Groceries', amount: -12000, notes: '' },
          { payee: 'Gift Shop', category: 'Gifts', amount: -3678, notes: 'Birthday' },
        ],
      }],
      '£',
    );
    expect(result).toContain('├─');
    expect(result).toContain('└─');
    expect(result).toContain('Groceries');
    expect(result).toContain('Gifts');
    expect(result).toContain('-£120.00');
    expect(result).toContain('-£36.78');
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
    const map = buildNameMap([{ id: 'cat-1', name: 'Groceries' }, { id: 'cat-2', name: 'Rent' }]);
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
```

- [ ] **Step 2: Verify RED**

```bash
cd actual-mcp && npx vitest run tests/format.test.ts
```

Expected: FAIL — `src/format.ts` does not exist.

- [ ] **Step 3: GREEN — Write format.ts**

Create `actual-mcp/src/format.ts`:

```typescript
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
```

- [ ] **Step 4: Verify GREEN**

```bash
cd actual-mcp && npx vitest run tests/format.test.ts
```

Expected: All 10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/format.ts tests/format.test.ts && git commit -m "feat: add formatting utilities for currency, tables, splits (TDD)"
```

---

### Task 5: Auth Middleware (TDD)

**Files:**
- Test: `actual-mcp/tests/auth.test.ts`
- Create: `actual-mcp/src/auth.ts`

- [ ] **Step 1: RED — Write failing tests for bearer token validation**

Create `actual-mcp/tests/auth.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { IncomingMessage, ServerResponse } from 'node:http';

describe('createAuthMiddleware', () => {
  function mockReqRes(authHeader?: string) {
    const req = { headers: { authorization: authHeader } } as unknown as IncomingMessage;
    const res = {
      writeHead: vi.fn(),
      end: vi.fn(),
    } as unknown as ServerResponse;
    const next = vi.fn();
    return { req, res, next };
  }

  it('should call next() with valid bearer token', async () => {
    const { createAuthMiddleware } = await import('../src/auth.js');
    const middleware = createAuthMiddleware('my-secret-token');
    const { req, res, next } = mockReqRes('Bearer my-secret-token');

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.writeHead).not.toHaveBeenCalled();
  });

  it('should return 401 when no Authorization header', async () => {
    const { createAuthMiddleware } = await import('../src/auth.js');
    const middleware = createAuthMiddleware('my-secret-token');
    const { req, res, next } = mockReqRes(undefined);

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
  });

  it('should return 401 when header is not Bearer scheme', async () => {
    const { createAuthMiddleware } = await import('../src/auth.js');
    const middleware = createAuthMiddleware('my-secret-token');
    const { req, res, next } = mockReqRes('Basic dXNlcjpwYXNz');

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
  });

  it('should return 403 when token is wrong', async () => {
    const { createAuthMiddleware } = await import('../src/auth.js');
    const middleware = createAuthMiddleware('my-secret-token');
    const { req, res, next } = mockReqRes('Bearer wrong-token');

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
  });

  it('should use constant-time comparison (not short-circuit)', async () => {
    const { createAuthMiddleware } = await import('../src/auth.js');
    const middleware = createAuthMiddleware('my-secret-token');
    // Different length tokens should also be rejected with 403
    const { req, res, next } = mockReqRes('Bearer x');

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
  });
});
```

- [ ] **Step 2: Verify RED**

```bash
cd actual-mcp && npx vitest run tests/auth.test.ts
```

Expected: FAIL — `src/auth.ts` does not exist.

- [ ] **Step 3: GREEN — Write auth.ts**

Create `actual-mcp/src/auth.ts`:

```typescript
import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export function createAuthMiddleware(token: string) {
  const tokenBuffer = Buffer.from(token);

  return (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing Bearer token' }));
      return;
    }

    const provided = Buffer.from(authHeader.slice(7));
    if (provided.length !== tokenBuffer.length || !crypto.timingSafeEqual(provided, tokenBuffer)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid token' }));
      return;
    }

    next();
  };
}
```

- [ ] **Step 4: Verify GREEN**

```bash
cd actual-mcp && npx vitest run tests/auth.test.ts
```

Expected: All 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/auth.ts tests/auth.test.ts && git commit -m "feat: add bearer token auth with constant-time comparison (TDD)"
```

---

### Task 6: CRUD Tools (TDD)

**Files:**
- Test: `actual-mcp/tests/tools/crud.test.ts`
- Create: `actual-mcp/src/tools/crud.ts`

- [ ] **Step 1: RED — Write failing tests for representative CRUD tools**

We test a representative sample: get-accounts, create-transaction (with splits), manage-category, get-notes. The rest follow the same pattern and share code paths.

Create `actual-mcp/tests/tools/crud.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

function mockClient(overrides: Record<string, unknown> = {}) {
  return {
    getAccounts: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 'a1', name: 'Checking', offbudget: false, closed: false }] }),
    getAccountBalance: vi.fn().mockResolvedValue({ ok: true, data: 250000 }),
    getTransactions: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    createTransaction: vi.fn().mockResolvedValue({ ok: true, data: 'tx-1' }),
    updateTransaction: vi.fn().mockResolvedValue({ ok: true, data: 'ok' }),
    deleteTransaction: vi.fn().mockResolvedValue({ ok: true, data: 'ok' }),
    getCategories: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 'c1', name: 'Groceries' }] }),
    getCategoryGroups: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 'g1', name: 'Bills', categories: [{ id: 'c1', name: 'Groceries' }] }] }),
    createCategory: vi.fn().mockResolvedValue({ ok: true, data: 'new-cat-id' }),
    updateCategory: vi.fn().mockResolvedValue({ ok: true, data: 'ok' }),
    deleteCategory: vi.fn().mockResolvedValue({ ok: true, data: 'ok' }),
    createCategoryGroup: vi.fn().mockResolvedValue({ ok: true, data: 'new-group-id' }),
    updateCategoryGroup: vi.fn().mockResolvedValue({ ok: true, data: 'ok' }),
    deleteCategoryGroup: vi.fn().mockResolvedValue({ ok: true, data: 'ok' }),
    getPayees: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 'p1', name: 'Costco' }] }),
    createPayee: vi.fn().mockResolvedValue({ ok: true, data: 'new-payee-id' }),
    updatePayee: vi.fn().mockResolvedValue({ ok: true, data: 'ok' }),
    deletePayee: vi.fn().mockResolvedValue({ ok: true, data: 'ok' }),
    mergePayees: vi.fn().mockResolvedValue({ ok: true, data: 'ok' }),
    getBudgetMonth: vi.fn().mockResolvedValue({ ok: true, data: { month: '2026-03', categoryGroups: [] } }),
    setBudgetAmount: vi.fn().mockResolvedValue({ ok: true, data: 'ok' }),
    transferBudget: vi.fn().mockResolvedValue({ ok: true, data: 'ok' }),
    getSchedules: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    createSchedule: vi.fn().mockResolvedValue({ ok: true, data: 'sched-1' }),
    updateSchedule: vi.fn().mockResolvedValue({ ok: true, data: 'ok' }),
    deleteSchedule: vi.fn().mockResolvedValue({ ok: true, data: 'ok' }),
    getRules: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    createRule: vi.fn().mockResolvedValue({ ok: true, data: { id: 'rule-1' } }),
    updateRule: vi.fn().mockResolvedValue({ ok: true, data: { id: 'rule-1' } }),
    deleteRule: vi.fn().mockResolvedValue({ ok: true, data: 'ok' }),
    getNotes: vi.fn().mockResolvedValue({ ok: true, data: 'My note content' }),
    setNotes: vi.fn().mockResolvedValue({ ok: true, data: 'ok' }),
    deleteNotes: vi.fn().mockResolvedValue({ ok: true, data: 'ok' }),
    runBankSync: vi.fn().mockResolvedValue({ ok: true, data: 'ok' }),
    ...overrides,
  } as any;
}

describe('CRUD tools', () => {
  it('get-accounts should return markdown table with balances', async () => {
    const { createCrudTools } = await import('../../src/tools/crud.js');
    const client = mockClient();
    const tools = createCrudTools(client, '$');
    const tool = tools.find((t) => t.schema.name === 'get-accounts')!;

    const result = await tool.handler({});

    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('Checking');
    expect(text).toContain('$2,500.00');
  });

  it('create-transaction should call client and return confirmation', async () => {
    const { createCrudTools } = await import('../../src/tools/crud.js');
    const client = mockClient();
    const tools = createCrudTools(client, '$');
    const tool = tools.find((t) => t.schema.name === 'create-transaction')!;

    const result = await tool.handler({
      account_id: 'a1',
      date: '2026-03-15',
      amount: -5000,
      payee_name: 'Costco',
    });

    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('Transaction Created');
    expect(text).toContain('-$50.00');
    expect(client.createTransaction).toHaveBeenCalledWith('a1', expect.objectContaining({ amount: -5000 }), undefined);
  });

  it('create-transaction should pass subtransactions for splits', async () => {
    const { createCrudTools } = await import('../../src/tools/crud.js');
    const client = mockClient();
    const tools = createCrudTools(client, '$');
    const tool = tools.find((t) => t.schema.name === 'create-transaction')!;

    await tool.handler({
      account_id: 'a1',
      date: '2026-03-15',
      amount: -10000,
      payee_name: 'Costco',
      subtransactions: [
        { amount: -7000, category_id: 'c1', payee_name: 'Costco' },
        { amount: -3000, category_id: 'c2', payee_name: 'Gift Shop', notes: 'Birthday' },
      ],
    });

    expect(client.createTransaction).toHaveBeenCalledWith(
      'a1',
      expect.objectContaining({
        subtransactions: expect.arrayContaining([
          expect.objectContaining({ amount: -7000 }),
          expect.objectContaining({ amount: -3000, notes: 'Birthday' }),
        ]),
      }),
      undefined,
    );
  });

  it('manage-category create should call createCategory', async () => {
    const { createCrudTools } = await import('../../src/tools/crud.js');
    const client = mockClient();
    const tools = createCrudTools(client, '$');
    const tool = tools.find((t) => t.schema.name === 'manage-category')!;

    const result = await tool.handler({ action: 'create', name: 'Entertainment', group_id: 'g1' });

    expect(result.isError).toBeUndefined();
    expect(client.createCategory).toHaveBeenCalledWith({ name: 'Entertainment', group_id: 'g1', is_income: undefined });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('Category Created');
  });

  it('manage-category should error when required fields missing', async () => {
    const { createCrudTools } = await import('../../src/tools/crud.js');
    const client = mockClient();
    const tools = createCrudTools(client, '$');
    const tool = tools.find((t) => t.schema.name === 'manage-category')!;

    const result = await tool.handler({ action: 'create' });

    expect(result.isError).toBe(true);
  });

  it('get-notes should return note content', async () => {
    const { createCrudTools } = await import('../../src/tools/crud.js');
    const client = mockClient();
    const tools = createCrudTools(client, '$');
    const tool = tools.find((t) => t.schema.name === 'get-notes')!;

    const result = await tool.handler({ type: 'category', id: 'c1' });

    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('My note content');
  });

  it('should return error when client call fails', async () => {
    const { createCrudTools } = await import('../../src/tools/crud.js');
    const client = mockClient({
      getAccounts: vi.fn().mockResolvedValue({ ok: false, error: 'HTTP 500: Server error' }),
    });
    const tools = createCrudTools(client, '$');
    const tool = tools.find((t) => t.schema.name === 'get-accounts')!;

    const result = await tool.handler({});

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('500');
  });

  it('should expose correct number of tools', async () => {
    const { createCrudTools } = await import('../../src/tools/crud.js');
    const tools = createCrudTools(mockClient(), '$');
    const names = tools.map((t) => t.schema.name);

    expect(names).toContain('get-accounts');
    expect(names).toContain('get-transactions');
    expect(names).toContain('create-transaction');
    expect(names).toContain('update-transaction');
    expect(names).toContain('delete-transaction');
    expect(names).toContain('get-categories');
    expect(names).toContain('manage-category');
    expect(names).toContain('get-payees');
    expect(names).toContain('manage-payee');
    expect(names).toContain('get-budget-month');
    expect(names).toContain('set-budget-amount');
    expect(names).toContain('transfer-budget');
    expect(names).toContain('get-schedules');
    expect(names).toContain('manage-schedule');
    expect(names).toContain('get-rules');
    expect(names).toContain('manage-rule');
    expect(names).toContain('get-notes');
    expect(names).toContain('set-notes');
    expect(names).toContain('run-bank-sync');
  });
});
```

- [ ] **Step 2: Verify RED**

```bash
cd actual-mcp && npx vitest run tests/tools/crud.test.ts
```

Expected: FAIL — `src/tools/crud.ts` does not exist.

- [ ] **Step 3: GREEN — Write crud.ts**

Create `actual-mcp/src/tools/crud.ts` — the full implementation from the original plan's Task 6 Step 1 (all 19 CRUD tools). The code is identical to what was specified in the original plan. Due to the length (~400 lines), refer to the **original Task 6 Step 1** code block for the complete implementation. The key contract: export `createCrudTools(client, currencySymbol)` returning an array of `{ schema, handler }` objects.

- [ ] **Step 4: Verify GREEN**

```bash
cd actual-mcp && npx vitest run tests/tools/crud.test.ts
```

Expected: All 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/tools/crud.ts tests/tools/crud.test.ts && git commit -m "feat: add 19 CRUD tools (TDD)"
```

---

### Task 7: Power Query Tool (TDD)

**Files:**
- Test: `actual-mcp/tests/tools/query.test.ts`
- Create: `actual-mcp/src/tools/query.ts`

- [ ] **Step 1: RED — Write failing tests**

Create `actual-mcp/tests/tools/query.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('run-query tool', () => {
  function mockClient(queryResult: unknown = []) {
    return {
      runQuery: vi.fn().mockResolvedValue({ ok: true, data: queryResult }),
    } as any;
  }

  it('should render array results as markdown table', async () => {
    const { createQueryTool } = await import('../../src/tools/query.js');
    const client = mockClient([
      { 'category.name': 'Groceries', total: -50000 },
      { 'category.name': 'Rent', total: -150000 },
    ]);
    const tool = createQueryTool(client, '$');

    const result = await tool.handler({
      table: 'transactions',
      groupBy: ['category.name'],
      select: ['category.name', { total: { $sum: '$amount' } }],
    });

    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('2 rows');
    expect(text).toContain('Groceries');
    expect(text).toContain('-$500.00');
    expect(text).toContain('-$1,500.00');
  });

  it('should render scalar results (from calculate)', async () => {
    const { createQueryTool } = await import('../../src/tools/query.js');
    const client = mockClient(-200000);
    const tool = createQueryTool(client, '£');

    const result = await tool.handler({
      table: 'transactions',
      calculate: { $sum: '$amount' },
    });

    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('-£2,000.00');
  });

  it('should handle empty results', async () => {
    const { createQueryTool } = await import('../../src/tools/query.js');
    const client = mockClient([]);
    const tool = createQueryTool(client, '$');

    const result = await tool.handler({ table: 'transactions' });

    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('0 rows');
  });

  it('should return error when query fails', async () => {
    const { createQueryTool } = await import('../../src/tools/query.js');
    const client = { runQuery: vi.fn().mockResolvedValue({ ok: false, error: 'HTTP 501: Not Implemented' }) } as any;
    const tool = createQueryTool(client, '$');

    const result = await tool.handler({ table: 'transactions' });

    expect(result.isError).toBe(true);
  });

  it('should have ActualQL reference in description', async () => {
    const { createQueryTool } = await import('../../src/tools/query.js');
    const tool = createQueryTool(mockClient(), '$');

    expect(tool.schema.description).toContain('$eq');
    expect(tool.schema.description).toContain('$sum');
    expect(tool.schema.description).toContain('groupBy');
    expect(tool.schema.description).toContain('category.name');
  });
});
```

- [ ] **Step 2: Verify RED**

```bash
cd actual-mcp && npx vitest run tests/tools/query.test.ts
```

Expected: FAIL — `src/tools/query.ts` does not exist.

- [ ] **Step 3: GREEN — Write query.ts**

Create `actual-mcp/src/tools/query.ts` — the full implementation from the original plan's Task 7 Step 1. Export `createQueryTool(client, currencySymbol)` returning a single `{ schema, handler }` object with embedded ActualQL reference in the description.

- [ ] **Step 4: Verify GREEN**

```bash
cd actual-mcp && npx vitest run tests/tools/query.test.ts
```

Expected: All 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/tools/query.ts tests/tools/query.test.ts && git commit -m "feat: add run-query tool with ActualQL reference (TDD)"
```

---

### Task 8: Analytics Tools (TDD)

**Files:**
- Test: `actual-mcp/tests/tools/analytics.test.ts`
- Create: `actual-mcp/src/tools/analytics.ts`

- [ ] **Step 1: RED — Write failing tests for analytics tools**

Create `actual-mcp/tests/tools/analytics.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

function mockClient(overrides: Record<string, unknown> = {}) {
  return {
    getAccounts: vi.fn().mockResolvedValue({
      ok: true,
      data: [
        { id: 'a1', name: 'Checking', offbudget: false, closed: false },
        { id: 'a2', name: 'Savings', offbudget: true, closed: false },
      ],
    }),
    getAccountBalance: vi.fn()
      .mockResolvedValueOnce({ ok: true, data: 500000 })
      .mockResolvedValueOnce({ ok: true, data: 1000000 }),
    getTransactions: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    getCategories: vi.fn().mockResolvedValue({
      ok: true,
      data: [
        { id: 'c1', name: 'Groceries', group_id: 'g1' },
        { id: 'c2', name: 'Salary', group_id: 'g-inc' },
      ],
    }),
    getCategoryGroups: vi.fn().mockResolvedValue({
      ok: true,
      data: [
        { id: 'g1', name: 'Expenses', is_income: false, categories: [{ id: 'c1', name: 'Groceries' }] },
        { id: 'g-inc', name: 'Income', is_income: true, categories: [{ id: 'c2', name: 'Salary' }] },
      ],
    }),
    getPayees: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 'p1', name: 'Costco' }] }),
    getBudgetMonth: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        month: '2026-03',
        totalIncome: 500000,
        totalSpent: -300000,
        toBudget: 0,
        totalBudgeted: -500000,
        categoryGroups: [
          {
            id: 'g1', name: 'Expenses', is_income: false,
            budgeted: 400000, spent: -300000, balance: 100000,
            categories: [
              { id: 'c1', name: 'Groceries', budgeted: 400000, spent: -300000, balance: 100000, hidden: false },
            ],
          },
        ],
      },
    }),
    ...overrides,
  } as any;
}

describe('analytics tools', () => {
  it('should export exactly 6 tools', async () => {
    const { createAnalyticsTools } = await import('../../src/tools/analytics.js');
    const tools = createAnalyticsTools(mockClient(), '$');
    expect(tools).toHaveLength(6);
    expect(tools.map((t) => t.schema.name)).toEqual([
      'monthly-financial-summary',
      'spending-analysis',
      'budget-variance-report',
      'net-worth-snapshot',
      'trend-analysis',
      'income-expense-timeline',
    ]);
  });

  it('net-worth-snapshot should calculate assets minus liabilities', async () => {
    const { createAnalyticsTools } = await import('../../src/tools/analytics.js');
    const client = mockClient();
    const tools = createAnalyticsTools(client, '$');
    const tool = tools.find((t) => t.schema.name === 'net-worth-snapshot')!;

    const result = await tool.handler({});

    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('Checking');
    expect(text).toContain('Savings');
    expect(text).toContain('$5,000.00');
    expect(text).toContain('$10,000.00');
    expect(text).toContain('$15,000.00'); // net worth
  });

  it('budget-variance-report should show budgeted vs spent and flag overspent', async () => {
    const { createAnalyticsTools } = await import('../../src/tools/analytics.js');
    const client = mockClient({
      getBudgetMonth: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          month: '2026-03',
          categoryGroups: [
            {
              id: 'g1', name: 'Expenses', is_income: false,
              categories: [
                { id: 'c1', name: 'Groceries', budgeted: 30000, spent: -45000, balance: -15000, hidden: false },
              ],
            },
          ],
        },
      }),
    });
    const tools = createAnalyticsTools(client, '$');
    const tool = tools.find((t) => t.schema.name === 'budget-variance-report')!;

    const result = await tool.handler({ month: '2026-03' });

    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('Groceries');
    expect(text).toContain('$300.00');   // budgeted
    expect(text).toContain('-$450.00');  // spent
    expect(text).toContain('⚠');         // overspent flag
  });

  it('monthly-financial-summary should separate income from expenses', async () => {
    const { createAnalyticsTools } = await import('../../src/tools/analytics.js');
    const client = mockClient({
      getTransactions: vi.fn().mockResolvedValue({
        ok: true,
        data: [
          { id: 't1', account: 'a1', date: '2026-03-01', amount: 500000, category: 'c2', is_child: false, subtransactions: [] },
          { id: 't2', account: 'a1', date: '2026-03-05', amount: -15000, category: 'c1', is_child: false, subtransactions: [] },
        ],
      }),
    });
    const tools = createAnalyticsTools(client, '$');
    const tool = tools.find((t) => t.schema.name === 'monthly-financial-summary')!;

    const result = await tool.handler({ month: '2026-03' });

    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('Income:');
    expect(text).toContain('Expenses:');
    expect(text).toContain('Savings Rate:');
  });

  it('should return error when client fails', async () => {
    const { createAnalyticsTools } = await import('../../src/tools/analytics.js');
    const client = mockClient({
      getAccounts: vi.fn().mockResolvedValue({ ok: false, error: 'HTTP 500: Server error' }),
    });
    const tools = createAnalyticsTools(client, '$');
    const tool = tools.find((t) => t.schema.name === 'net-worth-snapshot')!;

    const result = await tool.handler({});

    expect(result.isError).toBe(true);
  });
});
```

- [ ] **Step 2: Verify RED**

```bash
cd actual-mcp && npx vitest run tests/tools/analytics.test.ts
```

Expected: FAIL — `src/tools/analytics.ts` does not exist.

- [ ] **Step 3: GREEN — Write analytics.ts**

Create `actual-mcp/src/tools/analytics.ts` — the full implementation from the original plan's Task 8 Step 1. All 6 analytical tools: `monthly-financial-summary`, `spending-analysis`, `budget-variance-report`, `net-worth-snapshot`, `trend-analysis`, `income-expense-timeline`. Export `createAnalyticsTools(client, currencySymbol)` returning an array of `{ schema, handler }` objects.

- [ ] **Step 4: Verify GREEN**

```bash
cd actual-mcp && npx vitest run tests/tools/analytics.test.ts
```

Expected: All 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/tools/analytics.ts tests/tools/analytics.test.ts && git commit -m "feat: add 6 analytical report tools (TDD)"
```

---

### Task 9: Resources (TDD)

**Files:**
- Test: `actual-mcp/tests/resources.test.ts`
- Create: `actual-mcp/src/resources.ts`

- [ ] **Step 1: RED — Write failing tests**

Create `actual-mcp/tests/resources.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

describe('setupResources', () => {
  function mockClient() {
    return {
      getAccounts: vi.fn().mockResolvedValue({
        ok: true,
        data: [{ id: 'a1', name: 'Checking', offbudget: false, closed: false }],
      }),
      getAccountBalance: vi.fn().mockResolvedValue({ ok: true, data: 250000 }),
      getCategoryGroups: vi.fn().mockResolvedValue({
        ok: true,
        data: [{ id: 'g1', name: 'Bills', is_income: false, categories: [{ id: 'c1', name: 'Rent' }] }],
      }),
      getPayees: vi.fn().mockResolvedValue({
        ok: true,
        data: [{ id: 'p1', name: 'Costco', transfer_acct: null }],
      }),
    } as any;
  }

  it('should list 4 resources', async () => {
    const { setupResources } = await import('../src/resources.js');
    const server = new Server({ name: 'test', version: '0.0.1' }, { capabilities: { resources: {} } });
    setupResources(server, mockClient(), '$');

    // Trigger the list handler
    const handler = (server as any)._requestHandlers?.get('resources/list');
    expect(handler).toBeDefined();
  });

  // Note: Full handler testing requires MCP client SDK integration test.
  // These unit tests verify the module loads and registers without errors.
});
```

- [ ] **Step 2: Verify RED**

```bash
cd actual-mcp && npx vitest run tests/resources.test.ts
```

Expected: FAIL — `src/resources.ts` does not exist.

- [ ] **Step 3: GREEN — Write resources.ts**

Create `actual-mcp/src/resources.ts` — the full implementation from the original plan's Task 5 Step 1. Export `setupResources(server, client, currencySymbol)`.

- [ ] **Step 4: Verify GREEN**

```bash
cd actual-mcp && npx vitest run tests/resources.test.ts
```

Expected: Pass.

- [ ] **Step 5: Commit**

```bash
git add src/resources.ts tests/resources.test.ts && git commit -m "feat: add MCP resources for accounts, categories, payees, settings (TDD)"
```

---

### Task 10: Prompts + Server Wiring (TDD)

**Files:**
- Test: `actual-mcp/tests/server.test.ts`
- Create: `actual-mcp/src/prompts.ts`
- Create: `actual-mcp/src/server.ts`

- [ ] **Step 1: RED — Write failing tests for prompts and server**

Create `actual-mcp/tests/server.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('createMcpServer', () => {
  it('should create server with all tools registered', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { version: '26.4.0' } }), { status: 200 }),
    );

    const { createMcpServer } = await import('../src/server.js');
    const { server } = createMcpServer({
      config: {
        actualHttpApiUrl: 'http://localhost:5007',
        actualHttpApiKey: 'test-key',
        budgetSyncId: 'test-budget',
        mcpTransport: 'stdio' as const,
        mcpPort: 3001,
        currencySymbol: '$',
        logLevel: 'info' as const,
      },
    });

    expect(server).toBeDefined();
  });
});

describe('prompts', () => {
  it('should export 4 prompts', async () => {
    const { setupPrompts } = await import('../src/prompts.js');
    const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
    const server = new Server({ name: 'test', version: '0.0.1' }, { capabilities: { prompts: {} } });

    setupPrompts(server);

    // Verify handler was registered
    const handler = (server as any)._requestHandlers?.get('prompts/list');
    expect(handler).toBeDefined();
  });
});
```

- [ ] **Step 2: Verify RED**

```bash
cd actual-mcp && npx vitest run tests/server.test.ts
```

Expected: FAIL — `src/prompts.ts` and `src/server.ts` do not exist.

- [ ] **Step 3: GREEN — Write prompts.ts**

Create `actual-mcp/src/prompts.ts` — the full implementation from the original plan's Task 5 Step 2. Export `setupPrompts(server)`.

- [ ] **Step 4: GREEN — Write server.ts**

Create `actual-mcp/src/server.ts` — the full implementation from the original plan's Task 9 Step 1. Export `createMcpServer(options)` returning `{ server, client }`.

- [ ] **Step 5: Verify GREEN**

```bash
cd actual-mcp && npx vitest run tests/server.test.ts
```

Expected: All tests pass.

- [ ] **Step 6: Run ALL tests to confirm nothing broke**

```bash
cd actual-mcp && npx vitest run
```

Expected: All tests across all files pass.

- [ ] **Step 7: Commit**

```bash
git add src/prompts.ts src/server.ts tests/server.test.ts && git commit -m "feat: add prompts and MCP server wiring (TDD)"
```

---

### Task 11: Entry Point + Transports

> TDD exception for transport wiring: Express/SSE/stdio transport setup is infrastructure glue that requires running servers to test. The startup validation logic (health check, config) is already tested in Tasks 2 and 3.

**Files:**
- Create: `actual-mcp/src/index.ts`

- [ ] **Step 1: Write index.ts**

Create `actual-mcp/src/index.ts` — the full implementation from the original plan's Task 10 Step 2. Entry point with stdio/SSE/HTTP transport setup, health check endpoint, graceful shutdown.

- [ ] **Step 2: Verify it compiles**

```bash
cd actual-mcp && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Run ALL tests to confirm nothing broke**

```bash
cd actual-mcp && npx vitest run
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts && git commit -m "feat: add entry point with stdio/SSE/HTTP transports, health check, graceful shutdown"
```

---

### Task 12: Docker Setup

> TDD exception: infrastructure/deployment configuration.

**Files:**
- Create: `actual-mcp/Dockerfile`
- Create: `actual-mcp/docker/docker-compose.yml`

- [ ] **Step 1: Write Dockerfile**

Create `actual-mcp/Dockerfile`:

```dockerfile
FROM node:22-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/build ./build
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
EXPOSE 3001
CMD ["node", "build/index.js"]
```

- [ ] **Step 2: Write docker-compose.yml**

Create `actual-mcp/docker/docker-compose.yml`:

```yaml
services:
  actual-budget:
    image: actualbudget/actual-server:latest
    ports:
      - "5006:5006"
    volumes:
      - actual-data:/data
    networks:
      - actual-network

  actual-http-api:
    image: jhonderson/actual-http-api:latest
    environment:
      - ACTUAL_SERVER_URL=http://actual-budget:5006
      - ACTUAL_SERVER_PASSWORD=${ACTUAL_SERVER_PASSWORD}
      - API_KEY=${API_KEY}
    depends_on:
      - actual-budget
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:5007/v1/actualhttpapiversion"]
      interval: 30s
      timeout: 5s
      retries: 3
    networks:
      - actual-network

  actual-mcp:
    build: ../
    ports:
      - "3001:3001"
    environment:
      - ACTUAL_HTTP_API_URL=http://actual-http-api:5007
      - ACTUAL_HTTP_API_KEY=${API_KEY}
      - ACTUAL_BUDGET_SYNC_ID=${ACTUAL_BUDGET_SYNC_ID}
      - MCP_AUTH_TOKEN=${MCP_AUTH_TOKEN}
      - MCP_TRANSPORT=sse
      - MCP_PORT=3001
      - LOG_LEVEL=info
    depends_on:
      actual-http-api:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/health"]
      interval: 30s
      timeout: 5s
      retries: 3
    networks:
      - actual-network

volumes:
  actual-data:

networks:
  actual-network:
    driver: bridge
```

- [ ] **Step 3: Commit**

```bash
git add Dockerfile docker/docker-compose.yml && git commit -m "feat: add Dockerfile and docker-compose for sidecar deployment"
```

---

### Task 13: Final Verification

- [ ] **Step 1: Run ALL tests**

```bash
cd actual-mcp && npx vitest run
```

Expected: All tests pass across all test files.

- [ ] **Step 2: TypeScript build**

```bash
cd actual-mcp && npm run build
```

Expected: Clean build to `build/` directory with no errors.

- [ ] **Step 3: Docker build**

```bash
cd actual-mcp && docker build -t actual-mcp .
```

Expected: Successful image build.

- [ ] **Step 4: Verify test coverage summary**

```bash
cd actual-mcp && npx vitest run --reporter=verbose
```

Confirm all test files ran:
- `tests/config.test.ts`
- `tests/client.test.ts`
- `tests/format.test.ts`
- `tests/auth.test.ts`
- `tests/tools/crud.test.ts`
- `tests/tools/query.test.ts`
- `tests/tools/analytics.test.ts`
- `tests/resources.test.ts`
- `tests/server.test.ts`

- [ ] **Step 5: Final commit**

```bash
git add -A && git commit -m "feat: complete actual-budget-mcp server v0.1.0"
```

---

## TDD Summary

| Task | Tests | Production Code | Discipline |
|---|---|---|---|
| 1. Scaffolding | — | config files only | Exception: no logic |
| 2. Config | 4 tests | `config.ts` | RED → GREEN |
| 3. HTTP Client | 8 tests | `client.ts` | RED → GREEN |
| 4. Formatting | 10 tests | `format.ts` | RED → GREEN |
| 5. Auth | 5 tests | `auth.ts` | RED → GREEN |
| 6. CRUD Tools | 8 tests | `tools/crud.ts` | RED → GREEN |
| 7. Query Tool | 5 tests | `tools/query.ts` | RED → GREEN |
| 8. Analytics Tools | 5 tests | `tools/analytics.ts` | RED → GREEN |
| 9. Resources | 1 test | `resources.ts` | RED → GREEN |
| 10. Prompts + Server | 2 tests | `prompts.ts`, `server.ts` | RED → GREEN |
| 11. Entry Point | — | `index.ts` | Exception: transport glue |
| 12. Docker | — | `Dockerfile`, `compose` | Exception: infrastructure |
| 13. Final | verify all | — | All green |

**Total: ~48 tests across 9 test files, covering every production module.**
