> **Status:** Superseded by [`2026-05-04-v2-direct-sdk-design.md`](./2026-05-04-v2-direct-sdk-design.md) (v2 architecture).
> Kept for historical reference.

# Actual Budget MCP Server — Design Spec

## Overview

A custom MCP server that provides Claude with full read/write access to Actual Budget, including pre-built financial reports, CRUD operations, and raw ActualQL query power. Deployed as a Docker sidecar alongside the existing `actual-http-api` container, accessible remotely via SSE/Streamable HTTP with bearer token authentication.

## Problem Statement

The existing `actual-budget-mcp` server has critical issues:
- **Data quality** — split transactions return confusing/incomplete data
- **Missing functionality** — lacks tools needed for comprehensive budget analysis
- **Poor LLM usability** — tool descriptions and outputs aren't structured for Claude to reason about finances effectively

## Goals

1. Accurate, reliable financial data — especially split transactions
2. Pre-built analytical reports with sensible defaults for non-experts
3. Full CRUD access to all Actual Budget entities
4. Raw ActualQL query access for ad-hoc analysis
5. Output formatted for optimal LLM comprehension (markdown)
6. Secure remote access from Claude Code / Claude Desktop
7. Clean Docker sidecar deployment

## Non-Goals

- Multi-user / multi-tenant support
- OAuth or complex auth flows
- Cash flow forecasting (schedules are variable/zero-balance reminders)
- Replacing the Actual Budget UI

---

## Architecture

```
┌───────────────────────────────────────────────────────────────┐
│  VPS (Docker Compose)                                         │
│                                                               │
│  ┌───────────┐                                                │
│  │  Caddy    │ <── TLS :443 ── Internet                       │
│  │  (proxy)  │                                                │
│  └─────┬─────┘                                                │
│        │ Bearer token validated                                │
│        v                                                      │
│  ┌───────────┐    ┌────────────────┐    ┌──────────────────┐  │
│  │MCP Server │──> │ actual-http-api │──> │  Actual Budget   │  │
│  │  :3001    │    │  :5007         │    │  :5006           │  │
│  └───────────┘    └────────────────┘    └──────────────────┘  │
│                        (internal docker network only)         │
└───────────────────────────────────────────────────────────────┘
```

### Connectivity Approach: HTTP Proxy

The MCP server calls `actual-http-api` over HTTP on the internal Docker network. It does **not** use `@actual-app/api` directly.

**Rationale:**
- Loose coupling — MCP server doesn't care about Actual internals
- Split transactions already handled correctly at the HTTP layer
- Debugging via curl against the HTTP API independently
- HTTP API updates benefit the MCP server automatically
- Stateless — no budget download/sync/cache lifecycle to manage

### Security Layers

1. **Network** — Reverse proxy (Caddy) terminates TLS. Only port 443 exposed. MCP port 3001 is internal only.
2. **Transport** — Bearer token authentication on SSE/HTTP connections. Token validated with `crypto.timingSafeEqual` for constant-time comparison.
3. **Application** — `actual-http-api` requires its own API key on the internal network. Even if MCP auth is bypassed, the HTTP API rejects unauthenticated requests.
4. **Docker isolation** — HTTP API and Actual Budget are never exposed to the internet.

### Transports

- **stdio** — for local development and testing
- **SSE** — for remote access from Claude Code / Claude Desktop
- **Streamable HTTP** — for future MCP client compatibility

---

## Project Structure

```
actual-mcp/
├── Dockerfile
├── package.json
├── tsconfig.json
├── .env.example
├── src/
│   ├── index.ts              # Entry point, CLI args, transport setup
│   ├── server.ts             # MCP server factory, registers tools/resources/prompts
│   ├── config.ts             # Env var loading and validation
│   ├── auth.ts               # Bearer token middleware (crypto.timingSafeEqual)
│   ├── client.ts             # Typed HTTP client for actual-http-api
│   ├── format.ts             # Currency, markdown tables, transaction rendering
│   ├── tools/
│   │   ├── analytics.ts      # All 6 analytical tools
│   │   ├── crud.ts           # All CRUD tools
│   │   └── query.ts          # run-query with embedded ActualQL reference
│   ├── resources.ts          # All MCP resources
│   └── prompts.ts            # All MCP prompts
├── tests/
│   ├── client.test.ts        # HTTP client failure modes (most critical)
│   ├── format.test.ts        # Formatting as pure functions
│   ├── tools.test.ts         # Aggregation logic with mocked client
│   └── integration.test.ts   # End-to-end MCP tool calls
└── docker/
    └── docker-compose.yml
```

**File organization principle:** Each file contains related functions, not one function per file. Split only when a file exceeds ~400 lines. Tools are atomic (one function per tool) but colocated by tier.

---

## MCP Tools

### Tier 1 — Analytical Reports (6 tools)

Each tool makes multiple HTTP calls, aggregates server-side, and returns a markdown report.

#### `monthly-financial-summary`
One-call overview of a month's finances.
- **Params:** `month` (YYYY-MM, defaults to current)
- **Returns:** Income, expenses, savings rate, top spending categories, budget vs actual highlights, flags for overspent categories
- **HTTP calls:** GET accounts, GET transactions, GET budget month, GET categories

#### `spending-analysis`
Spending breakdown grouped by a dimension with optional comparison.
- **Params:** `period` (date range), `group_by` (category | payee | category_group), `compare_to` (optional prior period)
- **Returns:** Grouped spending table with totals, percentage of total, and comparison deltas if requested
- **HTTP calls:** GET transactions (x2 if comparing), GET categories, GET payees

#### `budget-variance-report`
What you budgeted vs what you actually spent, per category.
- **Params:** `month` (YYYY-MM, defaults to current)
- **Returns:** Category-by-category table: budgeted, actual, variance, percentage. Flags overspent.
- **HTTP calls:** GET budget month categories, GET transactions, GET categories

#### `net-worth-snapshot`
Total assets minus total liabilities across all accounts.
- **Params:** none
- **Returns:** Account-by-account table with balances, grouped by on-budget/off-budget, total net worth
- **HTTP calls:** GET accounts (with balances)

#### `trend-analysis`
Rolling trends per category over multiple months, with anomaly detection.
- **Params:** `months` (default 6), `categories` (optional filter)
- **Returns:** Month-by-month table per category, rolling averages, flags for categories that spiked vs their average
- **HTTP calls:** GET transactions (date range), GET categories

#### `income-expense-timeline`
Monthly income vs expenses over a range, with running surplus/deficit.
- **Params:** `start_month`, `end_month`
- **Returns:** Month-by-month table: income, expenses, net, cumulative surplus/deficit, savings rate
- **HTTP calls:** GET transactions (date range), GET categories

### Tier 2 — CRUD Operations

Thin wrappers around single HTTP API endpoints. Each returns a markdown key-value response for mutations, markdown table for listings.

**`manage-*` pattern:** Tools like `manage-category` accept an `action` param (`create` | `update` | `delete`) plus the relevant fields. This keeps the tool count manageable while maintaining atomic operations. Each action maps to a single HTTP call.

#### Accounts
- `get-accounts` — list all accounts with balances

#### Transactions
- `get-transactions` — query with filters (account, date range, category, payee, amount)
- `create-transaction` — create single or split transaction (subtransactions with per-row payee, category, notes)
- `update-transaction` — modify a transaction
- `delete-transaction` — remove a transaction

#### Categories
- `get-categories` — list category groups and categories
- `manage-category` — create, update, or delete a category or category group

#### Payees
- `get-payees` — list all payees
- `manage-payee` — create, update, delete, or merge payees

#### Budgets
- `get-budget-month` — budget data for a specific month
- `set-budget-amount` — set budgeted amount for a category in a month
- `transfer-budget` — move money between categories in a month

#### Schedules
- `get-schedules` — list scheduled/recurring transactions
- `manage-schedule` — create, update, or delete a schedule

#### Rules
- `get-rules` — list transaction rules
- `manage-rule` — create, update, or delete a rule

#### Notes
- `get-notes` — get notes for a category, account, or budget month
- `set-notes` — set/clear notes for a category, account, or budget month

#### Bank Sync
- `run-bank-sync` — trigger bank sync for one or all accounts

### Tier 3 — Power Query

#### `run-query`
Execute arbitrary ActualQL queries against the budget.

The tool description embeds a condensed ActualQL reference so Claude can construct queries without external documentation:

- **Tables:** transactions, accounts, categories, payees, schedules
- **Filter operators:** $eq, $lt, $gt, $lte, $gte, $ne, $oneof, $regex, $like, $notlike, $and, $or
- **Joins:** dot notation (category.name, payee.name, account.name)
- **Aggregates:** $sum, $count with groupBy
- **Date transforms:** $month, $year via $transform
- **Split options:** inline (default — flat subtransactions), grouped (parent with children array), all (both parent and children flat)
- **Sorting:** orderBy with asc/desc
- **Pagination:** limit, offset
- **Example queries** for common patterns (spending by category, transactions matching payee, monthly totals)

**Params:** `query` (ActualQL query object — table, filter, select, groupBy, orderBy, calculate, limit, offset, options)
**Returns:** Markdown table with resolved names + row count metadata

---

## MCP Resources

Passive context loaded without tool calls. Claude knows account names, category structure, and payees up front.

| Resource URI | Description |
|---|---|
| `actual://accounts` | All accounts with types and balances |
| `actual://categories` | Full category tree (groups + categories) |
| `actual://payees` | All payees |
| `actual://budget-settings` | Currency format, budget name |

---

## MCP Prompts

Analysis frameworks that teach Claude how to interpret budget data and what follow-up questions to ask.

| Prompt | Purpose |
|---|---|
| `financial-health-check` | Guided analysis: savings rate, spending patterns, budget adherence, recommendations |
| `budget-review` | Monthly review: overspent/underspent categories, top spending, suggestions |
| `spending-deep-dive` | Drill into a specific category or time period with structured follow-ups |
| `actualql-reference` | Full ActualQL documentation for Claude to self-serve complex queries |

---

## Output Formatting

All tool outputs use **Markdown**. Research shows markdown tables use 34-38% fewer tokens than JSON and produce higher LLM comprehension accuracy.

### Analytical Reports

```
## Monthly Financial Summary — March 2026

### Overview
- **Income:** £5,200.00
- **Expenses:** £3,847.32
- **Net:** +£1,352.68
- **Savings Rate:** 26.0%

### Top Spending Categories
| Category        | Budgeted   | Actual     | Variance   |
|-----------------|------------|------------|------------|
| Rent            | £1,500.00  | £1,500.00  | £0.00      |
| Groceries       | £400.00    | £487.23    | -£87.23 ⚠  |

### Flags
- ⚠ Groceries over budget by 21.8%
```

### Transactions (with splits)

Split transactions render with parent total and nested children, each with their own payee, category, and notes:

```
| Date       | Payee          | Category       | Amount     | Notes        |
|------------|----------------|----------------|------------|--------------|
| 2026-03-15 | Costco         |                | -£156.78   | Weekly shop  |
|            |  ├─ Costco     | Groceries      | -£120.00   |              |
|            |  └─ Gift Shop  | Gifts          | -£36.78    | Birthday     |
| 2026-03-14 | Spotify        | Subscriptions  | -£15.99    |              |
```

### CRUD Responses

```
**Transaction Created**
- ID: abc-123
- Date: 2026-03-15
- Payee: Costco
- Amount: -£156.78
- Category: (split)
```

### Query Results

```
> 12 rows | query: transactions grouped by category.name, summing amount, 2026-03

| Category      | Total       |
|---------------|-------------|
| Groceries     | -£487.23    |
| Rent          | -£1,500.00  |
```

### Error Messages

Actionable errors with suggestions:

```
❌ Could not find account "Chekcing" — did you mean "Checking" (id: abc-123)?

Available accounts: Checking, Savings, Credit Card, Investment
```

### Currency

Currency symbol and formatting read from budget settings via the `actual://budget-settings` resource at startup. No hardcoded currency symbols.

### Name Resolution

All IDs (category, payee, account) are resolved to human-readable names server-side. IDs are included alongside names in CRUD responses for chaining operations.

---

## HTTP Client (`client.ts`)

### Typed Wrapper

Single module handles all communication with `actual-http-api`:

```typescript
// Centralized endpoint definitions
const ENDPOINTS = {
  accounts: (budgetId: string) => `/v1/budgets/${budgetId}/accounts`,
  transactions: (budgetId: string, accountId: string) =>
    `/v1/budgets/${budgetId}/accounts/${accountId}/transactions`,
  // ... all endpoints in one place
} as const;
```

### Error Handling

- **Timeouts** — AbortController with 10s deadline per request
- **Result types** — all calls return `ApiResult<T>` (`{ ok: true, data: T } | { ok: false, error: string }`)
- **Zod validation** — response shapes validated at runtime to catch API drift
- **Partial results** — analytical tools return what they can with "N of M data sources failed" disclaimer

### Caching

Simple in-memory TTL cache (Map with timestamps) for reference data:
- Accounts, categories, payees — 60s TTL
- Budget settings — cached at startup, refreshed on demand

---

## Infrastructure

### Docker Compose

```yaml
actual-mcp:
  build: ./actual-mcp
  ports:
    - "3001:3001"
  environment:
    - ACTUAL_HTTP_API_URL=http://actual-http-api:5007
    - ACTUAL_HTTP_API_KEY=${API_KEY}
    - ACTUAL_BUDGET_SYNC_ID=${BUDGET_SYNC_ID}
    - MCP_AUTH_TOKEN=${MCP_AUTH_TOKEN}
    - MCP_TRANSPORT=sse
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
```

### Startup Sequence

1. Validate environment variables (fail fast if missing)
2. Verify `actual-http-api` is reachable (health check)
3. Fetch budget settings (currency format, budget name)
4. Populate reference data cache (accounts, categories, payees)
5. Start MCP transport (stdio or SSE/HTTP)

### Graceful Shutdown

```typescript
process.on('SIGTERM', async () => {
  await server.close();
  process.exit(0);
});
```

### Logging

Structured logging (pino) on all HTTP calls:
- Request: tool name, endpoint, params
- Response: status code, duration, error if any
- Debug level for response bodies

### Health Check

`GET /health` endpoint that verifies:
- MCP server is running
- `actual-http-api` is reachable
- Budget is loaded

---

## Testing Strategy

### Priority Order

1. **`client.test.ts`** (most critical) — HTTP client failure modes: timeouts, non-200 responses, malformed JSON, network errors, Zod validation failures, partial response handling
2. **`format.test.ts`** — pure function tests: currency formatting, markdown table rendering, split transaction rendering, name resolution
3. **`tools.test.ts`** — analytical tool aggregation logic with mocked HTTP client. Verify correct endpoints called, data combined properly, partial failure handling
4. **`integration.test.ts`** — end-to-end: spin up MCP server, call tools via MCP client SDK, verify responses. Few but valuable.

### Test Framework

Vitest — aligned with the TypeScript ecosystem, fast, good mocking support.

---

## Dependencies

| Package | Purpose |
|---|---|
| `@modelcontextprotocol/sdk` | MCP server SDK |
| `express` | HTTP server for SSE/Streamable HTTP transport |
| `zod` | Runtime response validation |
| `pino` | Structured logging |
| `dotenv` | Environment variable loading |
| `vitest` | Testing |
| `typescript` | Type safety |

---

## Tool Description Guidelines

Each tool's `description` field must:
1. State clearly what the tool does in one sentence
2. State when to use it ("Use this when...")
3. State when NOT to use it ("Do not use this when... use X instead")
4. List what data it returns

This prevents Claude from picking overlapping tools or defaulting to `run-query` for everything.
