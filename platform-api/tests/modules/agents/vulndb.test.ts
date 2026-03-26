import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRedisGet = vi.fn();
const mockRedisSet = vi.fn().mockResolvedValue('OK');

vi.mock('../../../src/lib/prisma.js', () => ({
  prisma: {
    vulnerabilityAffects: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('ioredis', () => ({
  default: vi.fn(() => ({
    ping: vi.fn().mockResolvedValue('PONG'),
    status: 'ready',
    options: { maxRetriesPerRequest: null },
    get: mockRedisGet,
    set: mockRedisSet,
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
import * as vulndbService from '../../../src/modules/agents/vulndb.service.js';

const mockPrisma = vi.mocked(prisma);

describe('VulnDB Snapshot Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
  });

  describe('buildSnapshot', () => {
    it('builds snapshot from vulnerability_affects', async () => {
      mockPrisma.vulnerabilityAffects.findMany.mockResolvedValue([
        {
          vulnerabilityId: 'CVE-2024-001',
          ecosystem: 'npm',
          packageName: 'lodash',
          versionRange: '>=4.0.0 <4.17.21',
          fixedVersion: '4.17.21',
          osFamily: null,
          osVersion: null,
          vulnerability: { cvssScore: 7.4 },
        },
        {
          vulnerabilityId: 'CVE-2024-002',
          ecosystem: 'ubuntu',
          packageName: 'openssl',
          versionRange: '>=3.0.0 <3.0.2-fix',
          fixedVersion: '3.0.2-fix',
          osFamily: 'ubuntu',
          osVersion: '22.04',
          vulnerability: { cvssScore: 8.1 },
        },
      ] as any);

      const result = await vulndbService.buildSnapshot();

      expect(result.version).toBeDefined();
      expect(result.data['npm']).toBeDefined();
      expect(result.data['npm']['lodash']).toHaveLength(1);
      expect(result.data['npm']['lodash'][0].cve_id).toBe('CVE-2024-001');
      expect(result.data['ubuntu:22.04']).toBeDefined();
      expect(result.data['ubuntu:22.04']['openssl']).toHaveLength(1);
    });

    it('caches snapshot in Redis', async () => {
      mockPrisma.vulnerabilityAffects.findMany.mockResolvedValue([]);

      await vulndbService.buildSnapshot();

      expect(mockRedisSet).toHaveBeenCalledWith('vulndb:snapshot:version', expect.any(String));
      expect(mockRedisSet).toHaveBeenCalledWith('vulndb:snapshot:data', expect.any(String));
    });
  });

  describe('getSnapshotVersion', () => {
    it('returns version from Redis', async () => {
      mockRedisGet.mockResolvedValue('2024-06-01T10:00:00Z');

      const version = await vulndbService.getSnapshotVersion();
      expect(version).toBe('2024-06-01T10:00:00Z');
    });

    it('returns null when no snapshot exists', async () => {
      mockRedisGet.mockResolvedValue(null);

      const version = await vulndbService.getSnapshotVersion();
      expect(version).toBeNull();
    });
  });

  describe('downloadSnapshot', () => {
    it('returns full snapshot when no since param', async () => {
      mockRedisGet
        .mockResolvedValueOnce('2024-06-01T10:00:00Z')  // version
        .mockResolvedValueOnce(JSON.stringify({ npm: { lodash: [] } }));  // data

      const result = await vulndbService.downloadSnapshot();

      expect(result.isDelta).toBe(false);
      expect(result.data['npm']).toBeDefined();
    });

    it('rebuilds snapshot when no cache', async () => {
      mockRedisGet.mockResolvedValue(null);
      mockPrisma.vulnerabilityAffects.findMany.mockResolvedValue([]);

      const result = await vulndbService.downloadSnapshot();

      expect(result.isDelta).toBe(false);
    });

    it('returns delta when since param and delta is small', async () => {
      mockRedisGet
        .mockResolvedValueOnce('2024-06-01T10:00:00Z')
        .mockResolvedValueOnce(JSON.stringify({
          npm: {
            lodash: [{ cve_id: 'a', affected: '1', fixed: '2', cvss: 5 }],
            express: [{ cve_id: 'b', affected: '1', fixed: '2', cvss: 3 }],
          },
        }));

      // Delta: only 1 new affect (< 50% of total 2)
      mockPrisma.vulnerabilityAffects.findMany.mockResolvedValue([
        {
          vulnerabilityId: 'CVE-NEW',
          ecosystem: 'npm',
          packageName: 'axios',
          versionRange: '>=1.0.0 <1.5.0',
          fixedVersion: '1.5.0',
          osFamily: null,
          osVersion: null,
          vulnerability: { cvssScore: 6.0 },
        },
      ] as any);

      const result = await vulndbService.downloadSnapshot('2024-05-01T00:00:00Z');

      expect(result.isDelta).toBe(true);
      expect(result.data['npm']['axios']).toHaveLength(1);
    });
  });
});
