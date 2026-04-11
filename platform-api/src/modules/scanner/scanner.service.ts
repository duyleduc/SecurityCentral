import { exec, execFile } from 'node:child_process';
import { access, constants, readdir, readFile } from 'node:fs/promises';
import { join, resolve, relative, basename } from 'node:path';
import { promisify } from 'node:util';
import type { Dirent } from 'node:fs';

import type { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { emitScanStarted, emitScanCompleted } from '../../ws/hooks.js';
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
  type: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  description?: string;
  cve_id?: string;
  cvss_score?: number;
  detail: Record<string, unknown>;
  remediation?: string;
  auto_fixable: boolean;
}

interface ScannerResult {
  findings: ScanFinding[];
  warnings: string[];
  scannersRun: string[];
  scannersSkipped: string[];
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

  // Run scan in background
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

  emitScanStarted(repo.orgId, { id: scanId, repositoryId: repo.id, type: input.scanType ?? 'full' });

  let cleanup: (() => Promise<void>) | undefined;

  try {
    // --- Clone ---
    logger.info('cloning repository', { scanId, repo: `${repo.owner}/${repo.name}` });
    const cloneUrl = await buildAuthenticatedCloneUrl(repo);
    const result = await shallowClone({ cloneUrl, branch: input.branch, depth: 1 });
    cleanup = result.cleanup;

    // --- Delta mode ---
    let changedFiles: string[] = [];
    if (!input.fullScan && input.branch && input.branch !== repo.defaultBranch) {
      changedFiles = await getChangedFiles(result.dir, repo.defaultBranch);
      logger.info('delta scan mode', { scanId, changedFiles: changedFiles.length });
    }

    // --- Run scanner ---
    const requestedType = (input.scanType === 'secrets') ? 'code_secrets' : 'code_dependencies';
    const scanResult = await runScanner(result.dir, requestedType);
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
        findingsTotal: created,
        meta: {
          branch: input.branch ?? repo.defaultBranch,
          deltaMode: changedFiles.length > 0,
          changedFilesCount: changedFiles.length,
          scannersRun: scanResult.scannersRun,
          scannersSkipped: scanResult.scannersSkipped,
          warnings: scanResult.warnings.length > 0 ? scanResult.warnings : undefined,
          totalDetected: scanResult.findings.length,
          newFindings: created,
        },
      },
    });

    await prisma.repository.update({
      where: { id: repo.id },
      data: { lastScanAt: new Date() },
    });

    emitScanCompleted(repo.orgId, { id: scanId, repositoryId: repo.id, findingsTotal: created, status: 'completed' });
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
// Scanner: try Go binary, fallback to built-in Node (v1 architecture)
// ---------------------------------------------------------------------------

async function runScanner(workDir: string, scanType: string): Promise<ScannerResult> {
  // Always run builtin Node.js scanner (native audit tools with real-time vuln DBs)
  const result = await runBuiltinScanner(workDir, scanType);

  // Additionally run sc-scan Go binary for secrets/configs/patterns detection
  // (Go binary has 50+ regex patterns, unsafe config detection, risky code patterns)
  const binary = await findBinary('sc-scan');
  if (binary) {
    logger.info('running sc-scan binary for additional analysis', { path: binary });
    try {
      const goFindings = await runGoBinary(binary, workDir, scanType);
      // Dedup: only add Go findings whose titles aren't already present
      const existingTitles = new Set(result.findings.map((f) => f.title));
      const newFindings = goFindings.filter((f) => !existingTitles.has(f.title));
      result.findings.push(...newFindings);
      result.scannersRun.push('sc-scan');
      logger.info('sc-scan added findings', { new: newFindings.length, deduped: goFindings.length - newFindings.length });
    } catch (err) {
      logger.warn('sc-scan binary failed', { error: (err as Error).message });
      result.scannersSkipped.push('sc-scan');
    }
  }

  return result;
}

async function findBinary(name: string): Promise<string | null> {
  if (env.SC_SCAN_BINARY) {
    try { await access(env.SC_SCAN_BINARY, constants.X_OK); return env.SC_SCAN_BINARY; } catch {}
  }
  const candidates = [
    resolve(process.cwd(), '..', 'sc-scan', 'bin', name),
    resolve(process.cwd(), '..', 'sc-scan', 'bin', `${name}-${process.platform === 'darwin' ? 'darwin' : 'linux'}-${process.arch === 'arm64' ? 'arm64' : 'amd64'}`),
    `/usr/local/bin/${name}`,
  ];
  for (const p of candidates) {
    try { await access(p, constants.X_OK); return p; } catch {}
  }
  try {
    const { stdout } = await execAsync(`which ${name}`, { timeout: 5000 });
    return stdout.trim();
  } catch {}
  return null;
}

async function runGoBinary(bin: string, workDir: string, scanType: string): Promise<ScanFinding[]> {
  const args = ['--repo-dir', workDir, '--output', 'json'];
  if (scanType === 'code_secrets') {
    args.push('--scan-type', 'secrets');
  }
  const { stdout } = await execFileAsync(bin, args, { timeout: 300_000, maxBuffer: 50 * 1024 * 1024 });
  const result = JSON.parse(stdout);
  // sc-scan outputs { scan_type, findings, duration_ms, files_scanned }
  // findings can be null when no issues found
  return (Array.isArray(result.findings) ? result.findings : Array.isArray(result) ? result : []) as ScanFinding[];
}

// ===========================================================================
// Built-in Node.js scanner (ported from archived v1)
// Uses native audit tools for real-time vulnerability databases.
// ===========================================================================

const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'vendor', '__pycache__', '.tox', '.venv',
  'venv', 'dist', 'build', '.next', '.nuxt', 'target', 'coverage',
]);
const MAX_DETECT_DEPTH = 10;

interface EcoScanner {
  manifests: string[];
  name: string;
  tool: string;
  installHint: string;
  run: (dir: string) => Promise<ScanFinding[]>;
  skipIf?: string[];
}

const ECO_SCANNERS: EcoScanner[] = [
  {
    manifests: ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'],
    name: 'npm', tool: 'npm', installHint: 'Install Node.js: https://nodejs.org',
    run: runNpmAudit,
  },
  {
    manifests: ['requirements.txt', 'Pipfile.lock', 'poetry.lock'],
    name: 'pip', tool: 'pip-audit', installHint: 'pip install pip-audit',
    run: runPipAudit,
  },
  {
    manifests: ['composer.lock'],
    name: 'composer', tool: 'composer', installHint: 'Install Composer: https://getcomposer.org',
    run: runComposerAudit,
  },
  {
    manifests: ['go.sum'],
    name: 'go', tool: 'govulncheck', installHint: 'go install golang.org/x/vuln/cmd/govulncheck@latest',
    run: runGoVulncheck,
  },
  {
    manifests: ['Gemfile.lock'],
    name: 'bundler', tool: 'bundle-audit', installHint: 'gem install bundler-audit',
    run: runBundleAudit,
  },
  {
    manifests: ['pom.xml'],
    name: 'maven', tool: 'mvn', installHint: 'Install Maven or osv-scanner',
    run: (dir) => runOsvScanner(dir, 'maven'),
  },
  {
    manifests: ['build.gradle', 'build.gradle.kts'],
    name: 'gradle', tool: 'gradle', installHint: 'Install Gradle or osv-scanner',
    run: (dir) => runOsvScanner(dir, 'gradle'),
    skipIf: ['maven'],
  },
];

async function runBuiltinScanner(workDir: string, scanType: string): Promise<ScannerResult> {
  const findings: ScanFinding[] = [];
  const warnings: string[] = [];
  const scannersRun: string[] = [];
  const scannersSkipped: string[] = [];

  // 1. Dependency scan (SCA) — recursive manifest discovery + native audit tools
  if (scanType !== 'code_secrets') {
    const depResult = await scanDependencies(workDir);
    findings.push(...depResult.findings);
    warnings.push(...depResult.warnings);
    scannersRun.push(...depResult.scannersRun);
    scannersSkipped.push(...depResult.scannersSkipped);
  }

  // 2. Secrets scan — regex patterns (always runs)
  const secretFindings = await scanSecrets(workDir);
  findings.push(...secretFindings);
  scannersRun.push('secret-regex');

  return { findings, warnings, scannersRun, scannersSkipped };
}

// ---------------------------------------------------------------------------
// Dependency scanning: discover manifests recursively, run native tools
// ---------------------------------------------------------------------------

async function scanDependencies(workDir: string): Promise<ScannerResult> {
  const findings: ScanFinding[] = [];
  const warnings: string[] = [];
  const scannersRun: string[] = [];
  const scannersSkipped: string[] = [];

  // Discover all directories with manifest files
  const targets = await discoverManifestDirs(workDir);
  logger.info('discovered manifests', {
    count: targets.length,
    dirs: targets.map((t) => ({ dir: relative(workDir, t.dir) || '.', scanner: t.scanner.name })),
  });

  // Run scanners
  for (const { dir, scanner } of targets) {
    const relDir = relative(workDir, dir) || '.';
    logger.info(`running ${scanner.name} dependency scan`, { dir: relDir });

    const ecoFindings = await scanner.run(dir);

    // Tag findings with subdirectory context
    for (const f of ecoFindings) {
      if (relDir !== '.') {
        f.title = `[${relDir}] ${f.title}`;
        f.detail.subdir = relDir;
      }
    }
    findings.push(...ecoFindings);

    if (ecoFindings.length === 0) {
      const hasNativeTool = await isToolInstalled(scanner.tool);
      if (!hasNativeTool) {
        const label = relDir === '.' ? scanner.name : `${scanner.name} (${relDir})`;
        scannersSkipped.push(label);
        warnings.push(`${label}: no scanning tool available. ${scanner.installHint}`);
      } else {
        scannersRun.push(relDir === '.' ? scanner.name : `${scanner.name} (${relDir})`);
      }
    } else {
      scannersRun.push(relDir === '.' ? scanner.name : `${scanner.name} (${relDir})`);
    }
  }

  return { findings, warnings, scannersRun, scannersSkipped };
}

interface ManifestTarget { dir: string; scanner: EcoScanner }

async function discoverManifestDirs(workDir: string): Promise<ManifestTarget[]> {
  const targets: ManifestTarget[] = [];
  const seen = new Set<string>();

  async function walk(dir: string, depth: number) {
    if (depth > MAX_DETECT_DEPTH) return;

    let entries: Dirent[];
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }

    const fileNames = entries.filter((e) => e.isFile()).map((e) => e.name);
    const fileNameSet = new Set(fileNames);
    const scannersInDir = new Set<string>();

    for (const scanner of ECO_SCANNERS) {
      const hasManifest = scanner.manifests.some((m) =>
        m.startsWith('*') ? fileNames.some((f) => f.endsWith(m.slice(1))) : fileNameSet.has(m),
      );
      if (!hasManifest) continue;
      if (scanner.skipIf?.some((s) => scannersInDir.has(s))) continue;

      const key = `${scanner.name}:${dir}`;
      if (!seen.has(key)) {
        seen.add(key);
        targets.push({ dir, scanner });
        scannersInDir.add(scanner.name);
      }
    }

    for (const e of entries) {
      if (e.isDirectory() && !SKIP_DIRS.has(e.name)) {
        await walk(join(dir, e.name), depth + 1);
      }
    }
  }

  await walk(workDir, 0);
  return targets;
}

async function isToolInstalled(name: string): Promise<boolean> {
  try { await execAsync(`${name} --version`, { timeout: 5000 }); return true; } catch { return false; }
}

async function fileExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

// ---------------------------------------------------------------------------
// npm audit --json
// ---------------------------------------------------------------------------

async function runNpmAudit(workDir: string): Promise<ScanFinding[]> {
  try {
    const { stdout } = await execAsync('npm audit --json 2>/dev/null || true', {
      cwd: workDir, timeout: 120_000, maxBuffer: 50 * 1024 * 1024,
    });
    if (!stdout.trim()) return [];

    const audit = JSON.parse(stdout);
    const vulns: Record<string, any> = audit.vulnerabilities ?? {};
    const findings: ScanFinding[] = [];

    for (const [pkgName, vuln] of Object.entries(vulns)) {
      const advisory = Array.isArray(vuln.via)
        ? vuln.via.find((v: any) => typeof v !== 'string' && v.title)
        : null;

      const cveUrl = advisory?.url ?? '';
      const cveId = cveUrl.match(/CVE-\d{4}-\d+/)?.[0] ?? cveUrl.match(/GHSA-[a-z0-9-]+/)?.[0] ?? '';
      const fixInfo = typeof vuln.fixAvailable === 'object' ? vuln.fixAvailable : null;

      findings.push({
        type: 'package_vulnerability',
        severity: mapNpmSeverity(vuln.severity),
        title: `${advisory?.title ?? 'Vulnerability'} in ${pkgName}`,
        description: `Package ${pkgName} (${vuln.range}) is vulnerable.${cveUrl ? ` Advisory: ${cveUrl}` : ''}`,
        cve_id: cveId || undefined,
        cvss_score: advisory?.cvss?.score,
        detail: { package_name: pkgName, ecosystem: 'npm', affected_range: vuln.range, advisory_url: cveUrl },
        remediation: fixInfo
          ? `Upgrade ${fixInfo.name} to ${fixInfo.version}: npm install ${fixInfo.name}@${fixInfo.version}`
          : 'No fix available yet.',
        auto_fixable: !!vuln.fixAvailable,
      });
    }
    return findings;
  } catch { return []; }
}

function mapNpmSeverity(s: string): ScanFinding['severity'] {
  switch (s) {
    case 'critical': return 'critical';
    case 'high': return 'high';
    case 'moderate': return 'medium';
    case 'low': return 'low';
    default: return 'info';
  }
}

// ---------------------------------------------------------------------------
// pip-audit --json (Python)
// ---------------------------------------------------------------------------

async function runPipAudit(workDir: string): Promise<ScanFinding[]> {
  for (const cmd of ['pip-audit', 'python3 -m pip_audit']) {
    try {
      const reqFile = (await fileExists(join(workDir, 'requirements.txt'))) ? '-r requirements.txt' : '';
      if (!reqFile) return [];

      const { stdout } = await execAsync(
        `${cmd} ${reqFile} --format json 2>/dev/null || true`,
        { cwd: workDir, timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
      );
      if (!stdout.trim() || stdout.trim() === '[]') return [];

      const results = JSON.parse(stdout) as Array<{
        name: string; version: string;
        vulns: Array<{ id: string; description: string; fix_versions: string[]; aliases: string[] }>;
      }>;

      const findings: ScanFinding[] = [];
      for (const pkg of results) {
        for (const vuln of pkg.vulns ?? []) {
          const cveId = vuln.aliases?.find((a) => a.startsWith('CVE-')) ?? vuln.id;
          const fixVersion = vuln.fix_versions?.[0];
          findings.push({
            type: 'package_vulnerability',
            severity: 'high',
            title: `${cveId} in ${pkg.name}@${pkg.version}`,
            description: vuln.description || `Vulnerability ${vuln.id} in ${pkg.name}`,
            cve_id: cveId.startsWith('CVE-') ? cveId : undefined,
            detail: { package_name: pkg.name, installed_version: pkg.version, ecosystem: 'pypi', vuln_id: vuln.id },
            remediation: fixVersion ? `Upgrade: pip install ${pkg.name}==${fixVersion}` : 'No fix available.',
            auto_fixable: !!fixVersion,
          });
        }
      }
      return findings;
    } catch { /* try next cmd */ }
  }
  return [];
}

// ---------------------------------------------------------------------------
// composer audit --format=json (PHP)
// ---------------------------------------------------------------------------

async function runComposerAudit(workDir: string): Promise<ScanFinding[]> {
  try {
    const { stdout } = await execAsync('composer audit --format=json 2>/dev/null || true', {
      cwd: workDir, timeout: 60_000, maxBuffer: 10 * 1024 * 1024,
    });
    if (!stdout.trim()) return [];

    const audit = JSON.parse(stdout);
    const advisories: Record<string, Array<{ advisoryId: string; packageName: string; title: string; cve: string; affectedVersions: string }>> = audit.advisories ?? {};
    const findings: ScanFinding[] = [];

    for (const [, advList] of Object.entries(advisories)) {
      for (const adv of advList) {
        findings.push({
          type: 'package_vulnerability', severity: 'high',
          title: `${adv.cve || adv.advisoryId}: ${adv.title}`,
          description: adv.title,
          cve_id: adv.cve || undefined,
          detail: { package_name: adv.packageName, ecosystem: 'composer', affected_versions: adv.affectedVersions },
          remediation: `Update ${adv.packageName}: composer update ${adv.packageName}`,
          auto_fixable: true,
        });
      }
    }
    return findings;
  } catch { return []; }
}

// ---------------------------------------------------------------------------
// govulncheck -json (Go)
// ---------------------------------------------------------------------------

async function runGoVulncheck(workDir: string): Promise<ScanFinding[]> {
  if (!(await isToolInstalled('govulncheck'))) return [];

  try {
    const { stdout } = await execAsync('govulncheck -json ./... 2>/dev/null || true', {
      cwd: workDir, timeout: 180_000, maxBuffer: 50 * 1024 * 1024,
      env: { ...process.env, GOFLAGS: '-mod=readonly' },
    });
    if (!stdout.trim()) return [];

    const findings: ScanFinding[] = [];
    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        const vuln = entry.finding;
        if (!vuln) continue;
        const osv = entry.osv ?? {};
        const cveId = (osv.aliases ?? []).find((a: string) => a.startsWith('CVE-')) ?? osv.id ?? '';

        findings.push({
          type: 'package_vulnerability',
          severity: mapGoSeverity(osv.database_specific?.severity ?? ''),
          title: `${cveId || osv.id}: ${osv.summary ?? 'Go vulnerability'}`,
          description: osv.details ?? osv.summary ?? '',
          cve_id: cveId || undefined,
          detail: { package_name: vuln.trace?.[0]?.module ?? 'unknown', ecosystem: 'go', osv_id: osv.id },
          remediation: osv.affected?.[0]?.ranges?.[0]?.events?.find((e: any) => e.fixed)?.fixed
            ? `Update module to ${osv.affected[0].ranges[0].events.find((e: any) => e.fixed).fixed}`
            : 'No fix available.',
          auto_fixable: !!osv.affected?.[0]?.ranges?.[0]?.events?.find((e: any) => e.fixed),
        });
      } catch { /* skip unparseable lines */ }
    }
    return findings;
  } catch { return []; }
}

function mapGoSeverity(s: string): ScanFinding['severity'] {
  switch (s.toUpperCase()) {
    case 'CRITICAL': return 'critical';
    case 'HIGH': return 'high';
    case 'MODERATE': case 'MEDIUM': return 'medium';
    case 'LOW': return 'low';
    default: return 'high';
  }
}

// ---------------------------------------------------------------------------
// bundle-audit (Ruby)
// ---------------------------------------------------------------------------

async function runBundleAudit(workDir: string): Promise<ScanFinding[]> {
  if (!(await isToolInstalled('bundle-audit'))) return [];

  try {
    const { stdout } = await execAsync('bundle-audit check --format json 2>/dev/null || true', {
      cwd: workDir, timeout: 60_000, maxBuffer: 10 * 1024 * 1024,
    });
    if (!stdout.trim()) return [];

    const results = JSON.parse(stdout);
    const vulns = results.results ?? results.advisories ?? [];
    return vulns.map((v: any) => ({
      type: 'package_vulnerability',
      severity: v.criticality === 'critical' ? 'critical' : v.criticality === 'high' ? 'high' : 'medium' as const,
      title: `${v.cve || v.advisory}: ${v.title ?? 'Vulnerability'} in ${v.gem ?? v.name ?? 'unknown'}`,
      cve_id: v.cve || undefined,
      detail: { package_name: v.gem ?? v.name, ecosystem: 'rubygems' },
      remediation: v.patched_versions ? `Update to: ${v.patched_versions}` : 'No fix available.',
      auto_fixable: !!v.patched_versions,
    }));
  } catch { return []; }
}

// ---------------------------------------------------------------------------
// osv-scanner fallback (any ecosystem)
// ---------------------------------------------------------------------------

async function runOsvScanner(workDir: string, ecosystem: string): Promise<ScanFinding[]> {
  if (!(await isToolInstalled('osv-scanner'))) return [];

  try {
    const { stdout } = await execAsync('osv-scanner --json -r . 2>/dev/null || true', {
      cwd: workDir, timeout: 180_000, maxBuffer: 50 * 1024 * 1024,
    });
    if (!stdout.trim()) return [];

    const results = JSON.parse(stdout);
    const findings: ScanFinding[] = [];
    for (const r of results.results ?? []) {
      for (const pkg of r.packages ?? []) {
        for (const v of pkg.vulnerabilities ?? []) {
          const cveId = (v.aliases ?? []).find((a: string) => a.startsWith('CVE-')) ?? v.id;
          findings.push({
            type: 'package_vulnerability', severity: 'high',
            title: `${cveId}: ${v.summary ?? 'Vulnerability'} in ${pkg.package?.name ?? 'unknown'}`,
            description: v.details ?? v.summary ?? '',
            cve_id: cveId.startsWith('CVE-') ? cveId : undefined,
            detail: { package_name: pkg.package?.name, ecosystem, osv_id: v.id },
            remediation: 'Check advisory for upgrade instructions.',
            auto_fixable: false,
          });
        }
      }
    }
    return findings;
  } catch { return []; }
}

// ---------------------------------------------------------------------------
// Secret scanning — regex patterns
// ---------------------------------------------------------------------------

interface SecretPattern {
  name: string;
  regex: RegExp;
  severity: ScanFinding['severity'];
}

const SECRET_PATTERNS: SecretPattern[] = [
  { name: 'AWS Access Key', regex: /AKIA[0-9A-Z]{16}/, severity: 'critical' },
  { name: 'AWS Secret Key', regex: /(?:aws_secret_access_key|secret_access_key)\s*[=:]\s*["']?[A-Za-z0-9/+=]{40}/i, severity: 'critical' },
  { name: 'GitHub PAT', regex: /ghp_[A-Za-z0-9]{36}/, severity: 'high' },
  { name: 'GitLab Token', regex: /glpat-[A-Za-z0-9_-]{20,}/, severity: 'high' },
  { name: 'Stripe Secret Key', regex: /sk_live_[0-9a-zA-Z]{24,}/, severity: 'critical' },
  { name: 'RSA Private Key', regex: /-----BEGIN RSA PRIVATE KEY-----/, severity: 'critical' },
  { name: 'EC Private Key', regex: /-----BEGIN EC PRIVATE KEY-----/, severity: 'critical' },
  { name: 'Generic Private Key', regex: /-----BEGIN PRIVATE KEY-----/, severity: 'critical' },
  { name: 'Slack Token', regex: /xox[bporas]-[0-9]{10,}-[A-Za-z0-9-]+/, severity: 'high' },
  { name: 'SendGrid Key', regex: /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/, severity: 'high' },
  { name: 'Database URI', regex: /(?:postgres|mysql|mongodb)(?:\+srv)?:\/\/[^:]+:[^@]+@[^\s]+/, severity: 'high' },
  { name: 'Generic Secret', regex: /(?:password|secret|token|api_key|apikey)\s*[=:]\s*["'][A-Za-z0-9+/=_-]{16,}["']/i, severity: 'medium' },
];

const SECRET_FILE_EXTS = ['ts', 'js', 'py', 'go', 'rb', 'php', 'java', 'env', 'yml', 'yaml', 'json', 'toml', 'cfg', 'conf', 'ini'];
const SECRET_SKIP_PATTERNS = /node_modules|\.lock$|package-lock|go\.sum|\.test\.|_test\.|\.spec\.|\.min\.|dist\/|build\//;

async function scanSecrets(workDir: string): Promise<ScanFinding[]> {
  const findings: ScanFinding[] = [];
  const extArgs = SECRET_FILE_EXTS.map((e) => `--include='*.${e}'`).join(' ');

  for (const p of SECRET_PATTERNS) {
    try {
      const { stdout } = await execAsync(
        `grep -rnl ${extArgs} -E '${p.regex.source}' . 2>/dev/null | head -30`,
        { cwd: workDir, timeout: 15_000 },
      );
      const files = stdout.trim().split('\n').filter(Boolean);
      for (const file of files) {
        const relPath = file.replace(/^\.\//, '');
        if (SECRET_SKIP_PATTERNS.test(relPath)) continue;

        findings.push({
          type: 'secret',
          severity: p.severity,
          title: `${p.name} detected in ${relPath}`,
          description: `Potential ${p.name} found in ${relPath}`,
          detail: { file: relPath, pattern_name: p.name },
          auto_fixable: false,
        });
      }
    } catch { /* grep exit 1 = no match */ }
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
  // Fetch ALL existing findings for this repo (any status) for dedup
  const existingFindings = await prisma.finding.findMany({
    where: { repositoryId },
    select: { id: true, title: true, cveId: true, status: true },
  });

  // Build lookup: key → existing finding
  const existingByKey = new Map<string, { id: string; status: string }>();
  for (const f of existingFindings) {
    existingByKey.set(dedupKey(f.cveId, f.title), { id: f.id, status: f.status });
  }

  const newKeys = new Set<string>();
  let created = 0;
  let reopened = 0;

  for (const f of findings) {
    const key = dedupKey(f.cve_id, f.title);
    newKeys.add(key);

    // Already exists in this repo — don't count as new
    const existing = existingByKey.get(key);
    if (existing) {
      if (existing.status !== 'open' && existing.status !== 'in_progress') {
        // Was resolved/suppressed but scanner found it again — reopen
        await prisma.finding.update({
          where: { id: existing.id },
          data: { status: 'open', scanId, resolvedAt: null },
        });
        reopened++;
      } else {
        // Already open — just link to latest scan
        await prisma.finding.update({
          where: { id: existing.id },
          data: { scanId },
        });
      }
      continue;
    }

    // Truly new finding — not seen in any previous scan of this repo
    await prisma.finding.create({
      data: {
        orgId, scanId, repositoryId,
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

  // Auto-resolve: open findings NOT in this scan's results (only when scan produced results)
  if (newKeys.size > 0) {
    const openFindings = existingFindings.filter((f) =>
      (f.status === 'open' || f.status === 'in_progress') &&
      !newKeys.has(dedupKey(f.cveId, f.title)),
    );
    if (openFindings.length > 0) {
      await prisma.finding.updateMany({
        where: { id: { in: openFindings.map((f) => f.id) } },
        data: { status: 'resolved', resolvedAt: new Date() },
      });
      logger.info('auto-resolved stale findings', { count: openFindings.length });
    }
  }

  logger.info('findings ingested', { created, reopened, total: findings.length });

  return created;
}

function dedupKey(cveId: string | null | undefined, title: string): string {
  return cveId ? `cve:${cveId}` : `title:${title}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function buildAuthenticatedCloneUrl(repo: {
  provider: string; owner: string; name: string; cloneUrl: string | null;
  integration: { config: unknown; baseUrl: string | null } | null;
}): Promise<string> {
  if (!repo.integration) {
    if (repo.cloneUrl) return repo.cloneUrl;
    if (repo.provider === 'gitlab') return `https://gitlab.com/${repo.owner}/${repo.name}.git`;
    return `https://github.com/${repo.owner}/${repo.name}.git`;
  }

  const config = repo.integration.config as Record<string, string>;
  const baseUrl = repo.integration.baseUrl;

  if (repo.provider === 'github') {
    const host = baseUrl ? new URL(baseUrl).host : 'github.com';
    const { token } = await github.getInstallationToken(
      config.installationId, config.appId ?? env.GITHUB_APP_ID,
      env.GITHUB_APP_PRIVATE_KEY, baseUrl ?? undefined,
    );
    return buildGitHubCloneUrl(token, host, repo.owner, repo.name);
  }

  if (repo.provider === 'gitlab') {
    const host = baseUrl ? new URL(baseUrl).host : 'gitlab.com';
    return buildGitLabCloneUrl(config.accessToken, host, repo.owner, repo.name);
  }

  throw new Error(`Unsupported provider: ${repo.provider}`);
}

function stripTokens(msg: string): string {
  return msg.replace(/https:\/\/[^@]+@/g, 'https://***@');
}
