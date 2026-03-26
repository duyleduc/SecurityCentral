import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';

import { errorHandler } from '../../src/middleware/errors.js';
import { requireRole, requirePermission } from '../../src/middleware/rbac.js';
import type { AuthContext } from '../../src/middleware/auth.js';

function createApp(middleware: express.RequestHandler) {
  const app = express();

  // Fake auth injection
  app.use((req, _res, next) => {
    const role = req.headers['x-test-role'] as string;
    if (role) {
      (req as express.Request & { auth: AuthContext }).auth = {
        userId: 'u1',
        orgId: 'o1',
        role,
        authMethod: 'jwt',
      };
    }
    next();
  });

  app.get('/test', middleware, (_req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  return app;
}

describe('RBAC Middleware', () => {
  describe('requireRole', () => {
    it('allows owner when admin is required', async () => {
      const app = createApp(requireRole('admin'));
      const res = await request(app).get('/test').set('x-test-role', 'owner');
      expect(res.status).toBe(200);
    });

    it('allows admin when admin is required', async () => {
      const app = createApp(requireRole('admin'));
      const res = await request(app).get('/test').set('x-test-role', 'admin');
      expect(res.status).toBe(200);
    });

    it('denies member when admin is required', async () => {
      const app = createApp(requireRole('admin'));
      const res = await request(app).get('/test').set('x-test-role', 'member');
      expect(res.status).toBe(403);
      expect(res.body.errors[0].code).toBe('AUTH_FORBIDDEN');
    });

    it('denies viewer when member is required', async () => {
      const app = createApp(requireRole('member'));
      const res = await request(app).get('/test').set('x-test-role', 'viewer');
      expect(res.status).toBe(403);
    });

    it('allows viewer when viewer is required', async () => {
      const app = createApp(requireRole('viewer'));
      const res = await request(app).get('/test').set('x-test-role', 'viewer');
      expect(res.status).toBe(200);
    });

    it('returns 401 when no auth context', async () => {
      const app = createApp(requireRole('member'));
      const res = await request(app).get('/test'); // no x-test-role header
      expect(res.status).toBe(401);
    });
  });

  describe('requirePermission', () => {
    it('allows admin to manage_org', async () => {
      const app = createApp(requirePermission('manage_org'));
      const res = await request(app).get('/test').set('x-test-role', 'admin');
      expect(res.status).toBe(200);
    });

    it('denies member from manage_org', async () => {
      const app = createApp(requirePermission('manage_org'));
      const res = await request(app).get('/test').set('x-test-role', 'member');
      expect(res.status).toBe(403);
    });

    it('allows viewer to view_findings', async () => {
      const app = createApp(requirePermission('view_findings'));
      const res = await request(app).get('/test').set('x-test-role', 'viewer');
      expect(res.status).toBe(200);
    });

    it('denies viewer from update_findings', async () => {
      const app = createApp(requirePermission('update_findings'));
      const res = await request(app).get('/test').set('x-test-role', 'viewer');
      expect(res.status).toBe(403);
    });

    it('allows member to trigger_scans', async () => {
      const app = createApp(requirePermission('trigger_scans'));
      const res = await request(app).get('/test').set('x-test-role', 'member');
      expect(res.status).toBe(200);
    });
  });
});
