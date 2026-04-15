import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse, delay } from 'msw';
import { setupServer } from 'msw/node';

const BASE_URL = 'http://localhost:5007';
const BUDGET_BASE = `${BASE_URL}/v1/budgets/test-budget`;

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('createClient', () => {
  describe('GET requests', () => {
    it('should make GET with correct headers and parse { data } response', async () => {
      const mockData = [{ id: '1', name: 'Checking' }];
      server.use(
        http.get(`${BUDGET_BASE}/accounts`, ({ request }) => {
          expect(request.headers.get('x-api-key')).toBe('test-key');
          expect(request.headers.get('Content-Type')).toBe('application/json');
          return HttpResponse.json({ data: mockData });
        }),
      );

      const { createClient } = await import('../src/client.js');
      const client = createClient({
        baseUrl: BASE_URL,
        apiKey: 'test-key',
        budgetSyncId: 'test-budget',
      });

      const result = await client.getAccounts();

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data).toEqual(mockData);
    });

    it('should return error result on non-200 response', async () => {
      server.use(
        http.get(`${BUDGET_BASE}/accounts`, () => {
          return HttpResponse.json({ error: 'Not found' }, { status: 404 });
        }),
      );

      const { createClient } = await import('../src/client.js');
      const client = createClient({
        baseUrl: BASE_URL,
        apiKey: 'test-key',
        budgetSyncId: 'test-budget',
      });

      const result = await client.getAccounts();

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('404');
    });

    it('should return error on network failure', async () => {
      server.use(
        http.get(`${BASE_URL}/*`, () => {
          return HttpResponse.error();
        }),
      );

      const { createClient } = await import('../src/client.js');
      const client = createClient({
        baseUrl: BASE_URL,
        apiKey: 'test-key',
        budgetSyncId: 'test-budget',
        retries: 0,
      });

      const result = await client.getAccounts();

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBeTruthy();
    });

    it('should return error on timeout', async () => {
      server.use(
        http.get(`${BASE_URL}/*`, async () => {
          await delay(500);
          return HttpResponse.json({ data: [] });
        }),
      );

      const { createClient } = await import('../src/client.js');
      const client = createClient({
        baseUrl: BASE_URL,
        apiKey: 'test-key',
        budgetSyncId: 'test-budget',
        timeoutMs: 50,
      });

      const result = await client.getAccounts();

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('timeout');
    });
  });

  describe('POST requests', () => {
    it('should send JSON body on POST', async () => {
      let capturedBody: unknown;
      server.use(
        http.post(`${BUDGET_BASE}/accounts/:accountId/transactions`, async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json(
            { data: { added: ['id-1'], updated: [] } },
            { status: 201 },
          );
        }),
      );

      const { createClient } = await import('../src/client.js');
      const client = createClient({
        baseUrl: BASE_URL,
        apiKey: 'test-key',
        budgetSyncId: 'test-budget',
      });

      const result = await client.createTransaction('acct-1', { date: '2026-03-15', amount: -5000 });

      expect(result.ok).toBe(true);
      expect(capturedBody).toEqual(
        expect.objectContaining({
          transaction: { date: '2026-03-15', amount: -5000 },
        }),
      );
    });
  });

  describe('caching', () => {
    it('should cache GET responses and not refetch within TTL', async () => {
      const mockData = [{ id: '1', name: 'Checking' }];
      let callCount = 0;
      server.use(
        http.get(`${BUDGET_BASE}/accounts`, () => {
          callCount++;
          return HttpResponse.json({ data: mockData });
        }),
      );

      const { createClient } = await import('../src/client.js');
      const client = createClient({
        baseUrl: BASE_URL,
        apiKey: 'test-key',
        budgetSyncId: 'test-budget',
      });

      await client.getAccounts();
      await client.getAccounts();

      expect(callCount).toBe(1);
    });

    it('should refetch after cache is cleared', async () => {
      const mockData = [{ id: '1', name: 'Checking' }];
      let callCount = 0;
      server.use(
        http.get(`${BUDGET_BASE}/accounts`, () => {
          callCount++;
          return HttpResponse.json({ data: mockData });
        }),
      );

      const { createClient } = await import('../src/client.js');
      const client = createClient({
        baseUrl: BASE_URL,
        apiKey: 'test-key',
        budgetSyncId: 'test-budget',
      });

      await client.getAccounts();
      client.clearCache();
      await client.getAccounts();

      expect(callCount).toBe(2);
    });
  });

  describe('health check', () => {
    it('should return true when API is reachable', async () => {
      server.use(
        http.get(`${BASE_URL}/v1/actualhttpapiversion`, () => {
          return HttpResponse.json({ data: { version: '26.4.0' } });
        }),
      );

      const { createClient } = await import('../src/client.js');
      const client = createClient({
        baseUrl: BASE_URL,
        apiKey: 'test-key',
        budgetSyncId: 'test-budget',
      });

      const healthy = await client.checkHealth();
      expect(healthy).toBe(true);
    });

    it('should return false when API is unreachable', async () => {
      server.use(
        http.get(`${BASE_URL}/*`, () => {
          return HttpResponse.error();
        }),
      );

      const { createClient } = await import('../src/client.js');
      const client = createClient({
        baseUrl: BASE_URL,
        apiKey: 'test-key',
        budgetSyncId: 'test-budget',
        retries: 0,
      });

      const healthy = await client.checkHealth();
      expect(healthy).toBe(false);
    });
  });
});
