import https from 'node:https';

import { logger } from './logger.js';

const log = logger.child({ component: 'gitlab' });

const DEFAULT_BASE_URL = 'https://gitlab.com';

// ---------------------------------------------------------------------------
// GitLab API Client
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
  readonly verifySsl?: boolean;
}

export class GitLabClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly agent: https.Agent | undefined;

  constructor(options: GitLabClientOptions) {
    this.token = options.accessToken;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');

    if (options.verifySsl === false) {
      this.agent = new https.Agent({ rejectUnauthorized: false });
    }
  }

  // -------------------------------------------------------------------------
  // Core request with pagination support
  // -------------------------------------------------------------------------

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}/api/v4${path}`;

    const init: RequestInit = {
      method,
      headers: {
        'PRIVATE-TOKEN': this.token,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    };

    // Pass custom agent for self-signed certs (Node 18+ fetch supports dispatcher)
    if (this.agent) {
      (init as any).dispatcher = this.agent;
    }

    const resp = await fetch(url, init);

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`GitLab API ${method} ${path}: ${resp.status} ${text}`);
    }

    return resp.json() as Promise<T>;
  }

  /**
   * Fetch a single page and return data + pagination info from headers.
   */
  private async requestPage<T>(path: string): Promise<{ data: T; nextPage: string | null; total: number }> {
    const url = `${this.baseUrl}/api/v4${path}`;

    const init: RequestInit = {
      method: 'GET',
      headers: {
        'PRIVATE-TOKEN': this.token,
      },
    };

    if (this.agent) {
      (init as any).dispatcher = this.agent;
    }

    const resp = await fetch(url, init);

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`GitLab API GET ${path}: ${resp.status} ${text}`);
    }

    const nextPage = resp.headers.get('x-next-page');
    const total = parseInt(resp.headers.get('x-total') ?? '0', 10);
    const data = (await resp.json()) as T;

    return { data, nextPage: nextPage && nextPage !== '' ? nextPage : null, total };
  }

  // -------------------------------------------------------------------------
  // Projects
  // -------------------------------------------------------------------------

  /**
   * List all accessible projects with pagination.
   * Follows `X-Next-Page` headers to fetch all pages.
   */
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

    const { data, nextPage, total } = await this.requestPage<GitLabProject[]>(
      `/projects?${params}`,
    );

    return { projects: data, total };
  }

  /**
   * Fetch ALL projects across all pages (for full sync).
   * Use with caution for large instances.
   */
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

      const { data, nextPage } = await this.requestPage<GitLabProject[]>(
        `/projects?${params}`,
      );

      allProjects.push(...data);

      if (!nextPage || data.length < perPage) break;
      page = parseInt(nextPage, 10);
    }

    return allProjects;
  }

  /**
   * Get a single project by ID.
   */
  async getProject(projectId: number): Promise<GitLabProject> {
    return this.request<GitLabProject>('GET', `/projects/${projectId}`);
  }

  // -------------------------------------------------------------------------
  // Webhooks
  // -------------------------------------------------------------------------

  /**
   * Create a webhook on a project.
   */
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
      enable_ssl_verification: true,
    });
  }

  /**
   * Delete a webhook from a project.
   */
  async deleteWebhook(projectId: number, hookId: number): Promise<void> {
    await this.request('DELETE', `/projects/${projectId}/hooks/${hookId}`);
  }

  /**
   * List webhooks for a project.
   */
  async listWebhooks(projectId: number): Promise<Array<{ id: number; url: string }>> {
    return this.request('GET', `/projects/${projectId}/hooks`);
  }
}
