import { exec, execFile } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import type { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { env } from '../../lib/env.js';
import { AppError } from '../../middleware/errors.js';
import { shallowClone, getChangedFiles, buildGitHubCloneUrl, buildGitLabCloneUrl } from '../../lib/clone.js';
import * as github from '../../lib/github.js';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

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
  readonly auto_fixable?: boolean;
  readonly detail?: Record<string, unknown>;
}

interface ScannerResult {
  readonly findings: ScanFinding[];
  readonly warnings: string[];
  readonly scannersRun: string[];
  readonly scannersSkipped: string[];
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

  // Prevent concurrent scans on same repo
  const activeScan = await prisma.scan.findFirst({
    where: { repositoryId: repo.id, status: { in: ['pending', 'running'] } },
  });
  if (activeScan) {
    throw new AppError('CONFLICT', 'A scan is already running for this repository');
  }

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
      meta: { requestedType: input.scanType ?? 'full' },
    },
  });

  // Run scan in background (fire-and-forget from caller's perspective)
  runScan(scan.id, repo, input).catch((err) => {
    logger.error('scan execution failed', { scanId: scan.id, error: (err as Error).message });
  });

  return scan;
}

// ---------------------------------------------------------------------------
// Scan execution pipeline
// ---------------------------------------------------------------------------

async function runScan(
  scanId: string,
  repo: { id: string; orgId: string; provider: string; owner: string; name: string; defaultBranch: string; cloneUrl: string | null; integration: { config: unknown; baseUrl: string | null } | null },
  input: TriggerScanInput,
) {
  const startedAt = new Date();

  await prisma.scan.update({
    where: { id: scanId },
    data: { status: 'running', startedAt },
  });

  let cleanup: (() => Promise<void>) | undefined;

  try {
    // --- Clone ---
    logger.info('cloning repository', { scanId, repo: `${repo.owner}/${repo.name}` });
    const cloneUrl = await buildAuthenticatedCloneUrl(repo);
    const result = await shallowClone({ cloneUrl, branch: input.branch, depth: 1 });
    cleanup = result.cleanup;
    logger.info('clone complete', { scanId });

    // --- Delta mode ---
    let changedFiles: string[] = [];
    if (!input.fullScan && input.branch && input.branch !== repo.defaultBranch) {
      changedFiles = await getChangedFiles(result.dir, repo.defaultBranch);
      logger.info('delta scan mode', { scanId, changedFiles: changedFiles.length });
    }

    // --- Run scanner (Go binary with Node fallback) ---
    const scanResult = await runScanner(result.dir, input.scanType ?? 'full', changedFiles);
    logger.info('scan finished', {
      scanId,
      findings: scanResult.findings.length,
      scannersRun: scanResult.scannersRun,
      scannersSkipped: scanResult.scannersSkipped,
    });

    // --- Ingest findings ---
    const created = await ingestFindings(repo.orgId, repo.id, scanId, scanResult.findings);

    // --- Complete ---
    const completedAt = new Date();
    const duration = completedAt.getTime() - startedAt.getTime();
    await prisma.scan.update({
      where: { id: scanId },
      data: {
        status: 'completed',
        completedAt,
        duration,
        findingsTotal: scanResult.findings.length,
        meta: {
          branch: input.branch ?? repo.defaultBranch,
          deltaMode: changedFiles.length > 0,
          changedFilesCount: changedFiles.length,
          scannersRun: scanResult.scannersRun,
          scannersSkipped: scanResult.scannersSkipped,
          warnings: scanResult.warnings.length > 0 ? scanResult.warnings : undefined,
          findingsCreated: created,
        },
      },
    });

    await prisma.repository.update({
      where: { id: repo.id },
      data: { lastScanAt: new Date() },
    });

    logger.info('scan completed', { scanId, findings: scanResult.findings.length, duration });
  } catch (err) {
    const msg = stripTokens((err as Error).message);
    const duration = Date.now() - startedAt.getTime();
    await prisma.scan.update({
      where: { id: scanId },
      data: { status: 'failed', completedAt: new Date(), duration, meta: { error: msg } },
    }).catch(() => {});
    logger.error('scan failed', { scanId, error: msg });
  } finally {
    if (cleanup) await cleanup();
  }
}

// ---------------------------------------------------------------------------
// Scanner: try Go binary, fallback to built-in Node
// ---------------------------------------------------------------------------

async function runScanner(
  workDir: string,
  scanType: string,
  changedFiles: string[],
): Promise<ScannerResult> {
  // Try sc-scan Go binary
  const binary = await findBinary('sc-scan');
  if (binary) {
    logger.info('using sc-scan binary', { path: binary });
    try {
      const findings = await runGoBinary(binary, workDir, scanType, changedFiles);
      return { findings, warnings: [], scannersRun: ['sc-scan'], scannersSkipped: [] };
    } catch (err) {
      logger.warn('sc-scan binary failed, falling back to built-in scanner', { error: (err as Error).message });
    }
  }

  // Fallback: built-in Node.js scanner
  logger.info('using built-in Node.js scanner (sc-scan binary not available)');
  return runBuiltinScanner(workDir, scanType);
}

async function findBinary(name: string): Promise<string | null> {
  // Check env override
  if (env.SC_SCAN_BINARY) {
    try { await access(env.SC_SCAN_BINARY, constants.X_OK); return env.SC_SCAN_BINARY; } catch {}
  }

  // Check relative paths from project root
  const candidates = [
    resolve(process.cwd(), '..', 'sc-scan', 'bin', name),
    resolve(process.cwd(), '..', 'sc-scan', 'bin', `${name}-${process.platform === 'darwin' ? 'darwin' : 'linux'}-${process.arch === 'arm64' ? 'arm64' : 'amd64'}`),
    `/usr/local/bin/${name}`,
  ];

  for (const p of candidates) {
    try { await access(p, constants.X_OK); return p; } catch {}
  }

  // Check PATH
  try {
    const { stdout } = await execAsync(`which ${name}`, { timeout: 5000 });
    return stdout.trim();
  } catch {}

  return null;
}

async function runGoBinary(
  bin: string,
  workDir: string,
  scanType: string,
  changedFiles: string[],
): Promise<ScanFinding[]> {
  const args = ['--repo-dir', workDir, '--output', 'json'];
  if (scanType && scanType !== 'full') {
    args.push('--scan-type', scanType);
  }
  if (changedFiles.length > 0) {
    args.push('--changed-files', changedFiles.join(','));
  }

  const { stdout } = await execFileAsync(bin, args, {
    timeout: 300_000,
    maxBuffer: 50 * 1024 * 1024,
  });

  const result = JSON.parse(stdout);
  // sc-scan outputs { scan_type, findings, duration_ms, files_scanned }
  return (result.findings ?? result) as ScanFinding[];
}

// ---------------------------------------------------------------------------
// Built-in Node.js scanner (fallback when Go binary not available)
// Uses native audit tools: npm audit, pip-audit, etc.
// ---------------------------------------------------------------------------

async function runBuiltinScanner(workDir: string, scanType: string): Promise<ScannerResult> {
  const findings: ScanFinding[] = [];
  const warnings: string[] = [];
  const scannersRun: string[] = [];
  const scannersSkipped: string[] = [];

  // Dependency scan via npm audit
  if (scanType !== 'secrets') {
    const hasNpm = await isToolInstalled('npm');
    if (hasNpm) {
      const npmFindings = await runNpmAudit(workDir);
      findings.push(...npmFindings);
      scannersRun.push('npm-audit');
    } else {
      scannersSkipped.push('npm-audit');
    }
  }

  // Secret scan via regex patterns (always runs)
  const secretFindings = await scanSecrets(workDir);
  findings.push(...secretFindings);
  scannersRun.push('secret-regex');

  if (scannersSkipped.length > 0) {
    warnings.push(`Skipped scanners (not installed): ${scannersSkipped.join(', ')}`);
  }

  return { findings, warnings, scannersRun, scannersSkipped };
}

async function isToolInstalled(name: string): Promise<boolean> {
  try {
    await execAsync(`${name} --version`, { timeout: 5000 });
    return true;
  } catch { return false; }
}

async function runNpmAudit(workDir: string): Promise<ScanFinding[]> {
  // Check if package-lock.json exists
  try { await access(join(workDir, 'package-lock.json')); } catch { return []; }

  try {
    const { stdout } = await execAsync('npm audit --json 2>/dev/null || true', {
      cwd: workDir,
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024,
    });

    const audit = JSON.parse(stdout);
    const findings: ScanFinding[] = [];

    // npm audit v2 format: { vulnerabilities: { [name]: { severity, via, effects, range, ... } } }
    const vulns = audit.vulnerabilities ?? {};
    for (const [name, v] of Object.entries<any>(vulns)) {
      findings.push({
        source: 'dependency',
        severity: v.severity ?? 'medium',
        title: `${name}@${v.range ?? 'unknown'} — ${v.severity ?? 'unknown'} vulnerability`,
        description: Array.isArray(v.via) ? v.via.filter((x: any) => typeof x === 'string').join('; ') : '',
        detail: { package_name: name, ecosystem: 'npm', range: v.range, fix_available: v.fixAvailable },
        auto_fixable: !!v.fixAvailable,
      });
    }

    return findings;
  } catch {
    return [];
  }
}

async function scanSecrets(workDir: string): Promise<ScanFinding[]> {
  // Simple regex-based secret scan (subset of what Go scanner does)
  const patterns = [
    { name: 'AWS Access Key', regex: /AKIA[0-9A-Z]{16}/, severity: 'critical' as const },
    { name: 'GitHub PAT', regex: /ghp_[A-Za-z0-9]{36}/, severity: 'high' as const },
    { name: 'GitLab Token', regex: /glpat-[A-Za-z0-9_-]{20,}/, severity: 'high' as const },
    { name: 'Stripe Secret Key', regex: /sk_live_[0-9a-zA-Z]{24,}/, severity: 'critical' as const },
    { name: 'Private Key', regex: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, severity: 'critical' as const },
    { name: 'Generic Secret', regex: /(?:password|secret|token|api_key)\s*[=:]\s*["'][A-Za-z0-9+/=_-]{16,}["']/i, severity: 'medium' as const },
  ];

  const findings: ScanFinding[] = [];

  try {
    // Use grep to find potential secrets (fast)
    for (const p of patterns) {
      try {
        const { stdout } = await execAsync(
          `grep -rnl --include='*.ts' --include='*.js' --include='*.py' --include='*.go' --include='*.env' --include='*.yml' --include='*.yaml' --include='*.json' -E '${p.regex.source}' . 2>/dev/null | head -20`,
          { cwd: workDir, timeout: 15_000 },
        );
        const files = stdout.trim().split('\n').filter(Boolean);
        for (const file of files) {
          const relPath = file.replace(/^\.\//, '');
          // Skip lockfiles and test files
          if (/node_modules|\.lock|package-lock|go\.sum|\.test\.|_test\./.test(relPath)) continue;

          findings.push({
            source: 'secret',
            severity: p.severity,
            title: `${p.name} detected in ${relPath}`,
            description: `Potential ${p.name} found in ${relPath}`,
            detail: { file: relPath, pattern_name: p.name },
          });
        }
      } catch {
        // grep returns exit 1 when no match — ignore
      }
    }
  } catch {
    // Scan error — non-fatal
  }

  return findings;
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
  const existingFindings = await prisma.finding.findMany({
    where: { repositoryId, status: { in: ['open', 'in_progress'] } },
    select: { id: true, title: true, cveId: true },
  });

  const existingKeys = new Set(existingFindings.map((f) => dedupKey(f.cveId, f.title)));
  const newKeys = new Set<string>();
  let created = 0;

  for (const f of findings) {
    const key = dedupKey(f.cve_id, f.title);
    newKeys.add(key);

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

  // Auto-resolve stale findings
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
    if (repo.cloneUrl) return repo.cloneUrl;
    // Public fallback by provider
    if (repo.provider === 'gitlab') return `https://gitlab.com/${repo.owner}/${repo.name}.git`;
    return `https://github.com/${repo.owner}/${repo.name}.git`;
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

/** Strip auth tokens from error messages to prevent leaking secrets */
function stripTokens(msg: string): string {
  return msg.replace(/https:\/\/[^@]+@/g, 'https://***@');
}
