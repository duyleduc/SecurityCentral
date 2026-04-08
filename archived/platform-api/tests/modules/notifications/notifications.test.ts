import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/lib/prisma.js', () => ({
  prisma: {
    notificationPreference: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      upsert: vi.fn(),
    },
    organization: { findUnique: vi.fn() },
    finding: { groupBy: vi.fn() },
    certificate: { count: vi.fn() },
    server: { count: vi.fn() },
    user: { findMany: vi.fn() },
    integration: { findMany: vi.fn() },
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
import { createDefaultPreferences } from '../../../src/jobs/notification-dispatcher.js';
import { aggregateDigest, renderDigestHtml, processDailyDigest } from '../../../src/lib/email.js';

const mockPrisma = vi.mocked(prisma);

describe('Notification Dispatcher', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('createDefaultPreferences', () => {
    it('creates 8 default preferences for a user', async () => {
      mockPrisma.notificationPreference.upsert.mockResolvedValue({} as any);

      await createDefaultPreferences('user-1');

      expect(mockPrisma.notificationPreference.upsert).toHaveBeenCalledTimes(8);
      // Check critical_finding slack is enabled
      expect(mockPrisma.notificationPreference.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            channel: 'slack',
            eventType: 'critical_finding',
            enabled: true,
          }),
        }),
      );
      // Check scan_complete slack is disabled
      expect(mockPrisma.notificationPreference.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            channel: 'slack',
            eventType: 'scan_complete',
            enabled: false,
          }),
        }),
      );
    });
  });
});

describe('Email Digest', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('aggregateDigest', () => {
    it('aggregates findings, certs, and agents', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ name: 'Acme' } as any);
      mockPrisma.finding.groupBy.mockResolvedValue([
        { severity: 'critical', _count: { id: 3 } },
        { severity: 'high', _count: { id: 7 } },
      ] as any);
      mockPrisma.certificate.count.mockResolvedValue(2);
      mockPrisma.server.count.mockResolvedValue(1);

      const digest = await aggregateDigest('org-1');

      expect(digest.orgName).toBe('Acme');
      expect(digest.findings.critical).toBe(3);
      expect(digest.findings.high).toBe(7);
      expect(digest.findings.total).toBe(10);
      expect(digest.expiringCerts).toBe(2);
      expect(digest.offlineAgents).toBe(1);
    });
  });

  describe('renderDigestHtml', () => {
    it('produces valid HTML with finding counts', () => {
      const html = renderDigestHtml({
        orgId: 'org-1',
        orgName: 'Acme Corp',
        period: '2024-06-01',
        findings: { critical: 2, high: 5, medium: 10, low: 3, total: 20 },
        expiringCerts: 1,
        offlineAgents: 0,
      });

      expect(html).toContain('Acme Corp');
      expect(html).toContain('2024-06-01');
      expect(html).toContain('>2<'); // critical count
      expect(html).toContain('>5<'); // high count
      expect(html).toContain('1 certificate(s)');
      expect(html).not.toContain('agent(s)'); // 0 offline agents
      expect(html).toContain('View Dashboard');
    });

    it('omits cert/agent sections when zero', () => {
      const html = renderDigestHtml({
        orgId: 'org-1',
        orgName: 'Test',
        period: '2024-06-01',
        findings: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
        expiringCerts: 0,
        offlineAgents: 0,
      });

      expect(html).not.toContain('certificate(s)');
      expect(html).not.toContain('agent(s)');
    });
  });

  describe('processDailyDigest', () => {
    it('sends emails to users with email prefs enabled', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ name: 'Acme' } as any);
      mockPrisma.finding.groupBy.mockResolvedValue([
        { severity: 'critical', _count: { id: 1 } },
      ] as any);
      mockPrisma.certificate.count.mockResolvedValue(0);
      mockPrisma.server.count.mockResolvedValue(0);
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 'u1', email: 'alice@example.com' },
        { id: 'u2', email: 'bob@example.com' },
      ] as any);
      // u1 has email enabled, u2 does not
      mockPrisma.notificationPreference.findFirst
        .mockResolvedValueOnce({ enabled: true } as any)
        .mockResolvedValueOnce(null);

      const sent = await processDailyDigest('org-1');
      expect(sent).toBe(1); // only alice
    });

    it('skips empty digest', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ name: 'Acme' } as any);
      mockPrisma.finding.groupBy.mockResolvedValue([]);
      mockPrisma.certificate.count.mockResolvedValue(0);
      mockPrisma.server.count.mockResolvedValue(0);

      const sent = await processDailyDigest('org-1');
      expect(sent).toBe(0);
      expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
    });
  });
});
