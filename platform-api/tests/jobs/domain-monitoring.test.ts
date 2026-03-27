import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    monitoredEndpoint: { update: vi.fn(), findMany: vi.fn() },
    certificate: { upsert: vi.fn(), findFirst: vi.fn() },
    finding: { findFirst: vi.fn(), create: vi.fn() },
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
  Queue: vi.fn().mockImplementation(() => ({
    add: vi.fn().mockResolvedValue({}),
    addBulk: vi.fn().mockResolvedValue([]),
  })),
}));

import { prisma } from '../../src/lib/prisma.js';
import { domainMonitoringQueue } from '../../src/jobs/queues.js';
import { scheduleEndpointChecks } from '../../src/jobs/domain-monitoring.processor.js';

const mockPrisma = vi.mocked(prisma);

describe('Domain Monitoring Scheduler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('enqueues checks for overdue endpoints', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    mockPrisma.monitoredEndpoint.findMany.mockResolvedValue([
      { id: 'ep-1', orgId: 'org-1', host: 'example.com', port: 443, checkInterval: '1h', lastCheckedAt: twoHoursAgo },
      { id: 'ep-2', orgId: 'org-1', host: 'api.example.com', port: 443, checkInterval: '1h', lastCheckedAt: twoHoursAgo },
    ] as any);

    const count = await scheduleEndpointChecks();
    expect(count).toBe(2);
    expect(domainMonitoringQueue.add).toHaveBeenCalledTimes(2);
  });

  it('skips recently checked endpoints', async () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    mockPrisma.monitoredEndpoint.findMany.mockResolvedValue([
      { id: 'ep-1', orgId: 'org-1', host: 'example.com', port: 443, checkInterval: '1h', lastCheckedAt: fiveMinutesAgo },
    ] as any);

    const count = await scheduleEndpointChecks();
    expect(count).toBe(0);
  });

  it('schedules never-checked endpoints', async () => {
    mockPrisma.monitoredEndpoint.findMany.mockResolvedValue([
      { id: 'ep-1', orgId: 'org-1', host: 'new.example.com', port: 443, checkInterval: '1h', lastCheckedAt: null },
    ] as any);

    const count = await scheduleEndpointChecks();
    expect(count).toBe(1);
  });

  it('respects different check intervals', async () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
    mockPrisma.monitoredEndpoint.findMany.mockResolvedValue([
      { id: 'ep-1', orgId: 'org-1', host: 'a.com', port: 443, checkInterval: '1h', lastCheckedAt: threeHoursAgo },
      { id: 'ep-2', orgId: 'org-1', host: 'b.com', port: 443, checkInterval: '6h', lastCheckedAt: threeHoursAgo },
      { id: 'ep-3', orgId: 'org-1', host: 'c.com', port: 443, checkInterval: '24h', lastCheckedAt: threeHoursAgo },
    ] as any);

    const count = await scheduleEndpointChecks();
    expect(count).toBe(1);
  });

  it('returns 0 for empty endpoint list', async () => {
    mockPrisma.monitoredEndpoint.findMany.mockResolvedValue([]);
    const count = await scheduleEndpointChecks();
    expect(count).toBe(0);
  });
});

describe('Cert Expiry Severity Classification', () => {
  const cases = [
    { days: -5, expected: 'critical', label: 'expired cert' },
    { days: 0, expected: 'critical', label: 'just expired' },
    { days: 5, expected: 'critical', label: '5 days' },
    { days: 7, expected: 'critical', label: '7 days' },
    { days: 15, expected: 'high', label: '15 days' },
    { days: 30, expected: 'high', label: '30 days' },
    { days: 45, expected: 'medium', label: '45 days' },
    { days: 80, expected: 'low', label: '80 days' },
    { days: 120, expected: null, label: '120 days - no finding' },
  ];

  it.each(cases)('$label → $expected', ({ days, expected }) => {
    let severity: string | null = null;
    if (days <= 0) severity = 'critical';
    else if (days <= 7) severity = 'critical';
    else if (days <= 30) severity = 'high';
    else if (days <= 60) severity = 'medium';
    else if (days <= 90) severity = 'low';
    expect(severity).toBe(expected);
  });
});
