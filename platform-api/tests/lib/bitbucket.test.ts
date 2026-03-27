import { describe, it, expect, vi, beforeEach } from 'vitest';

import { BitbucketClient } from '../../src/lib/bitbucket.js';

describe('BitbucketClient', () => {
  beforeEach(() => vi.restoreAllMocks());

  describe('Cloud API', () => {
    it('lists repositories with pagination', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            values: [{ uuid: '{abc}', slug: 'web-app', full_name: 'acme/web-app', name: 'web-app', mainbranch: { name: 'main' }, language: 'typescript', is_private: true, updated_on: '2024-06-01' }],
            next: undefined,
          }),
        });
      vi.stubGlobal('fetch', mockFetch);

      const client = new BitbucketClient({ username: 'user', appPassword: 'pass', workspace: 'acme' });
      const repos = await client.listRepositories();

      expect(repos).toHaveLength(1);
      expect(repos[0].full_name).toBe('acme/web-app');
      expect(mockFetch.mock.calls[0][0]).toContain('api.bitbucket.org/2.0/repositories/acme');
      expect(mockFetch.mock.calls[0][1].headers.Authorization).toMatch(/^Basic /);

      vi.unstubAllGlobals();
    });

    it('creates webhook on Cloud API', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ uuid: '{hook-1}' }) });
      vi.stubGlobal('fetch', mockFetch);

      const client = new BitbucketClient({ username: 'user', appPassword: 'pass', workspace: 'acme' });
      const result = await client.createWebhook('web-app', 'https://api.sc.io/webhook');

      expect(result.uuid).toBe('{hook-1}');
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.events).toContain('repo:push');

      vi.unstubAllGlobals();
    });
  });

  describe('Server API', () => {
    it('uses Server REST API path with custom baseUrl', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          values: [{ id: 1, slug: 'api', name: 'api', public: false }],
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new BitbucketClient({ username: 'user', appPassword: 'pass', workspace: 'PROJ', baseUrl: 'https://bitbucket.corp.com' });
      const repos = await client.listRepositories();

      expect(repos).toHaveLength(1);
      expect(repos[0].full_name).toBe('PROJ/api');
      expect(mockFetch.mock.calls[0][0]).toContain('bitbucket.corp.com/rest/api/1.0/projects/PROJ/repos');

      vi.unstubAllGlobals();
    });
  });

  it('throws on API error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, text: () => 'Forbidden' }));

    const client = new BitbucketClient({ username: 'user', appPassword: 'bad', workspace: 'acme' });
    await expect(client.listRepositories()).rejects.toThrow('403');

    vi.unstubAllGlobals();
  });
});
