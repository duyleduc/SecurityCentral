import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/lib/prisma.js', () => ({
  prisma: {
    integration: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    cloudResource: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    server: { findFirst: vi.fn() },
  },
}));

vi.mock('../../../src/lib/cloud/types.js', () => ({
  createCloudClient: vi.fn().mockReturnValue({
    provider: 'aws',
    discoverInstances: vi.fn().mockResolvedValue([
      { resourceId: 'i-abc123', resourceType: 'ec2', hostname: 'web-01', ipAddress: '10.0.1.5', region: 'us-east-1', status: 'running', osInfo: 'Linux' },
      { resourceId: 'i-def456', resourceType: 'ec2', hostname: 'api-01', ipAddress: '10.0.1.6', region: 'us-east-1', status: 'running', osInfo: 'Linux' },
    ]),
  }),
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
    name, add: vi.fn().mockResolvedValue({}), addBulk: vi.fn().mockResolvedValue([]),
  })),
}));

import { prisma } from '../../../src/lib/prisma.js';
import * as cloudDiscovery from '../../../src/modules/integrations/cloud-discovery.service.js';

const mockPrisma = vi.mocked(prisma);

describe('Cloud Discovery Service', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('connectCloudProvider', () => {
    it('creates integration after successful test discovery', async () => {
      // First call: check existing (null), second call: discoverResources finds the new integration
      mockPrisma.integration.findFirst
        .mockResolvedValueOnce(null) // connectCloudProvider check
        .mockResolvedValueOnce({ id: 'int-1', provider: 'aws', config: { region: 'us-east-1' } } as any); // discoverResources lookup
      mockPrisma.integration.create.mockResolvedValue({ id: 'int-1', provider: 'aws' } as any);
      mockPrisma.cloudResource.upsert.mockResolvedValue({} as any);
      mockPrisma.cloudResource.findMany.mockResolvedValue([]);
      mockPrisma.cloudResource.deleteMany.mockResolvedValue({ count: 0 } as any);

      const result = await cloudDiscovery.connectCloudProvider('org-1', 'aws', { region: 'us-east-1' });

      expect(result.provider).toBe('aws');
      expect(mockPrisma.integration.create).toHaveBeenCalled();
    });

    it('throws INTEGRATION_ALREADY_EXISTS if duplicate', async () => {
      mockPrisma.integration.findFirst.mockResolvedValue({ id: 'existing' } as any);

      await expect(
        cloudDiscovery.connectCloudProvider('org-1', 'aws', { region: 'us-east-1' }),
      ).rejects.toThrow('already exists');
    });
  });

  describe('discoverResources', () => {
    it('upserts discovered instances', async () => {
      mockPrisma.integration.findFirst.mockResolvedValue({
        id: 'int-1', config: { region: 'us-east-1' },
      } as any);
      mockPrisma.cloudResource.upsert.mockResolvedValue({} as any);
      mockPrisma.cloudResource.findMany.mockResolvedValue([]);
      mockPrisma.cloudResource.deleteMany.mockResolvedValue({ count: 0 } as any);

      const count = await cloudDiscovery.discoverResources('org-1', 'aws');

      expect(count).toBe(2);
      expect(mockPrisma.cloudResource.upsert).toHaveBeenCalledTimes(2);
    });

    it('throws if no active integration', async () => {
      mockPrisma.integration.findFirst.mockResolvedValue(null);

      await expect(cloudDiscovery.discoverResources('org-1', 'aws')).rejects.toThrow('No active');
    });
  });

  describe('listDiscoveredResources', () => {
    it('returns paginated resources with server join', async () => {
      mockPrisma.cloudResource.findMany.mockResolvedValue([
        { id: 'cr-1', resourceId: 'i-abc', hostname: 'web-01', server: { id: 's1', hostname: 'web-01', status: 'active' } },
      ] as any);
      mockPrisma.cloudResource.count.mockResolvedValue(1);

      const result = await cloudDiscovery.listDiscoveredResources('org-1', 'aws', { page: 1, per_page: 50 });

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });
  });

  describe('getUnmonitoredServers', () => {
    it('returns only resources without agents', async () => {
      mockPrisma.cloudResource.findMany.mockResolvedValue([
        { id: 'cr-2', resourceId: 'i-def', hostname: 'api-01', serverId: null },
      ] as any);

      const result = await cloudDiscovery.getUnmonitoredServers('org-1');

      expect(result).toHaveLength(1);
      expect(mockPrisma.cloudResource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ serverId: null }) }),
      );
    });
  });

  describe('getCoverageStats', () => {
    it('calculates coverage per provider/region', async () => {
      mockPrisma.cloudResource.findMany.mockResolvedValue([
        { provider: 'aws', region: 'us-east-1', serverId: 's1' },
        { provider: 'aws', region: 'us-east-1', serverId: null },
        { provider: 'aws', region: 'us-east-1', serverId: 's2' },
        { provider: 'azure', region: 'westeurope', serverId: null },
      ] as any);

      const stats = await cloudDiscovery.getCoverageStats('org-1');

      expect(stats.total_instances).toBe(4);
      expect(stats.total_monitored).toBe(2);
      expect(stats.overall_coverage_pct).toBe(50);
      expect(stats.breakdown).toHaveLength(2);

      const awsStat = stats.breakdown.find((b) => b.provider === 'aws');
      expect(awsStat?.total).toBe(3);
      expect(awsStat?.monitored).toBe(2);
      expect(awsStat?.coverage_pct).toBe(67);
    });

    it('handles empty resources', async () => {
      mockPrisma.cloudResource.findMany.mockResolvedValue([]);

      const stats = await cloudDiscovery.getCoverageStats('org-1');

      expect(stats.total_instances).toBe(0);
      expect(stats.overall_coverage_pct).toBe(0);
      expect(stats.breakdown).toHaveLength(0);
    });
  });
});
