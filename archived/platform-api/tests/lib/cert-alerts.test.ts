import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    certAlert: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock('ioredis', () => ({
  default: vi.fn(() => ({
    ping: vi.fn().mockResolvedValue('PONG'),
    status: 'ready',
    options: { maxRetriesPerRequest: null },
  })),
}));

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation((name: string) => ({
    name,
    add: vi.fn().mockResolvedValue({}),
    addBulk: vi.fn().mockResolvedValue([]),
  })),
}));

import { prisma } from '../../src/lib/prisma.js';
import { resolveAlertType, sendCertAlertIfNew, processCertExpiryAlerts } from '../../src/lib/cert-alerts.js';

const mockPrisma = vi.mocked(prisma);

describe('Certificate Alert Deduplication', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('resolveAlertType', () => {
    it.each([
      [-1, 'expired'],
      [0, 'expired'],
      [1, 'expiry_1d'],
      [5, 'expiry_7d'],
      [7, 'expiry_7d'],
      [20, 'expiry_30d'],
      [30, 'expiry_30d'],
      [45, 'expiry_60d'],
      [75, 'expiry_90d'],
      [90, 'expiry_90d'],
    ])('days=%d → %s', (days, expected) => {
      expect(resolveAlertType(days)).toBe(expected);
    });

    it('returns null for >90 days', () => {
      expect(resolveAlertType(91)).toBeNull();
      expect(resolveAlertType(365)).toBeNull();
    });
  });

  describe('sendCertAlertIfNew', () => {
    it('sends alert and records it when no prior alert exists', async () => {
      mockPrisma.certAlert.findUnique.mockResolvedValue(null);
      mockPrisma.certAlert.create.mockResolvedValue({} as any);

      const sent = await sendCertAlertIfNew('cert-1', 'expiry_30d', 'slack', { orgId: 'org-1' });

      expect(sent).toBe(true);
      expect(mockPrisma.certAlert.create).toHaveBeenCalledWith({
        data: { certificateId: 'cert-1', alertType: 'expiry_30d', channel: 'slack' },
      });
    });

    it('suppresses alert when prior alert exists (deduplication)', async () => {
      mockPrisma.certAlert.findUnique.mockResolvedValue({
        id: 'existing',
        certificateId: 'cert-1',
        alertType: 'expiry_30d',
      } as any);

      const sent = await sendCertAlertIfNew('cert-1', 'expiry_30d', 'slack', {});

      expect(sent).toBe(false);
      expect(mockPrisma.certAlert.create).not.toHaveBeenCalled();
    });

    it('allows new threshold even if prior threshold was alerted', async () => {
      // First call: 30d exists
      mockPrisma.certAlert.findUnique.mockResolvedValueOnce({ id: 'x' } as any);
      const sent30 = await sendCertAlertIfNew('cert-1', 'expiry_30d', 'slack', {});
      expect(sent30).toBe(false);

      // Second call: 7d does not exist
      mockPrisma.certAlert.findUnique.mockResolvedValueOnce(null);
      mockPrisma.certAlert.create.mockResolvedValue({} as any);
      const sent7 = await sendCertAlertIfNew('cert-1', 'expiry_7d', 'slack', {});
      expect(sent7).toBe(true);
    });
  });

  describe('processCertExpiryAlerts', () => {
    it('sends alerts for all crossed thresholds', async () => {
      // Cert expires in 5 days → crosses expired, 1d, 7d thresholds
      // But only send NEW ones
      mockPrisma.certAlert.findUnique.mockResolvedValue(null); // all are new
      mockPrisma.certAlert.create.mockResolvedValue({} as any);

      const notAfter = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
      const count = await processCertExpiryAlerts('cert-1', '*.example.com', notAfter, 'org-1');

      // Should send: expiry_7d, expiry_30d, expiry_60d, expiry_90d (all thresholds where days <= threshold)
      expect(count).toBeGreaterThan(0);
      expect(mockPrisma.certAlert.create).toHaveBeenCalled();
    });

    it('sends zero alerts when cert is far from expiry', async () => {
      const notAfter = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      const count = await processCertExpiryAlerts('cert-1', 'ok.com', notAfter, 'org-1');

      expect(count).toBe(0);
      expect(mockPrisma.certAlert.create).not.toHaveBeenCalled();
    });
  });
});
