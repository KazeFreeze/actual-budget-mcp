import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('createClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET requests', () => {
    it('should make GET with correct headers and parse { data } response', async () => {
      const mockData = [{ id: '1', name: 'Checking' }];
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ data: mockData }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const { createClient } = await import('../src/client.js');
      const client = createClient({
        baseUrl: 'http://localhost:5007',
        apiKey: 'test-key',
        budgetSyncId: 'test-budget',
      });

      const result = await client.getAccounts();

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data).toEqual(mockData);

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/budgets/test-budget/accounts'),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({ 'x-api-key': 'test-key' }),
        }),
      );
    });

    it('should return error result on non-200 response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }),
      );

      const { createClient } = await import('../src/client.js');
      const client = createClient({
        baseUrl: 'http://localhost:5007',
        apiKey: 'test-key',
        budgetSyncId: 'test-budget',
      });

      const result = await client.getAccounts();

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('404');
    });

    it('should return error on network failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const { createClient } = await import('../src/client.js');
      const client = createClient({
        baseUrl: 'http://localhost:5007',
        apiKey: 'test-key',
        budgetSyncId: 'test-budget',
      });

      const result = await client.getAccounts();

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('ECONNREFUSED');
    });

    it('should return error on timeout', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementationOnce(
        () => new Promise((_, reject) => {
          setTimeout(() => reject(new DOMException('Aborted', 'AbortError')), 50);
        }),
      );

      const { createClient } = await import('../src/client.js');
      const client = createClient({
        baseUrl: 'http://localhost:5007',
        apiKey: 'test-key',
        budgetSyncId: 'test-budget',
        timeoutMs: 100,
      });

      const result = await client.getAccounts();

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('timeout');
    });
  });

  describe('POST requests', () => {
    it('should send JSON body on POST', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { added: ['id-1'], updated: [] } }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const { createClient } = await import('../src/client.js');
      const client = createClient({
        baseUrl: 'http://localhost:5007',
        apiKey: 'test-key',
        budgetSyncId: 'test-budget',
      });

      const result = await client.createTransaction('acct-1', { date: '2026-03-15', amount: -5000 });

      expect(result.ok).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/transactions'),
        expect.objectContaining({
          method: 'POST',
          body: expect.any(String),
        }),
      );
    });
  });

  describe('caching', () => {
    it('should cache GET responses and not refetch within TTL', async () => {
      const mockData = [{ id: '1', name: 'Checking' }];
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ data: mockData }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const { createClient } = await import('../src/client.js');
      const client = createClient({
        baseUrl: 'http://localhost:5007',
        apiKey: 'test-key',
        budgetSyncId: 'test-budget',
      });

      await client.getAccounts();
      await client.getAccounts();

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('should refetch after cache is cleared', async () => {
      const mockData = [{ id: '1', name: 'Checking' }];
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ data: mockData }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const { createClient } = await import('../src/client.js');
      const client = createClient({
        baseUrl: 'http://localhost:5007',
        apiKey: 'test-key',
        budgetSyncId: 'test-budget',
      });

      await client.getAccounts();
      client.clearCache();
      await client.getAccounts();

      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('health check', () => {
    it('should return true when API is reachable', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { version: '26.4.0' } }), { status: 200 }),
      );

      const { createClient } = await import('../src/client.js');
      const client = createClient({
        baseUrl: 'http://localhost:5007',
        apiKey: 'test-key',
        budgetSyncId: 'test-budget',
      });

      const healthy = await client.checkHealth();
      expect(healthy).toBe(true);
    });

    it('should return false when API is unreachable', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const { createClient } = await import('../src/client.js');
      const client = createClient({
        baseUrl: 'http://localhost:5007',
        apiKey: 'test-key',
        budgetSyncId: 'test-budget',
      });

      const healthy = await client.checkHealth();
      expect(healthy).toBe(false);
    });
  });
});
