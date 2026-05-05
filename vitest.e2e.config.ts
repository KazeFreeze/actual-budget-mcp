import { defineConfig } from 'vitest/config';

// E2E suite: brings up real Docker containers (actual-server + actual-mcp)
// and exercises the Streamable HTTP transport end-to-end. Heavy and slow —
// CI-only, NOT part of `npm test` (which excludes tests/e2e/**).
//
// Hook timeout is large because beforeAll has to: pull the actualbudget/
// actual-server image (cold case), bring up actual-server, bootstrap the
// admin password, create a budget via the SDK, then bring up actual-mcp and
// poll its /health endpoint. 5 minutes covers a cold pull on slow networks.
export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 300_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
