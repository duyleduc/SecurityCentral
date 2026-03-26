import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    integration: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
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
import {
  criticalFindingMessage,
  scanCompletedMessage,
  certExpiryMessage,
  agentOfflineMessage,
  sendSlackMessage,
  notifyOrg,
} from '../../src/lib/slack.js';
import * as integrationsService from '../../src/modules/integrations/integrations.service.js';

const mockPrisma = vi.mocked(prisma);

describe('Slack Message Templates', () => {
  it('criticalFindingMessage has header and fields', () => {
    const blocks = criticalFindingMessage({
      cveId: 'CVE-2024-1234',
      severity: 'critical',
      title: 'RCE in lodash',
      packageName: 'lodash',
      asset: 'my-app',
      cvssScore: 9.8,
      dashboardUrl: 'https://app.securitycentral.io/findings/f1',
    });

    expect(blocks.length).toBeGreaterThanOrEqual(4);
    expect(blocks[0].type).toBe('header');
    expect(blocks[0].text?.text).toContain('CRITICAL');
    // Should have fields block
    const fieldsBlock = blocks.find((b) => b.fields);
    expect(fieldsBlock?.fields?.length).toBe(4);
    // Should have action button
    const actionsBlock = blocks.find((b) => b.type === 'actions');
    expect(actionsBlock?.elements?.[0].text?.text).toBe('View Finding');
  });

  it('scanCompletedMessage formats correctly', () => {
    const blocks = scanCompletedMessage({
      scanType: 'code_dependencies',
      asset: 'acme/app',
      total: 15,
      newFindings: 3,
      resolved: 2,
      duration: '12s',
      dashboardUrl: 'https://app.securitycentral.io/scans/s1',
    });

    expect(blocks[0].text?.text).toContain('Scan Completed');
    const fieldsBlock = blocks.find((b) => b.fields);
    expect(fieldsBlock?.fields?.some((f) => f.text.includes('15'))).toBe(true);
  });

  it('certExpiryMessage uses correct emoji by days', () => {
    const blocksUrgent = certExpiryMessage({
      subjectCn: '*.example.com',
      daysRemaining: 5,
      notAfter: '2024-06-01',
      dashboardUrl: 'https://app.securitycentral.io/certs/c1',
    });
    expect(blocksUrgent[0].text?.text).toContain('🔴');

    const blocksWarning = certExpiryMessage({
      subjectCn: '*.example.com',
      daysRemaining: 20,
      notAfter: '2024-07-01',
      dashboardUrl: 'https://app.securitycentral.io/certs/c1',
    });
    expect(blocksWarning[0].text?.text).toContain('🟠');

    const blocksNotice = certExpiryMessage({
      subjectCn: '*.example.com',
      daysRemaining: 60,
      notAfter: '2024-09-01',
      dashboardUrl: 'https://app.securitycentral.io/certs/c1',
    });
    expect(blocksNotice[0].text?.text).toContain('🟡');
  });

  it('agentOfflineMessage includes hostname and last seen', () => {
    const blocks = agentOfflineMessage({
      hostname: 'web-01',
      lastSeen: '2024-06-01T10:00:00Z',
      dashboardUrl: 'https://app.securitycentral.io/servers/s1',
    });

    expect(blocks[0].text?.text).toContain('Agent Offline');
    const fieldsBlock = blocks.find((b) => b.fields);
    expect(fieldsBlock?.fields?.some((f) => f.text.includes('web-01'))).toBe(true);
  });
});

describe('Slack Webhook Sender', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sendSlackMessage posts to webhook URL', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    const result = await sendSlackMessage(
      'https://hooks.slack.com/services/T00/B00/xxx',
      [{ type: 'section', text: { type: 'mrkdwn', text: 'test' } }],
      'Test message',
    );

    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://hooks.slack.com/services/T00/B00/xxx',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    vi.unstubAllGlobals();
  });

  it('sendSlackMessage returns false on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, text: () => 'bad' }));

    const result = await sendSlackMessage('https://hooks.slack.com/bad', [], 'test');
    expect(result).toBe(false);

    vi.unstubAllGlobals();
  });

  it('notifyOrg sends to all active slack integrations', async () => {
    mockPrisma.integration.findMany.mockResolvedValue([
      { id: 'i1', config: { webhook_url: 'https://hooks.slack.com/1' } },
      { id: 'i2', config: { webhook_url: 'https://hooks.slack.com/2' } },
    ] as any);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

    const sent = await notifyOrg('org-1', [], 'test');
    expect(sent).toBe(2);

    vi.unstubAllGlobals();
  });
});

describe('Slack Integration Service', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates Slack integration with webhook URL', async () => {
    mockPrisma.integration.findFirst.mockResolvedValue(null);
    mockPrisma.integration.create.mockResolvedValue({
      id: 'int-sl',
      provider: 'slack',
      status: 'active',
    } as any);

    const result = await integrationsService.createSlackIntegration(
      'org-1',
      'https://hooks.slack.com/services/T00/B00/xxx',
    );

    expect(result.provider).toBe('slack');
  });

  it('rejects duplicate Slack integration', async () => {
    mockPrisma.integration.findFirst.mockResolvedValue({ id: 'existing' } as any);

    await expect(
      integrationsService.createSlackIntegration('org-1', 'https://hooks.slack.com/x'),
    ).rejects.toThrow('already exists');
  });
});
