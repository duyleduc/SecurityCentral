import crypto from 'node:crypto';

import jwt from 'jsonwebtoken';

import { AppError } from '../middleware/errors.js';
import { logger } from './logger.js';

const DEFAULT_BASE_URL = 'https://api.github.com';
const DEFAULT_PER_PAGE = 30;

export interface GitHubRepo {
  readonly id: number;
  readonly name: string;
  readonly fullName: string;
  readonly owner: string;
  readonly defaultBranch: string;
  readonly language: string | null;
  readonly cloneUrl: string;
  readonly private: boolean;
}

interface InstallationTokenResponse {
  readonly token: string;
  readonly expires_at: string;
}

interface GitHubRepoResponse {
  readonly id: number;
  readonly name: string;
  readonly full_name: string;
  readonly owner: { readonly login: string };
  readonly default_branch: string;
  readonly language: string | null;
  readonly clone_url: string;
  readonly private: boolean;
}

interface ListReposResponse {
  readonly total_count: number;
  readonly repositories: readonly GitHubRepoResponse[];
}

function buildApiUrl(baseUrl: string | undefined): string {
  if (!baseUrl) return DEFAULT_BASE_URL;
  // GitHub Enterprise Server uses /api/v3 path
  return `${baseUrl.replace(/\/+$/, '')}/api/v3`;
}

function buildHostFromUrl(baseUrl: string | undefined): string {
  if (!baseUrl) return 'github.com';
  try {
    return new URL(baseUrl).host;
  } catch {
    return 'github.com';
  }
}

/**
 * Generate a JWT for GitHub App authentication.
 * Uses RS256 with the app's private key.
 */
export function generateAppJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: appId,
    iat: now - 60,
    exp: now + 600,
  };

  return jwt.sign(payload, privateKey, { algorithm: 'RS256' });
}

/**
 * Exchange an installation token using the App JWT.
 * POST /app/installations/{installationId}/access_tokens
 */
export async function getInstallationToken(
  installationId: string,
  appId: string,
  privateKey: string,
  baseUrl?: string,
): Promise<{ readonly token: string; readonly expiresAt: Date }> {
  const apiUrl = buildApiUrl(baseUrl);
  const appJwt = generateAppJwt(appId, privateKey);

  const url = `${apiUrl}/app/installations/${installationId}/access_tokens`;
  logger.debug('Requesting installation token', { installationId, url });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${appJwt}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    logger.error('Failed to get installation token', {
      status: response.status,
      body,
      installationId,
    });
    throw new AppError(
      'AUTH_INVALID_CREDENTIALS',
      `GitHub App installation token request failed: ${response.status}`,
      { status: response.status, body },
    );
  }

  const data = (await response.json()) as InstallationTokenResponse;

  return {
    token: data.token,
    expiresAt: new Date(data.expires_at),
  };
}

/**
 * List repositories accessible to the installation (paginated).
 * GET /installation/repositories
 */
export async function listInstallationRepos(
  token: string,
  page: number = 1,
  perPage: number = DEFAULT_PER_PAGE,
  baseUrl?: string,
): Promise<{ readonly repos: readonly GitHubRepo[]; readonly totalCount: number }> {
  const apiUrl = buildApiUrl(baseUrl);
  const url = `${apiUrl}/installation/repositories?page=${page}&per_page=${perPage}`;

  logger.debug('Listing installation repos', { page, perPage });

  const response = await fetch(url, {
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    logger.error('Failed to list installation repos', { status: response.status, body });
    throw new AppError(
      'AUTH_INVALID_CREDENTIALS',
      `GitHub API request failed: ${response.status}`,
      { status: response.status, body },
    );
  }

  const data = (await response.json()) as ListReposResponse;

  const repos: readonly GitHubRepo[] = data.repositories.map((r) => ({
    id: r.id,
    name: r.name,
    fullName: r.full_name,
    owner: r.owner.login,
    defaultBranch: r.default_branch,
    language: r.language,
    cloneUrl: r.clone_url,
    private: r.private,
  }));

  return { repos, totalCount: data.total_count };
}

/**
 * Verify a GitHub webhook signature (HMAC-SHA256).
 * Compares `sha256=<hex>` prefix + HMAC digest using timing-safe comparison.
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`;

  if (signature.length !== expected.length) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

/**
 * Build authenticated clone URL for a GitHub repository.
 * Format: https://x-access-token:{token}@{host}/{owner}/{name}.git
 */
export function buildCloneUrl(
  token: string,
  owner: string,
  name: string,
  baseUrl?: string,
): string {
  const host = buildHostFromUrl(baseUrl);
  return `https://x-access-token:${token}@${host}/${owner}/${name}.git`;
}
