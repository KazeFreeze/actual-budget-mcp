import { describe, it, expect } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { createAuthMiddleware, originAllowlist } from '../src/auth.js';

const KEY_A = 'a'.repeat(20) + 'BCDEFGHIJKLMNOP';
const KEY_B = 'b'.repeat(20) + 'CDEFGHIJKLMNOPQ';

function appWith(keys: string[]): Express {
  const app = express();
  app.use(createAuthMiddleware(keys));
  app.get('/x', (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe('createAuthMiddleware', () => {
  it('401 with WWW-Authenticate Bearer when header missing', async () => {
    const r = await request(appWith([KEY_A])).get('/x');
    expect(r.status).toBe(401);
    expect(r.headers['www-authenticate']).toBe('Bearer realm="actual-mcp"');
  });

  it('401 when scheme is not Bearer', async () => {
    const r = await request(appWith([KEY_A]))
      .get('/x')
      .set('Authorization', `Basic ${KEY_A}`);
    expect(r.status).toBe(401);
  });

  it('403 when token does not match any key', async () => {
    const r = await request(appWith([KEY_A]))
      .get('/x')
      .set('Authorization', 'Bearer wrong');
    expect(r.status).toBe(403);
  });

  it('200 when token matches first key', async () => {
    const r = await request(appWith([KEY_A, KEY_B]))
      .get('/x')
      .set('Authorization', `Bearer ${KEY_A}`);
    expect(r.status).toBe(200);
  });

  it('200 when token matches second key (rotation)', async () => {
    const r = await request(appWith([KEY_A, KEY_B]))
      .get('/x')
      .set('Authorization', `Bearer ${KEY_B}`);
    expect(r.status).toBe(200);
  });

  it('attaches callerKey (sha256 prefix) to req for audit logging', async () => {
    const app = express();
    app.use(createAuthMiddleware([KEY_A]));
    app.get('/x', (req, res) => {
      res.json({ k: (req as unknown as { callerKey: string }).callerKey });
    });
    const r = await request(app).get('/x').set('Authorization', `Bearer ${KEY_A}`);
    const body = r.body as { k: string };
    expect(body.k).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe('originAllowlist', () => {
  function appWithOrigins(origins: string[]): Express {
    const app = express();
    app.use(originAllowlist(origins));
    app.get('/x', (_req, res) => {
      res.json({ ok: true });
    });
    return app;
  }

  it('allows request with no Origin header', async () => {
    const r = await request(appWithOrigins(['https://claude.ai'])).get('/x');
    expect(r.status).toBe(200);
  });

  it('allows matching Origin', async () => {
    const r = await request(appWithOrigins(['https://claude.ai']))
      .get('/x')
      .set('Origin', 'https://claude.ai');
    expect(r.status).toBe(200);
  });

  it('403 on non-matching Origin', async () => {
    const r = await request(appWithOrigins(['https://claude.ai']))
      .get('/x')
      .set('Origin', 'https://evil.com');
    expect(r.status).toBe(403);
  });

  it('allows all Origins when allowlist is empty', async () => {
    const r = await request(appWithOrigins([])).get('/x').set('Origin', 'https://anything');
    expect(r.status).toBe(200);
  });
});
