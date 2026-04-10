import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { env } from '../../lib/env.js';
import { AppError } from '../../middleware/errors.js';
import { shallowClone, getChangedFiles, buildGitHubCloneUrl, buildGitLabCloneUrl } from '../../lib/clone.js';
import * as github from '../../lib/github.js';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TriggerScanInput {
  readonly orgId: string;
  readonly repositoryId: string;
  readonly trigger: 'manual' | 'webhook' | 'scheduled';
  readonly branch?: string;
  readonly fullScan?: boolean;
  readonly scanType?: string;
}

interface ScanFinding {
  readonly source: string;
  readonly severity: string;
  readonly title: string;
  readonly description: string;
  readonly cve_id?: string;
  readonly cvss_score?: number;
  readonly remediation?: string;
  readonly detail?: Record<string, unknown>;
}

interface ScanResult {
  readonly scan_type: string;
  readonly findings: ScanFinding[];
  readonly duration_ms: number;
  readonly files_scanned: number;
  readonly error?: string;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function triggerScan(input: TriggerScanInput) {
  const repo = await prisma.repository.findFirst({
    where: { id: input.repositoryId, orgId: input.orgId },
    include: { integration: true },
  });

  if (!repo) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Repository not found');
  }

  // Create scan record
  const scanType = input.scanType === 'full' || !input.scanType
    ? 'code_dependencies'
    : `code_${input.scanType}`;

  const scan = await prisma.scan.create({
    data: {
      orgId: input.orgId,
      repositoryId: repo.id,
      type: scanType,
      status: 'pending',
      trigger: input.trigger,
      branch: input.branch ?? repo.defaultBranch,
    },
  });

  // Run scan in background (fire-and-forget from caller's perspective)
  runScan(scan.id, repo, input).catch((err) => {
    logger.error('scan execution failed', { scanId: scan.id, error: err });
  });

  return scan;
}

// ---------------------------------------------------------------------------
// Scan execution
// ---------------------------------------------------------------------------

async function runScan(
  scanId: string,
  repo: Awaited<ReturnType<typeof getRepoWithIntegration>>,
  input: TriggerScanInput,
) {
  const startTime = Date.now();

  await prisma.scan.update({
    where: { id: scanId },
    data: { status: 'running', startedAt: new Date() },
  });

  let cloneDir: string | undefined;
  let cleanup: (() => Promise<void>) | undefined;

  try {
    // Build clone URL with auth token
    const cloneUrl = await buildAuthenticatedCloneUrl(repo);

    // Clone repository
    const result = await shallowClone({
      cloneUrl,
      branch: input.branch,
      depth: 1,
    });
    cloneDir = result.dir;
    cleanup = result.cleanup;

    // Determine changed files for delta scanning
    let changedFiles: string[] = [];
    if (!input.fullScan && input.branch && input.branch !== repo.defaultBranch) {
      changedFiles = await getChangedFiles(cloneDir, repo.defaultBranch);
      logger.info('delta scan mode', { changedFiles: changedFiles.length });
    }

    // Resolve sc-scan binary path
    const scanBinary = resolveScanBinary();

    // Build args
    const args = ['--repo-dir', cloneDir, '--output', 'json'];
    if (input.scanType && input.scanType !== 'full') {
      args.push('--scan-type', input.scanType);
    }
    if (changedFiles.length > 0) {
      args.push('--changed-files', changedFiles.join(','));
    }

    // Execute sc-scan
    const { stdout, stderr } = await execFileAsync(scanBinary, args, {
      timeout: 300_000, // 5 minutes max
      maxBuffer: 50 * 1024 * 1024, // 50MB output
    });

    if (stderr) {
      logger.warn('sc-scan stderr', { scanId, stderr: stderr.slice(0, 500) });
    }

    // Parse results
    const scanResult: ScanResult = JSON.parse(stdout);

    // Ingest findings
    const findingsCount = await ingestFindings(
      repo.orgId,
      repo.id,
      scanId,
      scanResult.findings,
    );

    // Update scan record
    const duration = Date.now() - startTime;
    await prisma.scan.update({
      where: { id: scanId },
      data: {
        status: 'completed',
        completedAt: new Date(),
        duration,
        findingsTotal: findingsCount,
        meta: {
          filesScanned: scanResult.files_scanned,
          branch: input.branch ?? repo.defaultBranch,
          deltaMode: changedFiles.length > 0,
          changedFilesCount: changedFiles.length,
        },
      },
    });

    // Update repo lastScanAt
    await prisma.repository.update({
      where: { id: repo.id },
      data: { lastScanAt: new Date() },
    });

    logger.info('scan completed', { scanId, findings: findingsCount, duration });
  } catch (err) {
    const duration = Date.now() - startTime;
    await prisma.scan.update({
      where: { id: scanId },
      data: {
        status: 'failed',
        completedAt: new Date(),
        duration,
        meta: { error: String(err) },
      },
    }).catch(() => {});
    throw err;
  } finally {
    if (cleanup) {
      await cleanup();
    }
  }
}

// ---------------------------------------------------------------------------
// Finding ingestion with dedup + auto-resolve stale
// ---------------------------------------------------------------------------

async function ingestFindings(
  orgId: string,
  repositoryId: string,
  scanId: string,
  findings: readonly ScanFinding[],
): Promise<number> {
  // Get existing open findings for this repo
  const existingFindings = await prisma.finding.findMany({
    where: { repositoryId, status: { in: ['open', 'in_progress'] } },
    select: { id: true, title: true, cveId: true },
  });

  const existingKeys = new Set(
    existingFindings.map((f) => dedupKey(f.cveId, f.title)),
  );
  const newKeys = new Set<string>();
  let created = 0;

  for (const f of findings) {
    const key = dedupKey(f.cve_id, f.title);
    newKeys.add(key);

    // Skip if already exists
    if (existingKeys.has(key)) continue;

    await prisma.finding.create({
      data: {
        orgId,
        scanId,
        repositoryId,
        source: 'code_scanner',
        severity: f.severity,
        status: 'open',
        title: f.title,
        description: f.description ?? null,
        cveId: f.cve_id ?? null,
        cvssScore: f.cvss_score ?? null,
        detail: (f.detail ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
    created++;
  }

  // Auto-resolve findings not in the new scan
  const staleFindings = existingFindings.filter(
    (f) => !newKeys.has(dedupKey(f.cveId, f.title)),
  );

  if (staleFindings.length > 0) {
    await prisma.finding.updateMany({
      where: { id: { in: staleFindings.map((f) => f.id) } },
      data: { status: 'resolved', resolvedAt: new Date() },
    });
    logger.info('auto-resolved stale findings', { count: staleFindings.length });
  }

  return created;
}

function dedupKey(cveId: string | null | undefined, title: string): string {
  return cveId ? `cve:${cveId}` : `title:${title}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getRepoWithIntegration(id: string) {
  return prisma.repository.findFirstOrThrow({
    where: { id },
    include: { integration: true },
  });
}

async function buildAuthenticatedCloneUrl(
  repo: {
    provider: string;
    owner: string;
    name: string;
    cloneUrl: string | null;
    integration: { config: unknown; baseUrl: string | null } | null;
  },
): Promise<string> {
  if (!repo.integration) {
    // Fallback to stored clone URL (public repo)
    if (repo.cloneUrl) return repo.cloneUrl;
    throw new Error('No integration or clone URL available');
  }

  const config = repo.integration.config as Record<string, string>;
  const baseUrl = repo.integration.baseUrl;

  if (repo.provider === 'github') {
    const host = baseUrl ? new URL(baseUrl).host : 'github.com';
    const { token } = await github.getInstallationToken(
      config.installationId,
      config.appId ?? env.GITHUB_APP_ID,
      env.GITHUB_APP_PRIVATE_KEY,
      baseUrl ?? undefined,
    );
    return buildGitHubCloneUrl(token, host, repo.owner, repo.name);
  }

  if (repo.provider === 'gitlab') {
    const host = baseUrl ? new URL(baseUrl).host : 'gitlab.com';
    return buildGitLabCloneUrl(config.accessToken, host, repo.owner, repo.name);
  }

  throw new Error(`Unsupported provider: ${repo.provider}`);
}

function resolveScanBinary(): string {
  // Check env override first, then look in project root
  if (env.SC_SCAN_BINARY) return env.SC_SCAN_BINARY;

  const platform = process.platform === 'darwin' ? 'darwin' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';

  return join(process.cwd(), '..', 'sc-scan', 'bin', `sc-scan-${platform}-${arch}`);
}
