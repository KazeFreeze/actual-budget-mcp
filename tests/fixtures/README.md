# Test fixtures

`budget-cache/` is a committed `@actual-app/api` cache directory used by integration tests.

## Regenerating

Only needed when @actual-app/api ships a schema migration:

    npx tsx tests/fixtures/regenerate.ts

This uses `compose.yml` to bring up `actual-server`, creates a fresh budget with a tiny deterministic dataset, copies the resulting cache here, then tears down.
