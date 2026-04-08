import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

// Track mock calls
const mockRequestCalls: any[] = [];
let responseQueue: Array<{ statusCode: number; headers: Record<string, string>; body: unknown }> = [];

// Mock node:https at module level
vi.mock('node:https', () => {
  return {
    default: {
      request: (opts: any, cb: any) => {
        mockRequestCalls.push(opts);
        const resp = responseQueue.shift() ?? { statusCode: 200, headers: {}, body: {} };

        const res = new EventEmitter() as any;
        res.statusCode = resp.statusCode;
        res.headers = resp.headers;

        process.nextTick(() => {
          cb(res);
          res.emit('data', Buffer.from(JSON.stringify(resp.body)));
          res.emit('end');
        });

        const req = new EventEmitter() as any;
        req.write = vi.fn();
        req.end = vi.fn();
        req.setTimeout = vi.fn();
        req.destroy = vi.fn();
        return req;
      },
    },
  };
});

vi.mock('node:http', () => ({
  default: { request: vi.fn() },
}));

import { GitLabClient, type GitLabProject } from '../../src/lib/gitlab.js';

const mockProject: GitLabProject = {
  id: 1, path_with_namespace: 'acme/web-app', name: 'web-app',
  namespace: { full_path: 'acme' }, default_branch: 'main', visibility: 'private',
  last_activity_at: '2024-06-01T10:00:00Z', topics: ['typescript'], web_url: 'https://gitlab.com/acme/web-app',
};

describe('GitLabClient', () => {
  beforeEach(() => {
    mockRequestCalls.length = 0;
    responseQueue = [];
  });

  describe('listProjects', () => {
    it('returns projects with pagination', async () => {
      responseQueue.push({ statusCode: 200, headers: { 'x-next-page': '2', 'x-total': '42' }, body: [mockProject] });
      const client = new GitLabClient({ accessToken: 'glpat-xxx' });
      const result = await client.listProjects({ page: 1, per_page: 50 });
      expect(result.projects).toHaveLength(1);
      expect(result.total).toBe(42);
    });

    it('uses custom base URL', async () => {
      responseQueue.push({ statusCode: 200, headers: { 'x-total': '1' }, body: [mockProject] });
      const client = new GitLabClient({ accessToken: 'glpat-xxx', baseUrl: 'https://gitlab.corp.com' });
      await client.listProjects();
      expect(mockRequestCalls[0].hostname).toBe('gitlab.corp.com');
    });

    it('passes search parameter', async () => {
      responseQueue.push({ statusCode: 200, headers: { 'x-total': '0' }, body: [] });
      const client = new GitLabClient({ accessToken: 'glpat-xxx' });
      await client.listProjects({ search: 'web-app' });
      expect(mockRequestCalls[0].path).toContain('search=web-app');
    });
  });

  describe('listAllProjects', () => {
    it('fetches multiple pages', async () => {
      responseQueue.push(
        { statusCode: 200, headers: { 'x-next-page': '2', 'x-total': '150' }, body: Array.from({ length: 100 }, (_, i) => ({ ...mockProject, id: i })) },
        { statusCode: 200, headers: { 'x-total': '150' }, body: Array.from({ length: 50 }, (_, i) => ({ ...mockProject, id: 100 + i })) },
      );
      const client = new GitLabClient({ accessToken: 'glpat-xxx' });
      const projects = await client.listAllProjects();
      expect(projects.length).toBe(150);
    });
  });

  describe('testConnection', () => {
    it('returns version', async () => {
      responseQueue.push({ statusCode: 200, headers: {}, body: { version: '16.9.0', revision: 'abc' } });
      const client = new GitLabClient({ accessToken: 'glpat-xxx' });
      const ver = await client.testConnection();
      expect(ver.version).toBe('16.9.0');
    });

    it('throws on invalid token', async () => {
      responseQueue.push({ statusCode: 401, headers: {}, body: { message: 'Unauthorized' } });
      const client = new GitLabClient({ accessToken: 'bad' });
      await expect(client.testConnection()).rejects.toThrow('401');
    });
  });

  describe('self-signed cert support', () => {
    it('sets rejectUnauthorized=false', async () => {
      responseQueue.push({ statusCode: 200, headers: {}, body: { version: '16.9.0' } });
      const client = new GitLabClient({ accessToken: 'glpat-xxx', baseUrl: 'https://gitlab.internal', verifySsl: false });
      await client.testConnection();
      expect(mockRequestCalls[0].rejectUnauthorized).toBe(false);
    });

    it('defaults to rejectUnauthorized=true', async () => {
      responseQueue.push({ statusCode: 200, headers: {}, body: { version: '16.9.0' } });
      const client = new GitLabClient({ accessToken: 'glpat-xxx' });
      await client.testConnection();
      expect(mockRequestCalls[0].rejectUnauthorized).toBe(true);
    });
  });

  describe('webhooks', () => {
    it('creates a webhook', async () => {
      responseQueue.push({ statusCode: 200, headers: {}, body: { id: 99, url: 'https://api.sc.io/webhook' } });
      const client = new GitLabClient({ accessToken: 'glpat-xxx' });
      const result = await client.createWebhook(1, 'https://api.sc.io/webhook', 'secret');
      expect(result.id).toBe(99);
    });

    it('deletes a webhook', async () => {
      responseQueue.push({ statusCode: 200, headers: {}, body: {} });
      const client = new GitLabClient({ accessToken: 'glpat-xxx' });
      await client.deleteWebhook(1, 99);
    });
  });

  it('throws on non-OK response', async () => {
    responseQueue.push({ statusCode: 403, headers: {}, body: { message: 'Forbidden' } });
    const client = new GitLabClient({ accessToken: 'bad' });
    await expect(client.listProjects()).rejects.toThrow('403');
  });
});
