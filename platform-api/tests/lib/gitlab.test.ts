import { describe, it, expect, vi, beforeEach } from 'vitest';

import { GitLabClient, type GitLabProject } from '../../src/lib/gitlab.js';

const mockProject: GitLabProject = {
  id: 1,
  path_with_namespace: 'acme/web-app',
  name: 'web-app',
  namespace: { full_path: 'acme' },
  default_branch: 'main',
  visibility: 'private',
  last_activity_at: '2024-06-01T10:00:00Z',
  topics: ['typescript'],
  web_url: 'https://gitlab.com/acme/web-app',
};

describe('GitLabClient', () => {
  beforeEach(() => vi.restoreAllMocks());

  describe('constructor', () => {
    it('uses default base URL when none provided', () => {
      const client = new GitLabClient({ accessToken: 'glpat-xxx' });
      // No error thrown = success
      expect(client).toBeDefined();
    });

    it('accepts custom base URL for self-hosted', () => {
      const client = new GitLabClient({
        accessToken: 'glpat-xxx',
        baseUrl: 'https://gitlab.internal.corp.com',
      });
      expect(client).toBeDefined();
    });

    it('strips trailing slash from base URL', () => {
      const client = new GitLabClient({
        accessToken: 'glpat-xxx',
        baseUrl: 'https://gitlab.corp.com/',
      });
      expect(client).toBeDefined();
    });
  });

  describe('listProjects', () => {
    it('returns projects with pagination info', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({
          'x-next-page': '2',
          'x-total': '42',
        }),
        json: () => Promise.resolve([mockProject]),
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new GitLabClient({ accessToken: 'glpat-xxx' });
      const result = await client.listProjects({ page: 1, per_page: 50 });

      expect(result.projects).toHaveLength(1);
      expect(result.projects[0].path_with_namespace).toBe('acme/web-app');
      expect(result.total).toBe(42);

      // Verify API call
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('https://gitlab.com/api/v4/projects'),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({ 'PRIVATE-TOKEN': 'glpat-xxx' }),
        }),
      );

      vi.unstubAllGlobals();
    });

    it('uses custom base URL for self-hosted instances', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'x-total': '1' }),
        json: () => Promise.resolve([mockProject]),
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new GitLabClient({
        accessToken: 'glpat-xxx',
        baseUrl: 'https://gitlab.internal.corp.com',
      });
      await client.listProjects();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('https://gitlab.internal.corp.com/api/v4/projects'),
        expect.any(Object),
      );

      vi.unstubAllGlobals();
    });

    it('passes search parameter', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'x-total': '0' }),
        json: () => Promise.resolve([]),
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new GitLabClient({ accessToken: 'glpat-xxx' });
      await client.listProjects({ search: 'web-app' });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('search=web-app');

      vi.unstubAllGlobals();
    });
  });

  describe('listAllProjects', () => {
    it('fetches multiple pages until exhausted', async () => {
      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          ok: true,
          headers: new Headers({
            'x-next-page': callCount < 3 ? String(callCount + 1) : '',
            'x-total': '150',
          }),
          json: () => Promise.resolve(
            Array.from({ length: callCount < 3 ? 100 : 50 }, (_, i) => ({
              ...mockProject,
              id: (callCount - 1) * 100 + i,
            })),
          ),
        });
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new GitLabClient({ accessToken: 'glpat-xxx' });
      const projects = await client.listAllProjects();

      expect(projects.length).toBe(250); // 100 + 100 + 50
      expect(mockFetch).toHaveBeenCalledTimes(3);

      vi.unstubAllGlobals();
    });
  });

  describe('getProject', () => {
    it('fetches a single project by ID', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockProject),
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new GitLabClient({ accessToken: 'glpat-xxx' });
      const project = await client.getProject(1);

      expect(project.id).toBe(1);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v4/projects/1'),
        expect.any(Object),
      );

      vi.unstubAllGlobals();
    });
  });

  describe('webhooks', () => {
    it('creates a webhook', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 99, url: 'https://api.sc.io/webhook' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new GitLabClient({ accessToken: 'glpat-xxx' });
      const result = await client.createWebhook(1, 'https://api.sc.io/webhook', 'secret-token');

      expect(result.id).toBe(99);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('/api/v4/projects/1/hooks');
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body);
      expect(body.url).toBe('https://api.sc.io/webhook');
      expect(body.push_events).toBe(true);

      vi.unstubAllGlobals();
    });

    it('deletes a webhook', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
      vi.stubGlobal('fetch', mockFetch);

      const client = new GitLabClient({ accessToken: 'glpat-xxx' });
      await client.deleteWebhook(1, 99);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v4/projects/1/hooks/99'),
        expect.objectContaining({ method: 'DELETE' }),
      );

      vi.unstubAllGlobals();
    });
  });

  describe('error handling', () => {
    it('throws on non-OK response', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      }));

      const client = new GitLabClient({ accessToken: 'bad-token' });
      await expect(client.listProjects()).rejects.toThrow('401');

      vi.unstubAllGlobals();
    });
  });
});
