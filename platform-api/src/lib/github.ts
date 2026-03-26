import crypto from 'node:crypto';

import { env } from './env.js';
import { logger } from './logger.js';

const log = logger.child({ component: 'github' });

const GITHUB_API = 'https://api.github.com';

// ---------------------------------------------------------------------------
// JWT for GitHub App authentication
// ---------------------------------------------------------------------------

function signAppJwt(): string {
  const appId = env.GITHUB_APP_ID;
  const privateKey = env.GITHUB_APP_PRIVATE_KEY;
  if (!appId || !privateKey) throw new Error('GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY required');

  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: appId, iat: now - 60, exp: now + 600 })).toString('base64url');

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const signature = sign.sign(privateKey, 'base64url');

  return `${header}.${payload}.${signature}`;
}

// ---------------------------------------------------------------------------
// Installation token
// ---------------------------------------------------------------------------

async function getInstallationToken(installationId: string): Promise<string> {
  const jwt = signAppJwt();
  const resp = await fetch(`${GITHUB_API}/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/vnd.github+json' },
  });

  if (!resp.ok) throw new Error(`GitHub installation token error: ${resp.status}`);
  const data = (await resp.json()) as { token: string };
  return data.token;
}

// ---------------------------------------------------------------------------
// GitHub API client
// ---------------------------------------------------------------------------

export class GitHubClient {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  static async forInstallation(installationId: string): Promise<GitHubClient> {
    const token = await getInstallationToken(installationId);
    return new GitHubClient(token);
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const resp = await fetch(`${GITHUB_API}${path}`, {
      method,
      headers: {
        Authorization: `token ${this.token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`GitHub API ${method} ${path}: ${resp.status} ${text}`);
    }

    return resp.json();
  }

  /** List all repositories accessible to this installation. */
  async listRepositories(): Promise<Array<{ id: number; full_name: string; name: string; owner: { login: string }; default_branch: string; language: string | null }>> {
    const data = (await this.request('GET', '/installation/repositories')) as { repositories: any[] };
    return data.repositories;
  }

  /** Get a reference (branch). */
  async getRef(owner: string, repo: string, ref: string): Promise<{ object: { sha: string } }> {
    return (await this.request('GET', `/repos/${owner}/${repo}/git/ref/heads/${ref}`)) as any;
  }

  /** Create a branch from a SHA. */
  async createBranch(owner: string, repo: string, branch: string, sha: string): Promise<void> {
    await this.request('POST', `/repos/${owner}/${repo}/git/refs`, {
      ref: `refs/heads/${branch}`,
      sha,
    });
  }

  /** Get file content (base64). */
  async getFileContent(owner: string, repo: string, path: string, ref: string): Promise<{ sha: string; content: string }> {
    return (await this.request('GET', `/repos/${owner}/${repo}/contents/${path}?ref=${ref}`)) as any;
  }

  /** Create or update a file. */
  async updateFile(owner: string, repo: string, path: string, content: string, message: string, sha: string, branch: string): Promise<void> {
    await this.request('PUT', `/repos/${owner}/${repo}/contents/${path}`, {
      message,
      content: Buffer.from(content).toString('base64'),
      sha,
      branch,
    });
  }

  /** Create a pull request. */
  async createPullRequest(owner: string, repo: string, title: string, body: string, head: string, base: string): Promise<{ html_url: string; number: number }> {
    return (await this.request('POST', `/repos/${owner}/${repo}/pulls`, {
      title,
      body,
      head,
      base,
    })) as any;
  }
}

// ---------------------------------------------------------------------------
// Webhook signature verification
// ---------------------------------------------------------------------------

export function verifyWebhookSignature(payload: string | Buffer, signature: string): boolean {
  const secret = env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return false;

  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
