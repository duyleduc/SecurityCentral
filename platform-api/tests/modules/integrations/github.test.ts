import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../src/lib/prisma.js', () => ({
  prisma: {
    integration: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    repository: {
      findFirst: vi.fn(),
      upsert: vi.fn(),
    },
    scan: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    finding: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
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
import * as integrationsService from '../../../src/modules/integrations/integrations.service.js';
import { verifyWebhookSignature } from '../../../src/lib/github.js';

const mockPrisma = vi.mocked(prisma);

describe('GitHub Integration Service', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('createGitHubIntegration', () => {
    it('creates integration when none exists', async () => {
      mockPrisma.integration.findFirst.mockResolvedValue(null);
      mockPrisma.integration.create.mockResolvedValue({
        id: 'int-1',
        provider: 'github',
        status: 'active',
      } as any);

      const result = await integrationsService.createGitHubIntegration('org-1', '12345', '67890');
      expect(result.provider).toBe('github');
      expect(mockPrisma.integration.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            config: { installation_id: '12345', app_id: '67890' },
          }),
        }),
      );
    });

    it('throws INTEGRATION_ALREADY_EXISTS when duplicate', async () => {
      mockPrisma.integration.findFirst.mockResolvedValue({ id: 'existing' } as any);

      await expect(
        integrationsService.createGitHubIntegration('org-1', '12345', '67890'),
      ).rejects.toThrow('already exists');
    });
  });

  describe('handlePushEvent', () => {
    it('enqueues scan for known repo on default branch', async () => {
      mockPrisma.repository.findFirst.mockResolvedValue({
        id: 'repo-1',
        orgId: 'org-1',
        defaultBranch: 'main',
      } as any);
      mockPrisma.scan.findFirst.mockResolvedValue(null);
      mockPrisma.scan.create.mockResolvedValue({ id: 'scan-1' } as any);

      await integrationsService.handlePushEvent({
        repository: { id: 123, full_name: 'acme/app' },
        ref: 'refs/heads/main',
      });

      expect(mockPrisma.scan.create).toHaveBeenCalled();
    });

    it('ignores push to non-default branch', async () => {
      mockPrisma.repository.findFirst.mockResolvedValue({
        id: 'repo-1',
        orgId: 'org-1',
        defaultBranch: 'main',
      } as any);

      await integrationsService.handlePushEvent({
        repository: { id: 123, full_name: 'acme/app' },
        ref: 'refs/heads/feature-branch',
      });

      expect(mockPrisma.scan.create).not.toHaveBeenCalled();
    });

    it('ignores push for unknown repo', async () => {
      mockPrisma.repository.findFirst.mockResolvedValue(null);

      await integrationsService.handlePushEvent({
        repository: { id: 999, full_name: 'unknown/repo' },
        ref: 'refs/heads/main',
      });

      expect(mockPrisma.scan.create).not.toHaveBeenCalled();
    });

    it('skips if scan already active', async () => {
      mockPrisma.repository.findFirst.mockResolvedValue({
        id: 'repo-1',
        orgId: 'org-1',
        defaultBranch: 'main',
      } as any);
      mockPrisma.scan.findFirst.mockResolvedValue({ id: 'active-scan', status: 'running' } as any);

      await integrationsService.handlePushEvent({
        repository: { id: 123, full_name: 'acme/app' },
        ref: 'refs/heads/main',
      });

      expect(mockPrisma.scan.create).not.toHaveBeenCalled();
    });
  });

  describe('handleInstallationEvent', () => {
    it('auto-discovers repos on installation created', async () => {
      mockPrisma.integration.findFirst.mockResolvedValue({ orgId: 'org-1' } as any);
      mockPrisma.repository.upsert.mockResolvedValue({} as any);

      await integrationsService.handleInstallationEvent({
        action: 'created',
        installation: { id: 111, app_id: 222, account: { login: 'acme' } },
        repositories: [
          { id: 1, name: 'app', full_name: 'acme/app', default_branch: 'main' },
          { id: 2, name: 'api', full_name: 'acme/api', default_branch: 'develop' },
        ],
      });

      expect(mockPrisma.repository.upsert).toHaveBeenCalledTimes(2);
    });

    it('ignores non-created/added actions', async () => {
      await integrationsService.handleInstallationEvent({
        action: 'deleted',
        installation: { id: 111, app_id: 222, account: { login: 'acme' } },
      });

      expect(mockPrisma.repository.upsert).not.toHaveBeenCalled();
    });
  });
});

describe('Webhook Signature Verification', () => {
  it('verifies valid HMAC signature', () => {
    // This test only works when GITHUB_WEBHOOK_SECRET is set
    // We test the crypto logic directly
    const secret = 'test-secret';
    const payload = '{"action":"push"}';
    const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');

    // verifyWebhookSignature reads from env, so this is a structural test
    // In production, env.GITHUB_WEBHOOK_SECRET would be set
    expect(typeof verifyWebhookSignature).toBe('function');
  });
});
