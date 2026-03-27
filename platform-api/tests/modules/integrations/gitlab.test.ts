import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock GitLab client so testConnection doesn't make real HTTP calls
vi.mock('../../../src/lib/gitlab.js', () => ({
  GitLabClient: vi.fn().mockImplementation(() => ({
    testConnection: vi.fn().mockResolvedValue({ version: '16.9.0', revision: 'abc' }),
    listProjects: vi.fn().mockResolvedValue({ projects: [{ id: 201, path_with_namespace: 'acme/frontend', name: 'frontend', namespace: { full_path: 'acme' }, default_branch: 'main', visibility: 'private', last_activity_at: '2024-06-01T00:00:00Z', topics: [], web_url: '' }], total: 1 }),
    getProject: vi.fn().mockResolvedValue({ id: 201, path_with_namespace: 'acme/frontend', name: 'frontend', namespace: { full_path: 'acme' }, default_branch: 'main' }),
    createWebhook: vi.fn().mockResolvedValue({ id: 1, url: 'https://api.sc.io/webhook' }),
    listWebhooks: vi.fn().mockResolvedValue([]),
    deleteWebhook: vi.fn(),
  })),
}));

vi.mock('../../../src/lib/prisma.js', () => ({
  prisma: {
    integration: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    repository: {
      findFirst: vi.fn(),
    },
    scan: {
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

import { prisma } from '../../../src/lib/prisma.js';
import * as integrationsService from '../../../src/modules/integrations/integrations.service.js';

const mockPrisma = vi.mocked(prisma);

describe('GitLab Integration Service', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('createGitLabIntegration', () => {
    it('creates integration with access token', async () => {
      mockPrisma.integration.findFirst.mockResolvedValue(null);
      mockPrisma.integration.create.mockResolvedValue({
        id: 'int-gl',
        provider: 'gitlab',
        status: 'active',
      } as any);

      const result = await integrationsService.createGitLabIntegration('org-1', 'glpat-xxxx');

      expect(result.provider).toBe('gitlab');
      expect(mockPrisma.integration.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            provider: 'gitlab',
            config: expect.objectContaining({ access_token: 'glpat-xxxx', webhook_secret: expect.any(String) }),
          }),
        }),
      );
    });

    it('throws INTEGRATION_ALREADY_EXISTS on duplicate', async () => {
      mockPrisma.integration.findFirst.mockResolvedValue({ id: 'existing' } as any);

      await expect(
        integrationsService.createGitLabIntegration('org-1', 'token'),
      ).rejects.toThrow('already exists');
    });
  });

  describe('handleGitLabPushEvent', () => {
    it('triggers scan for known repo on default branch', async () => {
      mockPrisma.repository.findFirst.mockResolvedValue({
        id: 'repo-gl',
        orgId: 'org-1',
        defaultBranch: 'main',
      } as any);
      mockPrisma.scan.findFirst.mockResolvedValue(null);
      mockPrisma.scan.create.mockResolvedValue({ id: 'scan-gl' } as any);

      await integrationsService.handleGitLabPushEvent({
        project: { id: 42, path_with_namespace: 'acme/app', default_branch: 'main' },
        ref: 'refs/heads/main',
      });

      expect(mockPrisma.scan.create).toHaveBeenCalled();
    });

    it('ignores push to non-default branch', async () => {
      mockPrisma.repository.findFirst.mockResolvedValue({
        id: 'repo-gl',
        orgId: 'org-1',
        defaultBranch: 'main',
      } as any);

      await integrationsService.handleGitLabPushEvent({
        project: { id: 42, path_with_namespace: 'acme/app', default_branch: 'main' },
        ref: 'refs/heads/develop',
      });

      expect(mockPrisma.scan.create).not.toHaveBeenCalled();
    });

    it('ignores push for unknown repo', async () => {
      mockPrisma.repository.findFirst.mockResolvedValue(null);

      await integrationsService.handleGitLabPushEvent({
        project: { id: 999, path_with_namespace: 'unknown/repo', default_branch: 'main' },
        ref: 'refs/heads/main',
      });

      expect(mockPrisma.scan.create).not.toHaveBeenCalled();
    });

    it('skips if scan already active', async () => {
      mockPrisma.repository.findFirst.mockResolvedValue({
        id: 'repo-gl',
        orgId: 'org-1',
        defaultBranch: 'main',
      } as any);
      mockPrisma.scan.findFirst.mockResolvedValue({ id: 'active', status: 'running' } as any);

      await integrationsService.handleGitLabPushEvent({
        project: { id: 42, path_with_namespace: 'acme/app', default_branch: 'main' },
        ref: 'refs/heads/main',
      });

      expect(mockPrisma.scan.create).not.toHaveBeenCalled();
    });
  });
});
