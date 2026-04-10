import crypto from 'node:crypto';

import { AppError } from '../middleware/errors.js';
import { logger } from './logger.js';

const DEFAULT_BASE_URL = 'https://gitlab.com';
const DEFAULT_PER_PAGE = 20;

export interface GitLabRepo {
  readonly id: number;
  readonly name: string;
  readonly fullName: string;
  readonly owner: string;
  readonly defaultBranch: string;
  readonly language: string | null;
  readonly cloneUrl: string;
  readonly private: boolean;
}

interface GitLabUserResponse {
  readonly username: string;
}

interface GitLabProjectResponse {
  readonly id: number;
  readonly name: string;
  readonly path_with_namespace: string;
  readonly namespace: { readonly full_path: string };
  readonly default_branch: string;
  readonly http_url_to_repo: string;
  readonly visibility: string;
}

function buildApiUrl(baseUrl: string | undefined): string {
  const base = (baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  return `${base}/api/v4`;
}

function buildHostFromUrl(baseUrl: string | undefined): string {
  const raw = baseUrl ?? DEFAULT_BASE_URL;
  try {
    return new URL(raw).host;
  } catch {
    return 'gitlab.com';
  }
}

/**
 * Create a fetch wrapper that handles SSL verification.
 * For self-hosted instances with invalid certs, set verifySsl to false.
 *
 * NOTE: When verifySsl is false, NODE_TLS_REJECT_UNAUTHORIZED is temporarily
 * set to '0' for the duration of the request. This is a pragmatic MVP approach;
 * a production solution should use undici's Agent with connect options.
 */
async function gitlabFetch(
  url: string,
  options: RequestInit & { headers: Record<string, string> },
  verifySsl: boolean,
): Promise<Response> {
  if (verifySsl) {
    return fetch(url, options);
  }

  const previousValue = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  try {
    return await fetch(url, options);
  } finally {
    if (previousValue === undefined) {
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    } else {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousValue;
    }
  }
}

/**
 * Verify a GitLab personal access token by calling /api/v4/user.
 */
export async function verifyToken(
  accessToken: string,
  baseUrl?: string,
  verifySsl: boolean = true,
): Promise<{ readonly valid: boolean; readonly username: string }> {
  const apiUrl = buildApiUrl(baseUrl);
  const url = `${apiUrl}/user`;

  logger.debug('Verifying GitLab token', { url });

  try {
    const response = await gitlabFetch(
      url,
      {
        headers: {
          'PRIVATE-TOKEN': accessToken,
          Accept: 'application/json',
        },
      },
      verifySsl,
    );

    if (!response.ok) {
      logger.warn('GitLab token verification failed', { status: response.status });
      return { valid: false, username: '' };
    }

    const data = (await response.json()) as GitLabUserResponse;
    return { valid: true, username: data.username };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('GitLab token verification error', { error: message });
    return { valid: false, username: '' };
  }
}

/**
 * List projects accessible to the token (paginated).
 * GET /api/v4/projects?membership=true&min_access_level=20
 */
export async function listProjects(
  accessToken: string,
  page: number = 1,
  perPage: number = DEFAULT_PER_PAGE,
  search?: string,
  baseUrl?: string,
  verifySsl: boolean = true,
): Promise<{ readonly repos: readonly GitLabRepo[]; readonly totalCount: number }> {
  const apiUrl = buildApiUrl(baseUrl);
  const params = new URLSearchParams({
    membership: 'true',
    min_access_level: '20',
    page: String(page),
    per_page: String(perPage),
  });

  if (search) {
    params.set('search', search);
  }

  const url = `${apiUrl}/projects?${params.toString()}`;
  logger.debug('Listing GitLab projects', { page, perPage, search });

  const response = await gitlabFetch(
    url,
    {
      headers: {
        'PRIVATE-TOKEN': accessToken,
        Accept: 'application/json',
      },
    },
    verifySsl,
  );

  if (!response.ok) {
    const body = await response.text();
    logger.error('Failed to list GitLab projects', { status: response.status, body });
    throw new AppError(
      'AUTH_INVALID_CREDENTIALS',
      `GitLab API request failed: ${response.status}`,
      { status: response.status, body },
    );
  }

  const data = (await response.json()) as readonly GitLabProjectResponse[];
  const totalCount = parseInt(response.headers.get('x-total') ?? '0', 10);

  const repos: readonly GitLabRepo[] = data.map((p) => ({
    id: p.id,
    name: p.name,
    fullName: p.path_with_namespace,
    owner: p.namespace.full_path,
    defaultBranch: p.default_branch,
    language: null,
    cloneUrl: p.http_url_to_repo,
    private: p.visibility !== 'public',
  }));

  return { repos, totalCount };
}

/**
 * Verify a GitLab webhook token.
 * GitLab sends the secret in the X-Gitlab-Token header; comparison is timing-safe.
 */
export function verifyWebhookToken(receivedToken: string, expectedSecret: string): boolean {
  if (receivedToken.length !== expectedSecret.length) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(Buffer.from(receivedToken), Buffer.from(expectedSecret));
  } catch {
    return false;
  }
}

/**
 * Build authenticated clone URL for a GitLab repository.
 * Format: https://oauth2:{access_token}@{host}/{owner}/{name}.git
 */
export function buildCloneUrl(
  accessToken: string,
  owner: string,
  name: string,
  baseUrl?: string,
): string {
  const host = buildHostFromUrl(baseUrl);
  return `https://oauth2:${accessToken}@${host}/${owner}/${name}.git`;
}
