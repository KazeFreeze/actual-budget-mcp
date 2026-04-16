# actual-budget-mcp

An [MCP](https://modelcontextprotocol.io/) server for [Actual Budget](https://actualbudget.org/) that provides AI assistants with tools to read, write, and analyze your budget data.

Connects through [actual-http-api](https://github.com/jhonderson/actual-http-api) as a proxy layer, deploys as a Docker sidecar alongside your existing Actual Budget instance.

## Features

- **19 CRUD tools** -- accounts, transactions, categories, payees, budget months, schedules, rules, notes, bank sync
- **6 analytical reports** -- monthly summary, spending analysis, budget variance, trend analysis, net worth snapshot, income/expense timeline
- **Raw query power** -- `run-query` tool with full ActualQL support (filters, aggregates, joins, grouping)
- **4 MCP resources** -- accounts, categories, payees, budget settings
- **4 guided prompts** -- financial health check, budget review, spending deep dive, ActualQL reference
- **Markdown output** -- formatted tables, split transaction rendering, 34-38% fewer tokens than JSON
- **Multiple transports** -- stdio (local), SSE (remote), Streamable HTTP
- **Security** -- bearer token auth, helmet headers, rate limiting, constant-time token comparison

## Quick Start

### Docker Compose (recommended)

```bash
# Clone the repo
git clone https://github.com/KazeFreeze/actual-budget-mcp.git
cd actual-budget-mcp

# Configure environment
cp .env.example .env
# Edit .env with your Actual Budget credentials

# Start the full stack
docker compose -f docker/docker-compose.yml up -d
```

### Using the published image

```bash
docker pull ghcr.io/kazefreeze/actual-budget-mcp:latest

# Or use the production compose file
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
| `ACTUAL_HTTP_API_URL` | Yes | -- | URL of your actual-http-api instance |
| `ACTUAL_HTTP_API_KEY` | Yes | -- | API key for actual-http-api |
| `ACTUAL_BUDGET_SYNC_ID` | Yes | -- | Budget sync ID (Settings > Advanced > Sync ID) |
| `MCP_AUTH_TOKEN` | No | -- | Bearer token for remote transport auth |
| `MCP_TRANSPORT` | No | `stdio` | Transport mode: `stdio`, `sse`, or `http` |
| `MCP_PORT` | No | `3001` | Port for SSE/HTTP transport |
| `CURRENCY_SYMBOL` | No | `$` | Currency symbol for formatting |
| `LOG_LEVEL` | No | `info` | Log level: `debug`, `info`, `warn`, `error` |

## Architecture

```
Claude/AI <--MCP--> actual-budget-mcp <--HTTP--> actual-http-api <---> Actual Budget
                     (this project)              (proxy layer)         (your data)
```

The MCP server never touches your budget database directly. All operations go through actual-http-api, which handles authentication and data access.

## MCP Client Setup

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "actual-budget": {
      "command": "node",
      "args": ["/path/to/actual-budget-mcp/build/src/index.js"],
      "env": {
        "ACTUAL_HTTP_API_URL": "http://localhost:5007",
        "ACTUAL_HTTP_API_KEY": "your-api-key",
        "ACTUAL_BUDGET_SYNC_ID": "your-sync-id"
      }
    }
  }
}
```

### Remote (SSE)

For remote access, set `MCP_TRANSPORT=sse` and optionally `MCP_AUTH_TOKEN`:

```json
{
  "mcpServers": {
    "actual-budget": {
      "url": "http://your-server:3001/sse",
      "headers": {
        "Authorization": "Bearer your-auth-token"
      }
    }
  }
}
```

## Tools

### CRUD Operations

| Tool | Description |
|------|-------------|
| `get-accounts` | List all accounts with balances |
| `get-transactions` | Query transactions with date filters |
| `create-transaction` | Create transaction (supports splits) |
| `update-transaction` | Update transaction fields |
| `delete-transaction` | Delete a transaction |
| `get-categories` | List category groups and categories |
| `manage-category` | Create/update/delete categories and groups |
| `get-payees` | List all payees |
| `manage-payee` | Create/update/delete/merge payees |
| `get-budget-month` | Get budget data for a month |
| `set-budget-amount` | Set category budget amount |
| `transfer-budget` | Move money between categories |
| `get-schedules` | List scheduled transactions |
| `manage-schedule` | Create/update/delete schedules |
| `get-rules` | List transaction rules |
| `manage-rule` | Create/update/delete rules |
| `get-notes` | Get notes for an entity |
| `set-notes` | Set notes for an entity |
| `run-bank-sync` | Trigger bank sync |

### Analytics

| Tool | Description |
|------|-------------|
| `monthly-financial-summary` | Income, expenses, net, savings rate, top categories |
| `spending-analysis` | Spending breakdown by category, payee, or account |
| `budget-variance-report` | Budgeted vs actual with over/under flags |
| `trend-analysis` | Month-over-month spending trends |
| `net-worth-snapshot` | All account balances and total net worth |
| `income-expense-timeline` | Monthly income/expense/net over time |

### Query

| Tool | Description |
|------|-------------|
| `run-query` | Execute raw ActualQL queries with full filter, aggregate, and join support |

## Development

```bash
npm ci              # Install dependencies
npm run dev         # Start with hot reload
npm test            # Run tests (58 tests)
npm run lint        # ESLint strict + TypeScript check
npm run build       # Compile TypeScript
npm run format      # Prettier formatting
```

### Project Structure

```
src/
  index.ts          # Entry point, transport setup
  config.ts         # Zod-validated environment config
  client.ts         # Typed HTTP client with TTL cache and retry
  auth.ts           # Bearer token middleware
  format.ts         # Markdown formatting utilities
  server.ts         # MCP server factory
  resources.ts      # MCP resources (accounts, categories, etc.)
  prompts.ts        # Guided analysis prompts
  tools/
    shared.ts       # Shared types and helpers
    crud.ts         # 19 CRUD tools
    query.ts        # ActualQL query tool
    analytics.ts    # 6 analytical report tools
tests/              # Vitest tests with MSW mocking
docker/             # Docker Compose files (dev + production)
```

## Tech Stack

- **Runtime:** Node.js 22, TypeScript (strict mode)
- **MCP SDK:** `@modelcontextprotocol/sdk`
- **Validation:** Zod v4
- **HTTP:** p-retry (exponential backoff), TTL cache
- **Security:** helmet, express-rate-limit, constant-time auth
- **Testing:** Vitest, MSW (Mock Service Worker)
- **Linting:** ESLint (strictTypeChecked), Prettier
- **CI/CD:** GitHub Actions, release-please, Docker multi-arch builds
- **Commits:** Conventional Commits (commitlint + husky)

## License

MIT
