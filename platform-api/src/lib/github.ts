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

// ---------------------------------------------------------------------------
// Personal Access Token (PAT) path — simpler onboarding than GitHub App.
// Works with both classic PATs (scope: repo) and fine-grained PATs
// (repository access + read metadata + read code scanning).
// ---------------------------------------------------------------------------

interface VerifyPatResult {
  readonly valid: boolean;
  readonly login?: string;
  readonly scopes?: readonly string[];
  readonly message?: string;
}

/**
 * Verify a GitHub PAT by calling GET /user.
 * Returns the authenticated login + granted scopes (classic tokens only).
 */
export async function verifyPersonalToken(token: string, baseUrl?: string): Promise<VerifyPatResult> {
  const apiUrl = buildApiUrl(baseUrl);
  const response = await fetch(`${apiUrl}/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    logger.warn('GitHub PAT verification failed', { status: response.status, body });
    return { valid: false, message: `GitHub API returned ${response.status}` };
  }

  const user = (await response.json()) as { login?: string };
  const scopesHeader = response.headers.get('x-oauth-scopes') ?? '';
  const scopes = scopesHeader
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return { valid: true, login: user.login, scopes };
}

/**
 * List repositories accessible to the authenticated user (paginated).
 * GET /user/repos — includes personal repos and any org repos the user has access to.
 * Supports an optional substring filter (client-side, since GitHub API doesn't expose one here).
 */
export async function listUserRepos(
  token: string,
  page: number = 1,
  perPage: number = DEFAULT_PER_PAGE,
  search?: string,
  baseUrl?: string,
): Promise<{ readonly repos: readonly GitHubRepo[]; readonly totalCount: number }> {
  const apiUrl = buildApiUrl(baseUrl);
  // affiliation covers owner + collaborator + org member repos
  const url = `${apiUrl}/user/repos?page=${page}&per_page=${perPage}&affiliation=owner,collaborator,organization_member&sort=updated`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    logger.error('Failed to list user repos', { status: response.status, body });
    throw new AppError(
      'AUTH_INVALID_CREDENTIALS',
      `GitHub API request failed: ${response.status}`,
      { status: response.status, body },
    );
  }

  const data = (await response.json()) as readonly GitHubRepoResponse[];

  let repos: GitHubRepo[] = data.map((r) => ({
    id: r.id,
    name: r.name,
    fullName: r.full_name,
    owner: r.owner.login,
    defaultBranch: r.default_branch,
    language: r.language,
    cloneUrl: r.clone_url,
    private: r.private,
  }));

  if (search && search.trim()) {
    const needle = search.trim().toLowerCase();
    repos = repos.filter((r) => r.fullName.toLowerCase().includes(needle));
  }

  // GET /user/repos doesn't return a total count header reliably — approximate
  // so the UI can decide whether to show a "next page" button.
  const totalCount = data.length < perPage ? (page - 1) * perPage + data.length : page * perPage + 1;
  return { repos, totalCount };
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
