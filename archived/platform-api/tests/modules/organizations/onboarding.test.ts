import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

import { signTokenPair } from '../../../src/lib/jwt.js';
import { errorHandler } from '../../../src/middleware/errors.js';

vi.mock('../../../src/lib/prisma.js', () => ({
  prisma: {
    organization: { findUnique: vi.fn(), update: vi.fn() },
    repository: { count: vi.fn() },
    integration: { count: vi.fn() },
    server: { count: vi.fn() },
    monitoredEndpoint: { count: vi.fn() },
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
import { organizationsRouter } from '../../../src/modules/organizations/organizations.router.js';
import { requestIdMiddleware } from '../../../src/middleware/request-id.js';

const mockPrisma = vi.mocked(prisma);

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(requestIdMiddleware);
  app.use('/api/v1/organizations', organizationsRouter);
  app.use(errorHandler);
  return app;
}

function auth(role = 'admin') {
  return `Bearer ${signTokenPair({ sub: 'u1', org: 'org-1', role }).accessToken}`;
}

describe('Onboarding Status', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('GET /api/v1/organizations/me/onboarding-status', () => {
    it('returns all steps incomplete for fresh org', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ onboardingCompleted: false } as any);
      mockPrisma.repository.count.mockResolvedValue(0);
      mockPrisma.integration.count.mockResolvedValue(0);
      mockPrisma.server.count.mockResolvedValue(0);
      mockPrisma.monitoredEndpoint.count.mockResolvedValue(0);

      const res = await request(createApp())
        .get('/api/v1/organizations/me/onboarding-status')
        .set('Authorization', auth());

      expect(res.status).toBe(200);
      expect(res.body.data.completed).toBe(false);
      expect(res.body.data.steps.code).toBe(false);
      expect(res.body.data.steps.infrastructure).toBe(false);
      expect(res.body.data.steps.ssl).toBe(false);
    });

    it('returns code step complete when integration exists', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ onboardingCompleted: false } as any);
      mockPrisma.repository.count.mockResolvedValue(0);
      mockPrisma.integration.count.mockResolvedValue(1); // has github integration
      mockPrisma.server.count.mockResolvedValue(0);
      mockPrisma.monitoredEndpoint.count.mockResolvedValue(0);

      const res = await request(createApp())
        .get('/api/v1/organizations/me/onboarding-status')
        .set('Authorization', auth());

      expect(res.body.data.steps.code).toBe(true);
      expect(res.body.data.steps.infrastructure).toBe(false);
    });

    it('returns all steps complete for active org', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ onboardingCompleted: true } as any);
      mockPrisma.repository.count.mockResolvedValue(5);
      mockPrisma.integration.count.mockResolvedValue(2);
      mockPrisma.server.count.mockResolvedValue(3);
      mockPrisma.monitoredEndpoint.count.mockResolvedValue(2);

      const res = await request(createApp())
        .get('/api/v1/organizations/me/onboarding-status')
        .set('Authorization', auth());

      expect(res.body.data.completed).toBe(true);
      expect(res.body.data.steps.code).toBe(true);
      expect(res.body.data.steps.infrastructure).toBe(true);
      expect(res.body.data.steps.ssl).toBe(true);
    });

    it('returns 401 without auth', async () => {
      const res = await request(createApp()).get('/api/v1/organizations/me/onboarding-status');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/v1/organizations/me/onboarding-complete', () => {
    it('marks onboarding as complete', async () => {
      mockPrisma.organization.update.mockResolvedValue({} as any);

      const res = await request(createApp())
        .post('/api/v1/organizations/me/onboarding-complete')
        .set('Authorization', auth());

      expect(res.status).toBe(200);
      expect(res.body.data.completed).toBe(true);
      expect(mockPrisma.organization.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { onboardingCompleted: true } }),
      );
    });
  });
});
