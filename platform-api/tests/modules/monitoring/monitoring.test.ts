import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

import { signTokenPair } from '../../../src/lib/jwt.js';
import { errorHandler } from '../../../src/middleware/errors.js';

vi.mock('../../../src/lib/prisma.js', () => ({
  prisma: {
    monitoredEndpoint: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      delete: vi.fn(),
    },
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
    name, add: vi.fn().mockResolvedValue({}), addBulk: vi.fn().mockResolvedValue([]),
  })),
}));

import { prisma } from '../../../src/lib/prisma.js';
import { monitoringRouter } from '../../../src/modules/monitoring/monitoring.router.js';
import { requestIdMiddleware } from '../../../src/middleware/request-id.js';

const mockPrisma = vi.mocked(prisma);
const UUID = '550e8400-e29b-41d4-a716-446655440000';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(requestIdMiddleware);
  app.use('/api/v1/monitoring', monitoringRouter);
  app.use(errorHandler);
  return app;
}

function auth(role = 'admin') {
  return `Bearer ${signTokenPair({ sub: 'u1', org: 'org-1', role }).accessToken}`;
}

describe('Domain Monitoring', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('POST /api/v1/monitoring/domains', () => {
    it('creates endpoints and enqueues initial checks', async () => {
      mockPrisma.monitoredEndpoint.create.mockResolvedValue({ id: UUID } as any);

      const res = await request(createApp())
        .post('/api/v1/monitoring/domains')
        .set('Authorization', auth())
        .send({
          endpoints: [
            { host: 'example.com', port: 443 },
            { host: 'api.example.com' },
          ],
          checkInterval: '1h',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.created).toBe(2);
      expect(mockPrisma.monitoredEndpoint.create).toHaveBeenCalledTimes(2);
    });

    it('handles duplicate endpoints gracefully', async () => {
      mockPrisma.monitoredEndpoint.create
        .mockResolvedValueOnce({ id: UUID } as any)
        .mockRejectedValueOnce({ code: 'P2002' });

      const res = await request(createApp())
        .post('/api/v1/monitoring/domains')
        .set('Authorization', auth())
        .send({
          endpoints: [
            { host: 'example.com' },
            { host: 'example.com' },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.data.created).toBe(1);
      expect(res.body.data.errors).toHaveLength(1);
      expect(res.body.data.errors[0]).toContain('already monitored');
    });

    it('rejects empty endpoints array', async () => {
      const res = await request(createApp())
        .post('/api/v1/monitoring/domains')
        .set('Authorization', auth())
        .send({ endpoints: [] });

      expect(res.status).toBe(422);
    });

    it('returns 401 without auth', async () => {
      const res = await request(createApp())
        .post('/api/v1/monitoring/domains')
        .send({ endpoints: [{ host: 'example.com' }] });

      expect(res.status).toBe(401);
    });

    it('denies member from adding (requires admin)', async () => {
      const res = await request(createApp())
        .post('/api/v1/monitoring/domains')
        .set('Authorization', auth('member'))
        .send({ endpoints: [{ host: 'example.com' }] });

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/v1/monitoring/domains', () => {
    it('returns paginated endpoints', async () => {
      mockPrisma.monitoredEndpoint.findMany.mockResolvedValue([
        { id: UUID, host: 'example.com', port: 443, status: 'active', lastStatus: 'healthy', lastResponseMs: 120 },
      ] as any);
      mockPrisma.monitoredEndpoint.count.mockResolvedValue(1);

      const res = await request(createApp())
        .get('/api/v1/monitoring/domains')
        .set('Authorization', auth());

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].host).toBe('example.com');
      expect(res.body.meta.total).toBe(1);
    });

    it('allows viewer access', async () => {
      mockPrisma.monitoredEndpoint.findMany.mockResolvedValue([]);
      mockPrisma.monitoredEndpoint.count.mockResolvedValue(0);

      const res = await request(createApp())
        .get('/api/v1/monitoring/domains')
        .set('Authorization', auth('viewer'));

      expect(res.status).toBe(200);
    });
  });

  describe('DELETE /api/v1/monitoring/domains/:id', () => {
    it('deletes endpoint', async () => {
      mockPrisma.monitoredEndpoint.findFirst.mockResolvedValue({ id: UUID, host: 'example.com' } as any);
      mockPrisma.monitoredEndpoint.delete.mockResolvedValue({} as any);

      const res = await request(createApp())
        .delete(`/api/v1/monitoring/domains/${UUID}`)
        .set('Authorization', auth());

      expect(res.status).toBe(204);
    });

    it('returns 404 for missing endpoint', async () => {
      mockPrisma.monitoredEndpoint.findFirst.mockResolvedValue(null);

      const res = await request(createApp())
        .delete(`/api/v1/monitoring/domains/${UUID}`)
        .set('Authorization', auth());

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/v1/monitoring/domains/:id/check', () => {
    it('enqueues immediate check', async () => {
      mockPrisma.monitoredEndpoint.findFirst.mockResolvedValue({ id: UUID, host: 'example.com', port: 443 } as any);

      const res = await request(createApp())
        .post(`/api/v1/monitoring/domains/${UUID}/check`)
        .set('Authorization', auth());

      expect(res.status).toBe(200);
      expect(res.body.data.queued).toBe(true);
    });

    it('denies viewer from triggering check', async () => {
      const res = await request(createApp())
        .post(`/api/v1/monitoring/domains/${UUID}/check`)
        .set('Authorization', auth('viewer'));

      expect(res.status).toBe(403);
    });
  });
});
