import https from 'node:https';
import http from 'node:http';
import { URL } from 'node:url';

import { logger } from './logger.js';

const log = logger.child({ component: 'gitlab' });

const DEFAULT_BASE_URL = 'https://gitlab.com';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitLabProject {
  readonly id: number;
  readonly path_with_namespace: string;
  readonly name: string;
  readonly namespace: { readonly full_path: string };
  readonly default_branch: string;
  readonly visibility: string;
  readonly last_activity_at: string;
  readonly topics: readonly string[];
  readonly web_url: string;
}

export interface GitLabClientOptions {
  readonly accessToken: string;
  readonly baseUrl?: string;
  /** Set to false for self-hosted instances with self-signed certificates. Default: true. */
  readonly verifySsl?: boolean;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class GitLabClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly rejectUnauthorized: boolean;

  constructor(options: GitLabClientOptions) {
    this.token = options.accessToken;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.rejectUnauthorized = options.verifySsl !== false;

    if (!this.rejectUnauthorized) {
      log.warn('SSL verification disabled for GitLab connection', { baseUrl: this.baseUrl });
    }
  }

  // -------------------------------------------------------------------------
  // HTTP layer — uses node:https for proper self-signed cert support
  // -------------------------------------------------------------------------

  private httpRequest<T>(method: string, fullUrl: string, body?: unknown): Promise<{ data: T; headers: Record<string, string | undefined> }> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(fullUrl);
      const isHttps = parsed.protocol === 'https:';

      const options: https.RequestOptions = {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method,
        headers: {
          'PRIVATE-TOKEN': this.token,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        rejectUnauthorized: this.rejectUnauthorized,
      };

      const transport = isHttps ? https : http;
      const req = transport.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');
          if (!res.statusCode || res.statusCode >= 400) {
            reject(new Error(`GitLab API ${method} ${parsed.pathname}: ${res.statusCode} ${raw.slice(0, 200)}`));
            return;
          }
          try {
            const data = JSON.parse(raw) as T;
            const headers: Record<string, string | undefined> = {
              'x-next-page': res.headers['x-next-page'] as string | undefined,
              'x-total': res.headers['x-total'] as string | undefined,
            };
            resolve({ data, headers });
          } catch {
            reject(new Error(`GitLab API: invalid JSON response from ${parsed.pathname}`));
          }
        });
      });

      req.on('error', (err) => {
        if ((err as NodeJS.ErrnoException).code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
          reject(new Error(`SSL verification failed for ${this.baseUrl}. Set verifySsl: false for self-signed certificates.`));
        } else {
          reject(err);
        }
      });

      req.setTimeout(15000, () => {
        req.destroy();
        reject(new Error(`GitLab API timeout: ${method} ${parsed.pathname}`));
      });

      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}/api/v4${path}`;
    const { data } = await this.httpRequest<T>(method, url, body);
    return data;
  }

  private async requestPage<T>(path: string): Promise<{ data: T; nextPage: string | null; total: number }> {
    const url = `${this.baseUrl}/api/v4${path}`;
    const { data, headers } = await this.httpRequest<T>('GET', url);
    const nextPage = headers['x-next-page'];
    const total = parseInt(headers['x-total'] ?? '0', 10);
    return { data, nextPage: nextPage && nextPage !== '' ? nextPage : null, total };
  }

  // -------------------------------------------------------------------------
  // Connection test
  // -------------------------------------------------------------------------

  /**
   * Test the connection by calling GET /api/v4/version.
   * Throws if the token is invalid or the server is unreachable.
   */
  async testConnection(): Promise<{ version: string; revision: string }> {
    return this.request<{ version: string; revision: string }>('GET', '/version');
  }

  // -------------------------------------------------------------------------
  // Projects
  // -------------------------------------------------------------------------

  async listProjects(query?: {
    search?: string;
    page?: number;
    per_page?: number;
    membership?: boolean;
  }): Promise<{ projects: GitLabProject[]; total: number }> {
    const params = new URLSearchParams();
    params.set('membership', String(query?.membership ?? true));
    params.set('per_page', String(query?.per_page ?? 50));
    params.set('order_by', 'last_activity_at');
    params.set('sort', 'desc');

    if (query?.search) params.set('search', query.search);
    if (query?.page) params.set('page', String(query.page));

    const { data, total } = await this.requestPage<GitLabProject[]>(`/projects?${params}`);
    return { projects: data, total };
  }

  async listAllProjects(): Promise<GitLabProject[]> {
    const allProjects: GitLabProject[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      const params = new URLSearchParams({
        membership: 'true',
        per_page: String(perPage),
        page: String(page),
        order_by: 'last_activity_at',
        sort: 'desc',
      });

      const { data, nextPage } = await this.requestPage<GitLabProject[]>(`/projects?${params}`);
      allProjects.push(...data);

      if (!nextPage || data.length < perPage) break;
      page = parseInt(nextPage, 10);
    }

    return allProjects;
  }

  async getProject(projectId: number): Promise<GitLabProject> {
    return this.request<GitLabProject>('GET', `/projects/${projectId}`);
  }

  // -------------------------------------------------------------------------
  // Webhooks
  // -------------------------------------------------------------------------

  async createWebhook(
    projectId: number,
    url: string,
    token: string,
    events?: { push?: boolean; merge_requests?: boolean },
  ): Promise<{ id: number; url: string }> {
    return this.request('POST', `/projects/${projectId}/hooks`, {
      url,
      token,
      push_events: events?.push ?? true,
      merge_requests_events: events?.merge_requests ?? false,
      // For self-hosted with self-signed certs, disable SSL verification on webhook too
      enable_ssl_verification: this.rejectUnauthorized,
    });
  }

  async deleteWebhook(projectId: number, hookId: number): Promise<void> {
    await this.request('DELETE', `/projects/${projectId}/hooks/${hookId}`);
  }

  async listWebhooks(projectId: number): Promise<Array<{ id: number; url: string }>> {
    return this.request('GET', `/projects/${projectId}/hooks`);
  }
}
