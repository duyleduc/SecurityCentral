import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

import { signTokenPair } from '../../../src/lib/jwt.js';
import { errorHandler } from '../../../src/middleware/errors.js';

vi.mock('../../../src/lib/prisma.js', () => ({
  prisma: {
    server: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    finding: {
      findMany: vi.fn().mockResolvedValue([]),
      groupBy: vi.fn().mockResolvedValue([]),
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
import { serversRouter } from '../../../src/modules/assets/servers.router.js';
import { requestIdMiddleware } from '../../../src/middleware/request-id.js';
import * as serversService from '../../../src/modules/assets/servers.service.js';

const mockPrisma = vi.mocked(prisma);

const UUID = '550e8400-e29b-41d4-a716-446655440000';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(requestIdMiddleware);
  app.use('/api/v1/servers', serversRouter);
  app.use(errorHandler);
  return app;
}

function auth(role = 'admin') {
  return `Bearer ${signTokenPair({ sub: 'u1', org: 'org-1', role }).accessToken}`;
}

const makeServer = (overrides = {}) => ({
  id: UUID,
  orgId: 'org-1',
  agentId: 'agent-1',
  hostname: 'web-01',
  osFamily: 'ubuntu',
  osVersion: '22.04',
  arch: 'amd64',
  cloudProvider: 'aws',
  cloudRegion: 'us-east-1',
  cloudInstanceId: 'i-abc123',
  environment: 'production',
  agentVersion: '1.0.0',
  lastHeartbeat: new Date(),
  lastScanAt: null,
  status: 'active',
  metadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('Servers Router', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('GET /api/v1/servers', () => {
    it('returns 401 without auth', async () => {
      const res = await request(createApp()).get('/api/v1/servers');
      expect(res.status).toBe(401);
    });

    it('returns paginated list with finding counts', async () => {
      mockPrisma.server.findMany.mockResolvedValue([makeServer()] as any);
      mockPrisma.server.count.mockResolvedValue(1);
      mockPrisma.finding.groupBy.mockResolvedValue([
        { serverId: UUID, _count: { id: 3 } },
      ] as any);

      const res = await request(createApp())
        .get('/api/v1/servers')
        .set('Authorization', auth());

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].openFindingCount).toBe(3);
      expect(res.body.meta.total).toBe(1);
    });

    it('applies status filter', async () => {
      mockPrisma.server.findMany.mockResolvedValue([]);
      mockPrisma.server.count.mockResolvedValue(0);

      await request(createApp())
        .get('/api/v1/servers?status=active')
        .set('Authorization', auth());

      expect(mockPrisma.server.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'active' }),
        }),
      );
    });

    it('applies environment filter', async () => {
      mockPrisma.server.findMany.mockResolvedValue([]);
      mockPrisma.server.count.mockResolvedValue(0);

      await request(createApp())
        .get('/api/v1/servers?environment=production')
        .set('Authorization', auth());

      expect(mockPrisma.server.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ environment: 'production' }),
        }),
      );
    });

    it('applies os_family filter', async () => {
      mockPrisma.server.findMany.mockResolvedValue([]);
      mockPrisma.server.count.mockResolvedValue(0);

      await request(createApp())
        .get('/api/v1/servers?os_family=ubuntu')
        .set('Authorization', auth());

      expect(mockPrisma.server.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ osFamily: 'ubuntu' }),
        }),
      );
    });
  });

  describe('GET /api/v1/servers/:id', () => {
    it('returns server detail with findings', async () => {
      mockPrisma.server.findFirst.mockResolvedValue(makeServer() as any);
      mockPrisma.finding.findMany.mockResolvedValue([
        { id: 'f1', title: 'CVE-2024-001', severity: 'high' },
      ] as any);
      mockPrisma.finding.groupBy.mockResolvedValue([
        { severity: 'high', _count: { id: 1 } },
      ] as any);

      const res = await request(createApp())
        .get(`/api/v1/servers/${UUID}`)
        .set('Authorization', auth());

      expect(res.status).toBe(200);
      expect(res.body.data.hostname).toBe('web-01');
      expect(res.body.data.recentFindings).toHaveLength(1);
      expect(res.body.data.findingCounts).toEqual({ high: 1 });
    });

    it('returns 404 for missing server', async () => {
      mockPrisma.server.findFirst.mockResolvedValue(null);

      const res = await request(createApp())
        .get(`/api/v1/servers/${UUID}`)
        .set('Authorization', auth());

      expect(res.status).toBe(404);
    });

    it('rejects non-UUID id', async () => {
      const res = await request(createApp())
        .get('/api/v1/servers/not-a-uuid')
        .set('Authorization', auth());

      expect(res.status).toBe(422);
    });
  });

  describe('DELETE /api/v1/servers/:id (decommission)', () => {
    it('soft-deletes by setting status to decommissioned', async () => {
      mockPrisma.server.findFirst.mockResolvedValue(makeServer() as any);
      mockPrisma.server.update.mockResolvedValue(makeServer({ status: 'decommissioned' }) as any);

      const res = await request(createApp())
        .delete(`/api/v1/servers/${UUID}`)
        .set('Authorization', auth());

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('decommissioned');
      expect(mockPrisma.server.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'decommissioned' },
        }),
      );
    });

    it('returns 404 for missing server', async () => {
      mockPrisma.server.findFirst.mockResolvedValue(null);

      const res = await request(createApp())
        .delete(`/api/v1/servers/${UUID}`)
        .set('Authorization', auth());

      expect(res.status).toBe(404);
    });

    it('denies member from decommissioning', async () => {
      const res = await request(createApp())
        .delete(`/api/v1/servers/${UUID}`)
        .set('Authorization', auth('member'));

      expect(res.status).toBe(403);
    });
  });
});

describe('Servers Service (unit)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('listServers returns zero finding count when no findings', async () => {
    mockPrisma.server.findMany.mockResolvedValue([makeServer()] as any);
    mockPrisma.server.count.mockResolvedValue(1);
    mockPrisma.finding.groupBy.mockResolvedValue([]);

    const result = await serversService.listServers('org-1', { page: 1, per_page: 50 });
    expect(result.data[0].openFindingCount).toBe(0);
  });

  it('decommissionServer throws for wrong org', async () => {
    mockPrisma.server.findFirst.mockResolvedValue(null);
    await expect(serversService.decommissionServer('org-1', 'bad')).rejects.toThrow('not found');
  });
});
