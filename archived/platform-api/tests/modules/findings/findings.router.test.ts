import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

import { signTokenPair } from '../../../src/lib/jwt.js';
import { errorHandler } from '../../../src/middleware/errors.js';

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

vi.mock('../../../src/lib/prisma.js', () => ({
  prisma: {
    finding: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
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

const mockEsSearch = vi.fn();
vi.mock('../../../src/lib/elasticsearch.js', () => ({
  getEsClient: () => ({ search: mockEsSearch }),
  FINDINGS_INDEX: 'findings',
  upsertFinding: vi.fn(),
}));

import { prisma } from '../../../src/lib/prisma.js';
import { findingsRouter } from '../../../src/modules/findings/findings.router.js';
import { requestIdMiddleware } from '../../../src/middleware/request-id.js';

const mockPrisma = vi.mocked(prisma);

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(requestIdMiddleware);
  app.use('/api/v1/findings', findingsRouter);
  app.use(errorHandler);
  return app;
}

function authHeader(role = 'admin') {
  const { accessToken } = signTokenPair({ sub: 'user-1', org: 'org-1', role });
  return `Bearer ${accessToken}`;
}

describe('Findings Router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/v1/findings', () => {
    it('returns 401 without auth', async () => {
      const res = await request(createApp()).get('/api/v1/findings');
      expect(res.status).toBe(401);
    });

    it('returns paginated findings with envelope format', async () => {
      mockPrisma.finding.findMany.mockResolvedValue([]);
      mockPrisma.finding.count.mockResolvedValue(0);

      const res = await request(createApp())
        .get('/api/v1/findings')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.meta).toEqual({ page: 1, per_page: 50, total: 0 });
      expect(res.body.errors).toEqual([]);
    });

    it('passes filter params to service', async () => {
      mockPrisma.finding.findMany.mockResolvedValue([]);
      mockPrisma.finding.count.mockResolvedValue(0);

      const res = await request(createApp())
        .get('/api/v1/findings?severity=critical&status=open&page=2&per_page=10')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body.meta.page).toBe(2);
      expect(res.body.meta.per_page).toBe(10);
    });

    it('rejects invalid per_page', async () => {
      const res = await request(createApp())
        .get('/api/v1/findings?per_page=999')
        .set('Authorization', authHeader());

      expect(res.status).toBe(422);
    });

    it('denies viewer from updating findings', async () => {
      const res = await request(createApp())
        .patch('/api/v1/findings/550e8400-e29b-41d4-a716-446655440000')
        .set('Authorization', authHeader('viewer'))
        .send({ status: 'resolved' });

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/v1/findings/:id', () => {
    it('returns a single finding', async () => {
      mockPrisma.finding.findFirst.mockResolvedValue({
        id: '550e8400-e29b-41d4-a716-446655440000',
        title: 'Test finding',
        orgId: 'org-1',
      } as any);

      const res = await request(createApp())
        .get('/api/v1/findings/550e8400-e29b-41d4-a716-446655440000')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body.data.title).toBe('Test finding');
    });

    it('returns 404 for non-existent finding', async () => {
      mockPrisma.finding.findFirst.mockResolvedValue(null);

      const res = await request(createApp())
        .get('/api/v1/findings/550e8400-e29b-41d4-a716-446655440000')
        .set('Authorization', authHeader());

      expect(res.status).toBe(404);
    });

    it('rejects non-UUID id', async () => {
      const res = await request(createApp())
        .get('/api/v1/findings/not-a-uuid')
        .set('Authorization', authHeader());

      expect(res.status).toBe(422);
    });
  });

  describe('PATCH /api/v1/findings/:id', () => {
    it('updates finding status', async () => {
      mockPrisma.finding.findFirst.mockResolvedValue({ id: 'f-1', orgId: 'org-1', status: 'open' } as any);
      mockPrisma.finding.update.mockResolvedValue({ id: 'f-1', status: 'resolved' } as any);

      const res = await request(createApp())
        .patch('/api/v1/findings/550e8400-e29b-41d4-a716-446655440000')
        .set('Authorization', authHeader())
        .send({ status: 'resolved' });

      expect(res.status).toBe(200);
    });

    it('rejects invalid status', async () => {
      const res = await request(createApp())
        .patch('/api/v1/findings/550e8400-e29b-41d4-a716-446655440000')
        .set('Authorization', authHeader())
        .send({ status: 'invalid' });

      expect(res.status).toBe(422);
    });
  });

  describe('GET /api/v1/findings/stats', () => {
    it('returns aggregated stats', async () => {
      mockEsSearch.mockResolvedValue({
        body: {
          hits: { total: { value: 10 } },
          aggregations: {
            by_severity: { buckets: [{ key: 'high', doc_count: 5 }] },
            by_status: { buckets: [{ key: 'open', doc_count: 8 }] },
            by_source: { buckets: [{ key: 'code_scanner', doc_count: 10 }] },
          },
        },
      });

      const res = await request(createApp())
        .get('/api/v1/findings/stats')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(10);
      expect(res.body.data.by_severity).toEqual({ high: 5 });
    });
  });

  describe('GET /api/v1/findings/trends', () => {
    it('returns time-series trends', async () => {
      mockEsSearch.mockResolvedValue({
        body: {
          hits: { total: { value: 5 } },
          aggregations: {
            new_findings: {
              buckets: [{ key_as_string: '2024-01-01', doc_count: 3 }],
            },
            resolved_findings: {
              over_time: {
                buckets: [{ key_as_string: '2024-01-01', doc_count: 1 }],
              },
            },
          },
        },
      });

      const res = await request(createApp())
        .get('/api/v1/findings/trends?interval=day&days=30')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body.data.new_findings).toHaveLength(1);
      expect(res.body.data.resolved_findings).toHaveLength(1);
    });
  });
});
