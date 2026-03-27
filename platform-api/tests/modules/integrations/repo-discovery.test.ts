import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

import { signTokenPair } from '../../../src/lib/jwt.js';
import { errorHandler } from '../../../src/middleware/errors.js';

// Mock prisma
vi.mock('../../../src/lib/prisma.js', () => ({
  prisma: {
    integration: { findFirst: vi.fn() },
    repository: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
  },
}));

// Mock GitHub client
vi.mock('../../../src/lib/github.js', () => ({
  GitHubClient: {
    forInstallation: vi.fn().mockResolvedValue({
      listRepositories: vi.fn().mockResolvedValue([
        { id: 101, full_name: 'acme/web-app', name: 'web-app', owner: { login: 'acme' }, default_branch: 'main', language: 'TypeScript' },
        { id: 102, full_name: 'acme/api', name: 'api', owner: { login: 'acme' }, default_branch: 'main', language: 'Go' },
        { id: 103, full_name: 'acme/docs', name: 'docs', owner: { login: 'acme' }, default_branch: 'main', language: null },
      ]),
    }),
  },
  verifyWebhookSignature: vi.fn(),
  parseLinkHeaderNext: vi.fn(),
}));

// Mock GitLab client
vi.mock('../../../src/lib/gitlab.js', () => ({
  GitLabClient: vi.fn().mockImplementation(() => ({
    listProjects: vi.fn().mockResolvedValue({
      projects: [
        { id: 201, path_with_namespace: 'acme/frontend', name: 'frontend', namespace: { full_path: 'acme' }, default_branch: 'main', visibility: 'private', last_activity_at: '2024-06-01T00:00:00Z', topics: [], web_url: '' },
      ],
      total: 1,
    }),
    getProject: vi.fn().mockResolvedValue({
      id: 201, path_with_namespace: 'acme/frontend', name: 'frontend', namespace: { full_path: 'acme' }, default_branch: 'main', visibility: 'private', last_activity_at: '2024-06-01T00:00:00Z', topics: [], web_url: '',
    }),
    createWebhook: vi.fn().mockResolvedValue({ id: 1, url: 'https://api.sc.io/webhook' }),
    listWebhooks: vi.fn().mockResolvedValue([]),
    deleteWebhook: vi.fn(),
  })),
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
    name, add: vi.fn().mockResolvedValue({}), addBulk: vi.fn().mockResolvedValue([]),
  })),
}));

import { prisma } from '../../../src/lib/prisma.js';
import { integrationsRouter } from '../../../src/modules/integrations/integrations.router.js';
import { requestIdMiddleware } from '../../../src/middleware/request-id.js';

const mockPrisma = vi.mocked(prisma);

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(requestIdMiddleware);
  app.use('/api/v1/integrations', integrationsRouter);
  app.use(errorHandler);
  return app;
}

function auth(role = 'admin') {
  return `Bearer ${signTokenPair({ sub: 'u1', org: 'org-1', role }).accessToken}`;
}

describe('Repo Discovery — GitHub', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('GET /api/v1/integrations/github/repos', () => {
    it('returns repos with synced annotation', async () => {
      mockPrisma.integration.findFirst.mockResolvedValue({
        id: 'int-1', orgId: 'org-1', provider: 'github', status: 'active',
        config: { installation_id: '12345' },
      } as any);
      mockPrisma.repository.findMany.mockResolvedValue([
        { providerId: '101' },
      ] as any);

      const res = await request(createApp())
        .get('/api/v1/integrations/github/repos')
        .set('Authorization', auth());

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
      expect(res.body.data[0].synced).toBe(true);  // 101 is synced
      expect(res.body.data[1].synced).toBe(false); // 102 not synced
      expect(res.body.meta.total).toBe(3);
    });

    it('supports search filtering', async () => {
      mockPrisma.integration.findFirst.mockResolvedValue({
        id: 'int-1', config: { installation_id: '12345' },
      } as any);
      mockPrisma.repository.findMany.mockResolvedValue([]);

      const res = await request(createApp())
        .get('/api/v1/integrations/github/repos?search=web')
        .set('Authorization', auth());

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].full_name).toBe('acme/web-app');
    });

    it('returns 404 when no GitHub integration', async () => {
      mockPrisma.integration.findFirst.mockResolvedValue(null);

      const res = await request(createApp())
        .get('/api/v1/integrations/github/repos')
        .set('Authorization', auth());

      expect(res.status).toBe(404);
    });

    it('returns 401 without auth', async () => {
      const res = await request(createApp()).get('/api/v1/integrations/github/repos');
      expect(res.status).toBe(401);
    });

    it('returns 403 for member role', async () => {
      const res = await request(createApp())
        .get('/api/v1/integrations/github/repos')
        .set('Authorization', auth('member'));
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/v1/integrations/github/repos/sync', () => {
    it('syncs selected repos', async () => {
      mockPrisma.integration.findFirst.mockResolvedValue({
        id: 'int-1', config: { installation_id: '12345' },
      } as any);
      mockPrisma.repository.upsert.mockResolvedValue({} as any);

      const res = await request(createApp())
        .post('/api/v1/integrations/github/repos/sync')
        .set('Authorization', auth())
        .send({ repo_ids: ['101', '102'] });

      expect(res.status).toBe(201);
      expect(res.body.data.synced).toBe(2);
      expect(res.body.data.errors).toHaveLength(0);
    });

    it('reports errors for unknown repo IDs', async () => {
      mockPrisma.integration.findFirst.mockResolvedValue({
        id: 'int-1', config: { installation_id: '12345' },
      } as any);

      const res = await request(createApp())
        .post('/api/v1/integrations/github/repos/sync')
        .set('Authorization', auth())
        .send({ repo_ids: ['999'] });

      expect(res.status).toBe(201);
      expect(res.body.data.synced).toBe(0);
      expect(res.body.data.errors).toHaveLength(1);
    });

    it('rejects empty repo_ids', async () => {
      const res = await request(createApp())
        .post('/api/v1/integrations/github/repos/sync')
        .set('Authorization', auth())
        .send({ repo_ids: [] });

      expect(res.status).toBe(422);
    });
  });

  describe('DELETE /api/v1/integrations/github/repos/:id/sync', () => {
    it('unsyncs a repo (preserves data)', async () => {
      mockPrisma.repository.findFirst.mockResolvedValue({ id: 'repo-1', orgId: 'org-1' } as any);
      mockPrisma.repository.update.mockResolvedValue({} as any);

      const res = await request(createApp())
        .delete('/api/v1/integrations/github/repos/101/sync')
        .set('Authorization', auth());

      expect(res.status).toBe(204);
      expect(mockPrisma.repository.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { settings: expect.objectContaining({ archived: true }) },
        }),
      );
    });

    it('returns 404 for unknown repo', async () => {
      mockPrisma.repository.findFirst.mockResolvedValue(null);

      const res = await request(createApp())
        .delete('/api/v1/integrations/github/repos/999/sync')
        .set('Authorization', auth());

      expect(res.status).toBe(404);
    });
  });
});

describe('Repo Discovery — GitLab', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('GET /api/v1/integrations/gitlab/repos', () => {
    it('returns GitLab projects with synced annotation', async () => {
      mockPrisma.integration.findFirst.mockResolvedValue({
        id: 'int-2', orgId: 'org-1', provider: 'gitlab', status: 'active',
        config: { access_token: 'glpat-xxx' },
      } as any);
      mockPrisma.repository.findMany.mockResolvedValue([]);

      const res = await request(createApp())
        .get('/api/v1/integrations/gitlab/repos')
        .set('Authorization', auth());

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].full_name).toBe('acme/frontend');
      expect(res.body.data[0].synced).toBe(false);
    });
  });

  describe('POST /api/v1/integrations/gitlab/repos/sync', () => {
    it('syncs GitLab repos and creates webhooks', async () => {
      mockPrisma.integration.findFirst.mockResolvedValue({
        id: 'int-2', config: { access_token: 'glpat-xxx' },
      } as any);
      mockPrisma.repository.upsert.mockResolvedValue({} as any);

      const res = await request(createApp())
        .post('/api/v1/integrations/gitlab/repos/sync')
        .set('Authorization', auth())
        .send({ repo_ids: ['201'] });

      expect(res.status).toBe(201);
      expect(res.body.data.synced).toBe(1);
    });
  });

  describe('DELETE /api/v1/integrations/gitlab/repos/:id/sync', () => {
    it('unsyncs GitLab repo', async () => {
      mockPrisma.repository.findFirst.mockResolvedValue({ id: 'repo-2', orgId: 'org-1' } as any);
      mockPrisma.integration.findFirst.mockResolvedValue({
        id: 'int-2', config: { access_token: 'glpat-xxx' },
      } as any);
      mockPrisma.repository.update.mockResolvedValue({} as any);

      const res = await request(createApp())
        .delete('/api/v1/integrations/gitlab/repos/201/sync')
        .set('Authorization', auth());

      expect(res.status).toBe(204);
    });
  });
});
