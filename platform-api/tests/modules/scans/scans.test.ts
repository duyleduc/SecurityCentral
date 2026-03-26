import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

import { signTokenPair } from '../../../src/lib/jwt.js';
import { errorHandler } from '../../../src/middleware/errors.js';

vi.mock('../../../src/lib/prisma.js', () => ({
  prisma: {
    scan: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
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
    name,
    add: vi.fn().mockResolvedValue({}),
    addBulk: vi.fn().mockResolvedValue([]),
  })),
}));

import { prisma } from '../../../src/lib/prisma.js';
import { scansRouter } from '../../../src/modules/scans/scans.router.js';
import { requestIdMiddleware } from '../../../src/middleware/request-id.js';

const mockPrisma = vi.mocked(prisma);
const UUID = '550e8400-e29b-41d4-a716-446655440000';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(requestIdMiddleware);
  app.use('/api/v1/scans', scansRouter);
  app.use(errorHandler);
  return app;
}

function auth(role = 'admin') {
  return `Bearer ${signTokenPair({ sub: 'u1', org: 'org-1', role }).accessToken}`;
}

const makeScan = (overrides = {}) => ({
  id: UUID,
  orgId: 'org-1',
  scanType: 'code_dependencies',
  status: 'running',
  trigger: 'manual',
  repositoryId: 'repo-1',
  serverId: null,
  findingsTotal: 10,
  findingsNew: 3,
  findingsResolved: 2,
  errorMessage: null,
  startedAt: new Date(),
  completedAt: null,
  durationMs: null,
  metadata: {},
  createdAt: new Date(),
  repository: { name: 'my-app', owner: 'acme' },
  server: null,
  ...overrides,
});

describe('Scans Router', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('GET /api/v1/scans', () => {
    it('returns paginated list', async () => {
      mockPrisma.scan.findMany.mockResolvedValue([makeScan()] as any);
      mockPrisma.scan.count.mockResolvedValue(1);

      const res = await request(createApp())
        .get('/api/v1/scans')
        .set('Authorization', auth());

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta.total).toBe(1);
    });

    it('applies status filter', async () => {
      mockPrisma.scan.findMany.mockResolvedValue([]);
      mockPrisma.scan.count.mockResolvedValue(0);

      await request(createApp())
        .get('/api/v1/scans?status=running')
        .set('Authorization', auth());

      expect(mockPrisma.scan.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'running' }),
        }),
      );
    });

    it('applies scan_type filter', async () => {
      mockPrisma.scan.findMany.mockResolvedValue([]);
      mockPrisma.scan.count.mockResolvedValue(0);

      await request(createApp())
        .get('/api/v1/scans?scan_type=code_dependencies')
        .set('Authorization', auth());

      expect(mockPrisma.scan.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ scanType: 'code_dependencies' }),
        }),
      );
    });
  });

  describe('GET /api/v1/scans/:id', () => {
    it('returns scan detail', async () => {
      mockPrisma.scan.findFirst.mockResolvedValue(makeScan() as any);

      const res = await request(createApp())
        .get(`/api/v1/scans/${UUID}`)
        .set('Authorization', auth());

      expect(res.status).toBe(200);
      expect(res.body.data.findingsTotal).toBe(10);
    });

    it('returns 404 for missing scan', async () => {
      mockPrisma.scan.findFirst.mockResolvedValue(null);

      const res = await request(createApp())
        .get(`/api/v1/scans/${UUID}`)
        .set('Authorization', auth());

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/v1/scans/:id/cancel', () => {
    it('cancels a running scan', async () => {
      mockPrisma.scan.findFirst.mockResolvedValue(makeScan({ status: 'running' }) as any);
      mockPrisma.scan.update.mockResolvedValue(makeScan({ status: 'cancelled' }) as any);

      const res = await request(createApp())
        .post(`/api/v1/scans/${UUID}/cancel`)
        .set('Authorization', auth());

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('cancelled');
    });

    it('cancels a pending scan', async () => {
      mockPrisma.scan.findFirst.mockResolvedValue(makeScan({ status: 'pending' }) as any);
      mockPrisma.scan.update.mockResolvedValue(makeScan({ status: 'cancelled' }) as any);

      const res = await request(createApp())
        .post(`/api/v1/scans/${UUID}/cancel`)
        .set('Authorization', auth());

      expect(res.status).toBe(200);
    });

    it('rejects cancelling a completed scan', async () => {
      mockPrisma.scan.findFirst.mockResolvedValue(makeScan({ status: 'completed' }) as any);

      const res = await request(createApp())
        .post(`/api/v1/scans/${UUID}/cancel`)
        .set('Authorization', auth());

      expect(res.status).toBe(422);
      expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
    });

    it('denies viewer from cancelling', async () => {
      const res = await request(createApp())
        .post(`/api/v1/scans/${UUID}/cancel`)
        .set('Authorization', auth('viewer'));

      expect(res.status).toBe(403);
    });
  });
});
