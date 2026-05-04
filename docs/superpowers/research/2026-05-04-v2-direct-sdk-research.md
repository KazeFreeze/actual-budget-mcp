# V2 Direct SDK — Research Notes

Research collected during the v2 brainstorm. Captures decisions, rationale, library choices, and external references so we can rebuild context in future sessions without re-discovering everything.

## Summary

V1 of `actual-budget-mcp` proxies the third-party `jhonderson/actual-http-api` over HTTP. That proxy is missing routes for category/account/budget-month notes (the `/notes/{type}/{id}` paths the v1 client calls don't exist upstream — see `references/actual-http-api/src/v1/routes/`), so `get-notes` / `set-notes` always 404. ActualQL `run-query` is read-only on the route level, so notes can be **read** through it but not written.

V2 replaces the HTTP proxy with **direct use of `@actual-app/api`**, the official SDK from the actualbudget monorepo. This unlocks notes (read via `aqlQuery({table:'notes'})`, write via `internal.send('notes-save', ...)`), tags, and any other internal handler the SDK exposes.

## Brainstorm decisions (locked in)

| # | Question | Decision |
|---|----------|----------|
| Q1 | Repo strategy | **A** — In-place major bump to `actual-budget-mcp@2.0.0` in this repo. v1.0.6 docker tag is immutable for rollback. |
| Q2 | Transport | **B** — Streamable HTTP + legacy SSE + stdio at v2.0.0. SSE marked deprecated in README/CHANGELOG; removed in v2.1. |
| Q3 | Sync strategy | **B with 2s coalesce** — Call `actualApi.sync()` before each read tool; skip if last sync ran <2s ago. Writes auto-sync via SDK. |
| Q4 | Budget model | **A** — Single budget per process, env-configured via `ACTUAL_BUDGET_SYNC_ID`. Multi-budget = multiple containers. |
| Q5 | Auth & hardening | **A** — `MCP_API_KEY` header, helmet, express-rate-limit, zod everywhere. Add audit log for every write. Fail-closed: refuse to start if `MCP_API_KEY` is unset and HTTP transport is enabled. Stdio bypasses auth (process-local trust). |
| Q6 | Tool surface | **A** — All v1 tools reimplemented on SDK + fixed notes (read+write+delete) + new tags CRUD. No raw `send()` escape hatch in v2.0. |
| Q7 | Test strategy | **A** — Mock-based unit tests per tool (vitest, swap `ActualClient` interface for fake). Integration tests use a bundled `.actual` cache fixture committed to `tests/fixtures/budget-cache/`, copied to temp dir per test, real SDK in offline mode (no `serverURL`). `tests/fixtures/regenerate.ts` script for schema migrations. |
| Q8 | Migration UX | **A** — Hard cut on env vars. v2 only accepts new vars (`ACTUAL_SERVER_URL`, `ACTUAL_SERVER_PASSWORD`, `ACTUAL_BUDGET_ENCRYPTION_PASSWORD?`, `ACTUAL_BUDGET_SYNC_ID`, `MCP_API_KEY`). Old vars (`ACTUAL_HTTP_API_*`) cause startup failure with a clear migration error. |

## Why ActualQL alone can't write notes

- `actual-http-api` `/v1/budgets/:id/run-query` route handler (`references/actual-http-api/src/v1/routes/run-query.js:103-141`) only invokes `select/filter/groupBy/orderBy/limit/offset/...` on the query builder — never any insert/update/delete.
- In `loot-core`, mutations go through `internal.send('<handler-name>', payload)`. For notes specifically: `notes-save`, `notes-save-undoable`, plus delete via the same app (`references/actual/packages/loot-core/src/server/notes/app.ts`).
- The notes table schema in AQL: `{ id, note }` where `id` is the entity UUID (category/account) or `budget-YYYY-MM`.

## SDK behavior — `@actual-app/api`

From `references/actual/packages/api/index.ts` and the public docs:

```ts
import * as api from '@actual-app/api';

await api.init({
  dataDir: '/var/lib/actual-mcp',     // SQLite cache lives here
  serverURL: 'https://actual.example', // omit for offline mode
  password:  'sync-server-password',
});
await api.downloadBudget(syncId, { password?: encryptionPassword });
// ... use api.* methods ...
await api.shutdown();   // calls send('sync') then send('close-budget')
```

Key facts:

- **Single budget per process.** Calling `downloadBudget` again is awkward; treat the process as bound to one budget.
- **Offline mode is real but limited.** Omit `serverURL` → no network calls, but you can only access budgets already downloaded into `dataDir`. There is no public `createBudget`. Useful for tests against committed fixtures.
- **`init()` returns the internal `lib` handle.** Exposes `internal.send(handlerName, payload)` for any registered server-side app handler (notes-save, sync, etc.). Powerful, schemaless — keep behind structured tool wrappers.
- **`shutdown()` does a final sync.** Wire to SIGTERM/SIGINT for clean exits.
- **Sync is incremental (CRDT).** `api.sync()` pulls/pushes deltas. Cheap when nothing changed, grows with external write volume.
- **No websocket / no server push.** Web UI uses scheduled `setTimeout` after writes (`references/actual/packages/loot-core/src/server/sync/index.ts`, `scheduleFullSync` with `FULL_SYNC_DELAY = 1000ms`). It does not poll for external changes — relies on app-load/focus events. Our MCP doing sync-before-read is therefore *strictly* fresher than the web UI w.r.t. external changes.

## MCP TS SDK — current state

Current production line is `@modelcontextprotocol/sdk@^1.27.0` (monolithic). v1 of our MCP uses this; we will too. v2.0.0-alpha of the SDK splits into `@modelcontextprotocol/{core,server,client,node,...}` — promising but alpha; do not adopt yet.

From `references/typescript-sdk/packages/server/src/server/`:

- `streamableHttp.ts` — modern transport, single endpoint POST+GET, session via `Mcp-Session-Id` header, optional SSE for streaming, supports resumability via `Last-Event-ID`.
- `sse.ts` — legacy HTTP+SSE transport (separate `/sse` endpoint for stream + POST endpoint for messages). Required for backwards compat with our existing v1 deployment.
- `stdio.ts` — local subprocess transport.

### Spec requirements we must honor (Streamable HTTP, 2025-06-18)

- **Validate `Origin` header** to prevent DNS rebinding.
- **`MCP-Protocol-Version` header** required on all subsequent requests after init; respond `400` on unsupported versions.
- **`Mcp-Session-Id` header** assigned at init, required on subsequent requests; respond `404` to unknown session IDs.
- **DELETE endpoint** to terminate sessions.
- **Resumability**: SSE event IDs + `Last-Event-ID` request header for stream resume.
- Auth is **OPTIONAL**; OAuth 2.1 is a "SHOULD" for HTTP transport. **API key auth is acceptable for private deployments** per spec.

## Library choices

Stick with v1's stack where it still serves us. Add minimal new dependencies.

| Concern | Library | Notes |
|---------|---------|-------|
| MCP server | `@modelcontextprotocol/sdk` (1.x) | Same as v1; swap to v2 SDK when stable. |
| Actual SDK | `@actual-app/api` (latest matching `actual-server` 26.x) | Pin minor version; track upstream releases. |
| HTTP framework | `express` (v5) | Already in use; SDK transports plug into it cleanly. |
| Headers | `helmet` | Existing. |
| Rate limit | `express-rate-limit` | Existing. |
| Validation | `zod` (v4) | Existing; SDK uses zod too. |
| Logging | `pino` | Existing. Audit log = pino child logger with `audit: true`. |
| Retry | `p-retry` | Existing — for transient sync failures. |
| Date | `date-fns` | Existing. |
| Tests | `vitest`, `msw` (still useful for testing the rare HTTP edges) | Existing. |
| Lint/format | `eslint`, `prettier`, `eslint-plugin-security`, `typescript-eslint` | Existing. |
| Pre-commit | `husky` + `lint-staged` | Existing. |
| Process supervision | none — Docker handles restart | n/a |

Ones we are *not* adopting (and why):
- **OAuth/Passport** — overkill for single-user private API key auth.
- **TypeORM/Prisma** — `@actual-app/api` owns all DB access; we never touch SQLite directly.
- **PM2** — Docker `restart: unless-stopped` is enough.

## File / module layout (proposed)

```
src/
  index.ts                 # CLI entrypoint (parse args, wire transport)
  config.ts                # env loading + validation (zod), fail-closed checks
  server.ts                # express + transport wiring (StreamableHTTP, SSE shim, stdio)
  auth.ts                  # API key middleware, origin validation, rate limit
  audit.ts                 # write-operation audit logger (pino child)
  client/
    actual-client.ts       # ActualClient interface (the boundary we mock in tests)
    sdk-client.ts          # real implementation backed by @actual-app/api
    fake-client.ts         # in-memory fake for unit tests
    sync-coalescer.ts      # 2s debounce wrapper around sync()
    lifecycle.ts           # init/downloadBudget/shutdown + signal handling
  tools/
    crud.ts, query.ts, notes.ts, tags.ts, ...   # one file per tool group
    register.ts            # iterate tools and register on McpServer
  format.ts                # output formatters (kept from v1)
  prompts.ts               # MCP prompts (kept from v1)
  resources.ts             # MCP resources (kept from v1)
tests/
  unit/tools/<tool>.test.ts
  integration/<feature>.test.ts
  fixtures/
    budget-cache/          # committed .actual cache directory
    regenerate.ts          # one-shot script to rebuild fixture via docker-compose
```

## Open questions deferred to design / impl

- **Audit log destination**: stdout-only (pino), or also append to a file mounted as a Docker volume? Default to stdout; revisit if forensic needs grow.
- **Healthcheck**: Docker healthcheck should hit a non-MCP `/health` endpoint that reports SDK init state and last-sync timestamp.
- **Encrypted budgets**: `ACTUAL_BUDGET_ENCRYPTION_PASSWORD` is optional; only required if the user enabled E2EE on the budget. Surface clear error if it's missing and download fails on encryption.
- **Fixture regeneration trigger**: Script auto-runs CI when fixture file is older than N actual-server releases? Probably manual to start.

## External references (read during research)

- MCP spec — Transports (Streamable HTTP): https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
- MCP spec — Authorization: https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization
- Actual API docs: https://actualbudget.org/docs/api/
- Actual API reference: https://actualbudget.org/docs/api/reference/
- Actual database details: https://actualbudget.org/docs/contributing/project-details/database/
- `references/actual/packages/loot-core/src/server/notes/app.ts` — notes handlers
- `references/actual/packages/loot-core/src/server/sync/index.ts` — sync model
- `references/actual/packages/api/index.ts` — SDK init/shutdown
- `references/actual-http-api/src/v1/routes/run-query.js` — confirmation that ActualQL surface is read-only
- `references/typescript-sdk/packages/server/src/server/{streamableHttp,sse,stdio}.ts` — SDK transports
