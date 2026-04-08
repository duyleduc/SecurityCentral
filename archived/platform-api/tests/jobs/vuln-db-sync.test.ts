import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    vulnerability: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    vulnerabilityAffects: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock('ioredis', () => ({
  default: vi.fn(() => ({
    ping: vi.fn().mockResolvedValue('PONG'),
    status: 'ready',
    options: { maxRetriesPerRequest: null },
    hget: vi.fn().mockResolvedValue(null),
    hset: vi.fn().mockResolvedValue(1),
    set: vi.fn().mockResolvedValue('OK'),
    get: vi.fn().mockResolvedValue(null),
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

const mockPrisma = vi.mocked(prisma);

// We test the deduplication logic by importing upsert indirectly through the processor
// Since the actual NVD/GitHub/OSV fetches require network, we test the deduplication logic

describe('VulnDB Sync — Deduplication Logic', () => {
  beforeEach(() => vi.clearAllMocks());

  it('NVD source updates CVSS on existing vulnerability', async () => {
    // This tests the deduplication preference: NVD wins for CVSS
    mockPrisma.vulnerability.findUnique.mockResolvedValue({
      id: 'CVE-2024-1234',
      title: 'Old title',
      cvssScore: 5.0,
      references: ['https://old.ref'],
    } as any);
    mockPrisma.vulnerability.update.mockResolvedValue({} as any);

    // Import the module to test internal upsert behavior
    // We'll test through processVulnDbSync by mocking fetch
    const { processVulnDbSync } = await import('../../src/jobs/vuln-db-sync.js');

    // Mock global fetch for NVD
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          totalResults: 1,
          resultsPerPage: 100,
          startIndex: 0,
          vulnerabilities: [{
            cve: {
              id: 'CVE-2024-1234',
              descriptions: [{ lang: 'en', value: 'Updated description' }],
              metrics: {
                cvssMetricV31: [{ cvssData: { baseScore: 9.8, vectorString: 'CVSS:3.1/AV:N', baseSeverity: 'CRITICAL' } }],
              },
              published: '2024-01-01T00:00:00Z',
              lastModified: '2024-06-01T00:00:00Z',
              references: [{ url: 'https://nvd.nist.gov/vuln/detail/CVE-2024-1234' }],
            },
          }],
        }),
      } as any)
      // GitHub returns empty (no token)
      // OSV returns empty
      .mockResolvedValue({ ok: false } as any);

    vi.stubGlobal('fetch', mockFetch);

    const mockJob = { queueName: 'vulndb-sync', id: 'j1', data: {} } as any;
    await processVulnDbSync(mockJob);

    // Should have called update with NVD CVSS data
    expect(mockPrisma.vulnerability.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'CVE-2024-1234' },
        data: expect.objectContaining({
          cvssScore: 9.8,
        }),
      }),
    );

    vi.unstubAllGlobals();
  });

  it('creates new vulnerability when not existing', async () => {
    mockPrisma.vulnerability.findUnique.mockResolvedValue(null);
    mockPrisma.vulnerability.create.mockResolvedValue({} as any);

    const { processVulnDbSync } = await import('../../src/jobs/vuln-db-sync.js');

    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        totalResults: 1,
        resultsPerPage: 100,
        startIndex: 0,
        vulnerabilities: [{
          cve: {
            id: 'CVE-2024-9999',
            descriptions: [{ lang: 'en', value: 'New vuln' }],
            metrics: {},
            references: [],
          },
        }],
      }),
    } as any).mockResolvedValue({ ok: false } as any);

    vi.stubGlobal('fetch', mockFetch);

    const mockJob = { queueName: 'vulndb-sync', id: 'j2', data: {} } as any;
    await processVulnDbSync(mockJob);

    expect(mockPrisma.vulnerability.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ id: 'CVE-2024-9999' }),
      }),
    );

    vi.unstubAllGlobals();
  });
});
