# actual-budget-mcp v2 — Direct SDK Design

**Status:** Approved (2026-05-04)
**Supersedes:** `docs/superpowers/specs/2026-04-15-actual-budget-mcp-server-design.md` (v1 architecture)
**Implementation plan:** TBD — generated next via `superpowers:writing-plans`
**Research notes:** `docs/superpowers/research/2026-05-04-v2-direct-sdk-research.md`

---

## 1. Problem & motivation

V1 (`actual-budget-mcp@1.0.6`) reaches Actual Budget through `jhonderson/actual-http-api`, an HTTP wrapper around the official `@actual-app/api` SDK. The proxy is missing several routes — most prominently `notes/{type}/{id}` — so v1's `get-notes` / `set-notes` always 404. ActualQL (`run-query`) is read-only at that route, so notes can be **read** through it but never **written**. Beyond notes, the proxy generally lags upstream SDK features (tags, send-handlers).

**V2 replaces the HTTP proxy with direct use of `@actual-app/api` in-process.** This unlocks every internal handler the SDK exposes (notes, tags, future features) and removes a whole tier of infrastructure (`actual-http-api` container).

V2 ships as `actual-budget-mcp@2.0.0` in this same repo. Old v1 docker tag (`v1.0.6`) stays available for instant rollback.

## 2. Locked-in decisions

| # | Decision area | Choice |
|---|---------------|--------|
| Q1 | Repo strategy | In-place major bump to `2.0.0` |
| Q2 | Transports | Streamable HTTP + legacy SSE (deprecated) + stdio at v2.0; SSE removed in v2.1 |
| Q3 | Sync strategy | Sync before each read tool, coalesced to ≥2s window. Writes do explicit post-write sync |
| Q4 | Budget model | Single budget per process, env-configured |
| Q5 | Auth & hardening | `Authorization: Bearer` only, multi-key rotation, ≥32 char entropy, sha256-hashed audit identity, helmet, origin allowlist, rate limit, fail-closed startup |
| Q6 | Tool surface | All v1 tools reimplemented on SDK + fixed notes (read+write+delete) + new tags CRUD; no raw `send()` escape hatch |
| Q7 | Test strategy | Unit (mock `ActualClient`) + integration (real SDK offline mode against committed `.actual` fixture) + e2e (docker-compose with real `actual-server`) |
| Q8 | Migration UX | Hard cut on env vars; old vars cause clear startup failure |
| Q9 | Sync failure policy | Fail hard (after `p-retry`) for both reads and writes; never serve stale data |

## 3. Architecture

Three layers with sharp boundaries:

```
┌─────────────────────────────────────────────────┐
│ Transport / HTTP layer                          │
│   express + helmet + rate-limit + auth          │
│   StreamableHTTP, SSE (deprecated), stdio       │
└──────────────────┬──────────────────────────────┘
                   │ McpServer (@modelcontextprotocol/sdk)
┌──────────────────▼──────────────────────────────┐
│ Tool layer                                       │
│   Each tool: zod input → ActualClient call →    │
│   formatter → CallToolResult                    │
│   Read tools wrapped by SyncCoalescer           │
│   Write tools wrapped by AuditLogger            │
└──────────────────┬──────────────────────────────┘
                   │ ActualClient interface
┌──────────────────▼──────────────────────────────┐
│ Client layer                                     │
│   sdk-client.ts  (real, wraps @actual-app/api)  │
│   fake-client.ts (in-memory, for unit tests)    │
└──────────────────────────────────────────────────┘
```

Tools never import `@actual-app/api` directly — only `ActualClient`. This is the swap-point that makes every tool unit-testable without booting the real SDK.

### Directory layout

```
src/
  index.ts                 # CLI entrypoint (parse flags, wire transport)
  config.ts                # env loading + zod validation, fail-closed checks
  server.ts                # express + transport wiring
  auth.ts                  # Bearer middleware, origin allowlist, rate limit
  audit.ts                 # write-operation audit logger (pino child)
  health.ts                # /health endpoint
  client/
    actual-client.ts       # ActualClient interface (the boundary)
    sdk-client.ts          # real impl backed by @actual-app/api
    fake-client.ts         # in-memory fake for unit tests
    sync-coalescer.ts      # 2s debounce wrapper around sync()
    lifecycle.ts           # init / downloadBudget / shutdown / signals
  tools/
    crud.ts, query.ts, notes.ts, tags.ts, schedules.ts, …
    register.ts            # iterate tools, register on McpServer
  format.ts                # output formatters (kept from v1)
  prompts.ts               # MCP prompts (kept from v1)
  resources.ts             # MCP resources (kept from v1)
tests/
  unit/{tools,client,…}/<name>.test.ts
  integration/<feature>.test.ts
  e2e/{compose.yml, *.test.ts}
  fixtures/
    budget-cache/          # committed minimal .actual cache (~50KB)
    regenerate.ts          # one-shot script via docker-compose
    README.md
```

## 4. Process lifecycle

```
startup:
  1. parse CLI flags → cfg
  2. zod-validate env (fail-closed: missing MCP_API_KEYS while HTTP enabled → exit 1)
  3. enforce key entropy (≥32 chars, ≥16 unique chars per key) → exit 1 on violation
  4. api.init({ dataDir: '/var/lib/actual-mcp', serverURL, password })
  5. api.downloadBudget(syncId, { password: encryptionPwd? })
  6. wire transports based on flags (--stdio, --http, --sse)
  7. start express (if HTTP/SSE) → listen
  8. install SIGTERM/SIGINT handlers → shutdown()
  9. start sync coalescer

runtime:
  read tool  → coalescer.maybeSync() → SDK call → format → CallToolResult
  write tool → SDK call → audit log → await sdk.sync() → CallToolResult
  /health    → return SDK + sync state

shutdown (idempotent):
  1. stop accepting new tool calls (transport.close())
  2. await drain (max 30s; force-cancel after)
  3. api.shutdown()  // final sync + close-budget
  4. process.exit(0)
```

Docker: `STOPSIGNAL SIGTERM`, `stop_grace_period: 60s`.

## 5. Transports

| Transport | Endpoint | Default in Docker | Auth |
|-----------|----------|-------------------|------|
| Streamable HTTP | `POST/GET/DELETE /mcp` | enabled | required |
| Legacy SSE (deprecated, removed in v2.1) | `GET /sse` + `POST /messages` | enabled (compat) | required |

SSE deprecation in v2.0 is concretely:
- README + CHANGELOG state SSE is deprecated and will be removed in v2.1.
- At startup, when `--sse` is enabled, log a `warn`-level line: `"SSE transport is deprecated and will be removed in v2.1; migrate to Streamable HTTP at /mcp"`.
- The `/sse` and `/messages` routes set `Deprecation: true` and `Sunset: <v2.1 release date or 90 days>` HTTP headers (RFC 8594 / RFC 9745) on every response.
| stdio | stdin/stdout | disabled | bypassed (process-local trust) |

Streamable HTTP per MCP spec 2025-06-18:
- Single endpoint, `POST` for client→server, `GET` for SSE-stream from server, `DELETE` to terminate session.
- `Mcp-Session-Id` header assigned at init, required on subsequent requests; respond `404` to unknown session IDs.
- `MCP-Protocol-Version` header validated; respond `400` on unsupported versions.
- Supports `Last-Event-ID` for resumability.

CLI flags: `--stdio`, `--http`, `--sse` (compose-able). Image `CMD` defaults to `--http --sse`.

## 6. Auth, hardening, audit

### Authentication

- Header: **`Authorization: Bearer <token>` only.** Anything else → `401 + WWW-Authenticate: Bearer realm="actual-mcp"`.
- Env: `MCP_API_KEYS` — comma-separated list of valid tokens (enables zero-downtime rotation: add new, deploy, remove old).
- Constant-time compare against each valid token.
- Startup entropy enforcement: each token must be ≥32 chars and contain ≥16 unique chars; otherwise fatal log + `exit(1)`.
- Stdio: middleware not mounted.

### Origin validation (DNS rebinding mitigation, per spec)

- Env: `MCP_ALLOWED_ORIGINS` (comma-separated). When `Origin` header is present, must match an entry; else `403`.
- Missing `Origin` (curl, server-to-server) is allowed — auth still required.

### Rate limit

- `express-rate-limit`, keyed by `callerKey = sha256(token).slice(0,12)` (not IP — single-tenant deploys all share one IP).
- Default 120 req/min, configurable via `MCP_RATE_LIMIT_PER_MIN`.

### Audit log

- pino child logger with `{ audit: true }`. Every write tool wraps its handler:
  ```
  { audit: true, tool, params, result: 'ok'|'err', durationMs, callerKey }
  ```
- Token never logged anywhere. `callerKey` is non-reversible.
- Default destination: stdout (Docker collects). File destination is a v2.x consideration.

### Other hardening

- `helmet` defaults (HSTS on, CSP off — not a browser-facing API).
- All env validation through zod; no string-coercion errors at runtime.
- `npm audit --audit-level=high` gate in CI.

### Health endpoint

`GET /health` (no auth, no rate limit):

```json
{
  "status": "ok",            // ok | degraded | down
  "sdkInitialized": true,
  "lastSyncAt": "2026-05-04T13:42:11Z",
  "lastSyncSucceeded": true,
  "budgetSyncId": "894961df-...",
  "version": "2.0.0"
}
```

- `ok` (HTTP 200).
- `degraded` (HTTP 200): SDK up, last sync failed. **Intentionally returns 200 so Docker does not restart on transient sync failures** — the operator sees it via the JSON body / log scraping.
- `down` (HTTP 503): SDK init failed. Docker will restart.
- Used by Docker `HEALTHCHECK`.

## 7. Sync model

### SyncCoalescer

```ts
class SyncCoalescer {
  private lastSyncAt = 0;
  private inFlight: Promise<void> | null = null;
  constructor(private sdk: ActualClient, private windowMs = 2000) {}

  async maybeSync(): Promise<void> {
    if (Date.now() - this.lastSyncAt < this.windowMs) return;       // cache hit
    if (this.inFlight) return this.inFlight;                         // dedupe concurrent
    this.inFlight = this.sdk.sync()
      .then(() => { this.lastSyncAt = Date.now(); })
      .finally(() => { this.inFlight = null; });
    return this.inFlight;
  }
}
```

### Failure policy (fail hard, with retries first)

| Tool type | Behavior |
|-----------|----------|
| **Read** | `coalescer.maybeSync()`; on failure after `p-retry` (3 attempts, 200ms→800ms expo, retry only on network/timeout), return MCP error result `"sync failed: <reason>; refusing to serve stale data"`. |
| **Write** | SDK call → `await sdk.sync()` (also retried). On push-sync failure return MCP error `"write committed locally but failed to sync to server: <reason>; will retry on next call"`. Local write stays in CRDT log; next sync pushes. |
| **Repeated failure** (3 consecutive) | `lastSyncSucceeded: false` + `degraded` status in `/health`. No restart loop. |

## 8. Tool surface

35 tools, every one has its own zod schema and `tests/unit/tools/<tool>.test.ts`.

| Group | Tools |
|-------|-------|
| Categories | `get-categories`, `create-category`, `update-category`, `delete-category`, `get-category-groups`, `create-category-group`, `update-category-group`, `delete-category-group` |
| Transactions | `get-transactions`, `add-transactions`, `import-transactions`, `update-transaction`, `delete-transaction` |
| Accounts | `get-accounts`, `create-account`, `update-account`, `close-account`, `reopen-account`, `delete-account`, `get-account-balance`, `run-bank-sync` |
| Payees | `get-payees`, `create-payee`, `update-payee`, `delete-payee`, `merge-payees`, `get-common-payees` |
| Rules | `get-rules`, `create-rule`, `update-rule`, `delete-rule`, `get-payee-rules` |
| Budget | `get-budget-month`, `get-budget-months`, `set-budget-amount`, `set-budget-carryover`, `hold-budget-for-next-month`, `reset-budget-hold` |
| Schedules | `get-schedules`, `create-schedule`, `update-schedule`, `delete-schedule` |
| **Notes (NEW, fixed)** | `get-notes`, `set-notes`, `delete-notes` — read via `aqlQuery({table:'notes', filter:{id}})`, write via `internal.send('notes-save')`, delete via corresponding handler. `id` is entity UUID or `budget-YYYY-MM`. |
| **Tags (NEW)** | `get-tags`, `create-tag`, `update-tag`, `delete-tag` |
| Query | `query` (raw ActualQL, kept from v1) |
| Utility | `get-id-by-name`, `get-server-version` |

### Tool template

```ts
mcpServer.tool(
  'set-notes',
  'Set or update notes for a category, account, or budget month.',
  {
    type: z.enum(['category', 'account', 'budgetmonth']),
    id:   z.string().min(1),
    notes: z.string(),
  },
  withAudit('set-notes', async ({ type, id, notes }) => {
    await client.sendNotesSave({ id: noteId(type, id), note: notes });
    await client.sync();   // fail-hard write
    return ok(`Notes updated for ${type} ${id}`);
  }),
);
```

Note: `client.sendNotesSave(...)` is a typed method on `ActualClient`. Tools never call `internal.send(handler, payload)` directly — every internal handler we expose gets a structured, typed method on the client interface. Keeps the boundary mockable and prevents the LLM from invoking arbitrary handlers.

### Explicitly NOT in v2.0

- Raw `send(handler, payload)` tool — every internal handler we expose gets a structured tool.
- Custom reports, dashboard widgets — not LLM-useful.
- `runImport`, `loadBudget`, `getBudgets` — process is bound to one budget.
- Multi-budget support, OAuth 2.1, OpenTelemetry — deferred to v2.x.

## 9. Configuration

### Required env vars (v2)

| Var | Required when | Notes |
|-----|---------------|-------|
| `ACTUAL_SERVER_URL` | always | e.g., `http://actual-budget:5006` |
| `ACTUAL_SERVER_PASSWORD` | always | The actual-server user password |
| `ACTUAL_BUDGET_SYNC_ID` | always | The single budget the process is bound to |
| `ACTUAL_BUDGET_ENCRYPTION_PASSWORD` | iff budget is E2EE-encrypted | clear error on download failure if missing |
| `MCP_API_KEYS` | iff HTTP or SSE transport enabled | comma-separated; ≥32 chars + ≥16 unique chars per key |
| `MCP_ALLOWED_ORIGINS` | recommended | comma-separated; warn at startup if unset |
| `MCP_RATE_LIMIT_PER_MIN` | optional | default 120 |
| `MCP_PORT` | optional | default 3000 |
| `MCP_DATA_DIR` | optional | default `/var/lib/actual-mcp` |
| `LOG_LEVEL` | optional | pino level, default `info` |

### Removed env vars (v1 → v2 hard cut)

- `ACTUAL_HTTP_API_URL` — not used; v2 talks to actual-server directly
- `ACTUAL_HTTP_API_KEY` — replaced by `ACTUAL_SERVER_PASSWORD`

If any removed var is set at startup, v2 logs a fatal migration error pointing to `docs/MIGRATION-v1-to-v2.md` and exits.

## 10. Testing

### Tier 1 — Unit (`tests/unit/`)

- One test file per tool: `tests/unit/tools/<tool>.test.ts`.
- `FakeActualClient` (in-memory map-backed) implements `ActualClient` interface.
- Covers zod validation, happy path, error mapping, formatter output (snapshot tests).
- Also covered: `sync-coalescer.test.ts` (with vitest fake timers), `auth.test.ts`, `audit.test.ts` (verifies tokens never appear in lines + sha256 identity), `config.test.ts` (env validation + entropy enforcement + fail-closed checks).
- **>90% coverage target** on `src/` excluding `index.ts` and `lifecycle.ts`. CI threshold gate.
- Run on `vitest --watch` during dev.

### Tier 2 — Integration (`tests/integration/`)

- Real `@actual-app/api` SDK in **offline mode** (`serverURL` omitted) against a temp copy of `tests/fixtures/budget-cache/`.
- `beforeEach`: copy fixture to `os.tmpdir()`, `actualApi.init({ dataDir: tmp })`.
- `afterEach`: `actualApi.shutdown()`, rm tmp dir.
- ~15 tests, one per tool group — verifies our `ActualClient` adapter lines up with real SDK shapes.
- Run on `npm run test:integration` and pre-push.

### Tier 3 — E2E (`tests/e2e/`)

- `docker compose -f tests/e2e/compose.yml up -d` brings up real `actual-server` + the v2 MCP container.
- ~5 smoke tests via real MCP client (`@modelcontextprotocol/sdk`) over Streamable HTTP: auth rejection, one read, one write, one notes flow, clean shutdown.
- Runs in CI only.

### Fixture management

`tests/fixtures/regenerate.ts` is a one-shot script: brings up actual-server in docker, has SDK create a fresh budget, populates a tiny dataset (2 accounts, 5 categories, 10 transactions, 3 notes, 2 tags), copies the resulting `.actual` cache to `tests/fixtures/budget-cache/`, tears down. Devs run it only when actual schema migrates. Output is deterministic so git diffs stay sensible.

### Lint, typecheck, security

| Tool | Purpose |
|------|---------|
| `eslint` (typescript-eslint) | TS errors + style |
| `eslint-plugin-security` | OWASP-style anti-patterns |
| `eslint-plugin-n` | Node best practices |
| `prettier` | Format |
| `tsc --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --noEmit` | Maximum type safety |
| `npm audit --audit-level=high` | Dep vulnerability gate (CI) |
| husky + lint-staged | `eslint --fix && prettier --write` on staged TS (existing v1 setup) |
| husky pre-push | `npm test && npm run lint` (existing v1 setup) |

## 11. Deployment

### Docker image

- Base: `node:22-alpine` (matches v1).
- Build stage adds `python3 make g++ sqlite` for `better-sqlite3` native compile; final stage drops them.
- Runs as non-root user `actualmcp:actualmcp` (uid 10001).
- `VOLUME /var/lib/actual-mcp` — SDK cache must persist across container restarts (otherwise re-downloads entire budget on every restart).
- `HEALTHCHECK CMD wget -qO- http://localhost:3000/health || exit 1` — every 30s, 3 retries.
- `STOPSIGNAL SIGTERM`.

### Compose (your VPS, post-cutover)

```yaml
services:
  actual-mcp:
    image: ghcr.io/kazefreeze/actual-budget-mcp:v2.0.0
    restart: unless-stopped
    stop_grace_period: 60s
    environment:
      ACTUAL_SERVER_URL: http://life-essentials-actualbudget-tupojc-actual-budget-1:5006
      ACTUAL_SERVER_PASSWORD: ${ACTUAL_SERVER_PASSWORD}
      ACTUAL_BUDGET_SYNC_ID: 894961df-d9b6-4b1c-8712-f4fe8eb6c824
      MCP_API_KEYS: ${MCP_KEYS}
      MCP_ALLOWED_ORIGINS: https://claude.ai
    volumes:
      - actual-mcp-data:/var/lib/actual-mcp
    networks:
      - actual-budget-network
volumes:
  actual-mcp-data:
```

(`actual-http-api` container can be removed after cutover.)

### Migration steps (one-time, your VPS)

1. Merge v2 to main → release-please opens v2.0.0 release PR.
2. Merge release PR → v2.0.0 image published to ghcr.io.
3. Edit your stack's compose file as above.
4. `docker compose up -d actual-mcp`. First boot downloads budget into the volume (~10-30s) then becomes healthy.
5. Verify in Claude.
6. (Optional, after a few days of stable operation) `docker compose rm actual-http-api`.

### Rollback (<2 min)

Set `image: ghcr.io/kazefreeze/actual-budget-mcp:v1.0.6`, restore old env vars, restart `actual-http-api`, `docker compose up -d`.

## 12. Release sequencing

- **v2.0.0** — everything in this design.
- **v2.1.0** — drop legacy SSE transport, drop env var migration error messages.
- **v2.2+** — escape-hatch `send` tool (if needed), OpenTelemetry, custom reports, OAuth 2.1.
- **v3.0** — adopt v2.x of `@modelcontextprotocol/sdk` once stable (currently alpha).

## 13. Documentation

- README: update env var table, transport flags, deprecation notice for SSE, link to migration doc.
- New: `docs/MIGRATION-v1-to-v2.md` — exact compose-file diff for the cutover.
- Update: `docs/superpowers/specs/2026-04-15-actual-budget-mcp-server-design.md` gets a "Superseded by 2026-05-04 v2 design" header.

## 14. Risks

| Risk | Mitigation |
|------|------------|
| `@actual-app/api` schema migration breaks fixture | Regen script (`tests/fixtures/regenerate.ts`) is one command; integration tests catch it on next CI run after upgrade. |
| First-boot budget download is slow on large budgets | Volume persists cache across restarts; only first boot pays the cost. Document expected ~10-30s init time. |
| `better-sqlite3` native build fails on alpine | Multi-stage Dockerfile with explicit `python3 make g++`; pin Node 22 + alpine version. CI builds image on every PR to catch this. |
| Concurrent tool calls from MCP clients race the SDK | SDK methods are async-safe in normal use; SyncCoalescer handles concurrent sync. Audit log + integration tests cover concurrent write scenarios. |
| Token leak via logs | Audit logger uses sha256 prefix only; lint rule + dedicated `audit.test.ts` enforce no token-in-log. |
| Loss of v1 user (no — single user, you) | Hard cut on env vars is acceptable; rollback path documented. |

## 15. Open items deferred to implementation

- Audit log to file (in addition to stdout) — defer to v2.x if forensic needs grow.
- Whether to ship a small `examples/` with a Claude Desktop config snippet.
- Whether `tools/register.ts` should pull tool metadata from a manifest or from each module — pick during impl.
