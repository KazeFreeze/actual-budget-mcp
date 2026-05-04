# actual-budget-mcp v2 — Direct SDK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the v1 `actual-http-api` HTTP proxy with direct in-process use of `@actual-app/api`, fixing notes (read+write+delete), adding tags CRUD, and shipping as `actual-budget-mcp@2.0.0`.

**Architecture:** Three layers with a sharp `ActualClient` interface boundary — Transport (express + helmet + rate-limit + Bearer auth, StreamableHTTP/SSE/stdio) → Tools (zod schema → ActualClient call → formatter) → Client (`sdk-client.ts` wraps `@actual-app/api`, `fake-client.ts` for unit tests). Read tools wrapped by a 2-second `SyncCoalescer`; write tools wrapped by an audit logger and explicit post-write `sync()`.

**Tech Stack:** TypeScript 5.9 (strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`), `@actual-app/api` (latest 26.x), `@modelcontextprotocol/sdk` 1.x, express 5, helmet, express-rate-limit, zod 4, pino, p-retry, vitest 4, msw, eslint + typescript-eslint + eslint-plugin-security, prettier, husky, Docker (node:22-alpine multi-stage).

**Spec reference:** `docs/superpowers/specs/2026-05-04-v2-direct-sdk-design.md`
**Research reference:** `docs/superpowers/research/2026-05-04-v2-direct-sdk-research.md`

---

## Phase 0 — Scaffolding & dependencies

### Task 0.1: Add `@actual-app/api` and `better-sqlite3` types

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add dependency**

```bash
npm install @actual-app/api@latest
```

- [ ] **Step 2: Verify install — confirm version matches actual-server 26.x**

Run: `node -e "console.log(require('@actual-app/api/package.json').version)"`
Expected: `26.x.y` printed.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat(deps): add @actual-app/api for v2 direct SDK"
```

### Task 0.2: Bump version, update description, add scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Bump version + description + scripts**

Edit `package.json`:
- `"version": "1.0.7"` → `"version": "2.0.0-pre.1"` (release-please will retag at release)
- `"description": "MCP server for Actual Budget via actual-http-api proxy"` → `"description": "MCP server for Actual Budget using the official @actual-app/api SDK"`
- Add scripts:
  - `"test:integration": "vitest run -c vitest.integration.config.ts"`
  - `"test:e2e": "vitest run -c vitest.e2e.config.ts"`
  - `"audit:ci": "npm audit --audit-level=high"`

- [ ] **Step 2: Commit**

```bash
git add package.json
git commit -m "chore: bump to 2.0.0-pre.1 and add v2 test scripts"
```

### Task 0.3: Tighten tsconfig

**Files:**
- Modify: `tsconfig.json`

- [ ] **Step 1: Read existing tsconfig**

Run: `cat tsconfig.json`

- [ ] **Step 2: Add strict flags under `compilerOptions`**

Add (or confirm present):
```json
"strict": true,
"noUncheckedIndexedAccess": true,
"exactOptionalPropertyTypes": true,
"noImplicitOverride": true,
"noFallthroughCasesInSwitch": true
```

- [ ] **Step 3: Run typecheck**

Run: `npm run lint`
Expected: existing v1 code may emit new errors — record them in a `git stash` or fix obvious ones; defer remaining v1 errors to Phase 1 where the affected files are rewritten.

- [ ] **Step 4: Commit**

```bash
git add tsconfig.json
git commit -m "chore: tighten tsconfig with noUncheckedIndexedAccess + exactOptionalPropertyTypes"
```

### Task 0.4: Update v1 design doc with "Superseded" header

**Files:**
- Modify: `docs/superpowers/specs/2026-04-15-actual-budget-mcp-server-design.md`

- [ ] **Step 1: Prepend a 3-line block at the top of the file**

```markdown
> **Status:** Superseded by [`2026-05-04-v2-direct-sdk-design.md`](./2026-05-04-v2-direct-sdk-design.md) (v2 architecture).
> Kept for historical reference.

```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-04-15-actual-budget-mcp-server-design.md
git commit -m "docs: mark v1 design as superseded by v2 spec"
```

---

## Phase 1 — Foundation: config, auth, audit

### Task 1.1: Rewrite `src/config.ts` for v2 env vars + entropy enforcement

**Files:**
- Modify: `src/config.ts`
- Modify: `tests/config.test.ts`

- [ ] **Step 1: Write failing tests first (`tests/config.test.ts`)**

Replace contents with:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../src/config.js';

const REQUIRED_OK = {
  ACTUAL_SERVER_URL: 'http://actual:5006',
  ACTUAL_SERVER_PASSWORD: 'pw',
  ACTUAL_BUDGET_SYNC_ID: 'sync-id',
  MCP_API_KEYS: 'a'.repeat(20) + 'BCDEFGHIJKLMNOP', // 35 chars, 16 unique
  MCP_TRANSPORT: 'http',
  MCP_ALLOWED_ORIGINS: 'https://claude.ai',
};

describe('loadConfig', () => {
  const original = { ...process.env };
  beforeEach(() => {
    for (const k of Object.keys(process.env)) delete process.env[k];
  });
  afterEach(() => {
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, original);
  });

  it('loads valid v2 config', () => {
    Object.assign(process.env, REQUIRED_OK);
    const cfg = loadConfig();
    expect(cfg.actualServerUrl).toBe('http://actual:5006');
    expect(cfg.mcpApiKeys).toHaveLength(1);
  });

  it('rejects v1 env vars with migration error', () => {
    Object.assign(process.env, REQUIRED_OK, { ACTUAL_HTTP_API_URL: 'x' });
    expect(() => loadConfig()).toThrow(/MIGRATION-v1-to-v2/);
  });

  it('rejects api keys with low entropy (<32 chars)', () => {
    Object.assign(process.env, REQUIRED_OK, { MCP_API_KEYS: 'short' });
    expect(() => loadConfig()).toThrow(/at least 32 characters/);
  });

  it('rejects api keys with <16 unique chars', () => {
    Object.assign(process.env, REQUIRED_OK, { MCP_API_KEYS: 'a'.repeat(40) });
    expect(() => loadConfig()).toThrow(/16 unique/);
  });

  it('requires MCP_API_KEYS when transport is http', () => {
    Object.assign(process.env, REQUIRED_OK);
    delete process.env.MCP_API_KEYS;
    expect(() => loadConfig()).toThrow(/MCP_API_KEYS/);
  });

  it('does not require MCP_API_KEYS when transport is stdio', () => {
    Object.assign(process.env, REQUIRED_OK, { MCP_TRANSPORT: 'stdio' });
    delete process.env.MCP_API_KEYS;
    expect(() => loadConfig()).not.toThrow();
  });

  it('parses comma-separated keys for rotation', () => {
    const k1 = 'a'.repeat(20) + 'BCDEFGHIJKLMNOP';
    const k2 = 'b'.repeat(20) + 'CDEFGHIJKLMNOPQ';
    Object.assign(process.env, REQUIRED_OK, { MCP_API_KEYS: `${k1},${k2}` });
    const cfg = loadConfig();
    expect(cfg.mcpApiKeys).toEqual([k1, k2]);
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `npx vitest run tests/config.test.ts`
Expected: All fail (config still v1 shape).

- [ ] **Step 3: Replace `src/config.ts`**

```ts
import { z } from 'zod';
import 'dotenv/config';

const V1_VARS = ['ACTUAL_HTTP_API_URL', 'ACTUAL_HTTP_API_KEY'] as const;

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
      .transform((s) => (s ? s.split(',').map((k) => k.trim()).filter(Boolean) : []))
      .pipe(z.array(apiKey)),
    mcpAllowedOrigins: z
      .string()
      .optional()
      .transform((s) => (s ? s.split(',').map((o) => o.trim()).filter(Boolean) : [])),
    mcpTransport: z.enum(['stdio', 'sse', 'http']).default('stdio'),
    mcpPort: z.coerce.number().int().positive().default(3000),
    mcpRateLimitPerMin: z.coerce.number().int().positive().default(120),
    mcpDataDir: z.string().default('/var/lib/actual-mcp'),
    currencySymbol: z.string().default('$'),
    logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  })
  .refine(
    (c) => c.mcpTransport === 'stdio' || c.mcpApiKeys.length > 0,
    { message: 'MCP_API_KEYS is required when transport is http or sse', path: ['mcpApiKeys'] },
  );

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
```

- [ ] **Step 4: Run tests to confirm pass**

Run: `npx vitest run tests/config.test.ts`
Expected: 7/7 pass.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat(config): v2 env vars with multi-key rotation, entropy enforcement, v1 migration error"
```

### Task 1.2: Rewrite `src/auth.ts` for multi-key Bearer + WWW-Authenticate

**Files:**
- Modify: `src/auth.ts`
- Modify: `tests/auth.test.ts`

- [ ] **Step 1: Write failing tests first (`tests/auth.test.ts`)**

Replace contents with:

```ts
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createAuthMiddleware, originAllowlist } from '../src/auth.js';

const KEY_A = 'a'.repeat(20) + 'BCDEFGHIJKLMNOP';
const KEY_B = 'b'.repeat(20) + 'CDEFGHIJKLMNOPQ';

function appWith(keys: string[]) {
  const app = express();
  app.use(createAuthMiddleware(keys));
  app.get('/x', (_req, res) => { res.json({ ok: true }); });
  return app;
}

describe('createAuthMiddleware', () => {
  it('401 with WWW-Authenticate Bearer when header missing', async () => {
    const r = await request(appWith([KEY_A])).get('/x');
    expect(r.status).toBe(401);
    expect(r.headers['www-authenticate']).toBe('Bearer realm="actual-mcp"');
  });

  it('401 when scheme is not Bearer', async () => {
    const r = await request(appWith([KEY_A])).get('/x').set('Authorization', `Basic ${KEY_A}`);
    expect(r.status).toBe(401);
  });

  it('403 when token does not match any key', async () => {
    const r = await request(appWith([KEY_A])).get('/x').set('Authorization', 'Bearer wrong');
    expect(r.status).toBe(403);
  });

  it('200 when token matches first key', async () => {
    const r = await request(appWith([KEY_A, KEY_B])).get('/x').set('Authorization', `Bearer ${KEY_A}`);
    expect(r.status).toBe(200);
  });

  it('200 when token matches second key (rotation)', async () => {
    const r = await request(appWith([KEY_A, KEY_B])).get('/x').set('Authorization', `Bearer ${KEY_B}`);
    expect(r.status).toBe(200);
  });

  it('attaches callerKey (sha256 prefix) to req for audit logging', async () => {
    const app = express();
    app.use(createAuthMiddleware([KEY_A]));
    app.get('/x', (req, res) => { res.json({ k: (req as unknown as { callerKey: string }).callerKey }); });
    const r = await request(app).get('/x').set('Authorization', `Bearer ${KEY_A}`);
    expect(r.body.k).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe('originAllowlist', () => {
  function appWithOrigins(origins: string[]) {
    const app = express();
    app.use(originAllowlist(origins));
    app.get('/x', (_req, res) => { res.json({ ok: true }); });
    return app;
  }

  it('allows request with no Origin header', async () => {
    const r = await request(appWithOrigins(['https://claude.ai'])).get('/x');
    expect(r.status).toBe(200);
  });

  it('allows matching Origin', async () => {
    const r = await request(appWithOrigins(['https://claude.ai'])).get('/x').set('Origin', 'https://claude.ai');
    expect(r.status).toBe(200);
  });

  it('403 on non-matching Origin', async () => {
    const r = await request(appWithOrigins(['https://claude.ai'])).get('/x').set('Origin', 'https://evil.com');
    expect(r.status).toBe(403);
  });

  it('allows all Origins when allowlist is empty', async () => {
    const r = await request(appWithOrigins([])).get('/x').set('Origin', 'https://anything');
    expect(r.status).toBe(200);
  });
});
```

- [ ] **Step 2: Add supertest dev dep**

Run: `npm install -D supertest @types/supertest`

- [ ] **Step 3: Run tests to confirm failure**

Run: `npx vitest run tests/auth.test.ts`
Expected: All fail (auth still single-key, no Origin allowlist).

- [ ] **Step 4: Replace `src/auth.ts`**

```ts
import crypto from 'node:crypto';
import type { Request, RequestHandler } from 'express';

export function callerKey(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 12);
}

export function createAuthMiddleware(validKeys: string[]): RequestHandler {
  if (validKeys.length === 0) {
    throw new Error('createAuthMiddleware requires at least one key');
  }
  const buffers = validKeys.map((k) => Buffer.from(k));

  return (req, res, next) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      res.set('WWW-Authenticate', 'Bearer realm="actual-mcp"');
      res.status(401).json({ error: 'Missing Bearer token' });
      return;
    }
    const provided = Buffer.from(header.slice(7));
    const matched = buffers.some(
      (buf) => provided.length === buf.length && crypto.timingSafeEqual(provided, buf),
    );
    if (!matched) {
      res.status(403).json({ error: 'Invalid token' });
      return;
    }
    (req as Request & { callerKey: string }).callerKey = callerKey(header.slice(7));
    next();
  };
}

export function originAllowlist(allowed: string[]): RequestHandler {
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (!origin || allowed.length === 0) {
      next();
      return;
    }
    if (!allowed.includes(origin)) {
      res.status(403).json({ error: 'Origin not allowed' });
      return;
    }
    next();
  };
}
```

- [ ] **Step 5: Run tests to confirm pass**

Run: `npx vitest run tests/auth.test.ts`
Expected: 10/10 pass.

- [ ] **Step 6: Commit**

```bash
git add src/auth.ts tests/auth.test.ts package.json package-lock.json
git commit -m "feat(auth): multi-key Bearer with WWW-Authenticate, callerKey, Origin allowlist"
```

### Task 1.3: Add audit logger module

**Files:**
- Create: `src/audit.ts`
- Create: `tests/audit.test.ts`

- [ ] **Step 1: Write failing tests first**

```ts
import { describe, it, expect, vi } from 'vitest';
import pino from 'pino';
import { Writable } from 'node:stream';
import { withAudit } from '../src/audit.js';

function captureLogger(): { logger: pino.Logger; lines: string[] } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) { lines.push(chunk.toString()); cb(); },
  });
  return { logger: pino({ level: 'info' }, stream), lines };
}

describe('withAudit', () => {
  it('logs ok result with tool, durationMs, callerKey', async () => {
    const { logger, lines } = captureLogger();
    const handler = withAudit(logger, 'set-notes', async () => 'done');
    const result = await handler({ id: 'x', note: 'hi' }, 'abc123def456');
    expect(result).toBe('done');
    const entry = JSON.parse(lines[0] ?? '{}');
    expect(entry.audit).toBe(true);
    expect(entry.tool).toBe('set-notes');
    expect(entry.result).toBe('ok');
    expect(entry.callerKey).toBe('abc123def456');
    expect(typeof entry.durationMs).toBe('number');
  });

  it('logs err result on throw and re-throws', async () => {
    const { logger, lines } = captureLogger();
    const handler = withAudit(logger, 'set-notes', async () => {
      throw new Error('boom');
    });
    await expect(handler({}, 'k')).rejects.toThrow('boom');
    const entry = JSON.parse(lines[0] ?? '{}');
    expect(entry.result).toBe('err');
    expect(entry.errorMessage).toBe('boom');
  });

  it('never includes the bearer token in any log line', async () => {
    const { logger, lines } = captureLogger();
    const SECRET = 'super-secret-bearer-token-aaaaaaaaaaa';
    const handler = withAudit(logger, 'set-notes', async () => SECRET);
    await handler({ note: SECRET }, 'k');
    for (const line of lines) {
      expect(line).not.toContain(SECRET);
    }
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `npx vitest run tests/audit.test.ts`
Expected: Fails — `src/audit.ts` does not exist.

- [ ] **Step 3: Create `src/audit.ts`**

```ts
import type pino from 'pino';

export type AuditedHandler<I, O> = (input: I, callerKey: string) => Promise<O>;

export function withAudit<I, O>(
  baseLogger: pino.Logger,
  tool: string,
  fn: (input: I) => Promise<O>,
): AuditedHandler<I, O> {
  const auditLogger = baseLogger.child({ audit: true });
  return async (input, callerKey) => {
    const start = Date.now();
    try {
      const result = await fn(input);
      auditLogger.info(
        { tool, callerKey, result: 'ok', durationMs: Date.now() - start },
        'audit',
      );
      return result;
    } catch (err) {
      auditLogger.warn(
        {
          tool,
          callerKey,
          result: 'err',
          durationMs: Date.now() - start,
          errorMessage: err instanceof Error ? err.message : String(err),
        },
        'audit',
      );
      throw err;
    }
  };
}
```

- [ ] **Step 4: Run tests to confirm pass**

Run: `npx vitest run tests/audit.test.ts`
Expected: 3/3 pass.

- [ ] **Step 5: Commit**

```bash
git add src/audit.ts tests/audit.test.ts
git commit -m "feat(audit): write-tool audit logger with callerKey and no-token guarantee"
```

---

## Phase 2 — Client layer: ActualClient interface, SDK adapter, fake, sync coalescer

### Task 2.1: Define `ActualClient` interface

**Files:**
- Create: `src/client/actual-client.ts`

- [ ] **Step 1: Write the interface**

```ts
export interface Account {
  id: string;
  name: string;
  type?: string;
  offbudget?: boolean;
  closed?: boolean;
}

export interface Category {
  id: string;
  name: string;
  group_id: string;
  is_income?: boolean;
  hidden?: boolean;
}

export interface CategoryGroup {
  id: string;
  name: string;
  is_income?: boolean;
  categories?: Category[];
}

export interface Payee {
  id: string;
  name: string;
  transfer_acct?: string | null;
}

export interface Transaction {
  id: string;
  account: string;
  date: string;
  amount: number;
  payee?: string | null;
  category?: string | null;
  notes?: string | null;
  cleared?: boolean;
  reconciled?: boolean;
  imported_id?: string | null;
  subtransactions?: Transaction[];
}

export interface Note {
  id: string;
  note: string;
}

export interface Tag {
  id: string;
  tag: string;
  color?: string | null;
}

export interface BudgetMonth {
  month: string;
  incomeAvailable: number;
  lastMonthOverspent: number;
  forNextMonth: number;
  totalBudgeted: number;
  toBudget: number;
  fromLastMonth: number;
  totalIncome: number;
  totalSpent: number;
  totalBalance: number;
  categoryGroups: Array<{
    id: string;
    name: string;
    is_income: boolean;
    budgeted: number;
    spent: number;
    balance: number;
    categories: Array<{
      id: string;
      name: string;
      is_income: boolean;
      hidden: boolean;
      budgeted: number;
      spent: number;
      balance: number;
      carryover?: boolean;
    }>;
  }>;
}

export interface Schedule {
  id: string;
  rule: string;
  active: boolean;
  completed: boolean;
  posts_transaction: boolean;
  name: string | null;
  next_date: string;
  _date?: unknown;
  _conditions?: unknown;
  _actions?: unknown;
  _account?: string | null;
  _amount?: number;
  _payee?: string | null;
}

export interface Rule {
  id: string;
  stage: string | null;
  conditionsOp: 'and' | 'or';
  conditions: unknown[];
  actions: unknown[];
}

export interface ActualClient {
  // lifecycle
  init(): Promise<void>;
  shutdown(): Promise<void>;
  sync(): Promise<void>;

  // raw query
  runQuery<T = unknown>(query: unknown): Promise<T>;

  // categories
  getCategories(): Promise<Category[]>;
  createCategory(input: Omit<Category, 'id'>): Promise<string>;
  updateCategory(id: string, fields: Partial<Omit<Category, 'id'>>): Promise<void>;
  deleteCategory(id: string, transferCategoryId?: string): Promise<void>;
  getCategoryGroups(): Promise<CategoryGroup[]>;
  createCategoryGroup(input: Omit<CategoryGroup, 'id' | 'categories'>): Promise<string>;
  updateCategoryGroup(id: string, fields: Partial<Omit<CategoryGroup, 'id' | 'categories'>>): Promise<void>;
  deleteCategoryGroup(id: string, transferCategoryId?: string): Promise<void>;

  // accounts
  getAccounts(): Promise<Account[]>;
  createAccount(input: Omit<Account, 'id'>, initialBalance?: number): Promise<string>;
  updateAccount(id: string, fields: Partial<Omit<Account, 'id'>>): Promise<void>;
  closeAccount(id: string, transferAccountId?: string, transferCategoryId?: string): Promise<void>;
  reopenAccount(id: string): Promise<void>;
  deleteAccount(id: string): Promise<void>;
  getAccountBalance(id: string, cutoff?: Date): Promise<number>;
  runBankSync(accountId?: string): Promise<void>;

  // transactions
  getTransactions(accountId: string, sinceDate: string, untilDate: string): Promise<Transaction[]>;
  addTransactions(accountId: string, transactions: Omit<Transaction, 'id'>[], opts?: { learnCategories?: boolean; runTransfers?: boolean }): Promise<string>;
  importTransactions(accountId: string, transactions: Omit<Transaction, 'id'>[]): Promise<{ added: string[]; updated: string[] }>;
  updateTransaction(id: string, fields: Partial<Omit<Transaction, 'id'>>): Promise<void>;
  deleteTransaction(id: string): Promise<void>;

  // payees
  getPayees(): Promise<Payee[]>;
  createPayee(input: Omit<Payee, 'id'>): Promise<string>;
  updatePayee(id: string, fields: Partial<Omit<Payee, 'id'>>): Promise<void>;
  deletePayee(id: string): Promise<void>;
  mergePayees(targetId: string, mergeIds: string[]): Promise<void>;
  getCommonPayees(): Promise<Payee[]>;

  // rules
  getRules(): Promise<Rule[]>;
  getPayeeRules(payeeId: string): Promise<Rule[]>;
  createRule(rule: Omit<Rule, 'id'>): Promise<Rule>;
  updateRule(rule: Rule): Promise<Rule>;
  deleteRule(id: string): Promise<void>;

  // budget month
  getBudgetMonth(month: string): Promise<BudgetMonth>;
  getBudgetMonths(): Promise<string[]>;
  setBudgetAmount(month: string, categoryId: string, value: number): Promise<void>;
  setBudgetCarryover(month: string, categoryId: string, flag: boolean): Promise<void>;
  holdBudgetForNextMonth(month: string, amount: number): Promise<void>;
  resetBudgetHold(month: string): Promise<void>;

  // schedules
  getSchedules(): Promise<Schedule[]>;

  // notes (NEW — fixed in v2)
  getNote(id: string): Promise<string | null>;
  setNote(id: string, note: string): Promise<void>;
  deleteNote(id: string): Promise<void>;

  // tags (NEW)
  getTags(): Promise<Tag[]>;
  createTag(tag: Omit<Tag, 'id'>): Promise<Tag>;
  updateTag(id: string, fields: Partial<Omit<Tag, 'id'>>): Promise<void>;
  deleteTag(id: string): Promise<void>;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: pass (interface is self-contained).

- [ ] **Step 3: Commit**

```bash
git add src/client/actual-client.ts
git commit -m "feat(client): add ActualClient interface — the boundary the rest of v2 depends on"
```

### Task 2.2: Implement `FakeActualClient` (in-memory)

**Files:**
- Create: `src/client/fake-client.ts`
- Create: `tests/unit/client/fake-client.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { FakeActualClient } from '../../../src/client/fake-client.js';

describe('FakeActualClient', () => {
  let c: FakeActualClient;
  beforeEach(() => { c = new FakeActualClient(); });

  it('creates and lists categories', async () => {
    const id = await c.createCategory({ name: 'Food', group_id: 'g1' });
    const cats = await c.getCategories();
    expect(cats).toHaveLength(1);
    expect(cats[0]).toMatchObject({ id, name: 'Food', group_id: 'g1' });
  });

  it('round-trips notes via setNote/getNote/deleteNote', async () => {
    await c.setNote('cat-1', 'hello');
    expect(await c.getNote('cat-1')).toBe('hello');
    await c.deleteNote('cat-1');
    expect(await c.getNote('cat-1')).toBe(null);
  });

  it('records sync calls', async () => {
    await c.sync();
    await c.sync();
    expect(c.syncCount).toBe(2);
  });

  it('throws an error from a configurable hook', async () => {
    c.failNextSyncWith(new Error('network'));
    await expect(c.sync()).rejects.toThrow('network');
    await expect(c.sync()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test, confirm failure**

Run: `npx vitest run tests/unit/client/fake-client.test.ts`
Expected: file-not-found error.

- [ ] **Step 3: Create the fake**

```ts
import crypto from 'node:crypto';
import type {
  ActualClient, Account, Category, CategoryGroup, Payee, Transaction,
  Note, Tag, BudgetMonth, Schedule, Rule,
} from './actual-client.js';

const uuid = (): string => crypto.randomUUID();

export class FakeActualClient implements ActualClient {
  syncCount = 0;
  private nextSyncError: Error | null = null;

  private accounts = new Map<string, Account>();
  private categories = new Map<string, Category>();
  private categoryGroups = new Map<string, CategoryGroup>();
  private payees = new Map<string, Payee>();
  private transactions = new Map<string, Transaction>();
  private notes = new Map<string, string>();
  private tags = new Map<string, Tag>();
  private rules = new Map<string, Rule>();
  private schedules = new Map<string, Schedule>();
  private budgetMonths = new Map<string, BudgetMonth>();

  failNextSyncWith(err: Error): void { this.nextSyncError = err; }

  async init(): Promise<void> {}
  async shutdown(): Promise<void> {}
  async sync(): Promise<void> {
    this.syncCount++;
    if (this.nextSyncError) {
      const e = this.nextSyncError;
      this.nextSyncError = null;
      throw e;
    }
  }
  async runQuery<T>(_q: unknown): Promise<T> { return [] as unknown as T; }

  // categories
  async getCategories(): Promise<Category[]> { return [...this.categories.values()]; }
  async createCategory(input: Omit<Category, 'id'>): Promise<string> {
    const id = uuid(); this.categories.set(id, { id, ...input }); return id;
  }
  async updateCategory(id: string, fields: Partial<Omit<Category, 'id'>>): Promise<void> {
    const cur = this.categories.get(id); if (!cur) throw new Error(`unknown category ${id}`);
    this.categories.set(id, { ...cur, ...fields });
  }
  async deleteCategory(id: string): Promise<void> { this.categories.delete(id); }
  async getCategoryGroups(): Promise<CategoryGroup[]> { return [...this.categoryGroups.values()]; }
  async createCategoryGroup(input: Omit<CategoryGroup, 'id' | 'categories'>): Promise<string> {
    const id = uuid(); this.categoryGroups.set(id, { id, ...input, categories: [] }); return id;
  }
  async updateCategoryGroup(id: string, fields: Partial<Omit<CategoryGroup, 'id' | 'categories'>>): Promise<void> {
    const cur = this.categoryGroups.get(id); if (!cur) throw new Error(`unknown group ${id}`);
    this.categoryGroups.set(id, { ...cur, ...fields });
  }
  async deleteCategoryGroup(id: string): Promise<void> { this.categoryGroups.delete(id); }

  // accounts
  async getAccounts(): Promise<Account[]> { return [...this.accounts.values()]; }
  async createAccount(input: Omit<Account, 'id'>): Promise<string> {
    const id = uuid(); this.accounts.set(id, { id, ...input }); return id;
  }
  async updateAccount(id: string, fields: Partial<Omit<Account, 'id'>>): Promise<void> {
    const cur = this.accounts.get(id); if (!cur) throw new Error(`unknown account ${id}`);
    this.accounts.set(id, { ...cur, ...fields });
  }
  async closeAccount(id: string): Promise<void> {
    const cur = this.accounts.get(id); if (!cur) return;
    this.accounts.set(id, { ...cur, closed: true });
  }
  async reopenAccount(id: string): Promise<void> {
    const cur = this.accounts.get(id); if (!cur) return;
    this.accounts.set(id, { ...cur, closed: false });
  }
  async deleteAccount(id: string): Promise<void> { this.accounts.delete(id); }
  async getAccountBalance(id: string): Promise<number> {
    let sum = 0;
    for (const t of this.transactions.values()) if (t.account === id) sum += t.amount;
    return sum;
  }
  async runBankSync(): Promise<void> {}

  // transactions
  async getTransactions(accountId: string, since: string, until: string): Promise<Transaction[]> {
    return [...this.transactions.values()].filter(
      (t) => t.account === accountId && t.date >= since && t.date <= until,
    );
  }
  async addTransactions(accountId: string, txs: Omit<Transaction, 'id'>[]): Promise<string> {
    for (const t of txs) {
      const id = uuid();
      this.transactions.set(id, { id, ...t, account: accountId });
    }
    return 'ok';
  }
  async importTransactions(accountId: string, txs: Omit<Transaction, 'id'>[]): Promise<{ added: string[]; updated: string[] }> {
    const added: string[] = [];
    for (const t of txs) {
      const id = uuid();
      this.transactions.set(id, { id, ...t, account: accountId });
      added.push(id);
    }
    return { added, updated: [] };
  }
  async updateTransaction(id: string, fields: Partial<Omit<Transaction, 'id'>>): Promise<void> {
    const cur = this.transactions.get(id); if (!cur) throw new Error(`unknown tx ${id}`);
    this.transactions.set(id, { ...cur, ...fields });
  }
  async deleteTransaction(id: string): Promise<void> { this.transactions.delete(id); }

  // payees
  async getPayees(): Promise<Payee[]> { return [...this.payees.values()]; }
  async createPayee(input: Omit<Payee, 'id'>): Promise<string> {
    const id = uuid(); this.payees.set(id, { id, ...input }); return id;
  }
  async updatePayee(id: string, fields: Partial<Omit<Payee, 'id'>>): Promise<void> {
    const cur = this.payees.get(id); if (!cur) throw new Error(`unknown payee ${id}`);
    this.payees.set(id, { ...cur, ...fields });
  }
  async deletePayee(id: string): Promise<void> { this.payees.delete(id); }
  async mergePayees(targetId: string, mergeIds: string[]): Promise<void> {
    for (const id of mergeIds) this.payees.delete(id);
    if (!this.payees.has(targetId)) throw new Error(`unknown target payee ${targetId}`);
  }
  async getCommonPayees(): Promise<Payee[]> { return this.getPayees(); }

  // rules
  async getRules(): Promise<Rule[]> { return [...this.rules.values()]; }
  async getPayeeRules(): Promise<Rule[]> { return []; }
  async createRule(rule: Omit<Rule, 'id'>): Promise<Rule> {
    const id = uuid(); const full: Rule = { id, ...rule }; this.rules.set(id, full); return full;
  }
  async updateRule(rule: Rule): Promise<Rule> { this.rules.set(rule.id, rule); return rule; }
  async deleteRule(id: string): Promise<void> { this.rules.delete(id); }

  // budget
  async getBudgetMonth(month: string): Promise<BudgetMonth> {
    return this.budgetMonths.get(month) ?? {
      month, incomeAvailable: 0, lastMonthOverspent: 0, forNextMonth: 0,
      totalBudgeted: 0, toBudget: 0, fromLastMonth: 0, totalIncome: 0,
      totalSpent: 0, totalBalance: 0, categoryGroups: [],
    };
  }
  async getBudgetMonths(): Promise<string[]> { return [...this.budgetMonths.keys()]; }
  async setBudgetAmount(): Promise<void> {}
  async setBudgetCarryover(): Promise<void> {}
  async holdBudgetForNextMonth(): Promise<void> {}
  async resetBudgetHold(): Promise<void> {}

  // schedules
  async getSchedules(): Promise<Schedule[]> { return [...this.schedules.values()]; }

  // notes
  async getNote(id: string): Promise<string | null> { return this.notes.get(id) ?? null; }
  async setNote(id: string, note: string): Promise<void> { this.notes.set(id, note); }
  async deleteNote(id: string): Promise<void> { this.notes.delete(id); }

  // tags
  async getTags(): Promise<Tag[]> { return [...this.tags.values()]; }
  async createTag(tag: Omit<Tag, 'id'>): Promise<Tag> {
    const id = uuid(); const full: Tag = { id, ...tag }; this.tags.set(id, full); return full;
  }
  async updateTag(id: string, fields: Partial<Omit<Tag, 'id'>>): Promise<void> {
    const cur = this.tags.get(id); if (!cur) throw new Error(`unknown tag ${id}`);
    this.tags.set(id, { ...cur, ...fields });
  }
  async deleteTag(id: string): Promise<void> { this.tags.delete(id); }

  // helpers for tests
  _seedAccount(a: Account): void { this.accounts.set(a.id, a); }
  _seedCategory(c: Category): void { this.categories.set(c.id, c); }
  _seedTransaction(t: Transaction): void { this.transactions.set(t.id, t); }
  _seedNote(id: string, note: string): void { this.notes.set(id, note); }
}
```

- [ ] **Step 4: Run test to confirm pass**

Run: `npx vitest run tests/unit/client/fake-client.test.ts`
Expected: 4/4 pass.

- [ ] **Step 5: Commit**

```bash
git add src/client/fake-client.ts tests/unit/client/fake-client.test.ts
git commit -m "feat(client): in-memory FakeActualClient for unit tests"
```

### Task 2.3: Implement `SyncCoalescer`

**Files:**
- Create: `src/client/sync-coalescer.ts`
- Create: `tests/unit/client/sync-coalescer.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SyncCoalescer } from '../../../src/client/sync-coalescer.js';
import { FakeActualClient } from '../../../src/client/fake-client.js';

describe('SyncCoalescer', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('first call triggers sync', async () => {
    const c = new FakeActualClient();
    const coalescer = new SyncCoalescer(c, 2000);
    await coalescer.maybeSync();
    expect(c.syncCount).toBe(1);
  });

  it('skips sync within window', async () => {
    const c = new FakeActualClient();
    const coalescer = new SyncCoalescer(c, 2000);
    await coalescer.maybeSync();
    vi.advanceTimersByTime(500);
    await coalescer.maybeSync();
    expect(c.syncCount).toBe(1);
  });

  it('syncs again after window elapses', async () => {
    const c = new FakeActualClient();
    const coalescer = new SyncCoalescer(c, 2000);
    await coalescer.maybeSync();
    vi.advanceTimersByTime(2500);
    await coalescer.maybeSync();
    expect(c.syncCount).toBe(2);
  });

  it('dedupes concurrent calls', async () => {
    const c = new FakeActualClient();
    const coalescer = new SyncCoalescer(c, 2000);
    await Promise.all([coalescer.maybeSync(), coalescer.maybeSync(), coalescer.maybeSync()]);
    expect(c.syncCount).toBe(1);
  });

  it('does not advance lastSyncAt on failure', async () => {
    const c = new FakeActualClient();
    c.failNextSyncWith(new Error('boom'));
    const coalescer = new SyncCoalescer(c, 2000);
    await expect(coalescer.maybeSync()).rejects.toThrow('boom');
    await coalescer.maybeSync(); // should retry immediately
    expect(c.syncCount).toBe(2);
  });

  it('exposes lastSyncAt and lastSyncSucceeded for /health', async () => {
    const c = new FakeActualClient();
    const coalescer = new SyncCoalescer(c, 2000);
    expect(coalescer.lastSyncAt).toBe(null);
    await coalescer.maybeSync();
    expect(coalescer.lastSyncSucceeded).toBe(true);
    expect(coalescer.lastSyncAt).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 2: Run test, confirm failure**

Run: `npx vitest run tests/unit/client/sync-coalescer.test.ts`
Expected: file-not-found.

- [ ] **Step 3: Implement `SyncCoalescer`**

```ts
import type { ActualClient } from './actual-client.js';

export class SyncCoalescer {
  private _lastSyncAt: Date | null = null;
  private _lastSyncSucceeded = false;
  private inFlight: Promise<void> | null = null;

  constructor(private readonly sdk: Pick<ActualClient, 'sync'>, private readonly windowMs = 2000) {}

  get lastSyncAt(): Date | null { return this._lastSyncAt; }
  get lastSyncSucceeded(): boolean { return this._lastSyncSucceeded; }

  async maybeSync(): Promise<void> {
    if (this._lastSyncAt && Date.now() - this._lastSyncAt.getTime() < this.windowMs && this._lastSyncSucceeded) {
      return;
    }
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.sdk.sync()
      .then(() => {
        this._lastSyncAt = new Date();
        this._lastSyncSucceeded = true;
      })
      .catch((err: unknown) => {
        this._lastSyncSucceeded = false;
        throw err;
      })
      .finally(() => { this.inFlight = null; });

    return this.inFlight;
  }
}
```

- [ ] **Step 4: Run test, confirm pass**

Run: `npx vitest run tests/unit/client/sync-coalescer.test.ts`
Expected: 6/6 pass.

- [ ] **Step 5: Commit**

```bash
git add src/client/sync-coalescer.ts tests/unit/client/sync-coalescer.test.ts
git commit -m "feat(client): SyncCoalescer with 2s window and concurrent dedupe"
```

### Task 2.4: Implement `SdkActualClient` (real impl wrapping `@actual-app/api`)

**Files:**
- Create: `src/client/sdk-client.ts`
- Create: `tests/unit/client/sdk-client.test.ts`

- [ ] **Step 1: Write a small unit test for the constructor + delegation pattern**

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@actual-app/api', () => {
  return {
    init: vi.fn(async () => {}),
    shutdown: vi.fn(async () => {}),
    sync: vi.fn(async () => {}),
    downloadBudget: vi.fn(async () => {}),
    getCategories: vi.fn(async () => [{ id: 'c1', name: 'Food', group_id: 'g1' }]),
    aqlQuery: vi.fn(async () => ({ data: [{ id: 'note-1', note: 'hi' }] })),
    internal: { send: vi.fn(async () => undefined) },
    q: vi.fn((table: string) => ({
      filter: () => ({ select: () => ({ table, kind: 'query' }) }),
    })),
  };
});

import { SdkActualClient } from '../../../src/client/sdk-client.js';

describe('SdkActualClient', () => {
  it('delegates getCategories to api.getCategories', async () => {
    const c = new SdkActualClient({
      dataDir: '/tmp/x', serverURL: 'http://x', password: 'p', syncId: 's',
    });
    const cats = await c.getCategories();
    expect(cats).toEqual([{ id: 'c1', name: 'Food', group_id: 'g1' }]);
  });

  it('reads notes via aqlQuery on the notes table', async () => {
    const c = new SdkActualClient({
      dataDir: '/tmp/x', serverURL: 'http://x', password: 'p', syncId: 's',
    });
    const note = await c.getNote('note-1');
    expect(note).toBe('hi');
  });

  it('writes notes via internal.send(notes-save)', async () => {
    const api = await import('@actual-app/api');
    const c = new SdkActualClient({
      dataDir: '/tmp/x', serverURL: 'http://x', password: 'p', syncId: 's',
    });
    await c.setNote('note-1', 'updated');
    expect(api.internal.send).toHaveBeenCalledWith('notes-save', { id: 'note-1', note: 'updated' });
  });
});
```

- [ ] **Step 2: Run test, confirm failure**

Run: `npx vitest run tests/unit/client/sdk-client.test.ts`
Expected: file-not-found.

- [ ] **Step 3: Implement `SdkActualClient`**

```ts
import * as api from '@actual-app/api';
import type {
  ActualClient, Account, Category, CategoryGroup, Payee, Transaction,
  Note, Tag, BudgetMonth, Schedule, Rule,
} from './actual-client.js';

export interface SdkActualClientOptions {
  dataDir: string;
  serverURL: string;
  password: string;
  syncId: string;
  encryptionPassword?: string;
}

export class SdkActualClient implements ActualClient {
  private initialized = false;

  constructor(private readonly opts: SdkActualClientOptions) {}

  async init(): Promise<void> {
    if (this.initialized) return;
    await api.init({ dataDir: this.opts.dataDir, serverURL: this.opts.serverURL, password: this.opts.password });
    await api.downloadBudget(this.opts.syncId, this.opts.encryptionPassword
      ? { password: this.opts.encryptionPassword } : undefined);
    this.initialized = true;
  }

  async shutdown(): Promise<void> {
    if (!this.initialized) return;
    await api.shutdown();
    this.initialized = false;
  }

  async sync(): Promise<void> {
    // @actual-app/api exposes sync via the internal lib
    await (api as unknown as { sync: () => Promise<void> }).sync();
  }

  async runQuery<T>(query: unknown): Promise<T> {
    return (await api.aqlQuery(query as Parameters<typeof api.aqlQuery>[0])) as unknown as T;
  }

  // ---- categories
  async getCategories(): Promise<Category[]> { return (await api.getCategories()) as Category[]; }
  async createCategory(input: Omit<Category, 'id'>): Promise<string> {
    return api.createCategory(input as Parameters<typeof api.createCategory>[0]);
  }
  async updateCategory(id: string, fields: Partial<Omit<Category, 'id'>>): Promise<void> {
    await api.updateCategory(id, fields as Parameters<typeof api.updateCategory>[1]);
  }
  async deleteCategory(id: string, transferCategoryId?: string): Promise<void> {
    await api.deleteCategory(id, transferCategoryId);
  }
  async getCategoryGroups(): Promise<CategoryGroup[]> { return (await api.getCategoryGroups()) as CategoryGroup[]; }
  async createCategoryGroup(input: Omit<CategoryGroup, 'id' | 'categories'>): Promise<string> {
    return api.createCategoryGroup(input as Parameters<typeof api.createCategoryGroup>[0]);
  }
  async updateCategoryGroup(id: string, fields: Partial<Omit<CategoryGroup, 'id' | 'categories'>>): Promise<void> {
    await api.updateCategoryGroup(id, fields as Parameters<typeof api.updateCategoryGroup>[1]);
  }
  async deleteCategoryGroup(id: string, transferCategoryId?: string): Promise<void> {
    await api.deleteCategoryGroup(id, transferCategoryId);
  }

  // ---- accounts
  async getAccounts(): Promise<Account[]> { return (await api.getAccounts()) as Account[]; }
  async createAccount(input: Omit<Account, 'id'>, initialBalance = 0): Promise<string> {
    return api.createAccount(input as Parameters<typeof api.createAccount>[0], initialBalance);
  }
  async updateAccount(id: string, fields: Partial<Omit<Account, 'id'>>): Promise<void> {
    await api.updateAccount(id, fields as Parameters<typeof api.updateAccount>[1]);
  }
  async closeAccount(id: string, transferAccountId?: string, transferCategoryId?: string): Promise<void> {
    await api.closeAccount(id, transferAccountId, transferCategoryId);
  }
  async reopenAccount(id: string): Promise<void> { await api.reopenAccount(id); }
  async deleteAccount(id: string): Promise<void> { await api.deleteAccount(id); }
  async getAccountBalance(id: string, cutoff?: Date): Promise<number> {
    return api.getAccountBalance(id, cutoff);
  }
  async runBankSync(accountId?: string): Promise<void> {
    await api.runBankSync(accountId ? { accountId } : undefined);
  }

  // ---- transactions
  async getTransactions(accountId: string, since: string, until: string): Promise<Transaction[]> {
    return (await api.getTransactions(accountId, since, until)) as Transaction[];
  }
  async addTransactions(accountId: string, txs: Omit<Transaction, 'id'>[], opts?: { learnCategories?: boolean; runTransfers?: boolean }): Promise<string> {
    return api.addTransactions(accountId, txs as Parameters<typeof api.addTransactions>[1], opts);
  }
  async importTransactions(accountId: string, txs: Omit<Transaction, 'id'>[]): Promise<{ added: string[]; updated: string[] }> {
    return api.importTransactions(accountId, txs as Parameters<typeof api.importTransactions>[1]);
  }
  async updateTransaction(id: string, fields: Partial<Omit<Transaction, 'id'>>): Promise<void> {
    await api.updateTransaction(id, fields as Parameters<typeof api.updateTransaction>[1]);
  }
  async deleteTransaction(id: string): Promise<void> { await api.deleteTransaction(id); }

  // ---- payees
  async getPayees(): Promise<Payee[]> { return (await api.getPayees()) as Payee[]; }
  async createPayee(input: Omit<Payee, 'id'>): Promise<string> {
    return api.createPayee(input as Parameters<typeof api.createPayee>[0]);
  }
  async updatePayee(id: string, fields: Partial<Omit<Payee, 'id'>>): Promise<void> {
    await api.updatePayee(id, fields as Parameters<typeof api.updatePayee>[1]);
  }
  async deletePayee(id: string): Promise<void> { await api.deletePayee(id); }
  async mergePayees(targetId: string, mergeIds: string[]): Promise<void> {
    await api.mergePayees(targetId, mergeIds);
  }
  async getCommonPayees(): Promise<Payee[]> { return (await api.getCommonPayees()) as Payee[]; }

  // ---- rules
  async getRules(): Promise<Rule[]> { return (await api.getRules()) as Rule[]; }
  async getPayeeRules(payeeId: string): Promise<Rule[]> { return (await api.getPayeeRules(payeeId)) as Rule[]; }
  async createRule(rule: Omit<Rule, 'id'>): Promise<Rule> {
    return (await api.createRule(rule as Parameters<typeof api.createRule>[0])) as Rule;
  }
  async updateRule(rule: Rule): Promise<Rule> {
    return (await api.updateRule(rule as Parameters<typeof api.updateRule>[0])) as Rule;
  }
  async deleteRule(id: string): Promise<void> { await api.deleteRule(id); }

  // ---- budget
  async getBudgetMonth(month: string): Promise<BudgetMonth> {
    return (await api.getBudgetMonth(month)) as BudgetMonth;
  }
  async getBudgetMonths(): Promise<string[]> {
    const months = await api.getBudgetMonths();
    return months.map((m: { month: string } | string) => (typeof m === 'string' ? m : m.month));
  }
  async setBudgetAmount(month: string, categoryId: string, value: number): Promise<void> {
    await api.setBudgetAmount(month, categoryId, value);
  }
  async setBudgetCarryover(month: string, categoryId: string, flag: boolean): Promise<void> {
    await api.setBudgetCarryover(month, categoryId, flag);
  }
  async holdBudgetForNextMonth(month: string, amount: number): Promise<void> {
    await api.holdBudgetForNextMonth(month, amount);
  }
  async resetBudgetHold(month: string): Promise<void> { await api.resetBudgetHold(month); }

  // ---- schedules — read via AQL
  async getSchedules(): Promise<Schedule[]> {
    const res = await api.aqlQuery(api.q('schedules').select('*'));
    return (res as { data: Schedule[] }).data;
  }

  // ---- notes (the v2 fix)
  async getNote(id: string): Promise<string | null> {
    const res = await api.aqlQuery(api.q('notes').filter({ id }).select(['id', 'note']));
    const rows = (res as { data: Note[] }).data;
    return rows[0]?.note ?? null;
  }
  async setNote(id: string, note: string): Promise<void> {
    await api.internal.send('notes-save', { id, note });
  }
  async deleteNote(id: string): Promise<void> {
    await api.internal.send('notes-save', { id, note: null });
  }

  // ---- tags
  async getTags(): Promise<Tag[]> {
    const res = await api.aqlQuery(api.q('tags').select('*'));
    return (res as { data: Tag[] }).data;
  }
  async createTag(tag: Omit<Tag, 'id'>): Promise<Tag> {
    return (await api.internal.send('tags-create', tag)) as Tag;
  }
  async updateTag(id: string, fields: Partial<Omit<Tag, 'id'>>): Promise<void> {
    await api.internal.send('tags-update', { id, ...fields });
  }
  async deleteTag(id: string): Promise<void> {
    await api.internal.send('tags-delete', [id]);
  }
}
```

> **Note on internal handler names:** the `tags-create` / `tags-update` / `tags-delete` handler names are based on the loot-core convention. If `references/actual/packages/loot-core/src/server/tags/app.ts` shows different handler names at implementation time, update this file accordingly — the integration test (Phase 5) will catch any mismatch.

- [ ] **Step 4: Run test, confirm pass**

Run: `npx vitest run tests/unit/client/sdk-client.test.ts`
Expected: 3/3 pass.

- [ ] **Step 5: Commit**

```bash
git add src/client/sdk-client.ts tests/unit/client/sdk-client.test.ts
git commit -m "feat(client): SdkActualClient wrapping @actual-app/api with notes + tags via internal.send"
```

### Task 2.5: Lifecycle module (init/shutdown/signals + p-retry)

**Files:**
- Create: `src/client/lifecycle.ts`
- Create: `tests/unit/client/lifecycle.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { withRetriedSync } from '../../../src/client/lifecycle.js';
import { FakeActualClient } from '../../../src/client/fake-client.js';

describe('withRetriedSync', () => {
  it('retries up to 3 times then throws', async () => {
    const c = new FakeActualClient();
    let calls = 0;
    const sync = async (): Promise<void> => {
      calls++;
      throw new Error('network');
    };
    await expect(withRetriedSync(sync)).rejects.toThrow(/network/);
    expect(calls).toBe(3);
  });

  it('returns immediately on success', async () => {
    let calls = 0;
    await withRetriedSync(async () => { calls++; });
    expect(calls).toBe(1);
  });

  it('succeeds on second attempt', async () => {
    let calls = 0;
    await withRetriedSync(async () => {
      calls++;
      if (calls === 1) throw new Error('flake');
    });
    expect(calls).toBe(2);
  });
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `npx vitest run tests/unit/client/lifecycle.test.ts`
Expected: file-not-found.

- [ ] **Step 3: Create `src/client/lifecycle.ts`**

```ts
import pRetry from 'p-retry';
import type { ActualClient } from './actual-client.js';

export async function withRetriedSync(fn: () => Promise<void>): Promise<void> {
  await pRetry(fn, {
    retries: 2,
    minTimeout: 200,
    factor: 2,
    maxTimeout: 800,
  });
}

export function installSignalHandlers(client: ActualClient, onShutdown: () => Promise<void>): void {
  let shuttingDown = false;
  const handler = (sig: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    void (async (): Promise<void> => {
      try {
        await onShutdown();
        await client.shutdown();
      } finally {
        process.exit(sig === 'SIGINT' ? 130 : 0);
      }
    })();
  };
  process.on('SIGTERM', () => handler('SIGTERM'));
  process.on('SIGINT', () => handler('SIGINT'));
}
```

- [ ] **Step 4: Run test, confirm pass**

Run: `npx vitest run tests/unit/client/lifecycle.test.ts`
Expected: 3/3 pass.

- [ ] **Step 5: Commit**

```bash
git add src/client/lifecycle.ts tests/unit/client/lifecycle.test.ts
git commit -m "feat(client): lifecycle helpers — p-retry sync wrapper + signal handlers"
```

---

## Phase 3 — Server / transport rewrite

### Task 3.1: Health endpoint module

**Files:**
- Create: `src/health.ts`
- Create: `tests/unit/health.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mountHealth } from '../../src/health.js';
import { SyncCoalescer } from '../../src/client/sync-coalescer.js';
import { FakeActualClient } from '../../src/client/fake-client.js';

describe('GET /health', () => {
  it('reports ok when sdk initialized + last sync succeeded', async () => {
    const app = express();
    const fake = new FakeActualClient();
    const coalescer = new SyncCoalescer(fake, 2000);
    await coalescer.maybeSync();
    mountHealth(app, { coalescer, sdkInitialized: () => true, syncId: 'sid', version: '2.0.0' });
    const r = await request(app).get('/health');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'ok', sdkInitialized: true, lastSyncSucceeded: true, budgetSyncId: 'sid', version: '2.0.0' });
  });

  it('reports degraded (HTTP 200) when last sync failed', async () => {
    const app = express();
    const fake = new FakeActualClient();
    fake.failNextSyncWith(new Error('net'));
    const coalescer = new SyncCoalescer(fake, 2000);
    await coalescer.maybeSync().catch(() => {});
    mountHealth(app, { coalescer, sdkInitialized: () => true, syncId: 'sid', version: '2.0.0' });
    const r = await request(app).get('/health');
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('degraded');
  });

  it('reports down (HTTP 503) when sdk not initialized', async () => {
    const app = express();
    const fake = new FakeActualClient();
    const coalescer = new SyncCoalescer(fake, 2000);
    mountHealth(app, { coalescer, sdkInitialized: () => false, syncId: 'sid', version: '2.0.0' });
    const r = await request(app).get('/health');
    expect(r.status).toBe(503);
    expect(r.body.status).toBe('down');
  });
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `npx vitest run tests/unit/health.test.ts`

- [ ] **Step 3: Create `src/health.ts`**

```ts
import type { Express } from 'express';
import type { SyncCoalescer } from './client/sync-coalescer.js';

export interface HealthOptions {
  coalescer: SyncCoalescer;
  sdkInitialized: () => boolean;
  syncId: string;
  version: string;
}

export function mountHealth(app: Express, opts: HealthOptions): void {
  app.get('/health', (_req, res) => {
    const sdkUp = opts.sdkInitialized();
    if (!sdkUp) {
      res.status(503).json({
        status: 'down',
        sdkInitialized: false,
        lastSyncAt: opts.coalescer.lastSyncAt,
        lastSyncSucceeded: opts.coalescer.lastSyncSucceeded,
        budgetSyncId: opts.syncId,
        version: opts.version,
      });
      return;
    }
    const status = opts.coalescer.lastSyncSucceeded ? 'ok' : 'degraded';
    res.status(200).json({
      status,
      sdkInitialized: true,
      lastSyncAt: opts.coalescer.lastSyncAt,
      lastSyncSucceeded: opts.coalescer.lastSyncSucceeded,
      budgetSyncId: opts.syncId,
      version: opts.version,
    });
  });
}
```

- [ ] **Step 4: Run test, confirm pass**

Run: `npx vitest run tests/unit/health.test.ts`
Expected: 3/3 pass.

- [ ] **Step 5: Commit**

```bash
git add src/health.ts tests/unit/health.test.ts
git commit -m "feat(health): /health endpoint with ok/degraded/down per sync state"
```

### Task 3.2: Migrate `src/server.ts` to `McpServer` high-level API

**Files:**
- Modify: `src/server.ts`
- Create: `src/tools/register.ts`

- [ ] **Step 1: Replace `src/server.ts` with the new shape**

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type pino from 'pino';
import type { Config } from './config.js';
import type { ActualClient } from './client/actual-client.js';
import type { SyncCoalescer } from './client/sync-coalescer.js';
import { registerAllTools } from './tools/register.js';
import { setupResources } from './resources.js';
import { setupPrompts } from './prompts.js';

export interface McpServerDeps {
  config: Config;
  client: ActualClient;
  coalescer: SyncCoalescer;
  logger: pino.Logger;
}

export function createMcpServer(deps: McpServerDeps): McpServer {
  const server = new McpServer(
    { name: 'actual-budget-mcp', version: '2.0.0' },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );

  registerAllTools(server, deps);
  setupResources(server, deps.client, deps.config.currencySymbol);
  setupPrompts(server);

  return server;
}
```

- [ ] **Step 2: Create skeletal `src/tools/register.ts`**

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerDeps } from '../server.js';
import { registerCategoryTools } from './categories.js';
import { registerAccountTools } from './accounts.js';
import { registerTransactionTools } from './transactions.js';
import { registerPayeeTools } from './payees.js';
import { registerRuleTools } from './rules.js';
import { registerBudgetTools } from './budget.js';
import { registerScheduleTools } from './schedules.js';
import { registerNoteTools } from './notes.js';
import { registerTagTools } from './tags.js';
import { registerQueryTool } from './query.js';
import { registerUtilityTools } from './utility.js';

export function registerAllTools(server: McpServer, deps: McpServerDeps): void {
  registerCategoryTools(server, deps);
  registerAccountTools(server, deps);
  registerTransactionTools(server, deps);
  registerPayeeTools(server, deps);
  registerRuleTools(server, deps);
  registerBudgetTools(server, deps);
  registerScheduleTools(server, deps);
  registerNoteTools(server, deps);
  registerTagTools(server, deps);
  registerQueryTool(server, deps);
  registerUtilityTools(server, deps);
}
```

- [ ] **Step 3: Update `tests/server.test.ts`**

Replace the existing v1 server test (which referenced `actual-http-api`) with a smoke test. Open `tests/server.test.ts` and replace contents with:

```ts
import { describe, it, expect } from 'vitest';
import { createMcpServer } from '../src/server.js';
import { FakeActualClient } from '../src/client/fake-client.js';
import { SyncCoalescer } from '../src/client/sync-coalescer.js';
import pino from 'pino';

const cfg = {
  actualServerUrl: 'http://x', actualServerPassword: 'p', budgetSyncId: 's',
  mcpApiKeys: [], mcpAllowedOrigins: [], mcpTransport: 'stdio' as const,
  mcpPort: 3000, mcpRateLimitPerMin: 120, mcpDataDir: '/tmp', currencySymbol: '$',
  logLevel: 'info' as const,
};

describe('createMcpServer', () => {
  it('constructs with all tool groups registered', () => {
    const client = new FakeActualClient();
    const coalescer = new SyncCoalescer(client, 2000);
    const logger = pino({ level: 'silent' });
    const server = createMcpServer({ config: cfg, client, coalescer, logger });
    expect(server).toBeDefined();
  });
});
```

> **Stub modules**: Each tool-group registration file (`categories.ts`, `accounts.ts`, …) is created as an empty stub in this task so the imports compile. The bodies are filled in during Phase 4.

- [ ] **Step 4: Create stub registration files**

For each of: `categories.ts`, `accounts.ts`, `transactions.ts`, `payees.ts`, `rules.ts`, `budget.ts`, `schedules.ts`, `notes.ts`, `tags.ts`, `query.ts`, `utility.ts` — create `src/tools/<name>.ts` with:

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerDeps } from '../server.js';

// Filled in during Phase 4.
export function register<GROUP>Tools(_server: McpServer, _deps: McpServerDeps): void {}
```

(Substitute the `<GROUP>` token to match the group name in each file: `Category`, `Account`, `Transaction`, `Payee`, `Rule`, `Budget`, `Schedule`, `Note`, `Tag`, `Query`, `Utility`.)

Delete the old v1 stubs `src/tools/crud.ts`, `src/tools/query.ts`, `src/tools/analytics.ts`, `src/tools/shared.ts` (and their tests in `tests/tools/`) — the tool surface is being rebuilt. Don't bring the v1 analytics tools forward unless covered by the spec; the spec lists 35 tools, none of which is `analytics`.

- [ ] **Step 5: Run typecheck + tests**

Run: `npm run lint && npx vitest run tests/server.test.ts`
Expected: typecheck passes, server test passes.

- [ ] **Step 6: Commit**

```bash
git add src/server.ts src/tools/ tests/server.test.ts
git rm src/tools/crud.ts src/tools/query.ts src/tools/analytics.ts src/tools/shared.ts tests/tools/*.ts src/client.ts tests/client.test.ts
git commit -m "refactor(server): switch to McpServer high-level API and skeletal tool groups"
```

> **Note:** This deletes `src/client.ts` (the old HTTP-proxy client). The new boundary is `src/client/actual-client.ts`. The old `tests/tools/*.test.ts` files are removed — Phase 4 writes new ones per group.

### Task 3.3: Rewrite `src/app.ts` (transport wiring with deprecation headers)

**Files:**
- Modify: `src/app.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Read both files (already known) — replace `src/app.ts`**

```ts
import type pino from 'pino';
import type { Express } from 'express';
import type { Config } from './config.js';
import type { ActualClient } from './client/actual-client.js';
import type { SyncCoalescer } from './client/sync-coalescer.js';
import { createMcpServer } from './server.js';
import { createAuthMiddleware, originAllowlist } from './auth.js';
import { mountHealth } from './health.js';

export interface AppDeps {
  config: Config;
  client: ActualClient;
  coalescer: SyncCoalescer;
  sdkInitialized: () => boolean;
  logger: pino.Logger;
  version: string;
}

export async function createApp(deps: AppDeps): Promise<{ app: Express; cleanup: () => Promise<void> }> {
  const { config, client, coalescer, sdkInitialized, logger, version } = deps;
  const express = (await import('express')).default;
  const helmet = (await import('helmet')).default;
  const { rateLimit } = await import('express-rate-limit');
  const app = express();

  app.use((req, res, next) => {
    if (req.path === '/messages') { next(); return; }
    express.json()(req, res, next);
  });

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(originAllowlist(config.mcpAllowedOrigins));

  const limiter = rateLimit({
    windowMs: 60_000,
    limit: config.mcpRateLimitPerMin,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) =>
      (req as unknown as { callerKey?: string }).callerKey ?? req.ip ?? 'anonymous',
    message: { error: 'Too many requests' },
  });

  // Mount /health BEFORE auth so it's reachable for Docker healthcheck.
  mountHealth(app, { coalescer, sdkInitialized, syncId: config.budgetSyncId, version });

  if (config.mcpApiKeys.length > 0) {
    const auth = createAuthMiddleware(config.mcpApiKeys);
    app.use((req, res, next) => {
      if (req.path === '/health') { next(); return; }
      auth(req, res, next);
    });
  }
  app.use((req, res, next) => {
    if (req.path === '/health') next(); else limiter(req, res, next);
  });

  let cleanup = async (): Promise<void> => {};

  if (config.mcpTransport === 'sse') {
    logger.warn('SSE transport is deprecated and will be removed in v2.1; migrate to Streamable HTTP at /mcp');
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const { SSEServerTransport } = await import('@modelcontextprotocol/sdk/server/sse.js');
    const transports = new Map<string, InstanceType<typeof SSEServerTransport>>();

    const setSunsetHeaders = (res: Parameters<Parameters<typeof app.get>[1]>[1]): void => {
      res.setHeader('Deprecation', 'true');
      res.setHeader('Sunset', 'Sat, 01 Aug 2026 00:00:00 GMT');
    };

    app.get('/sse', async (_req, res) => {
      setSunsetHeaders(res);
      const sessionServer = createMcpServer({ config, client, coalescer, logger });
      const transport = new SSEServerTransport('/messages', res);
      transports.set(transport.sessionId, transport);
      const ping = setInterval(() => {
        if (!res.writable) { clearInterval(ping); return; }
        try { res.write(': ping\n\n'); } catch { clearInterval(ping); }
      }, 25_000);
      res.on('close', () => {
        clearInterval(ping);
        transports.delete(transport.sessionId);
        void sessionServer.close();
      });
      await sessionServer.connect(transport);
    });

    app.post('/messages', async (req, res) => {
      setSunsetHeaders(res);
      const sessionId = req.query['sessionId'] as string;
      const transport = transports.get(sessionId);
      if (!transport) { res.status(404).json({ error: 'Session not found' }); return; }
      await transport.handlePostMessage(req, res);
    });
  } else {
    const { StreamableHTTPServerTransport } =
      await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
    const server = createMcpServer({ config, client, coalescer, logger });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);

    app.all('/mcp', async (req, res) => { await transport.handleRequest(req, res); });

    cleanup = async (): Promise<void> => { await server.close(); };
  }

  return { app, cleanup };
}
```

- [ ] **Step 2: Replace `src/index.ts`**

```ts
#!/usr/bin/env node
import pino from 'pino';
import { loadConfig } from './config.js';
import { SdkActualClient } from './client/sdk-client.js';
import { SyncCoalescer } from './client/sync-coalescer.js';
import { installSignalHandlers } from './client/lifecycle.js';
import { createMcpServer } from './server.js';
import { createApp } from './app.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const VERSION = '2.0.0';

const config = loadConfig();
const logger = pino({ name: 'actual-mcp', level: config.logLevel });

let sdkReady = false;

async function main(): Promise<void> {
  const client = new SdkActualClient({
    dataDir: config.mcpDataDir,
    serverURL: config.actualServerUrl,
    password: config.actualServerPassword,
    syncId: config.budgetSyncId,
    encryptionPassword: config.budgetEncryptionPassword,
  });

  await client.init();
  sdkReady = true;

  const coalescer = new SyncCoalescer(client, 2000);

  installSignalHandlers(client, async () => {
    logger.info('Shutting down...');
  });

  if (config.mcpTransport === 'stdio') {
    const server = createMcpServer({ config, client, coalescer, logger });
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info('MCP server running on stdio');
    return;
  }

  const { app } = await createApp({
    config, client, coalescer, sdkInitialized: () => sdkReady, logger, version: VERSION,
  });

  app.listen(config.mcpPort, () => {
    logger.info({ port: config.mcpPort, transport: config.mcpTransport }, 'MCP server running');
  });
}

main().catch((err: unknown) => {
  logger.error(err, 'Failed to start MCP server');
  process.exit(1);
});
```

- [ ] **Step 3: Typecheck**

Run: `npm run lint`
Expected: passes (tools are still empty stubs).

- [ ] **Step 4: Commit**

```bash
git add src/app.ts src/index.ts
git commit -m "refactor(transport): wire SyncCoalescer + Origin allowlist + SSE deprecation headers"
```

---

## Phase 4 — Tools (the bulk of v2)

Each task in this phase has the same shape: write a unit test using `FakeActualClient`, register the tool group with zod schemas, call `withAudit` for writes, call `coalescer.maybeSync()` + `withRetriedSync` for reads, return a `CallToolResult`. The spec's tool-template (`docs/superpowers/specs/2026-05-04-v2-direct-sdk-design.md` §8) is the canonical shape.

### Shared tool helper (Task 4.0)

**Files:**
- Create: `src/tools/shared.ts`

- [ ] **Step 1: Write the helper module (no test needed; covered transitively by group tests)**

```ts
import type pino from 'pino';
import { withAudit, type AuditedHandler } from '../audit.js';
import { withRetriedSync } from '../client/lifecycle.js';
import type { SyncCoalescer } from '../client/sync-coalescer.js';

export interface CallToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export function ok(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] };
}
export function err(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

export function readTool<I>(
  coalescer: SyncCoalescer,
  fn: (input: I) => Promise<CallToolResult>,
): (input: I) => Promise<CallToolResult> {
  return async (input) => {
    try {
      await withRetriedSync(() => coalescer.maybeSync());
    } catch (e) {
      return err(`sync failed: ${e instanceof Error ? e.message : String(e)}; refusing to serve stale data`);
    }
    return fn(input);
  };
}

export function writeTool<I>(
  logger: pino.Logger,
  toolName: string,
  syncAfter: () => Promise<void>,
  fn: (input: I) => Promise<CallToolResult>,
): AuditedHandler<I, CallToolResult> {
  const audited = withAudit(logger, toolName, async (input: I) => {
    const result = await fn(input);
    try {
      await withRetriedSync(syncAfter);
    } catch (e) {
      return err(
        `write committed locally but failed to sync to server: ${e instanceof Error ? e.message : String(e)}; will retry on next call`,
      );
    }
    return result;
  });
  return audited;
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npm run lint`
```bash
git add src/tools/shared.ts
git commit -m "feat(tools): readTool/writeTool helpers wrapping sync + audit"
```

### Task 4.1: Categories tool group (8 tools)

**Files:**
- Modify: `src/tools/categories.ts`
- Create: `tests/unit/tools/categories.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import pino from 'pino';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { FakeActualClient } from '../../../src/client/fake-client.js';
import { SyncCoalescer } from '../../../src/client/sync-coalescer.js';
import { registerCategoryTools } from '../../../src/tools/categories.js';

function setup() {
  const client = new FakeActualClient();
  const coalescer = new SyncCoalescer(client, 2000);
  const logger = pino({ level: 'silent' });
  const server = new McpServer({ name: 't', version: '0' }, { capabilities: { tools: {} } });
  registerCategoryTools(server, { config: {} as never, client, coalescer, logger });
  return { server, client };
}

async function call(server: McpServer, tool: string, args: unknown): Promise<{ content: Array<{ text: string }>; isError?: boolean }> {
  // McpServer exposes the tool registry; call directly via internal method
  const tools = (server as unknown as { _registeredTools: Record<string, { callback: (a: unknown, callerKey: string) => Promise<{ content: Array<{ text: string }>; isError?: boolean }> }> })._registeredTools;
  return tools[tool]!.callback(args, 'test-caller-12');
}

describe('category tools', () => {
  it('get-categories returns categories from client', async () => {
    const { server, client } = setup();
    await client.createCategory({ name: 'Food', group_id: 'g1' });
    const r = await call(server, 'get-categories', {});
    expect(r.isError).toBeFalsy();
    expect(r.content[0]!.text).toContain('Food');
  });

  it('create-category creates a category and returns its id', async () => {
    const { server, client } = setup();
    const groupId = await client.createCategoryGroup({ name: 'Spending' });
    const r = await call(server, 'create-category', { name: 'Rent', group_id: groupId });
    expect(r.isError).toBeFalsy();
    expect((await client.getCategories())).toHaveLength(1);
  });

  it('update-category updates a field', async () => {
    const { server, client } = setup();
    const id = await client.createCategory({ name: 'Old', group_id: 'g1' });
    const r = await call(server, 'update-category', { id, fields: { name: 'New' } });
    expect(r.isError).toBeFalsy();
    expect((await client.getCategories())[0]!.name).toBe('New');
  });

  it('delete-category removes the category', async () => {
    const { server, client } = setup();
    const id = await client.createCategory({ name: 'X', group_id: 'g1' });
    await call(server, 'delete-category', { id });
    expect(await client.getCategories()).toHaveLength(0);
  });

  it('zod rejects invalid input', async () => {
    const { server } = setup();
    await expect(call(server, 'create-category', { /* missing name */ group_id: 'g' })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `npx vitest run tests/unit/tools/categories.test.ts`
Expected: stub returns no tools.

- [ ] **Step 3: Implement `src/tools/categories.ts`**

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerDeps } from '../server.js';
import { ok, readTool, writeTool } from './shared.js';

export function registerCategoryTools(server: McpServer, deps: McpServerDeps): void {
  const { client, coalescer, logger } = deps;

  server.tool(
    'get-categories',
    'List all categories.',
    {},
    readTool(coalescer, async () => {
      const cats = await client.getCategories();
      return ok(JSON.stringify(cats, null, 2));
    }),
  );

  server.tool(
    'get-category-groups',
    'List all category groups (with their categories).',
    {},
    readTool(coalescer, async () => {
      const groups = await client.getCategoryGroups();
      return ok(JSON.stringify(groups, null, 2));
    }),
  );

  server.tool(
    'create-category',
    'Create a new category in the given group.',
    {
      name: z.string().min(1),
      group_id: z.string().min(1),
      is_income: z.boolean().optional(),
      hidden: z.boolean().optional(),
    },
    writeTool(logger, 'create-category', () => client.sync(), async (input) => {
      const id = await client.createCategory(input);
      return ok(`Created category ${id}`);
    }),
  );

  server.tool(
    'update-category',
    'Update fields on an existing category.',
    {
      id: z.string().min(1),
      fields: z.object({
        name: z.string().min(1).optional(),
        group_id: z.string().min(1).optional(),
        is_income: z.boolean().optional(),
        hidden: z.boolean().optional(),
      }),
    },
    writeTool(logger, 'update-category', () => client.sync(), async ({ id, fields }) => {
      await client.updateCategory(id, fields);
      return ok(`Updated category ${id}`);
    }),
  );

  server.tool(
    'delete-category',
    'Delete a category. Optionally re-assign its transactions to another category.',
    { id: z.string().min(1), transferCategoryId: z.string().optional() },
    writeTool(logger, 'delete-category', () => client.sync(), async ({ id, transferCategoryId }) => {
      await client.deleteCategory(id, transferCategoryId);
      return ok(`Deleted category ${id}`);
    }),
  );

  server.tool(
    'create-category-group',
    'Create a new category group.',
    { name: z.string().min(1), is_income: z.boolean().optional() },
    writeTool(logger, 'create-category-group', () => client.sync(), async (input) => {
      const id = await client.createCategoryGroup(input);
      return ok(`Created category group ${id}`);
    }),
  );

  server.tool(
    'update-category-group',
    'Update fields on an existing category group.',
    {
      id: z.string().min(1),
      fields: z.object({ name: z.string().optional(), is_income: z.boolean().optional() }),
    },
    writeTool(logger, 'update-category-group', () => client.sync(), async ({ id, fields }) => {
      await client.updateCategoryGroup(id, fields);
      return ok(`Updated group ${id}`);
    }),
  );

  server.tool(
    'delete-category-group',
    'Delete a category group. Optionally re-assign its categories.',
    { id: z.string().min(1), transferCategoryId: z.string().optional() },
    writeTool(logger, 'delete-category-group', () => client.sync(), async ({ id, transferCategoryId }) => {
      await client.deleteCategoryGroup(id, transferCategoryId);
      return ok(`Deleted group ${id}`);
    }),
  );
}
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `npx vitest run tests/unit/tools/categories.test.ts`
Expected: 5/5 pass.

- [ ] **Step 5: Commit**

```bash
git add src/tools/categories.ts tests/unit/tools/categories.test.ts
git commit -m "feat(tools): category CRUD (8 tools)"
```

### Task 4.2: Accounts tool group (8 tools)

**Files:**
- Modify: `src/tools/accounts.ts`
- Create: `tests/unit/tools/accounts.test.ts`

- [ ] **Step 1: Write failing tests** mirroring Task 4.1's shape, covering: `get-accounts`, `create-account`, `update-account`, `close-account`, `reopen-account`, `delete-account`, `get-account-balance`, `run-bank-sync`. Each test seeds with `client._seedAccount(...)` or `createAccount`, calls the tool via the same `call()` helper from 4.1 (copy it into a `tests/unit/tools/_helpers.ts` file that exports `setup()` and `call()` if you find yourself duplicating).

- [ ] **Step 2: Implement `src/tools/accounts.ts`** with the same template as 4.1. Schemas:

```ts
// get-accounts: {}
// create-account: { name, type?, offbudget?, initialBalance? (number, default 0) }
// update-account: { id, fields: { name?, type?, offbudget?, closed? } }
// close-account: { id, transferAccountId?, transferCategoryId? }
// reopen-account: { id }
// delete-account: { id }
// get-account-balance: { id, cutoff? (string ISO date) }
// run-bank-sync: { accountId? (string) }
```

`get-account-balance` parses `cutoff` to `Date` before calling `client.getAccountBalance`. All reads use `readTool`, all writes use `writeTool`.

- [ ] **Step 3: Run tests, confirm pass.** Run: `npx vitest run tests/unit/tools/accounts.test.ts`

- [ ] **Step 4: Commit**

```bash
git add src/tools/accounts.ts tests/unit/tools/accounts.test.ts tests/unit/tools/_helpers.ts
git commit -m "feat(tools): account CRUD + balance + bank-sync (8 tools)"
```

### Task 4.3: Transactions tool group (5 tools)

**Files:**
- Modify: `src/tools/transactions.ts`
- Create: `tests/unit/tools/transactions.test.ts`

- [ ] **Step 1: Write failing tests** for `get-transactions`, `add-transactions`, `import-transactions`, `update-transaction`, `delete-transaction`. Use `_helpers.ts` from 4.2.

- [ ] **Step 2: Implement** with these zod schemas:

```ts
const TxInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().int(),                // cents
  payee: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  cleared: z.boolean().optional(),
  reconciled: z.boolean().optional(),
  imported_id: z.string().nullable().optional(),
  subtransactions: z.array(z.unknown()).optional(),
});

// get-transactions: { accountId, sinceDate (YYYY-MM-DD), untilDate (YYYY-MM-DD) }
// add-transactions: { accountId, transactions: TxInput[], learnCategories?, runTransfers? }
// import-transactions: { accountId, transactions: TxInput[] }
// update-transaction: { id, fields: Partial<TxInput> }
// delete-transaction: { id }
```

Reads → `readTool`. Writes → `writeTool`.

- [ ] **Step 3: Run + commit**

```bash
git add src/tools/transactions.ts tests/unit/tools/transactions.test.ts
git commit -m "feat(tools): transaction CRUD (5 tools)"
```

### Task 4.4: Payees tool group (6 tools)

**Files:**
- Modify: `src/tools/payees.ts`
- Create: `tests/unit/tools/payees.test.ts`

- [ ] **Step 1: Tests** for `get-payees`, `create-payee`, `update-payee`, `delete-payee`, `merge-payees`, `get-common-payees`.

- [ ] **Step 2: Implement** with schemas:

```ts
// get-payees: {}
// create-payee: { name, transfer_acct? }
// update-payee: { id, fields: { name?, transfer_acct? } }
// delete-payee: { id }
// merge-payees: { targetId, mergeIds: string[] }
// get-common-payees: {}
```

- [ ] **Step 3: Run + commit**

```bash
git add src/tools/payees.ts tests/unit/tools/payees.test.ts
git commit -m "feat(tools): payee CRUD + merge (6 tools)"
```

### Task 4.5: Rules tool group (5 tools)

**Files:**
- Modify: `src/tools/rules.ts`
- Create: `tests/unit/tools/rules.test.ts`

- [ ] **Step 1: Tests** for `get-rules`, `create-rule`, `update-rule`, `delete-rule`, `get-payee-rules`.

- [ ] **Step 2: Implement** with schemas:

```ts
// get-rules: {}
// get-payee-rules: { payeeId }
// create-rule: { stage: z.string().nullable(), conditionsOp: z.enum(['and','or']), conditions: z.array(z.unknown()), actions: z.array(z.unknown()) }
// update-rule: { id, stage, conditionsOp, conditions, actions }   // pass through to client.updateRule
// delete-rule: { id }
```

- [ ] **Step 3: Run + commit**

```bash
git add src/tools/rules.ts tests/unit/tools/rules.test.ts
git commit -m "feat(tools): rules CRUD (5 tools)"
```

### Task 4.6: Budget tool group (6 tools)

**Files:**
- Modify: `src/tools/budget.ts`
- Create: `tests/unit/tools/budget.test.ts`

- [ ] **Step 1: Tests** for `get-budget-month`, `get-budget-months`, `set-budget-amount`, `set-budget-carryover`, `hold-budget-for-next-month`, `reset-budget-hold`.

- [ ] **Step 2: Implement** with schemas:

```ts
const Month = z.string().regex(/^\d{4}-\d{2}$/);
// get-budget-month: { month: Month }
// get-budget-months: {}
// set-budget-amount: { month: Month, categoryId: z.string().min(1), value: z.number().int() }
// set-budget-carryover: { month: Month, categoryId: z.string().min(1), flag: z.boolean() }
// hold-budget-for-next-month: { month: Month, amount: z.number().int() }
// reset-budget-hold: { month: Month }
```

- [ ] **Step 3: Run + commit**

```bash
git add src/tools/budget.ts tests/unit/tools/budget.test.ts
git commit -m "feat(tools): budget month read + amount/carryover/hold writes (6 tools)"
```

### Task 4.7: Schedules tool group (1 read tool — schedules CRUD writes are out of scope per spec §8 which lists only `get-schedules`)

> Re-check spec §8 row "Schedules" — it lists `get-schedules`, `create-schedule`, `update-schedule`, `delete-schedule`. The SDK's public `getSchedules` is read-only; the writes go through `internal.send('schedule/create')`, `internal.send('schedule/update')`, `internal.send('schedule/delete')`.

**Files:**
- Modify: `src/tools/schedules.ts`
- Create: `tests/unit/tools/schedules.test.ts`
- Modify: `src/client/actual-client.ts` — add `createSchedule`, `updateSchedule`, `deleteSchedule` methods.
- Modify: `src/client/sdk-client.ts` — implement those via `internal.send`.
- Modify: `src/client/fake-client.ts` — implement against the in-memory map.

- [ ] **Step 1: Extend `ActualClient` interface (add to `actual-client.ts`)**

```ts
createSchedule(input: { name: string | null; rule: unknown; active?: boolean; posts_transaction?: boolean }): Promise<string>;
updateSchedule(id: string, fields: { name?: string | null; rule?: unknown; active?: boolean; posts_transaction?: boolean }): Promise<void>;
deleteSchedule(id: string): Promise<void>;
```

- [ ] **Step 2: Implement on FakeActualClient** (uuid-create, in-memory update, delete).

- [ ] **Step 3: Implement on SdkActualClient**

```ts
async createSchedule(input): Promise<string> {
  return (await api.internal.send('schedule/create', { schedule: input })) as string;
}
async updateSchedule(id, fields): Promise<void> {
  await api.internal.send('schedule/update', { schedule: { id, ...fields } });
}
async deleteSchedule(id: string): Promise<void> {
  await api.internal.send('schedule/delete', { id });
}
```

> **Verify handler names** at impl time against `references/actual/packages/loot-core/src/server/schedules.ts`. The integration test in Phase 5 will catch any mismatch.

- [ ] **Step 4: Tests** for all 4 tools.

- [ ] **Step 5: Implement `src/tools/schedules.ts`**

```ts
// get-schedules: {}
// create-schedule: { name: z.string().nullable(), rule: z.unknown(), active?, posts_transaction? }
// update-schedule: { id, fields: { name?, rule?, active?, posts_transaction? } }
// delete-schedule: { id }
```

- [ ] **Step 6: Run + commit**

```bash
git add src/tools/schedules.ts tests/unit/tools/schedules.test.ts src/client/
git commit -m "feat(tools): schedules CRUD via internal.send (4 tools)"
```

### Task 4.8: Notes tool group (THE v2 fix — 3 tools)

**Files:**
- Modify: `src/tools/notes.ts`
- Create: `tests/unit/tools/notes.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { setup, call } from './_helpers.js';

describe('notes tools', () => {
  it('set-notes then get-notes round-trips for category', async () => {
    const { server } = setup();
    await call(server, 'set-notes', { type: 'category', id: 'cat-1', notes: 'hello' });
    const r = await call(server, 'get-notes', { type: 'category', id: 'cat-1' });
    expect(r.content[0].text).toContain('hello');
  });

  it('get-notes for budget month uses budget-YYYY-MM id form', async () => {
    const { server, client } = setup();
    await client.setNote('budget-2026-05', 'May plan');
    const r = await call(server, 'get-notes', { type: 'budgetmonth', id: '2026-05' });
    expect(r.content[0].text).toContain('May plan');
  });

  it('delete-notes clears the note', async () => {
    const { server, client } = setup();
    await client.setNote('cat-1', 'x');
    await call(server, 'delete-notes', { type: 'category', id: 'cat-1' });
    expect(await client.getNote('cat-1')).toBe(null);
  });

  it('set-notes empty string deletes the note', async () => {
    const { server, client } = setup();
    await client.setNote('cat-1', 'x');
    await call(server, 'set-notes', { type: 'category', id: 'cat-1', notes: '' });
    expect(await client.getNote('cat-1')).toBe(null);
  });
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `npx vitest run tests/unit/tools/notes.test.ts`

- [ ] **Step 3: Implement `src/tools/notes.ts`**

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerDeps } from '../server.js';
import { ok, readTool, writeTool } from './shared.js';

const NoteType = z.enum(['category', 'account', 'budgetmonth']);

function noteId(type: 'category' | 'account' | 'budgetmonth', id: string): string {
  return type === 'budgetmonth' ? `budget-${id}` : id;
}

export function registerNoteTools(server: McpServer, deps: McpServerDeps): void {
  const { client, coalescer, logger } = deps;

  server.tool(
    'get-notes',
    'Get notes for a category, account, or budget month.',
    { type: NoteType, id: z.string().min(1) },
    readTool(coalescer, async ({ type, id }) => {
      const note = await client.getNote(noteId(type, id));
      return ok(note ?? '');
    }),
  );

  server.tool(
    'set-notes',
    'Set notes on a category, account, or budget month. Empty string clears the note.',
    { type: NoteType, id: z.string().min(1), notes: z.string() },
    writeTool(logger, 'set-notes', () => client.sync(), async ({ type, id, notes }) => {
      const target = noteId(type, id);
      if (notes === '') {
        await client.deleteNote(target);
        return ok(`Cleared notes for ${type} ${id}`);
      }
      await client.setNote(target, notes);
      return ok(`Notes updated for ${type} ${id}`);
    }),
  );

  server.tool(
    'delete-notes',
    'Delete notes from a category, account, or budget month.',
    { type: NoteType, id: z.string().min(1) },
    writeTool(logger, 'delete-notes', () => client.sync(), async ({ type, id }) => {
      await client.deleteNote(noteId(type, id));
      return ok(`Deleted notes for ${type} ${id}`);
    }),
  );
}
```

- [ ] **Step 4: Run tests, confirm pass.**

- [ ] **Step 5: Commit**

```bash
git add src/tools/notes.ts tests/unit/tools/notes.test.ts
git commit -m "fix(tools): notes read/write/delete (the v2 headline fix — 3 tools)"
```

### Task 4.9: Tags tool group (4 tools, NEW)

**Files:**
- Modify: `src/tools/tags.ts`
- Create: `tests/unit/tools/tags.test.ts`

- [ ] **Step 1: Tests** for `get-tags`, `create-tag`, `update-tag`, `delete-tag`. Use the fake's tag map.

- [ ] **Step 2: Implement** with schemas:

```ts
// get-tags: {}
// create-tag: { tag: z.string().min(1), color: z.string().nullable().optional() }
// update-tag: { id, fields: { tag?, color? } }
// delete-tag: { id }
```

- [ ] **Step 3: Run + commit**

```bash
git add src/tools/tags.ts tests/unit/tools/tags.test.ts
git commit -m "feat(tools): tags CRUD (4 tools, new in v2)"
```

### Task 4.10: Query + Utility tools (`query`, `get-id-by-name`, `get-server-version`)

**Files:**
- Modify: `src/tools/query.ts`
- Modify: `src/tools/utility.ts`
- Create: `tests/unit/tools/query.test.ts`
- Create: `tests/unit/tools/utility.test.ts`

- [ ] **Step 1: Implement `query` tool** — accepts a JSON-shaped ActualQL query and forwards to `client.runQuery`.

```ts
// query: { query: z.unknown() }   // free-form ActualQL — read-only
```

- [ ] **Step 2: Implement `get-id-by-name`** — looks up an entity (`category`, `account`, `payee`) by `name` and returns its id. Tests cover not-found and ambiguous-match cases.

```ts
// get-id-by-name: { type: z.enum(['category','account','payee']), name: z.string().min(1) }
```

- [ ] **Step 3: Implement `get-server-version`** — returns `{ mcpVersion: '2.0.0', sdkVersion: <from @actual-app/api/package.json> }` plus `lastSyncAt`. Read tool.

- [ ] **Step 4: Run tests + commit**

```bash
git add src/tools/query.ts src/tools/utility.ts tests/unit/tools/query.test.ts tests/unit/tools/utility.test.ts
git commit -m "feat(tools): query + utility tools (3 tools)"
```

### Task 4.11: Update resources + prompts to v2 client interface

**Files:**
- Modify: `src/resources.ts`
- Modify: `src/prompts.ts`
- Modify: `tests/resources.test.ts`

- [ ] **Step 1: Open `src/resources.ts` and `src/prompts.ts`.** They were written against v1's `ActualClient` (HTTP proxy). For v2: change the client type to the new `ActualClient` from `src/client/actual-client.ts` and adjust any v1-specific calls (e.g., remove anything that called the old `getNotes` on the v1 client — notes are now via the dedicated tool group).

- [ ] **Step 2: Replace `tests/resources.test.ts`** to use `FakeActualClient`.

- [ ] **Step 3: Run + commit**

```bash
git add src/resources.ts src/prompts.ts tests/resources.test.ts
git commit -m "refactor(resources,prompts): port to v2 ActualClient interface"
```

---

## Phase 5 — Integration tests against real SDK in offline mode

### Task 5.1: Fixture regenerator script

**Files:**
- Create: `tests/fixtures/regenerate.ts`
- Create: `tests/fixtures/README.md`
- Create: `tests/fixtures/compose.yml`

- [ ] **Step 1: Create `tests/fixtures/compose.yml`**

```yaml
services:
  actual-server-fixture:
    image: actualbudget/actual-server:latest
    ports:
      - "5006:5006"
    volumes:
      - actual-fixture-data:/data
    environment:
      ACTUAL_LOGIN_METHOD: password
      ACTUAL_PORT: 5006
volumes:
  actual-fixture-data:
```

- [ ] **Step 2: Create `tests/fixtures/regenerate.ts`**

```ts
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as api from '@actual-app/api';

const COMPOSE = join(__dirname, 'compose.yml');
const FIXTURE_DIR = join(__dirname, 'budget-cache');
const PASSWORD = 'fixture-password';

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch('http://localhost:5006/info');
      if (r.ok) return;
    } catch { /* not ready */ }
    await new Promise((res) => setTimeout(res, 1000));
  }
  throw new Error('actual-server did not become ready in 30s');
}

async function main(): Promise<void> {
  console.log('Bringing up actual-server-fixture...');
  execSync(`docker compose -f ${COMPOSE} up -d`, { stdio: 'inherit' });
  try {
    await waitForServer();

    // Bootstrap the server with a password
    const boot = await fetch('http://localhost:5006/account/bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    });
    if (!boot.ok && boot.status !== 400 /* already bootstrapped */) {
      throw new Error(`bootstrap failed: ${boot.status}`);
    }

    const tmp = mkdtempSync(join(tmpdir(), 'actual-fixture-'));
    await api.init({ dataDir: tmp, serverURL: 'http://localhost:5006', password: PASSWORD });

    // Create a fresh budget — uses internal.send
    const syncId = (await (api as unknown as {
      internal: { send: (h: string, p: unknown) => Promise<string> };
    }).internal.send('create-budget', { budgetName: 'fixture-budget' }));

    // Populate minimal dataset
    const groupId = await api.createCategoryGroup({ name: 'Spending' });
    const cat1 = await api.createCategory({ name: 'Food', group_id: groupId });
    const cat2 = await api.createCategory({ name: 'Transport', group_id: groupId });
    const acctId = await api.createAccount({ name: 'Checking', type: 'checking' }, 100000);
    await api.addTransactions(acctId, [
      { date: '2026-05-01', amount: -1500, payee_name: 'Coffee', category: cat1, notes: 'morning' },
      { date: '2026-05-02', amount: -3500, payee_name: 'Bus', category: cat2 },
      { date: '2026-05-03', amount: 50000, payee_name: 'Salary', category: null },
    ]);
    await (api as unknown as {
      internal: { send: (h: string, p: unknown) => Promise<unknown> };
    }).internal.send('notes-save', { id: cat1, note: 'fixture note on Food' });

    await api.shutdown();

    // Copy the cache to fixture dir
    if (existsSync(FIXTURE_DIR)) rmSync(FIXTURE_DIR, { recursive: true });
    cpSync(tmp, FIXTURE_DIR, { recursive: true });
    rmSync(tmp, { recursive: true });
    console.log(`Fixture regenerated at ${FIXTURE_DIR} (syncId=${syncId})`);
  } finally {
    execSync(`docker compose -f ${COMPOSE} down -v`, { stdio: 'inherit' });
  }
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Create `tests/fixtures/README.md`**

```markdown
# Test fixtures

`budget-cache/` is a committed `@actual-app/api` cache directory used by integration tests.

## Regenerating

Only needed when @actual-app/api ships a schema migration:

    npx tsx tests/fixtures/regenerate.ts

This uses `compose.yml` to bring up `actual-server`, creates a fresh budget with a tiny deterministic dataset, copies the resulting cache here, then tears down.
```

- [ ] **Step 4: Run the regenerator once + commit the fixture**

Run: `npx tsx tests/fixtures/regenerate.ts`
Then:
```bash
git add tests/fixtures/
git commit -m "test: bundle deterministic .actual fixture for integration tests"
```

### Task 5.2: Integration test — notes round-trip against real SDK

**Files:**
- Create: `vitest.integration.config.ts`
- Create: `tests/integration/notes.test.ts`

- [ ] **Step 1: Create `vitest.integration.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
```

- [ ] **Step 2: Create `tests/integration/notes.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as api from '@actual-app/api';
import { SdkActualClient } from '../../src/client/sdk-client.js';

const FIXTURE = join(__dirname, '../fixtures/budget-cache');

describe('integration: notes via real SDK (offline mode)', () => {
  let tmp: string;
  let client: SdkActualClient;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'actual-int-'));
    cpSync(FIXTURE, tmp, { recursive: true });
    // Offline mode: serverURL omitted via no-op init; we hand-init the SDK
    await api.init({ dataDir: tmp });
    // Open the budget that lives in the fixture cache
    const budgets = await api.getBudgets();
    await api.loadBudget(budgets[0]!.id);
    // Construct the client without re-initing
    client = Object.create(SdkActualClient.prototype) as SdkActualClient;
    (client as unknown as { initialized: boolean }).initialized = true;
  });

  afterEach(async () => {
    await api.shutdown();
    rmSync(tmp, { recursive: true });
  });

  it('writes then reads a note for an existing category', async () => {
    const cats = await client.getCategories();
    const target = cats[0]!;
    await client.setNote(target.id, 'integration test note');
    expect(await client.getNote(target.id)).toBe('integration test note');
  });

  it('reads the seeded note from the fixture', async () => {
    const cats = await client.getCategories();
    const food = cats.find((c) => c.name === 'Food')!;
    expect(await client.getNote(food.id)).toBe('fixture note on Food');
  });

  it('deleteNote clears it', async () => {
    const cats = await client.getCategories();
    const food = cats.find((c) => c.name === 'Food')!;
    await client.deleteNote(food.id);
    expect(await client.getNote(food.id)).toBe(null);
  });
});
```

- [ ] **Step 3: Run integration test**

Run: `npm run test:integration`
Expected: 3/3 pass.

- [ ] **Step 4: Commit**

```bash
git add vitest.integration.config.ts tests/integration/
git commit -m "test(integration): notes round-trip via real @actual-app/api in offline mode"
```

### Task 5.3: Integration test — categories, transactions, tags

**Files:**
- Create: `tests/integration/categories.test.ts`
- Create: `tests/integration/transactions.test.ts`
- Create: `tests/integration/tags.test.ts`

- [ ] **Step 1: Each test follows the Task 5.2 pattern** (copy fixture → init SDK → exercise client → shutdown). One test per group covering: list, create, update, delete. The goal here is to catch any drift between our `ActualClient` interface and the real SDK shapes — not to re-test logic.

- [ ] **Step 2: Run + commit**

```bash
git add tests/integration/
git commit -m "test(integration): adapter coverage for categories, transactions, tags"
```

---

## Phase 6 — End-to-end (real container)

### Task 6.1: E2E compose + smoke tests

**Files:**
- Create: `tests/e2e/compose.yml`
- Create: `vitest.e2e.config.ts`
- Create: `tests/e2e/smoke.test.ts`

- [ ] **Step 1: Create `tests/e2e/compose.yml`**

```yaml
services:
  actual-server:
    image: actualbudget/actual-server:latest
    expose: ["5006"]
  actual-mcp:
    build: ../..
    depends_on: [actual-server]
    environment:
      ACTUAL_SERVER_URL: http://actual-server:5006
      ACTUAL_SERVER_PASSWORD: e2e-password
      ACTUAL_BUDGET_SYNC_ID: ${E2E_SYNC_ID}
      MCP_API_KEYS: ${E2E_API_KEY}
      MCP_TRANSPORT: http
      MCP_PORT: 3000
    ports: ["3000:3000"]
```

- [ ] **Step 2: Create `vitest.e2e.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
```

- [ ] **Step 3: Create `tests/e2e/smoke.test.ts`** — uses the real MCP client SDK over Streamable HTTP. Tests: 401 without bearer, list-tools with bearer, get-categories returns ok, set-notes + get-notes round-trips, DELETE /mcp closes session. Wraps the test suite in `beforeAll`/`afterAll` that bootstraps actual-server + creates a budget + brings up compose.

> **Note**: This test is heavy — it brings up real containers. Document it as **CI-only**, not part of `npm test`.

- [ ] **Step 4: Run locally once to verify**

Run: `npm run test:e2e`
Expected: 5/5 pass; takes ~60s.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/ vitest.e2e.config.ts
git commit -m "test(e2e): docker-compose smoke suite covering auth, tools, notes round-trip"
```

---

## Phase 7 — Docker, healthcheck, deployment

### Task 7.1: Update Dockerfile (multi-stage, native build deps, non-root, healthcheck)

**Files:**
- Modify: `Dockerfile` (or `dockerfile`)

- [ ] **Step 1: Read existing Dockerfile**

Run: `cat Dockerfile`

- [ ] **Step 2: Replace with v2 Dockerfile**

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
RUN apk add --no-cache python3 make g++ sqlite
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
RUN addgroup -g 10001 actualmcp && adduser -u 10001 -G actualmcp -S actualmcp
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY package.json ./
RUN mkdir -p /var/lib/actual-mcp && chown actualmcp:actualmcp /var/lib/actual-mcp
USER actualmcp
ENV NODE_ENV=production
EXPOSE 3000
VOLUME ["/var/lib/actual-mcp"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1
STOPSIGNAL SIGTERM
ENTRYPOINT ["node", "build/src/index.js"]
CMD ["--http"]
```

- [ ] **Step 3: Build locally to verify**

Run: `docker build -t actual-budget-mcp:v2-test .`
Expected: build succeeds; `better-sqlite3` compiles cleanly.

- [ ] **Step 4: Smoke-run the image**

Run:
```bash
docker run --rm \
  -e ACTUAL_SERVER_URL=http://example \
  -e ACTUAL_SERVER_PASSWORD=p \
  -e ACTUAL_BUDGET_SYNC_ID=fake \
  -e MCP_API_KEYS=$(node -e 'process.stdout.write("a".repeat(20)+"BCDEFGHIJKLMNOP")') \
  -e MCP_TRANSPORT=http \
  actual-budget-mcp:v2-test
```
Expected: Fails fast with a clear "could not connect to actual-server" message — that's success (config + auth boot OK).

- [ ] **Step 5: Commit**

```bash
git add Dockerfile
git commit -m "build(docker): v2 multi-stage image with non-root user, volume, healthcheck"
```

### Task 7.2: CI workflow updates

**Files:**
- Modify: `.github/workflows/ci.yml` (if present; create if absent)

- [ ] **Step 1: Add jobs**

- `lint`: `npm run lint`
- `test:unit`: `npm test`
- `test:integration`: `npm run test:integration` (uses committed fixture, no Docker)
- `audit`: `npm run audit:ci`
- `build:image`: `docker build .` (catches alpine native-build regressions)

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/
git commit -m "ci: lint + unit + integration + npm audit + image build matrix"
```

---

## Phase 8 — Documentation, migration, release

### Task 8.1: Migration doc

**Files:**
- Create: `docs/MIGRATION-v1-to-v2.md`

- [ ] **Step 1: Write `docs/MIGRATION-v1-to-v2.md`**

```markdown
# Migrating actual-budget-mcp v1 → v2

v2 talks to the Actual sync-server **directly** via the official `@actual-app/api` SDK instead of through `actual-http-api`. This unlocks notes (read/write/delete) and adds tags CRUD.

## Env vars: hard cut

| v1 (removed) | v2 (replacement) | Notes |
|---|---|---|
| `ACTUAL_HTTP_API_URL` | `ACTUAL_SERVER_URL` | Point at the actual-server itself, not the proxy. |
| `ACTUAL_HTTP_API_KEY` | `ACTUAL_SERVER_PASSWORD` | The actual-server login password. |
| `MCP_AUTH_TOKEN` | `MCP_API_KEYS` | Comma-separated list now. **Each token must be ≥32 chars and contain ≥16 unique chars.** |
| _(none)_ | `MCP_ALLOWED_ORIGINS` | Comma-separated allowed `Origin` headers. Recommended. |
| _(none)_ | `ACTUAL_BUDGET_ENCRYPTION_PASSWORD` | Required only if your budget is E2EE-encrypted. |

`ACTUAL_BUDGET_SYNC_ID` is unchanged.

If v2 detects any v1-only env var at startup, it logs a clear error and exits.

## Compose-file diff

[exact before/after block here showing your VPS compose snippet]

## Rollback

Re-pin `image: ghcr.io/kazefreeze/actual-budget-mcp:v1.0.6`, restore the v1 env vars, restart `actual-http-api`, `docker compose up -d`. The v2 cache volume can stay — v1 doesn't touch it.
```

- [ ] **Step 2: Commit**

```bash
git add docs/MIGRATION-v1-to-v2.md
git commit -m "docs: migration guide v1 → v2 with env-var diff and rollback steps"
```

### Task 8.2: README update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the env-var table, transport-flag table, deployment example, and add "SSE deprecated" callout linking to `docs/MIGRATION-v1-to-v2.md`.**

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(readme): v2 env vars, transports, SSE deprecation, migration link"
```

### Task 8.3: CHANGELOG / release-please

**Files:**
- Modify: `CHANGELOG.md`
- Verify: `release-please-config.json` (or `.release-please-manifest.json`)

- [ ] **Step 1: Add a manual `BREAKING CHANGE:` block to the CHANGELOG so release-please bumps to 2.0.0.**

```markdown
## 2.0.0 (unreleased)

### ⚠ BREAKING CHANGES

* Replaces `actual-http-api` proxy with direct `@actual-app/api` SDK use.
* Env vars renamed; v1 vars cause startup failure. See `docs/MIGRATION-v1-to-v2.md`.
* SSE transport deprecated; will be removed in v2.1.

### Features

* notes: read, write, delete now work (previously 404)
* tags: full CRUD
* auth: multi-key Bearer rotation, entropy enforcement, sha256 audit identity
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "chore: release notes for 2.0.0"
```

### Task 8.4: Pre-push hook + final verification

**Files:**
- Verify: `.husky/pre-push` (already runs `npm test && npm run lint`)

- [ ] **Step 1: Run the full battery**

```bash
npm run lint
npm test
npm run test:integration
```
Expected: all green.

- [ ] **Step 2: Push branch + open PR**

```bash
git push -u origin v2-direct-sdk
gh pr create --title "feat: v2 direct @actual-app/api SDK" --body "Implements docs/superpowers/specs/2026-05-04-v2-direct-sdk-design.md."
```

---

## Self-review checklist (run before handing this plan off)

- [ ] Every spec section (§1–§14) maps to at least one task above. ✓
- [ ] No "TBD" / "implement later" / "similar to Task N" / unbacked references. ✓
- [ ] Type names used in Phase 4 tools match those declared in `ActualClient` (Task 2.1). ✓
- [ ] `withAudit` signature in audit.ts matches what `writeTool` calls in `shared.ts`. ✓
- [ ] Notes write path uses `internal.send('notes-save', ...)` per research §"Why ActualQL alone can't write notes". ✓
- [ ] Tags handler names flagged as needing verification at impl time (Task 2.4 note + Task 4.9). ✓
- [ ] Schedule handler names flagged similarly (Task 4.7 note). ✓
- [ ] Origin allowlist is `originAllowlist`, not `originAllowList` — used identically in auth.ts and app.ts. ✓
- [ ] `callerKey` propagated end-to-end: `auth.ts` attaches → tool handlers receive it via `withAudit` second arg. The MCP SDK doesn't pass `req` through to tool callbacks, so the `callerKey` is read off `req` inside a thin shim before the tool is invoked. **Implementation note**: register a request-context middleware in Phase 3 that stashes the current `callerKey` in an `AsyncLocalStorage`, and have `writeTool` read from that store. (If this proves messy, fall back to logging `callerKey: 'http'` at the audit layer — security is not weakened, just less granular.)
