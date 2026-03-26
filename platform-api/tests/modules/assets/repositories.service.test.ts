import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/lib/prisma.js', () => ({
  prisma: {
    repository: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    scan: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    finding: {
      groupBy: vi.fn(),
      deleteMany: vi.fn(),
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

import { prisma } from '../../../src/lib/prisma.js';
import * as repoService from '../../../src/modules/assets/repositories.service.js';

const mockPrisma = vi.mocked(prisma);

const makeRepo = (overrides = {}) => ({
  id: 'repo-uuid',
  orgId: 'org-1',
  provider: 'github',
  providerId: '12345',
  owner: 'acme',
  name: 'my-app',
  defaultBranch: 'main',
  language: 'typescript',
  lastScanAt: null,
  settings: {},
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('Repositories Service', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('listRepositories', () => {
    it('returns paginated repos', async () => {
      mockPrisma.repository.findMany.mockResolvedValue([makeRepo()] as any);
      mockPrisma.repository.count.mockResolvedValue(1);

      const result = await repoService.listRepositories('org-1', { page: 1, per_page: 50 });

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });

    it('applies provider filter', async () => {
      mockPrisma.repository.findMany.mockResolvedValue([]);
      mockPrisma.repository.count.mockResolvedValue(0);

      await repoService.listRepositories('org-1', { page: 1, per_page: 50, provider: 'github' });

      expect(mockPrisma.repository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ provider: 'github' }),
        }),
      );
    });
  });

  describe('createRepository', () => {
    it('creates a repository', async () => {
      mockPrisma.repository.create.mockResolvedValue(makeRepo() as any);

      const result = await repoService.createRepository('org-1', {
        provider: 'github',
        providerId: '12345',
        owner: 'acme',
        name: 'my-app',
        defaultBranch: 'main',
      });

      expect(result.name).toBe('my-app');
    });

    it('throws on duplicate', async () => {
      mockPrisma.repository.create.mockRejectedValue({ code: 'P2002' });

      await expect(
        repoService.createRepository('org-1', {
          provider: 'github',
          providerId: '12345',
          owner: 'acme',
          name: 'my-app',
          defaultBranch: 'main',
        }),
      ).rejects.toThrow('already registered');
    });
  });

  describe('getRepositoryById', () => {
    it('returns repo with scan summary and finding counts', async () => {
      mockPrisma.repository.findFirst.mockResolvedValue(makeRepo() as any);
      (mockPrisma.scan.findFirst as any).mockResolvedValue({ id: 'scan-1', status: 'completed' });
      mockPrisma.finding.groupBy.mockResolvedValue([
        { severity: 'high', _count: { id: 5 } },
        { severity: 'critical', _count: { id: 2 } },
      ] as any);

      const result = await repoService.getRepositoryById('org-1', 'repo-uuid');

      expect(result.name).toBe('my-app');
      expect(result.latestScan?.status).toBe('completed');
      expect(result.findingCounts).toEqual({ high: 5, critical: 2 });
    });

    it('throws RESOURCE_NOT_FOUND', async () => {
      mockPrisma.repository.findFirst.mockResolvedValue(null);

      await expect(repoService.getRepositoryById('org-1', 'bad')).rejects.toThrow('not found');
    });
  });

  describe('deleteRepository', () => {
    it('deletes repo and associated data', async () => {
      mockPrisma.repository.findFirst.mockResolvedValue(makeRepo() as any);
      mockPrisma.finding.deleteMany.mockResolvedValue({ count: 5 } as any);
      (mockPrisma.scan as any).deleteMany = vi.fn().mockResolvedValue({ count: 2 });
      mockPrisma.repository.delete.mockResolvedValue(makeRepo() as any);

      await expect(repoService.deleteRepository('org-1', 'repo-uuid')).resolves.not.toThrow();
    });

    it('throws RESOURCE_NOT_FOUND', async () => {
      mockPrisma.repository.findFirst.mockResolvedValue(null);
      await expect(repoService.deleteRepository('org-1', 'bad')).rejects.toThrow('not found');
    });
  });

  describe('triggerScan', () => {
    it('creates scan and enqueues job', async () => {
      mockPrisma.repository.findFirst.mockResolvedValue(makeRepo() as any);
      (mockPrisma.scan.findFirst as any).mockResolvedValue(null); // no active scan
      (mockPrisma.scan.create as any).mockResolvedValue({
        id: 'scan-new',
        status: 'pending',
        scanType: 'code_dependencies',
      });

      const result = await repoService.triggerScan('org-1', 'repo-uuid');

      expect(result.status).toBe('pending');
      expect(mockPrisma.scan.create).toHaveBeenCalled();
    });

    it('throws SCAN_ALREADY_RUNNING when active scan exists', async () => {
      mockPrisma.repository.findFirst.mockResolvedValue(makeRepo() as any);
      (mockPrisma.scan.findFirst as any).mockResolvedValue({ id: 'existing', status: 'running' });

      await expect(repoService.triggerScan('org-1', 'repo-uuid')).rejects.toThrow('active scan');
    });

    it('throws RESOURCE_NOT_FOUND for missing repo', async () => {
      mockPrisma.repository.findFirst.mockResolvedValue(null);

      await expect(repoService.triggerScan('org-1', 'bad')).rejects.toThrow('not found');
    });
  });
});
