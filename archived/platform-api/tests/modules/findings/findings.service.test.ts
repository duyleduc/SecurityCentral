import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock Prisma
// ---------------------------------------------------------------------------
vi.mock('../../../src/lib/prisma.js', () => ({
  prisma: {
    finding: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
  },
}));

// Mock ES client
const mockEsSearch = vi.fn();
vi.mock('../../../src/lib/elasticsearch.js', () => ({
  getEsClient: () => ({
    search: mockEsSearch,
  }),
  FINDINGS_INDEX: 'findings',
  upsertFinding: vi.fn(),
}));

// Mock BullMQ queue
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
import * as findingsService from '../../../src/modules/findings/findings.service.js';

const mockPrisma = vi.mocked(prisma);

const makeFinding = (overrides = {}) => ({
  id: '550e8400-e29b-41d4-a716-446655440000',
  orgId: 'org-1',
  source: 'code_scanner',
  severity: 'high',
  status: 'open',
  title: 'CVE-2024-1234 in lodash',
  description: 'Prototype pollution',
  cveId: 'CVE-2024-1234',
  cvssScore: 7.5,
  repositoryId: 'repo-1',
  serverId: null,
  certificateId: null,
  detail: {},
  remediation: 'Upgrade to lodash 4.17.21',
  autoFixable: true,
  fixPrUrl: null,
  scanId: 'scan-1',
  firstSeenAt: new Date('2024-01-15'),
  resolvedAt: null,
  createdAt: new Date('2024-01-15'),
  updatedAt: new Date('2024-01-15'),
  repository: { name: 'my-app', owner: 'org' },
  server: null,
  certificate: null,
  ...overrides,
});

describe('Findings Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- List (PG path) ---

  describe('listFindings (PG)', () => {
    it('returns paginated findings from PostgreSQL', async () => {
      const findings = [makeFinding()];
      mockPrisma.finding.findMany.mockResolvedValue(findings as any);
      mockPrisma.finding.count.mockResolvedValue(1);

      const result = await findingsService.listFindings('org-1', {
        page: 1,
        per_page: 50,
      });

      expect(result.data).toHaveLength(1);
      expect(result.meta).toEqual({ page: 1, per_page: 50, total: 1 });
      expect(mockPrisma.finding.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { orgId: 'org-1' }, skip: 0, take: 50 }),
      );
    });

    it('applies severity filter', async () => {
      mockPrisma.finding.findMany.mockResolvedValue([]);
      mockPrisma.finding.count.mockResolvedValue(0);

      await findingsService.listFindings('org-1', {
        severity: 'critical,high',
        page: 1,
        per_page: 50,
      });

      expect(mockPrisma.finding.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            severity: { in: ['critical', 'high'] },
          }),
        }),
      );
    });

    it('applies status filter', async () => {
      mockPrisma.finding.findMany.mockResolvedValue([]);
      mockPrisma.finding.count.mockResolvedValue(0);

      await findingsService.listFindings('org-1', {
        status: 'open,in_progress',
        page: 1,
        per_page: 50,
      });

      expect(mockPrisma.finding.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: ['open', 'in_progress'] },
          }),
        }),
      );
    });

    it('applies cve_id filter', async () => {
      mockPrisma.finding.findMany.mockResolvedValue([]);
      mockPrisma.finding.count.mockResolvedValue(0);

      await findingsService.listFindings('org-1', {
        cve_id: 'CVE-2024-1234',
        page: 1,
        per_page: 50,
      });

      expect(mockPrisma.finding.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ cveId: 'CVE-2024-1234' }),
        }),
      );
    });

    it('computes correct skip for page 3', async () => {
      mockPrisma.finding.findMany.mockResolvedValue([]);
      mockPrisma.finding.count.mockResolvedValue(0);

      await findingsService.listFindings('org-1', { page: 3, per_page: 25 });

      expect(mockPrisma.finding.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 50, take: 25 }),
      );
    });
  });

  // --- List (ES path) ---

  describe('listFindings (ES — full-text)', () => {
    it('routes to ES when q is provided', async () => {
      mockEsSearch.mockResolvedValue({
        body: {
          hits: {
            total: { value: 1 },
            hits: [{ _source: makeFinding() }],
          },
        },
      });

      const result = await findingsService.listFindings('org-1', {
        q: 'log4j',
        page: 1,
        per_page: 50,
      });

      expect(mockEsSearch).toHaveBeenCalled();
      expect(result.data).toHaveLength(1);
      // PG should NOT be called
      expect(mockPrisma.finding.findMany).not.toHaveBeenCalled();
    });
  });

  // --- Get by ID ---

  describe('getFindingById', () => {
    it('returns finding with asset info', async () => {
      mockPrisma.finding.findFirst.mockResolvedValue(makeFinding() as any);

      const result = await findingsService.getFindingById('org-1', '550e8400-e29b-41d4-a716-446655440000');
      expect(result.title).toBe('CVE-2024-1234 in lodash');
    });

    it('throws RESOURCE_NOT_FOUND for missing finding', async () => {
      mockPrisma.finding.findFirst.mockResolvedValue(null);

      await expect(
        findingsService.getFindingById('org-1', '550e8400-e29b-41d4-a716-446655440000'),
      ).rejects.toThrow('not found');
    });
  });

  // --- Update status ---

  describe('updateFindingStatus', () => {
    it('sets resolved_at when resolving', async () => {
      mockPrisma.finding.findFirst.mockResolvedValue(makeFinding({ status: 'open' }) as any);
      mockPrisma.finding.update.mockResolvedValue(makeFinding({ status: 'resolved' }) as any);

      const result = await findingsService.updateFindingStatus('org-1', 'f-1', 'resolved');

      expect(mockPrisma.finding.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'resolved',
            resolvedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('clears resolved_at when reopening', async () => {
      mockPrisma.finding.findFirst.mockResolvedValue(makeFinding({ status: 'resolved' }) as any);
      mockPrisma.finding.update.mockResolvedValue(makeFinding({ status: 'open' }) as any);

      await findingsService.updateFindingStatus('org-1', 'f-1', 'open');

      expect(mockPrisma.finding.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'open',
            resolvedAt: null,
          }),
        }),
      );
    });

    it('throws RESOURCE_NOT_FOUND for missing finding', async () => {
      mockPrisma.finding.findFirst.mockResolvedValue(null);

      await expect(
        findingsService.updateFindingStatus('org-1', 'bad-id', 'resolved'),
      ).rejects.toThrow('not found');
    });
  });

  // --- Stats ---

  describe('getStats', () => {
    it('returns aggregated counts from ES', async () => {
      mockEsSearch.mockResolvedValue({
        body: {
          hits: { total: { value: 42 } },
          aggregations: {
            by_severity: { buckets: [{ key: 'high', doc_count: 20 }, { key: 'critical', doc_count: 10 }] },
            by_status: { buckets: [{ key: 'open', doc_count: 30 }] },
            by_source: { buckets: [{ key: 'code_scanner', doc_count: 42 }] },
          },
        },
      });

      const stats = await findingsService.getStats('org-1');

      expect(stats.total).toBe(42);
      expect(stats.by_severity).toEqual({ high: 20, critical: 10 });
      expect(stats.by_status).toEqual({ open: 30 });
      expect(stats.by_source).toEqual({ code_scanner: 42 });
    });
  });

  // --- Trends ---

  describe('getTrends', () => {
    it('returns time-series data from ES', async () => {
      mockEsSearch.mockResolvedValue({
        body: {
          hits: { total: { value: 10 } },
          aggregations: {
            new_findings: {
              buckets: [
                { key_as_string: '2024-01-01', doc_count: 5 },
                { key_as_string: '2024-01-02', doc_count: 3 },
              ],
            },
            resolved_findings: {
              over_time: {
                buckets: [
                  { key_as_string: '2024-01-01', doc_count: 2 },
                ],
              },
            },
          },
        },
      });

      const trends = await findingsService.getTrends('org-1', { interval: 'day', days: 30 });

      expect(trends.interval).toBe('day');
      expect(trends.new_findings).toHaveLength(2);
      expect(trends.new_findings[0]).toEqual({ date: '2024-01-01', count: 5 });
      expect(trends.resolved_findings).toHaveLength(1);
    });
  });
});
