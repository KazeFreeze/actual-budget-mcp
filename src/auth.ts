import crypto from 'node:crypto';
import type { Request, RequestHandler } from 'express';

export function callerKey(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 12);
}

export function createAuthMiddleware(validKeys: string[]): RequestHandler {
  if (validKeys.length === 0) {
    throw new Error('createAuthMiddleware requires at least one key');
  }
  const buffers = validKeys.map((k) => Buffer.from(k));

  return (req, res, next) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      res.set('WWW-Authenticate', 'Bearer realm="actual-mcp"');
      res.status(401).json({ error: 'Missing Bearer token' });
      return;
    }
    const provided = Buffer.from(header.slice(7));
    const matched = buffers.some(
      (buf) => provided.length === buf.length && crypto.timingSafeEqual(provided, buf),
    );
    if (!matched) {
      res.status(403).json({ error: 'Invalid token' });
      return;
    }
    (req as Request & { callerKey: string }).callerKey = callerKey(header.slice(7));
    next();
  };
}

export function originAllowlist(allowed: string[]): RequestHandler {
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (!origin || allowed.length === 0) {
      next();
      return;
    }
    if (!allowed.includes(origin)) {
      res.status(403).json({ error: 'Origin not allowed' });
      return;
    }
    next();
  };
}
