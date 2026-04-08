import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

import { signTokenPair } from '../../../src/lib/jwt.js';
import { errorHandler } from '../../../src/middleware/errors.js';

vi.mock('../../../src/lib/prisma.js', () => ({
  prisma: {
    certificate: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
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
import { certificatesRouter } from '../../../src/modules/assets/certificates.router.js';
import { requestIdMiddleware } from '../../../src/middleware/request-id.js';

const mockPrisma = vi.mocked(prisma);
const UUID = '550e8400-e29b-41d4-a716-446655440000';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(requestIdMiddleware);
  app.use('/api/v1/certificates', certificatesRouter);
  app.use(errorHandler);
  return app;
}

function auth(role = 'admin') {
  return `Bearer ${signTokenPair({ sub: 'u1', org: 'org-1', role }).accessToken}`;
}

const makeCert = (overrides = {}) => ({
  id: UUID,
  orgId: 'org-1',
  subjectCn: '*.example.com',
  sans: ['example.com', '*.example.com'],
  issuerCn: "Let's Encrypt Authority X3",
  serialNumber: 'AABBCC',
  fingerprintSha256: 'abc123',
  notBefore: new Date('2024-01-01'),
  notAfter: new Date('2025-01-01'),
  keyAlgorithm: 'RSA-2048',
  signatureAlgorithm: 'SHA256withRSA',
  chainValid: true,
  chainDepth: 3,
  discoveredFrom: 'alb:arn:aws:...',
  sourceAssetId: null,
  lastCheckedAt: new Date(),
  status: 'active',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('Certificates Router', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('GET /api/v1/certificates', () => {
    it('returns 401 without auth', async () => {
      const res = await request(createApp()).get('/api/v1/certificates');
      expect(res.status).toBe(401);
    });

    it('returns paginated list', async () => {
      mockPrisma.certificate.findMany.mockResolvedValue([makeCert()] as any);
      mockPrisma.certificate.count.mockResolvedValue(1);

      const res = await request(createApp())
        .get('/api/v1/certificates')
        .set('Authorization', auth());

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].subjectCn).toBe('*.example.com');
      expect(res.body.meta.total).toBe(1);
    });

    it('applies status filter', async () => {
      mockPrisma.certificate.findMany.mockResolvedValue([]);
      mockPrisma.certificate.count.mockResolvedValue(0);

      await request(createApp())
        .get('/api/v1/certificates?status=expiring')
        .set('Authorization', auth());

      expect(mockPrisma.certificate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'expiring' }),
        }),
      );
    });
  });

  describe('GET /api/v1/certificates/:id', () => {
    it('returns certificate detail with chain info', async () => {
      mockPrisma.certificate.findFirst.mockResolvedValue({
        ...makeCert(),
        sourceAsset: null,
        findings: [],
      } as any);

      const res = await request(createApp())
        .get(`/api/v1/certificates/${UUID}`)
        .set('Authorization', auth());

      expect(res.status).toBe(200);
      expect(res.body.data.subjectCn).toBe('*.example.com');
      expect(res.body.data.sans).toEqual(['example.com', '*.example.com']);
    });

    it('returns 404 for missing cert', async () => {
      mockPrisma.certificate.findFirst.mockResolvedValue(null);

      const res = await request(createApp())
        .get(`/api/v1/certificates/${UUID}`)
        .set('Authorization', auth());

      expect(res.status).toBe(404);
    });

    it('rejects non-UUID id', async () => {
      const res = await request(createApp())
        .get('/api/v1/certificates/not-a-uuid')
        .set('Authorization', auth());

      expect(res.status).toBe(422);
    });
  });

  describe('GET /api/v1/certificates/expiring', () => {
    it('returns certificates expiring within N days', async () => {
      mockPrisma.certificate.findMany.mockResolvedValue([
        makeCert({ notAfter: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000) }),
      ] as any);
      mockPrisma.certificate.count.mockResolvedValue(1);

      const res = await request(createApp())
        .get('/api/v1/certificates/expiring?days=30')
        .set('Authorization', auth());

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });

    it('defaults to 30 days', async () => {
      mockPrisma.certificate.findMany.mockResolvedValue([]);
      mockPrisma.certificate.count.mockResolvedValue(0);

      const res = await request(createApp())
        .get('/api/v1/certificates/expiring')
        .set('Authorization', auth());

      expect(res.status).toBe(200);

      // Verify the where clause includes notAfter <= ~30 days from now
      const call = mockPrisma.certificate.findMany.mock.calls[0][0] as any;
      const deadline = call.where.notAfter.lte as Date;
      const daysFromNow = (deadline.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
      expect(daysFromNow).toBeGreaterThan(29);
      expect(daysFromNow).toBeLessThan(31);
    });

    it('filters only active/expiring status', async () => {
      mockPrisma.certificate.findMany.mockResolvedValue([]);
      mockPrisma.certificate.count.mockResolvedValue(0);

      await request(createApp())
        .get('/api/v1/certificates/expiring')
        .set('Authorization', auth());

      const call = mockPrisma.certificate.findMany.mock.calls[0][0] as any;
      expect(call.where.status).toEqual({ in: ['active', 'expiring'] });
    });
  });
});
