import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

import { signTokenPair } from '../../../src/lib/jwt.js';
import { errorHandler } from '../../../src/middleware/errors.js';

vi.mock('../../../src/lib/prisma.js', () => ({
  prisma: {
    repository: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn(),
      delete: vi.fn(),
    },
    scan: { findFirst: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    finding: { groupBy: vi.fn().mockResolvedValue([]), deleteMany: vi.fn() },
  },
}));

vi.mock('ioredis', () => ({
  default: vi.fn(() => ({
    ping: vi.fn().mockResolvedValue('PONG'),
    status: 'ready',
    options: { maxRetriesPerRequest: null },
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
  })),
}));

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation((name: string) => ({
    name,
    add: vi.fn().mockResolvedValue({}),
    addBulk: vi.fn().mockResolvedValue([]),
  })),
}));

import { prisma } from '../../../src/lib/prisma.js';
import { repositoriesRouter } from '../../../src/modules/assets/repositories.router.js';
import { requestIdMiddleware } from '../../../src/middleware/request-id.js';

const mockPrisma = vi.mocked(prisma);

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(requestIdMiddleware);
  app.use('/api/v1/repositories', repositoriesRouter);
  app.use(errorHandler);
  return app;
}

function auth(role = 'admin') {
  return `Bearer ${signTokenPair({ sub: 'u1', org: 'org-1', role }).accessToken}`;
}

describe('Repositories Router', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('GET /api/v1/repositories', () => {
    it('returns 401 without auth', async () => {
      const res = await request(createApp()).get('/api/v1/repositories');
      expect(res.status).toBe(401);
    });

    it('returns paginated list', async () => {
      const res = await request(createApp())
        .get('/api/v1/repositories')
        .set('Authorization', auth());

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.meta).toEqual({ page: 1, per_page: 50, total: 0 });
    });
  });

  describe('POST /api/v1/repositories', () => {
    it('creates a repository', async () => {
      mockPrisma.repository.create.mockResolvedValue({
        id: 'new-id',
        name: 'my-app',
        provider: 'github',
      } as any);

      const res = await request(createApp())
        .post('/api/v1/repositories')
        .set('Authorization', auth())
        .send({
          provider: 'github',
          providerId: '123',
          owner: 'acme',
          name: 'my-app',
          defaultBranch: 'main',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe('my-app');
    });

    it('rejects invalid provider', async () => {
      const res = await request(createApp())
        .post('/api/v1/repositories')
        .set('Authorization', auth())
        .send({ provider: 'invalid', providerId: '1', owner: 'a', name: 'b' });

      expect(res.status).toBe(422);
    });

    it('denies member from creating repo (requires admin)', async () => {
      const res = await request(createApp())
        .post('/api/v1/repositories')
        .set('Authorization', auth('member'))
        .send({ provider: 'github', providerId: '1', owner: 'a', name: 'b' });

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/v1/repositories/:id', () => {
    it('returns repo detail with scan and finding counts', async () => {
      mockPrisma.repository.findFirst.mockResolvedValue({ id: 'r1', name: 'app', orgId: 'org-1' } as any);
      (mockPrisma.scan.findFirst as any).mockResolvedValue(null);
      mockPrisma.finding.groupBy.mockResolvedValue([]);

      const res = await request(createApp())
        .get('/api/v1/repositories/550e8400-e29b-41d4-a716-446655440000')
        .set('Authorization', auth());

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('app');
    });

    it('returns 404 for missing repo', async () => {
      mockPrisma.repository.findFirst.mockResolvedValue(null);

      const res = await request(createApp())
        .get('/api/v1/repositories/550e8400-e29b-41d4-a716-446655440000')
        .set('Authorization', auth());

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/v1/repositories/:id', () => {
    it('returns 204 on success', async () => {
      mockPrisma.repository.findFirst.mockResolvedValue({ id: 'r1', orgId: 'org-1' } as any);
      mockPrisma.finding.deleteMany.mockResolvedValue({ count: 0 } as any);
      (mockPrisma.scan as any).deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.repository.delete.mockResolvedValue({} as any);

      const res = await request(createApp())
        .delete('/api/v1/repositories/550e8400-e29b-41d4-a716-446655440000')
        .set('Authorization', auth());

      expect(res.status).toBe(204);
    });
  });

  describe('POST /api/v1/repositories/:id/scan', () => {
    it('triggers a scan and returns 201', async () => {
      mockPrisma.repository.findFirst.mockResolvedValue({ id: 'r1', orgId: 'org-1' } as any);
      (mockPrisma.scan.findFirst as any).mockResolvedValue(null);
      (mockPrisma.scan.create as any).mockResolvedValue({
        id: 'scan-1',
        status: 'pending',
        scanType: 'code_dependencies',
      });

      const res = await request(createApp())
        .post('/api/v1/repositories/550e8400-e29b-41d4-a716-446655440000/scan')
        .set('Authorization', auth());

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('pending');
    });

    it('returns 409 when scan already running', async () => {
      mockPrisma.repository.findFirst.mockResolvedValue({ id: 'r1', orgId: 'org-1' } as any);
      (mockPrisma.scan.findFirst as any).mockResolvedValue({ id: 'active', status: 'running' });

      const res = await request(createApp())
        .post('/api/v1/repositories/550e8400-e29b-41d4-a716-446655440000/scan')
        .set('Authorization', auth());

      expect(res.status).toBe(409);
      expect(res.body.errors[0].code).toBe('SCAN_ALREADY_RUNNING');
    });

    it('denies viewer from triggering scan', async () => {
      const res = await request(createApp())
        .post('/api/v1/repositories/550e8400-e29b-41d4-a716-446655440000/scan')
        .set('Authorization', auth('viewer'));

      expect(res.status).toBe(403);
    });
  });
});
