# actual-budget-mcp

An [MCP](https://modelcontextprotocol.io/) server for [Actual Budget](https://actualbudget.org/) that provides AI assistants with tools to read, write, and analyze your budget data.

Connects directly to your Actual Budget sync server using the official `@actual-app/api` SDK, deploys as a Docker sidecar.

## Features

- **52 tools** -- accounts, transactions, categories, payees, budget months, schedules, rules, notes, tags, utility, and ActualQL query
- **Tags CRUD (NEW in v2)** -- full create/read/update/delete for transaction tags
- **Notes (read/write/delete)** -- now functional, was broken in v1
- **Raw query power** -- `query` tool with full ActualQL support (filters, aggregates, joins, grouping)
- **4 MCP resources** -- accounts, categories, payees, budget settings
- **4 guided prompts** -- financial health check, budget review, spending deep dive, ActualQL reference
- **Markdown output** -- formatted tables, split transaction rendering, 34-38% fewer tokens than JSON
- **Multiple transports** -- stdio (local), Streamable HTTP (remote, recommended), SSE (deprecated, removal targeted v2.1)
- **Security** -- multi-key Bearer rotation with entropy enforcement (≥32 chars, ≥16 unique chars), Origin allowlist, helmet headers, per-IP rate limiting, audit logger with sha256 caller-key prefix

## Quick Start

> **Upgrading from v1?** See [`docs/MIGRATION-v1-to-v2.md`](docs/MIGRATION-v1-to-v2.md) for the breaking-change guide (env var renames, port change `3001` → `3000`, removal of the `actual-http-api` sidecar).

### Docker Compose (recommended)

```bash
# Clone the repo
git clone https://github.com/KazeFreeze/actual-budget-mcp.git
cd actual-budget-mcp

# Configure environment (uses the v2 var names: ACTUAL_SERVER_URL,
# ACTUAL_SERVER_PASSWORD, ACTUAL_BUDGET_SYNC_ID, MCP_API_KEYS, ...)
cp .env.example .env

# Start the full stack
docker compose -f docker/docker-compose.production.yml up -d
```

### Using the published image

```bash
docker pull ghcr.io/kazefreeze/actual-budget-mcp:latest
docker compose -f docker/docker-compose.production.yml up -d
```

### Local development

```bash
npm ci
npm run dev
```

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ACTUAL_SERVER_URL` | Yes | -- | Actual sync-server URL (e.g. `http://actual-budget:5006`) |
| `ACTUAL_SERVER_PASSWORD` | Yes | -- | actual-server login password |
| `ACTUAL_BUDGET_SYNC_ID` | Yes | -- | Budget sync ID (Settings → Advanced → Sync ID) |
| `ACTUAL_BUDGET_ENCRYPTION_PASSWORD` | If E2EE | -- | Encryption password (only for E2EE-encrypted budgets) |
| `MCP_API_KEYS` | http/sse | -- | Comma-separated bearer tokens. **Each ≥32 chars and ≥16 unique chars.** |
| `MCP_ALLOWED_ORIGINS` | No | -- | Comma-separated allowed `Origin` headers (recommended in production) |
| `MCP_TRANSPORT` | No | `stdio` | Transport mode: `stdio`, `http`, or `sse` (deprecated) |
| `MCP_PORT` | No | `3000` | Port for http/sse transport |
| `MCP_RATE_LIMIT_PER_MIN` | No | `120` | Per-IP rate limit (http/sse) |
| `MCP_DATA_DIR` | No | `/var/lib/actual-mcp` | SDK budget cache directory |
| `CURRENCY_SYMBOL` | No | _auto_ | Optional override. Auto-detected from the budget's `defaultCurrencyCode` preference; set this only to force a specific symbol. Falls back to `$` if neither is available. |
| `LOG_LEVEL` | No | `info` | Log level: `debug`, `info`, `warn`, `error` |

## Architecture

```
v2: Claude/AI <--MCP--> actual-budget-mcp <----> actual-server
                         (this project)         (sync server)
```

The MCP server uses `@actual-app/api` in-process and persists its budget cache to a Docker volume at `/var/lib/actual-mcp`.

## MCP Client Setup

### Claude Desktop (stdio)

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "actual-budget": {
      "command": "node",
      "args": ["/path/to/actual-budget-mcp/build/src/index.js"],
      "env": {
        "ACTUAL_SERVER_URL": "http://localhost:5006",
        "ACTUAL_SERVER_PASSWORD": "your-actual-server-password",
        "ACTUAL_BUDGET_SYNC_ID": "your-sync-id"
      }
    }
  }
}
```

### Remote (Streamable HTTP, recommended)

Set `MCP_TRANSPORT=http` and `MCP_API_KEYS` (comma-separated, each token ≥32 chars and ≥16 unique chars):

```json
{
  "mcpServers": {
    "actual-budget": {
      "url": "http://your-server:3000/mcp",
      "headers": {
        "Authorization": "Bearer your-api-key-min-32-chars-and-16-unique"
      }
    }
  }
}
```

### Remote (SSE, deprecated)

SSE transport is still supported through v2.1 for backwards compatibility but is slated for removal. The endpoint is `/sse` (POSTs to `/messages`). Responses include `Deprecation: true` and `Sunset` headers. Migrate to Streamable HTTP — see [`docs/MIGRATION-v1-to-v2.md`](docs/MIGRATION-v1-to-v2.md).

## Tools

### Accounts

| Tool | Description |
|------|-------------|
| `get-accounts` | List all accounts |
| `get-account-balance` | Get current balance for one account |
| `create-account` | Create an on- or off-budget account |
| `update-account` | Rename or rebalance an account |
| `close-account` | Close an account (transferring balance) |
| `reopen-account` | Reopen a closed account |
| `delete-account` | Delete an account |

### Transactions

| Tool | Description |
|------|-------------|
| `get-transactions` | Query transactions with date / account filters |
| `add-transactions` | Add transactions (no rules / categorization) |
| `import-transactions` | Import transactions (with rules + dedupe) |
| `update-transaction` | Update one transaction (supports splits) |
| `delete-transaction` | Delete a transaction |

### Categories

| Tool | Description |
|------|-------------|
| `get-categories` | List all categories |
| `get-category-groups` | List category groups |
| `create-category` | Create a category |
| `update-category` | Update a category |
| `delete-category` | Delete a category |
| `create-category-group` | Create a category group |
| `update-category-group` | Update a category group |
| `delete-category-group` | Delete a category group |

### Payees

| Tool | Description |
|------|-------------|
| `get-payees` | List all payees |
| `get-common-payees` | List the most-used payees |
| `create-payee` | Create a payee |
| `update-payee` | Update a payee |
| `delete-payee` | Delete a payee |
| `merge-payees` | Merge one payee into another |
| `get-payee-rules` | List rules associated with a payee |

### Budget

| Tool | Description |
|------|-------------|
| `get-budget-month` | Get budget data for a single month |
| `get-budget-months` | List available budget months |
| `set-budget-amount` | Set the budgeted amount for a category |
| `set-budget-carryover` | Toggle carryover for a category |
| `hold-budget-for-next-month` | Hold leftover funds for next month |
| `reset-budget-hold` | Clear a hold-for-next-month flag |

### Schedules

| Tool | Description |
|------|-------------|
| `get-schedules` | List scheduled transactions |
| `create-schedule` | Create a schedule |
| `update-schedule` | Update a schedule |
| `delete-schedule` | Delete a schedule |

### Rules

| Tool | Description |
|------|-------------|
| `get-rules` | List transaction rules |
| `create-rule` | Create a rule |
| `update-rule` | Update a rule |
| `delete-rule` | Delete a rule |

### Notes

| Tool | Description |
|------|-------------|
| `get-notes` | Get notes for an entity |
| `set-notes` | Set notes for an entity |
| `delete-notes` | Delete notes for an entity |

### Tags (NEW in v2)

| Tool | Description |
|------|-------------|
| `get-tags` | List all transaction tags |
| `create-tag` | Create a tag |
| `update-tag` | Update a tag |
| `delete-tag` | Delete a tag |

### Utility

| Tool | Description |
|------|-------------|
| `run-bank-sync` | Trigger bank sync |
| `get-id-by-name` | Resolve an account / category / payee name to its ID |
| `get-server-version` | Report the actual-server version |

### Query

| Tool | Description |
|------|-------------|
| `query` | Execute raw ActualQL queries with full filter, aggregate, and join support |

## Resources

| URI | Description |
|-----|-------------|
| `actual://accounts` | All accounts with type and current balance |
| `actual://categories` | Full category tree (groups + categories) |
| `actual://payees` | All payees |
| `actual://budget-settings` | Currency / formatting settings |

## Prompts

| Name | Description |
|------|-------------|
| `financial-health-check` | Guided savings rate / spending / variance review with recommendations |
| `budget-review` | Monthly budget review with overspent / underspent flags |
| `spending-deep-dive` | Deep dive into a specific category over a time period |
| `actualql-reference` | Full ActualQL syntax reference for the `query` tool |

## Development

```bash
npm ci                      # Install dependencies
npm run dev                 # Start with hot reload (tsx)
npm test                    # Run unit tests (vitest)
npm run test:integration    # Integration tests against committed budget fixture (real SDK)
npm run test:e2e            # Docker-compose smoke suite (auth, tools, notes round-trip)
npm run lint                # ESLint strict + TypeScript --noEmit
npm run build               # Compile TypeScript to build/
npm run format              # Prettier formatting
```

### Project Structure

```
src/
  index.ts            # Entry point
  app.ts              # Express app + MCP transport wiring (per-session map)
  config.ts           # Zod-validated v2 env config (with v1 var detection)
  auth.ts             # Multi-key Bearer middleware + Origin allowlist
  audit.ts            # Audit logger (sha256 caller-key prefix)
  health.ts           # /health endpoint
  server.ts           # MCP server factory (registers tools/resources/prompts)
  resources.ts        # MCP resources
  prompts.ts          # MCP prompts
  format.ts           # Markdown formatting helpers
  client/
    actual-client.ts  # ActualClient interface (boundary)
    fake-client.ts    # In-memory fake for unit tests
    sdk-client.ts     # Production @actual-app/api SDK adapter
    sync-coalescer.ts # 2s debounce for sync calls
    lifecycle.ts      # init/shutdown with p-retry + signal handlers
  tools/
    register.ts       # Aggregator
    shared.ts         # readTool / writeTool wrappers
    {accounts,budget,categories,notes,payees,query,rules,schedules,tags,transactions,utility}.ts
tests/
  unit/               # Vitest + FakeActualClient
  integration/        # Real SDK against committed budget fixture
  e2e/                # docker-compose smoke suite
docker/               # Production + dev compose
```

## Tech Stack

- **Runtime:** Node.js 22, TypeScript (strict mode)
- **MCP SDK:** `@modelcontextprotocol/sdk`
- **SDK:** `@actual-app/api` v26 (in-process, not HTTP proxy)
- **Validation:** Zod v4
- **Resilience:** p-retry (exponential backoff), 2-second sync coalescer
- **Security:** helmet, express-rate-limit, multi-key Bearer with constant-time compare, Origin allowlist, audit logger
- **Testing:** Vitest (unit + integration + e2e), in-memory fake client, committed budget fixture
- **Linting:** ESLint (strictTypeChecked), Prettier
- **CI/CD:** GitHub Actions, release-please, Docker multi-arch builds
- **Commits:** Conventional Commits (commitlint + husky)

## License

MIT
