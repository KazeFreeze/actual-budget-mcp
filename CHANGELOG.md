# Changelog

## [3.0.1](https://github.com/KazeFreeze/actual-budget-mcp/compare/v3.0.0...v3.0.1) (2026-05-06)


### Bug Fixes

* populate balance_current in get-accounts ([#20](https://github.com/KazeFreeze/actual-budget-mcp/issues/20)) ([16df28b](https://github.com/KazeFreeze/actual-budget-mcp/commit/16df28b60c1ebc5d45c942568a7515fc320da98f))

## [3.0.0](https://github.com/KazeFreeze/actual-budget-mcp/compare/v2.1.0...v3.0.0) (2026-05-06)


### ⚠ BREAKING CHANGES

* CURRENCY_SYMBOL env var removed; formatAmount signature changed; getCurrencyCode() removed from ActualClient interface.

### Features

* drop currency symbol from MCP layer ([#18](https://github.com/KazeFreeze/actual-budget-mcp/issues/18)) ([dac3fdc](https://github.com/KazeFreeze/actual-budget-mcp/commit/dac3fdc46c8036f386ac86c25bd17c5cadb6f5ce))

## 3.0.0 (unreleased)

### ⚠ BREAKING CHANGES

* Currency symbol is no longer emitted by the MCP server. Amounts are returned as plain formatted numbers (e.g. `1,250.00`). The `CURRENCY_SYMBOL` env var, the `currencySymbol` config field, and the `getCurrencyCode()` SDK call have all been removed. Currency labeling is now the client's responsibility — add `Currency is <CODE> — display as <SYMBOL>.` to your `CLAUDE.md`/system prompt. See `docs/MIGRATION-v2-to-v3.md` for details.

## [2.1.0](https://github.com/KazeFreeze/actual-budget-mcp/compare/v2.0.0...v2.1.0) (2026-05-06)


### Features

* auto-detect currency symbol from budget preferences ([#15](https://github.com/KazeFreeze/actual-budget-mcp/issues/15)) ([a606733](https://github.com/KazeFreeze/actual-budget-mcp/commit/a60673370eadf3ef64e6a81d48b1a82d6c52612a))

## 2.0.1 (unreleased)

### Features

- **currency**: auto-detect symbol from budget's defaultCurrencyCode preference; CURRENCY_SYMBOL env var becomes optional override

## [2.0.0](https://github.com/KazeFreeze/actual-budget-mcp/compare/v1.0.8...v2.0.0) (2026-05-05)


### ⚠ BREAKING CHANGES

* Replaces actual-http-api proxy with direct @actual-app/api SDK. Env vars renamed (ACTUAL_HTTP_API_URL -> ACTUAL_SERVER_URL, ACTUAL_HTTP_API_KEY -> ACTUAL_SERVER_PASSWORD, MCP_AUTH_TOKEN -> MCP_API_KEYS). Default MCP_PORT changed 3001 -> 3000. SSE transport deprecated; removal targeted v2.1. See docs/MIGRATION-v1-to-v2.md.

### Features

* v2 direct @actual-app/api SDK ([#13](https://github.com/KazeFreeze/actual-budget-mcp/issues/13)) ([de52acb](https://github.com/KazeFreeze/actual-budget-mcp/commit/de52acbb230a33216eff57046e5aabd82830dd61))

## 2.0.0 (unreleased)

### ⚠ BREAKING CHANGES

- Replaces the `actual-http-api` proxy with direct in-process use of the official `@actual-app/api` SDK. The MCP server now talks to your `actual-server` directly; the `actual-http-api` sidecar is no longer required (or supported).
- Env vars renamed; v1 vars (`ACTUAL_HTTP_API_URL`, `ACTUAL_HTTP_API_KEY`, `MCP_AUTH_TOKEN`) cause startup failure with a pointer to the migration guide. See [`docs/MIGRATION-v1-to-v2.md`](docs/MIGRATION-v1-to-v2.md).
- `MCP_AUTH_TOKEN` (single token) is replaced by `MCP_API_KEYS` (comma-separated rotation list). Each key must be ≥32 chars and contain ≥16 unique characters.
- Default `MCP_PORT` changed from `3001` to `3000`. Update reverse-proxy and client configurations.
- Default Docker volume `/var/lib/actual-mcp` is now required for persistent budget cache between restarts.
- SSE transport is deprecated; planned removal in v2.1. Use Streamable HTTP (`MCP_TRANSPORT=http`) instead.
- Several composite v1 tools were split into single-purpose tools (e.g. `manage-payee` → `create-payee`/`update-payee`/`delete-payee`/`merge-payees`; `manage-schedule` → individual CRUD; `run-query` → `query`). Tool input shape for `create-schedule`/`update-schedule` now uses the SDK's external flat shape (`payee`/`account`/`amount`/`amountOp`/`date`).
- `add-transactions` no longer returns the new transaction id(s) — re-query via `get-transactions` to obtain them. (Underlying `@actual-app/api` handler returns a literal `"ok"` token, not ids.)

### Features

- **notes**: read, write, delete now work end-to-end (v1 was 404 due to a missing endpoint in `actual-http-api`)
- **tags**: full CRUD (`get-tags`, `create-tag`, `update-tag`, `delete-tag`) — new in v2
- **auth**: multi-key Bearer rotation, per-key entropy enforcement, sha256 audit identity prefix
- **transports**: per-session Streamable HTTP transport with `Mcp-Session-Id` keying (replaces v1 singleton that broke under multi-client load)
- **security**: Origin allowlist via `MCP_ALLOWED_ORIGINS`, audit logger module, p-retry on sync, 2s sync coalescing
- **ActualQL**: full server-side aggregates (`$sum`, `$count`, `groupBy`, `$month`/`$year` date transforms) — these previously failed with HTTP 500 through the proxy
- **prompts**: 4 guided prompts (`financial-health-check`, `budget-review`, `spending-deep-dive`, `actualql-reference`) restored to working state by re-porting the analytics tool group they reference

### Quality

- 194 unit + 11 integration + 5 e2e tests, all green
- TypeScript strict + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` enabled throughout
- CI matrix: lint, unit, integration, npm audit, Docker image build
- Docker image is non-root (uid 10001), `dumb-init` PID 1, healthcheck via `node fetch`

## [1.0.8](https://github.com/KazeFreeze/actual-budget-mcp/compare/v1.0.7...v1.0.8) (2026-05-03)


### Bug Fixes

* emit SSE comment heartbeat every 25s ([#11](https://github.com/KazeFreeze/actual-budget-mcp/issues/11)) ([9bd9cc8](https://github.com/KazeFreeze/actual-budget-mcp/commit/9bd9cc8a6f89b751b4bdbe22d488533405d8589d))

## [1.0.7](https://github.com/KazeFreeze/actual-budget-mcp/compare/v1.0.6...v1.0.7) (2026-05-03)


### Bug Fixes

* create fresh MCP Server per SSE connection ([#9](https://github.com/KazeFreeze/actual-budget-mcp/issues/9)) ([b41976a](https://github.com/KazeFreeze/actual-budget-mcp/commit/b41976a512239168b5c8fc36f414ed3ea7ad730f))

## [1.0.6](https://github.com/KazeFreeze/actual-budget-mcp/compare/v1.0.5...v1.0.6) (2026-04-17)


### Bug Fixes

* skip express.json() for SSE /messages route ([0c4e4e2](https://github.com/KazeFreeze/actual-budget-mcp/commit/0c4e4e2ebc9145fc3c914dc89908a96242114899))

## [1.0.5](https://github.com/KazeFreeze/actual-budget-mcp/compare/v1.0.4...v1.0.5) (2026-04-17)


### Bug Fixes

* skip auth for OAuth discovery flow paths (/register, /authorize, /token) ([d02f49d](https://github.com/KazeFreeze/actual-budget-mcp/commit/d02f49d1a751a67fb41fc2829e3664c66824d2f7))

## [1.0.4](https://github.com/KazeFreeze/actual-budget-mcp/compare/v1.0.3...v1.0.4) (2026-04-17)


### Bug Fixes

* skip auth for .well-known paths to allow MCP OAuth discovery fallback ([a3be1c6](https://github.com/KazeFreeze/actual-budget-mcp/commit/a3be1c69d73a9a1f99a90f63145c83d8ad5853f0))

## [1.0.3](https://github.com/KazeFreeze/actual-budget-mcp/compare/v1.0.2...v1.0.3) (2026-04-17)


### Bug Fixes

* use /v1/budgets for health check instead of non-existent version endpoint ([6881b47](https://github.com/KazeFreeze/actual-budget-mcp/commit/6881b47263cc308840abd68d5b14b0769d2e386c))

## [1.0.2](https://github.com/KazeFreeze/actual-budget-mcp/compare/v1.0.1...v1.0.2) (2026-04-16)


### Bug Fixes

* copy tsconfig.build.json in Docker build stage ([c76183d](https://github.com/KazeFreeze/actual-budget-mcp/commit/c76183d1b11fd280df3cd1a1493e03f4dd78c007))

## [1.0.1](https://github.com/KazeFreeze/actual-budget-mcp/compare/v1.0.0...v1.0.1) (2026-04-16)


### Bug Fixes

* prevent husky prepare script failure in Docker builds ([632b581](https://github.com/KazeFreeze/actual-budget-mcp/commit/632b581c136a327397f9d9b9df79331f573c04c7))

## 1.0.0 (2026-04-16)


### Features

* add 19 CRUD tools (TDD) ([c59829c](https://github.com/KazeFreeze/actual-budget-mcp/commit/c59829cdf57e9c9bbd0dd5b04736ac713529cc91))
* add 6 analytical report tools (TDD) ([b4c9fae](https://github.com/KazeFreeze/actual-budget-mcp/commit/b4c9faeb9b957deffe1715f6c58f739892c4c896))
* add bearer token auth with constant-time comparison (TDD) ([77c1531](https://github.com/KazeFreeze/actual-budget-mcp/commit/77c1531c7f75a9446ed6403d724eb658349c7835))
* add config module with Zod validation (TDD) ([34b602d](https://github.com/KazeFreeze/actual-budget-mcp/commit/34b602ddcde64181865b2c12e4e83d67004f7b21))
* add Dockerfile and docker-compose for sidecar deployment ([d875a6b](https://github.com/KazeFreeze/actual-budget-mcp/commit/d875a6b565b1c7a808eca062644ad958ab96582e))
* add entry point with stdio/SSE/HTTP transports, health check, graceful shutdown ([ea0dd24](https://github.com/KazeFreeze/actual-budget-mcp/commit/ea0dd24199783cce41564d7dcc65a9596500c3dc))
* add formatting utilities for currency, tables, splits (TDD) ([952a5f1](https://github.com/KazeFreeze/actual-budget-mcp/commit/952a5f1cdb0baa97d92b1b183f4695557e73b406))
* add helmet security headers and express-rate-limit ([e1d137f](https://github.com/KazeFreeze/actual-budget-mcp/commit/e1d137f0113a69d6e2ca93ddd34bd4007b7d7d41))
* add MCP resources for accounts, categories, payees, settings (TDD) ([a949be8](https://github.com/KazeFreeze/actual-budget-mcp/commit/a949be84baf8e02238e852b32ed9064ef5c7d2e4))
* add p-retry exponential backoff to HTTP client ([42dbdb8](https://github.com/KazeFreeze/actual-budget-mcp/commit/42dbdb89f89e89ca221d8d20553fb920f8e20d4b))
* add prompts and MCP server wiring (TDD) ([bf0ee15](https://github.com/KazeFreeze/actual-budget-mcp/commit/bf0ee15edd5ced22763bec47a482637938384120))
* add run-query tool with ActualQL reference (TDD) ([9d85d2f](https://github.com/KazeFreeze/actual-budget-mcp/commit/9d85d2f91356dce690a207eadbf54d6fd8655a77))
* add typed HTTP client with timeouts, caching, result types (TDD) ([12884bd](https://github.com/KazeFreeze/actual-budget-mcp/commit/12884bd04710f976152f4e350780075e3ade8aca))
* scaffold actual-budget-mcp project ([fa5be65](https://github.com/KazeFreeze/actual-budget-mcp/commit/fa5be659f7e43eaa74b08340d8d95f7ac4bd57b0))


### Bug Fixes

* add commitlint.config.js to ESLint ignores ([83fdc55](https://github.com/KazeFreeze/actual-budget-mcp/commit/83fdc554d3f7e6a2dbb650069dd6e1cbb770e35a))
* correct GHCR image owner in production compose ([1a712a4](https://github.com/KazeFreeze/actual-budget-mcp/commit/1a712a463fc8ffa68d9210a5e917ac4bd1023715))
* prevent split transaction double-counting in analytics tools, bind Docker port to localhost ([559739f](https://github.com/KazeFreeze/actual-budget-mcp/commit/559739f084800b0af46d30f67aaf8b6af32ba2fc))
* resolve all 205 ESLint strict violations across codebase ([1bd52b4](https://github.com/KazeFreeze/actual-budget-mcp/commit/1bd52b43a38fa5e883df17687d58024e1aa7d081))
