import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

import { signTokenPair } from '../../../src/lib/jwt.js';
import { errorHandler } from '../../../src/middleware/errors.js';

vi.mock('../../../src/lib/prisma.js', () => ({
  prisma: {
    auditLog: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
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
import { audit, listAuditLogs } from '../../../src/lib/audit.js';
import { auditRouter } from '../../../src/modules/audit/audit.router.js';
import { requestIdMiddleware } from '../../../src/middleware/request-id.js';

const mockPrisma = vi.mocked(prisma);

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(requestIdMiddleware);
  app.use('/api/v1/audit-logs', auditRouter);
  app.use(errorHandler);
  return app;
}

function auth(role = 'admin') {
  return `Bearer ${signTokenPair({ sub: 'u1', org: 'org-1', role }).accessToken}`;
}

const makeLog = (overrides = {}) => ({
  id: 'log-uuid',
  orgId: 'org-1',
  actorType: 'user',
  actorId: 'u1',
  action: 'finding.status_changed',
  entityType: 'finding',
  entityId: 'f1',
  oldValue: { status: 'open' },
  newValue: { status: 'resolved' },
  createdAt: new Date('2024-06-01T10:00:00Z'),
  ...overrides,
});

describe('Audit Service', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('audit()', () => {
    it('creates an audit log entry', async () => {
      mockPrisma.auditLog.create.mockResolvedValue(makeLog() as any);

      audit({
        orgId: 'org-1',
        actorType: 'user',
        actorId: 'u1',
        action: 'finding.status_changed',
        entityType: 'finding',
        entityId: 'f1',
        oldValue: { status: 'open' },
        newValue: { status: 'resolved' },
      });

      // audit is fire-and-forget, give it a tick
      await new Promise((r) => setTimeout(r, 10));

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          orgId: 'org-1',
          action: 'finding.status_changed',
          entityType: 'finding',
        }),
      });
    });

    it('does not throw on failure', async () => {
      mockPrisma.auditLog.create.mockRejectedValue(new Error('DB down'));

      expect(() =>
        audit({
          orgId: 'org-1',
          actorType: 'system',
          actorId: 'system',
          action: 'scan.triggered',
          entityType: 'scan',
          entityId: 's1',
        }),
      ).not.toThrow();
    });
  });

  describe('listAuditLogs()', () => {
    it('returns paginated logs', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([makeLog()] as any);
      mockPrisma.auditLog.count.mockResolvedValue(1);

      const result = await listAuditLogs('org-1', { page: 1, per_page: 50 });

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });

    it('applies entity_type filter', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.count.mockResolvedValue(0);

      await listAuditLogs('org-1', { entity_type: 'finding', page: 1, per_page: 50 });

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ entityType: 'finding' }),
        }),
      );
    });

    it('applies date range filter', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.count.mockResolvedValue(0);

      await listAuditLogs('org-1', {
        from: '2024-01-01T00:00:00Z',
        to: '2024-12-31T23:59:59Z',
        page: 1,
        per_page: 50,
      });

      const call = mockPrisma.auditLog.findMany.mock.calls[0][0] as any;
      expect(call.where.createdAt.gte).toEqual(new Date('2024-01-01T00:00:00Z'));
      expect(call.where.createdAt.lte).toEqual(new Date('2024-12-31T23:59:59Z'));
    });
  });
});

describe('Audit Router', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('GET /api/v1/audit-logs', () => {
    it('returns 401 without auth', async () => {
      const res = await request(createApp()).get('/api/v1/audit-logs');
      expect(res.status).toBe(401);
    });

    it('returns paginated audit logs for admin', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([makeLog()] as any);
      mockPrisma.auditLog.count.mockResolvedValue(1);

      const res = await request(createApp())
        .get('/api/v1/audit-logs')
        .set('Authorization', auth('admin'));

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].action).toBe('finding.status_changed');
    });

    it('denies member access (requires admin+)', async () => {
      const res = await request(createApp())
        .get('/api/v1/audit-logs')
        .set('Authorization', auth('member'));

      expect(res.status).toBe(403);
    });

    it('denies viewer access', async () => {
      const res = await request(createApp())
        .get('/api/v1/audit-logs')
        .set('Authorization', auth('viewer'));

      expect(res.status).toBe(403);
    });

    it('passes filter query params', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.count.mockResolvedValue(0);

      const res = await request(createApp())
        .get('/api/v1/audit-logs?entity_type=finding&entity_id=f1&page=2&per_page=10')
        .set('Authorization', auth());

      expect(res.status).toBe(200);
      expect(res.body.meta.page).toBe(2);
      expect(res.body.meta.per_page).toBe(10);
    });
  });
});
