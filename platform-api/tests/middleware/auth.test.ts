import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

import { signTokenPair } from '../../src/lib/jwt.js';
import { errorHandler } from '../../src/middleware/errors.js';

// Mock the API key authentication
vi.mock('../../src/modules/auth/auth.service.js', () => ({
  authenticateApiKey: vi.fn().mockRejectedValue(new Error('Invalid API key')),
}));

import { requireAuth, requireScope } from '../../src/middleware/auth.js';

function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/protected', requireAuth, (req, res) => {
    res.json({ auth: req.auth });
  });

  app.get('/scoped', requireAuth, requireScope('scan:write'), (req, res) => {
    res.json({ auth: req.auth });
  });

  app.use(errorHandler);
  return app;
}

describe('Auth Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when no auth header is provided', async () => {
    const app = createApp();
    const res = await request(app).get('/protected');

    expect(res.status).toBe(401);
    expect(res.body.errors[0].code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('authenticates with valid JWT Bearer token', async () => {
    const app = createApp();
    const { accessToken } = signTokenPair({ sub: 'user-1', org: 'org-1', role: 'admin' });

    const res = await request(app).get('/protected').set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.auth.userId).toBe('user-1');
    expect(res.body.auth.orgId).toBe('org-1');
    expect(res.body.auth.role).toBe('admin');
    expect(res.body.auth.authMethod).toBe('jwt');
  });

  it('returns 401 for invalid JWT', async () => {
    const app = createApp();
    const res = await request(app).get('/protected').set('Authorization', 'Bearer invalid-token');

    expect(res.status).toBe(401);
    expect(res.body.errors[0].code).toBe('AUTH_TOKEN_EXPIRED');
  });

  it('JWT users bypass scope check', async () => {
    const app = createApp();
    const { accessToken } = signTokenPair({ sub: 'user-1', org: 'org-1', role: 'member' });

    const res = await request(app).get('/scoped').set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
  });
});
