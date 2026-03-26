import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

import { signTokenPair } from '../../../src/lib/jwt.js';
import { errorHandler } from '../../../src/middleware/errors.js';

vi.mock('../../../src/lib/prisma.js', () => ({
  prisma: {
    integration: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    repository: { findFirst: vi.fn() },
    scan: { findFirst: vi.fn(), create: vi.fn() },
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
import { integrationsRouter } from '../../../src/modules/integrations/integrations.router.js';
import { requestIdMiddleware } from '../../../src/middleware/request-id.js';

const mockPrisma = vi.mocked(prisma);
const UUID = '550e8400-e29b-41d4-a716-446655440000';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(requestIdMiddleware);
  app.use('/api/v1/integrations', integrationsRouter);
  app.use(errorHandler);
  return app;
}

function auth(role = 'admin') {
  return `Bearer ${signTokenPair({ sub: 'u1', org: 'org-1', role }).accessToken}`;
}

describe('Integration Management', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('GET /api/v1/integrations', () => {
    it('returns list of integrations for org', async () => {
      mockPrisma.integration.findMany.mockResolvedValue([
        { id: 'i1', provider: 'github', status: 'active', createdAt: new Date(), updatedAt: new Date() },
        { id: 'i2', provider: 'slack', status: 'active', createdAt: new Date(), updatedAt: new Date() },
      ] as any);

      const res = await request(createApp())
        .get('/api/v1/integrations')
        .set('Authorization', auth());

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0].provider).toBe('github');
      expect(res.body.data[1].provider).toBe('slack');
    });

    it('returns empty array when no integrations', async () => {
      mockPrisma.integration.findMany.mockResolvedValue([]);

      const res = await request(createApp())
        .get('/api/v1/integrations')
        .set('Authorization', auth());

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it('denies member access (requires admin)', async () => {
      const res = await request(createApp())
        .get('/api/v1/integrations')
        .set('Authorization', auth('member'));

      expect(res.status).toBe(403);
    });

    it('returns 401 without auth', async () => {
      const res = await request(createApp()).get('/api/v1/integrations');
      expect(res.status).toBe(401);
    });
  });

  describe('DELETE /api/v1/integrations/:id', () => {
    it('deletes integration and returns 204', async () => {
      mockPrisma.integration.findFirst.mockResolvedValue({ id: UUID, orgId: 'org-1' } as any);
      mockPrisma.integration.delete.mockResolvedValue({} as any);

      const res = await request(createApp())
        .delete(`/api/v1/integrations/${UUID}`)
        .set('Authorization', auth());

      expect(res.status).toBe(204);
      expect(mockPrisma.integration.delete).toHaveBeenCalledWith({ where: { id: UUID } });
    });

    it('returns 404 for non-existent integration', async () => {
      mockPrisma.integration.findFirst.mockResolvedValue(null);

      const res = await request(createApp())
        .delete(`/api/v1/integrations/${UUID}`)
        .set('Authorization', auth());

      expect(res.status).toBe(404);
    });

    it('denies member from deleting', async () => {
      const res = await request(createApp())
        .delete(`/api/v1/integrations/${UUID}`)
        .set('Authorization', auth('member'));

      expect(res.status).toBe(403);
    });

    it('rejects non-UUID id', async () => {
      const res = await request(createApp())
        .delete('/api/v1/integrations/not-a-uuid')
        .set('Authorization', auth());

      expect(res.status).toBe(422);
    });
  });
});
