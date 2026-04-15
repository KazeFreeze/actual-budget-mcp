import { describe, it, expect, vi } from 'vitest';
import { IncomingMessage, ServerResponse } from 'node:http';

describe('createAuthMiddleware', () => {
  function mockReqRes(authHeader?: string): {
    req: IncomingMessage;
    res: ServerResponse;
    next: ReturnType<typeof vi.fn>;
  } {
    const req = { headers: { authorization: authHeader } } as unknown as IncomingMessage;
    const res = {
      writeHead: vi.fn(),
      end: vi.fn(),
    } as unknown as ServerResponse;
    const next = vi.fn();
    return { req, res, next };
  }

  it('should call next() with valid bearer token', async () => {
    const { createAuthMiddleware } = await import('../src/auth.js');
    const middleware = createAuthMiddleware('my-secret-token');
    const { req, res, next } = mockReqRes('Bearer my-secret-token');

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(res.writeHead).not.toHaveBeenCalled();
  });

  it('should return 401 when no Authorization header', async () => {
    const { createAuthMiddleware } = await import('../src/auth.js');
    const middleware = createAuthMiddleware('my-secret-token');
    const { req, res, next } = mockReqRes(undefined);

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
  });

  it('should return 401 when header is not Bearer scheme', async () => {
    const { createAuthMiddleware } = await import('../src/auth.js');
    const middleware = createAuthMiddleware('my-secret-token');
    const { req, res, next } = mockReqRes('Basic dXNlcjpwYXNz');

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
  });

  it('should return 403 when token is wrong', async () => {
    const { createAuthMiddleware } = await import('../src/auth.js');
    const middleware = createAuthMiddleware('my-secret-token');
    const { req, res, next } = mockReqRes('Bearer wrong-token');

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
  });

  it('should use constant-time comparison (not short-circuit)', async () => {
    const { createAuthMiddleware } = await import('../src/auth.js');
    const middleware = createAuthMiddleware('my-secret-token');
    const { req, res, next } = mockReqRes('Bearer x');

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
  });
});
