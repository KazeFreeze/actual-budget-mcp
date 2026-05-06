# Migrating actual-budget-mcp v1 → v2

v2 talks to the Actual sync-server **directly** via the official `@actual-app/api` SDK instead of through `actual-http-api`. This unlocks notes (read/write/delete) and adds tags CRUD.

## Architecture

```
v1: Claude  ->  actual-budget-mcp  ->  actual-http-api  ->  actual-server
v2: Claude  ->  actual-budget-mcp  ->  actual-server
```

One fewer container to run. The MCP server now opens the budget file in-process and keeps its local cache under `/var/lib/actual-mcp` (declared as a Docker `VOLUME` in the image).

## Env vars: hard cut

| v1 (removed)            | v2 (replacement)                     | Notes                                                                                                            |
| ----------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `ACTUAL_HTTP_API_URL`   | `ACTUAL_SERVER_URL`                  | Point at the actual-server itself, not the proxy.                                                                |
| `ACTUAL_HTTP_API_KEY`   | `ACTUAL_SERVER_PASSWORD`             | The actual-server login password.                                                                                |
| `MCP_AUTH_TOKEN`        | `MCP_API_KEYS`                       | Comma-separated list now. **Each token must be ≥32 chars and contain ≥16 unique chars.**                         |
| _(none)_                | `MCP_ALLOWED_ORIGINS`                | Comma-separated allowed `Origin` headers. Recommended in production for browser-based clients.                   |
| _(none)_                | `ACTUAL_BUDGET_ENCRYPTION_PASSWORD`  | Required only if your budget is E2EE-encrypted.                                                                  |
| `CURRENCY_SYMBOL`       | `CURRENCY_SYMBOL` (optional override) | Now auto-detected from the budget's `defaultCurrencyCode` preference (since v2.0.1). Set only to force a symbol. |

`ACTUAL_BUDGET_SYNC_ID` is unchanged.

If v2 detects any of `ACTUAL_HTTP_API_URL`, `ACTUAL_HTTP_API_KEY`, or `MCP_AUTH_TOKEN` at startup, it logs a clear error pointing here and exits.

Default `MCP_PORT` changed from `3001` (v1) to `3000` (v2).

## Compose-file diff

### Before (v1)

```yaml
services:
  actual-budget:
    image: actualbudget/actual-server:latest
    ports:
      - "5006:5006"
    volumes:
      - actual-data:/data
    restart: unless-stopped
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
    restart: unless-stopped
    networks:
      - actual-network

  actual-mcp:
    image: ghcr.io/kazefreeze/actual-budget-mcp:latest
    ports:
      - "127.0.0.1:3001:3001"
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
    restart: unless-stopped
    networks:
      - actual-network

volumes:
  actual-data:

networks:
  actual-network:
    driver: bridge
```

### After (v2)

```yaml
services:
  actual-budget:
    image: actualbudget/actual-server:latest
    ports:
      - "5006:5006"
    volumes:
      - actual-data:/data
    restart: unless-stopped
    networks:
      - actual-network

  actual-mcp:
    image: ghcr.io/kazefreeze/actual-budget-mcp:latest
    ports:
      - "127.0.0.1:3000:3000"
    environment:
      - ACTUAL_SERVER_URL=http://actual-budget:5006
      - ACTUAL_SERVER_PASSWORD=${ACTUAL_SERVER_PASSWORD}
      - ACTUAL_BUDGET_SYNC_ID=${ACTUAL_BUDGET_SYNC_ID}
      - ACTUAL_BUDGET_ENCRYPTION_PASSWORD=${ACTUAL_BUDGET_ENCRYPTION_PASSWORD:-}
      - MCP_API_KEYS=${MCP_API_KEYS}
      - MCP_ALLOWED_ORIGINS=${MCP_ALLOWED_ORIGINS:-}
      - MCP_TRANSPORT=http
      - MCP_PORT=3000
      - LOG_LEVEL=info
    depends_on:
      - actual-budget
    volumes:
      - actual-mcp-cache:/var/lib/actual-mcp
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
    restart: unless-stopped
    networks:
      - actual-network

volumes:
  actual-data:
  actual-mcp-cache:

networks:
  actual-network:
    driver: bridge
```

Highlights of the change:

- `actual-http-api` service deleted entirely.
- `actual-mcp` now points at `actual-budget:5006` directly via `ACTUAL_SERVER_URL`.
- `API_KEY` (the v1 shared secret between MCP and the proxy) is gone; auth between Claude and the MCP server is `MCP_API_KEYS`, and auth between the MCP server and actual-server is `ACTUAL_SERVER_PASSWORD`.
- `MCP_TRANSPORT` defaulted to `sse` in v1 examples; v2 defaults to `http` because SSE is deprecated and slated for removal in v2.1.
- New named volume `actual-mcp-cache` mounted at `/var/lib/actual-mcp` to persist the SDK's local budget cache across restarts (matches the `VOLUME` declaration in the v2 Dockerfile).
- Healthcheck uses `node -e "fetch(...)"` instead of `curl` because the runtime image doesn't ship curl.

## Step-by-step

1. `docker compose down`
2. Replace `docker/docker-compose.production.yml` with the v2 version above (or pull the new file from this repo).
3. Update your `.env`:
   - Remove `ACTUAL_HTTP_API_URL`, `ACTUAL_HTTP_API_KEY`, `API_KEY`, `MCP_AUTH_TOKEN`.
   - Add `ACTUAL_SERVER_PASSWORD` (the actual-server login password) and `MCP_API_KEYS` (≥32 chars, ≥16 unique chars per token; comma-separated for multiple).
   - Optionally add `MCP_ALLOWED_ORIGINS` and `ACTUAL_BUDGET_ENCRYPTION_PASSWORD`.
4. Update any reverse-proxy / Claude config that referenced port `3001` to use `3000`.
5. `docker compose -f docker/docker-compose.production.yml pull && docker compose -f docker/docker-compose.production.yml up -d`
6. `docker compose logs -f actual-mcp` and watch for the "ready" line. The first run will sync the budget into `/var/lib/actual-mcp`, which can take a few seconds for large files.

## Rollback

Re-pin `image: ghcr.io/kazefreeze/actual-budget-mcp:v1.0.7`, restore the v1 env vars, restart `actual-http-api`, `docker compose up -d`. The v2 cache volume can stay — v1 doesn't touch it.
