import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

import { signTokenPair } from '../../../src/lib/jwt.js';
import { errorHandler } from '../../../src/middleware/errors.js';

// Mock Redis with get/set/del for caching
const mockRedisGet = vi.fn().mockResolvedValue(null);
const mockRedisSet = vi.fn().mockResolvedValue('OK');
const mockRedisDel = vi.fn().mockResolvedValue(1);

vi.mock('ioredis', () => ({
  default: vi.fn(() => ({
    ping: vi.fn().mockResolvedValue('PONG'),
    status: 'ready',
    options: { maxRetriesPerRequest: null },
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    get: mockRedisGet,
    set: mockRedisSet,
    del: mockRedisDel,
  })),
}));

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation((name: string) => ({
    name,
    add: vi.fn().mockResolvedValue({}),
    addBulk: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('../../../src/lib/prisma.js', () => ({
  prisma: {
    repository: { count: vi.fn().mockResolvedValue(5) },
    server: { count: vi.fn().mockResolvedValue(10) },
    certificate: { count: vi.fn().mockResolvedValue(3) },
    finding: {
      findMany: vi.fn().mockResolvedValue([]),
      groupBy: vi.fn().mockResolvedValue([]),
    },
  },
}));

const mockEsSearch = vi.fn();
vi.mock('../../../src/lib/elasticsearch.js', () => ({
  getEsClient: () => ({ search: mockEsSearch }),
  FINDINGS_INDEX: 'findings',
}));

import { prisma } from '../../../src/lib/prisma.js';
import { dashboardRouter } from '../../../src/modules/dashboard/dashboard.router.js';
import { invalidateCache } from '../../../src/modules/dashboard/dashboard.service.js';
import { requestIdMiddleware } from '../../../src/middleware/request-id.js';

const mockPrisma = vi.mocked(prisma);

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(requestIdMiddleware);
  app.use('/api/v1/dashboard', dashboardRouter);
  app.use(errorHandler);
  return app;
}

function auth(role = 'admin') {
  return `Bearer ${signTokenPair({ sub: 'u1', org: 'org-1', role }).accessToken}`;
}

describe('Dashboard Router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisGet.mockResolvedValue(null); // default: cache miss
  });

  describe('GET /api/v1/dashboard/summary', () => {
    it('returns org-wide summary', async () => {
      mockEsSearch.mockResolvedValue({
        body: {
          hits: { total: { value: 42 } },
          aggregations: {
            by_severity: { buckets: [{ key: 'high', doc_count: 20 }, { key: 'critical', doc_count: 10 }] },
            by_status: { buckets: [{ key: 'open', doc_count: 30 }, { key: 'resolved', doc_count: 12 }] },
          },
        },
      });

      const res = await request(createApp())
        .get('/api/v1/dashboard/summary')
        .set('Authorization', auth());

      expect(res.status).toBe(200);
      expect(res.body.data.findings.total).toBe(42);
      expect(res.body.data.findings.open).toBe(30);
      expect(res.body.data.findings.resolved).toBe(12);
      expect(res.body.data.assets.repositories).toBe(5);
      expect(res.body.data.assets.servers).toBe(10);
    });

    it('writes to Redis cache on miss', async () => {
      mockEsSearch.mockResolvedValue({
        body: {
          hits: { total: { value: 0 } },
          aggregations: {
            by_severity: { buckets: [] },
            by_status: { buckets: [] },
          },
        },
      });

      await request(createApp())
        .get('/api/v1/dashboard/summary')
        .set('Authorization', auth());

      expect(mockRedisSet).toHaveBeenCalledWith(
        'dashboard:summary:org-1',
        expect.any(String),
        'EX',
        30,
      );
    });

    it('returns cached data on cache hit', async () => {
      const cachedSummary = {
        findings: { total: 100, by_severity: {}, open: 50, resolved: 50 },
        assets: { repositories: 1, servers: 2, certificates: 3 },
      };
      mockRedisGet.mockResolvedValue(JSON.stringify(cachedSummary));

      const res = await request(createApp())
        .get('/api/v1/dashboard/summary')
        .set('Authorization', auth());

      expect(res.status).toBe(200);
      expect(res.body.data.findings.total).toBe(100);
      // ES should NOT be called
      expect(mockEsSearch).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/dashboard/top-risks', () => {
    it('returns top 10 findings by CVSS', async () => {
      mockPrisma.finding.findMany.mockResolvedValue([
        { id: 'f1', title: 'Critical vuln', cvssScore: 9.8, severity: 'critical' },
      ] as any);

      const res = await request(createApp())
        .get('/api/v1/dashboard/top-risks')
        .set('Authorization', auth());

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].cvssScore).toBe(9.8);
    });
  });

  describe('GET /api/v1/dashboard/assets-overview', () => {
    it('returns health percentages', async () => {
      mockPrisma.repository.count.mockResolvedValue(10);
      mockPrisma.server.count.mockResolvedValue(20);
      mockPrisma.certificate.count.mockResolvedValue(5);
      // 2 repos, 5 servers, 1 cert have critical/high findings
      mockPrisma.finding.groupBy
        .mockResolvedValueOnce([{ repositoryId: 'r1' }, { repositoryId: 'r2' }] as any) // repos
        .mockResolvedValueOnce([{ serverId: 's1' }, { serverId: 's2' }, { serverId: 's3' }, { serverId: 's4' }, { serverId: 's5' }] as any) // servers
        .mockResolvedValueOnce([{ certificateId: 'c1' }] as any); // certs

      const res = await request(createApp())
        .get('/api/v1/dashboard/assets-overview')
        .set('Authorization', auth());

      expect(res.status).toBe(200);
      expect(res.body.data.repositories).toEqual({ total: 10, affected: 2, health_pct: 80 });
      expect(res.body.data.servers).toEqual({ total: 20, affected: 5, health_pct: 75 });
      expect(res.body.data.certificates).toEqual({ total: 5, affected: 1, health_pct: 80 });
    });
  });

  describe('Cache invalidation', () => {
    it('invalidateCache deletes Redis keys', async () => {
      await invalidateCache('org-1');
      expect(mockRedisDel).toHaveBeenCalledWith('dashboard:summary:org-1', 'dashboard:top-risks:org-1');
    });
  });

  describe('RBAC', () => {
    it('allows viewer to access dashboard', async () => {
      mockEsSearch.mockResolvedValue({
        body: {
          hits: { total: { value: 0 } },
          aggregations: { by_severity: { buckets: [] }, by_status: { buckets: [] } },
        },
      });

      const res = await request(createApp())
        .get('/api/v1/dashboard/summary')
        .set('Authorization', auth('viewer'));

      expect(res.status).toBe(200);
    });
  });
});
