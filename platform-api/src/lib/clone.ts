import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { logger } from './logger.js';

const execFileAsync = promisify(execFile);

export interface CloneOptions {
  readonly cloneUrl: string;
  readonly branch?: string;
  readonly depth?: number;
  readonly timeoutMs?: number;
}

export interface CloneResult {
  readonly dir: string;
  readonly cleanup: () => Promise<void>;
}

/**
 * Shallow-clone a repository into a temp directory.
 * Returns the path and a cleanup function to remove it.
 */
export async function shallowClone(opts: CloneOptions): Promise<CloneResult> {
  const dir = await mkdtemp(join(tmpdir(), 'sc-clone-'));
  const args = ['clone', '--depth', String(opts.depth ?? 1), '--single-branch'];

  if (opts.branch) {
    args.push('--branch', opts.branch);
  }

  args.push(opts.cloneUrl, dir);

  try {
    await execFileAsync('git', args, {
      timeout: opts.timeoutMs ?? 120_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    logger.info('cloned repository', { dir, branch: opts.branch ?? 'default' });
  } catch (err) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }

  const cleanup = async () => {
    await rm(dir, { recursive: true, force: true });
    logger.debug('cleaned up clone dir', { dir });
  };

  return { dir, cleanup };
}

/**
 * Get list of changed files between the current branch and the default branch.
 */
export async function getChangedFiles(
  repoDir: string,
  defaultBranch: string,
): Promise<string[]> {
  try {
    // Fetch the default branch ref so we can diff against it
    await execFileAsync('git', ['fetch', 'origin', defaultBranch, '--depth=1'], {
      cwd: repoDir,
      timeout: 30_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });

    const { stdout } = await execFileAsync(
      'git',
      ['diff', '--name-only', `origin/${defaultBranch}...HEAD`],
      { cwd: repoDir, timeout: 10_000 },
    );

    return stdout
      .trim()
      .split('\n')
      .filter((f) => f.length > 0);
  } catch (err) {
    logger.warn('failed to get changed files, falling back to full scan', { error: err });
    return [];
  }
}

/**
 * Build a clone URL with embedded token for GitHub.
 * Format: https://x-access-token:{token}@{host}/{owner}/{name}.git
 */
export function buildGitHubCloneUrl(
  token: string,
  host: string,
  owner: string,
  name: string,
): string {
  return `https://x-access-token:${token}@${host}/${owner}/${name}.git`;
}

/**
 * Build a clone URL with embedded token for GitLab.
 * Format: https://oauth2:{token}@{host}/{owner}/{name}.git
 */
export function buildGitLabCloneUrl(
  token: string,
  host: string,
  owner: string,
  name: string,
): string {
  return `https://oauth2:${token}@${host}/${owner}/${name}.git`;
}
