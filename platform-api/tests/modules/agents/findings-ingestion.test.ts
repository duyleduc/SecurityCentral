import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../src/lib/prisma.js', () => ({
  prisma: {
    server: { findFirst: vi.fn() },
    scan: { create: vi.fn(), update: vi.fn() },
    finding: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
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
import { ingestFindings } from '../../../src/modules/agents/findings-ingestion.service.js';
import type { SubmitFindingsInput } from '../../../src/modules/agents/agents.validation.js';

const mockPrisma = vi.mocked(prisma);

const baseBatch: SubmitFindingsInput = {
  agent_id: 'agent-1',
  scan_type: 'infra_packages',
  started_at: '2024-06-01T10:00:00Z',
  completed_at: '2024-06-01T10:00:12Z',
  findings: [
    {
      type: 'package_vulnerability',
      severity: 'high',
      title: 'OpenSSL vuln',
      cve_id: 'CVE-2024-1234',
      cvss_score: 8.1,
      detail: { package_name: 'openssl' },
      auto_fixable: false,
    },
    {
      type: 'package_vulnerability',
      severity: 'critical',
      title: 'libcurl RCE',
      cve_id: 'CVE-2024-5678',
      cvss_score: 9.8,
      detail: { package_name: 'libcurl' },
      auto_fixable: false,
    },
  ],
};

describe('Findings Ingestion Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock: server exists
    mockPrisma.server.findFirst.mockResolvedValue({ id: 'server-1' } as any);

    // Scan creation
    (mockPrisma.scan.create as any).mockResolvedValue({
      id: 'scan-new',
      findingsTotal: 2,
    });
    (mockPrisma.scan.update as any).mockResolvedValue({});

    // Finding defaults: no existing findings (all new)
    mockPrisma.finding.findFirst.mockResolvedValue(null);
    mockPrisma.finding.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ id: `f-${Math.random().toString(36).slice(2)}`, ...data }),
    );
    mockPrisma.finding.update.mockResolvedValue({} as any);
    mockPrisma.finding.updateMany.mockResolvedValue({ count: 0 } as any);
  });

  it('creates scan record and new findings', async () => {
    const result = await ingestFindings('org-1', baseBatch);

    expect(result.scanId).toBe('scan-new');
    expect(result.findingsCreated).toBe(2);
    expect(result.findingsUpdated).toBe(0);
    expect(mockPrisma.scan.create).toHaveBeenCalled();
    expect(mockPrisma.finding.create).toHaveBeenCalledTimes(2);
  });

  it('deduplicates by CVE+asset — updates existing finding instead of creating', async () => {
    // First finding matches existing
    mockPrisma.finding.findFirst
      .mockResolvedValueOnce({ id: 'existing-f1' } as any) // CVE-2024-1234 exists
      .mockResolvedValueOnce(null); // CVE-2024-5678 is new

    const result = await ingestFindings('org-1', baseBatch);

    expect(result.findingsCreated).toBe(1);
    expect(result.findingsUpdated).toBe(1);
    expect(mockPrisma.finding.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'existing-f1' },
      }),
    );
  });

  it('auto-resolves stale findings not in the new batch', async () => {
    mockPrisma.finding.updateMany.mockResolvedValue({ count: 3 } as any);

    const result = await ingestFindings('org-1', baseBatch);

    expect(result.findingsResolved).toBe(3);
    expect(mockPrisma.finding.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'resolved',
          resolvedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('does not auto-resolve when no server (code scanner)', async () => {
    mockPrisma.server.findFirst.mockResolvedValue(null);

    const result = await ingestFindings('org-1', {
      ...baseBatch,
      scan_type: 'code_dependencies',
    });

    expect(result.findingsResolved).toBe(0);
    expect(mockPrisma.finding.updateMany).not.toHaveBeenCalled();
  });

  it('updates scan findingsNew and findingsResolved counts', async () => {
    mockPrisma.finding.updateMany.mockResolvedValue({ count: 1 } as any);

    await ingestFindings('org-1', baseBatch);

    expect(mockPrisma.scan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          findingsNew: 2,
          findingsResolved: 1,
        }),
      }),
    );
  });

  it('handles empty findings array', async () => {
    const result = await ingestFindings('org-1', {
      ...baseBatch,
      findings: [],
    });

    expect(result.findingsCreated).toBe(0);
    expect(result.findingsUpdated).toBe(0);
    expect(mockPrisma.finding.create).not.toHaveBeenCalled();
  });

  it('deduplicates by title+asset for non-CVE findings', async () => {
    const noCveBatch: SubmitFindingsInput = {
      ...baseBatch,
      findings: [
        {
          type: 'secret',
          severity: 'high',
          title: 'AWS key exposed in config',
          detail: { file: '/etc/config.yml' },
          auto_fixable: false,
        },
      ],
    };

    // Existing finding matches by title
    mockPrisma.finding.findFirst.mockResolvedValueOnce({ id: 'existing-secret' } as any);

    const result = await ingestFindings('org-1', noCveBatch);

    expect(result.findingsUpdated).toBe(1);
    expect(result.findingsCreated).toBe(0);
  });
});
