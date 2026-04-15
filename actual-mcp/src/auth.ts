import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export function createAuthMiddleware(token: string) {
  const tokenBuffer = Buffer.from(token);

  return (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing Bearer token' }));
      return;
    }

    const provided = Buffer.from(authHeader.slice(7));
    if (provided.length !== tokenBuffer.length || !crypto.timingSafeEqual(provided, tokenBuffer)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid token' }));
      return;
    }

    next();
  };
}
