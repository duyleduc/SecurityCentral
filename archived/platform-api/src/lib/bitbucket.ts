import { logger } from './logger.js';

const log = logger.child({ component: 'bitbucket' });

const CLOUD_BASE = 'https://api.bitbucket.org/2.0';

export interface BitbucketRepo {
  readonly uuid: string;
  readonly slug: string;
  readonly full_name: string;
  readonly name: string;
  readonly mainbranch?: { name: string };
  readonly language: string;
  readonly is_private: boolean;
  readonly updated_on: string;
}

export interface BitbucketClientOptions {
  readonly username: string;
  readonly appPassword: string;
  readonly workspace: string;
  readonly baseUrl?: string; // for Bitbucket Server
}

export class BitbucketClient {
  private readonly auth: string;
  private readonly workspace: string;
  private readonly baseUrl: string;
  private readonly isServer: boolean;

  constructor(options: BitbucketClientOptions) {
    this.auth = Buffer.from(`${options.username}:${options.appPassword}`).toString('base64');
    this.workspace = options.workspace;
    this.isServer = !!options.baseUrl;
    this.baseUrl = options.baseUrl?.replace(/\/+$/, '') ?? CLOUD_BASE;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = this.isServer ? `${this.baseUrl}/rest/api/1.0${path}` : `${this.baseUrl}${path}`;

    const resp = await fetch(url, {
      method,
      headers: {
        Authorization: `Basic ${this.auth}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Bitbucket API ${method} ${path}: ${resp.status} ${text}`);
    }

    return resp.json() as Promise<T>;
  }

  /**
   * List repositories for the workspace.
   */
  async listRepositories(): Promise<BitbucketRepo[]> {
    if (this.isServer) {
      const data = await this.request<{ values: any[] }>('GET', `/projects/${this.workspace}/repos?limit=100`);
      return data.values.map((r) => ({
        uuid: r.id?.toString() ?? r.slug,
        slug: r.slug,
        full_name: `${this.workspace}/${r.slug}`,
        name: r.name ?? r.slug,
        mainbranch: r.defaultBranch ? { name: r.defaultBranch } : undefined,
        language: '',
        is_private: !r.public,
        updated_on: '',
      }));
    }

    // Cloud API — paginated
    const allRepos: BitbucketRepo[] = [];
    let url: string | null = `/repositories/${this.workspace}?pagelen=100`;

    while (url) {
      const data = await this.request<{ values: BitbucketRepo[]; next?: string }>('GET', url);
      allRepos.push(...data.values);
      url = data.next ? data.next.replace(this.baseUrl, '') : null;
    }

    return allRepos;
  }

  /**
   * Get a single repository.
   */
  async getRepository(slug: string): Promise<BitbucketRepo> {
    if (this.isServer) {
      const r = await this.request<any>('GET', `/projects/${this.workspace}/repos/${slug}`);
      return {
        uuid: r.id?.toString() ?? r.slug,
        slug: r.slug,
        full_name: `${this.workspace}/${r.slug}`,
        name: r.name ?? r.slug,
        mainbranch: r.defaultBranch ? { name: r.defaultBranch } : undefined,
        language: '',
        is_private: !r.public,
        updated_on: '',
      };
    }
    return this.request<BitbucketRepo>('GET', `/repositories/${this.workspace}/${slug}`);
  }

  /**
   * Create a webhook.
   */
  async createWebhook(slug: string, url: string): Promise<{ uuid: string }> {
    if (this.isServer) {
      return this.request('POST', `/projects/${this.workspace}/repos/${slug}/webhooks`, {
        name: 'SecurityCentral', url, events: ['repo:refs_changed'], active: true,
      });
    }
    return this.request('POST', `/repositories/${this.workspace}/${slug}/hooks`, {
      description: 'SecurityCentral', url, events: ['repo:push'], active: true,
    });
  }

  /**
   * Delete a webhook.
   */
  async deleteWebhook(slug: string, hookId: string): Promise<void> {
    if (this.isServer) {
      await this.request('DELETE', `/projects/${this.workspace}/repos/${slug}/webhooks/${hookId}`);
    } else {
      await this.request('DELETE', `/repositories/${this.workspace}/${slug}/hooks/${hookId}`);
    }
  }
}
