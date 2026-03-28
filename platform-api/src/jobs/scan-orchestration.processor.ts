import { execFile, exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Job } from 'bullmq';

import { prisma } from '../lib/prisma.js';
import { jobLogger } from '../lib/logger.js';
import { GitHubClient } from '../lib/github.js';
import { ingestFindings } from '../modules/agents/findings-ingestion.service.js';
import type { JobContext } from './context.js';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

export interface ScanOrchestrationJobData extends JobContext {
  scanId: string;
  repositoryId?: string;
  serverId?: string;
  orgId: string;
}

/**
 * BullMQ processor: full code scan pipeline.
 *
 * 1. Mark scan as "running"
 * 2. Clone repo (authenticated via provider token)
 * 3. Run sc-scan Go binary (or built-in Node scanner fallback)
 * 4. Ingest findings into platform
 * 5. Mark scan as "completed" or "failed"
 */
export async function processScanOrchestration(job: Job<ScanOrchestrationJobData>): Promise<void> {
  const { scanId, repositoryId, orgId, request_id } = job.data;
  const log = jobLogger(job.queueName, job.id ?? 'unknown', request_id);

  const scan = await prisma.scan.findUnique({ where: { id: scanId } });
  if (!scan) { log.warn('Scan not found', { scanId }); return; }
  if (scan.status === 'cancelled') { log.info('Scan cancelled', { scanId }); return; }

  const startedAt = new Date();
  await prisma.scan.update({ where: { id: scanId }, data: { status: 'running', startedAt } });
  log.info('Scan started', { scanId, scanType: scan.scanType, repositoryId });

  const workDir = path.join(os.tmpdir(), `sc-scan-${scanId}`);

  try {
    if (!repositoryId) throw new Error('No repositoryId — cannot scan without a target');

    const repo = await prisma.repository.findUnique({ where: { id: repositoryId } });
    if (!repo) throw new Error(`Repository ${repositoryId} not found`);

    // --- Clone ---
    log.info('Cloning repository', { repo: `${repo.owner}/${repo.name}`, provider: repo.provider });
    const cloneUrl = await buildCloneUrl(repo.provider, repo.orgId, repo.owner, repo.name);
    await cloneRepo(cloneUrl, repo.defaultBranch, workDir);
    log.info('Clone complete', { workDir });

    // --- Detect ecosystems ---
    const ecosystems = await detectEcosystems(workDir);
    log.info('Detected ecosystems', { ecosystems });

    // --- Scan ---
    const requestedType = (scan.metadata as Record<string, unknown>)?.requestedType as string | undefined;
    const effectiveScanType = requestedType === 'code_secrets' ? 'code_secrets' : scan.scanType;
    log.info('Running scanner', { effectiveScanType, ecosystems });
    const findings = await runScanner(workDir, effectiveScanType, log);
    log.info('Scan finished', { findingCount: findings.length });

    // --- Ingest findings ---
    if (findings.length > 0) {
      const result = await ingestFindings(orgId, {
        agent_id: 'platform-scanner',
        scan_type: scan.scanType as any,
        started_at: startedAt.toISOString(),
        completed_at: new Date().toISOString(),
        findings,
      }, request_id);
      log.info('Findings ingested', { created: result.findingsCreated, updated: result.findingsUpdated, resolved: result.findingsResolved });
    }

    // --- Complete ---
    await prisma.repository.update({ where: { id: repositoryId }, data: { lastScanAt: new Date() } });

    const completedAt = new Date();
    await prisma.scan.update({
      where: { id: scanId },
      data: {
        status: 'completed',
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        findingsTotal: findings.length,
        findingsNew: findings.length,
        metadata: { ...(scan.metadata as Record<string, unknown>), ecosystems } as any,
      },
    });
    log.info('Scan completed', { scanId, findings: findings.length, durationMs: completedAt.getTime() - startedAt.getTime() });

  } catch (err) {
    await prisma.scan.update({
      where: { id: scanId },
      data: { status: 'failed', completedAt: new Date(), durationMs: Date.now() - startedAt.getTime(), errorMessage: (err as Error).message },
    });
    log.error('Scan failed', { scanId, error: (err as Error).message });
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ===========================================================================
// Git clone with provider auth
// ===========================================================================

async function buildCloneUrl(provider: string, orgId: string, owner: string, name: string): Promise<string> {
  const integration = await prisma.integration.findFirst({ where: { orgId, provider, status: 'active' } });

  if (!integration) {
    // Public fallback
    if (provider === 'gitlab') return `https://gitlab.com/${owner}/${name}.git`;
    if (provider === 'bitbucket') return `https://bitbucket.org/${owner}/${name}.git`;
    return `https://github.com/${owner}/${name}.git`;
  }

  const config = integration.config as Record<string, string>;

  switch (provider) {
    case 'github': {
      const gh = await GitHubClient.forInstallation(config.installation_id);
      // Access the token for HTTPS clone auth
      const token = (gh as any).token as string;
      return `https://x-access-token:${token}@github.com/${owner}/${name}.git`;
    }
    case 'gitlab': {
      const host = new URL(config.base_url ?? 'https://gitlab.com').host;
      return `https://oauth2:${config.access_token}@${host}/${owner}/${name}.git`;
    }
    case 'bitbucket': {
      return `https://${config.username}:${config.app_password}@bitbucket.org/${owner}/${name}.git`;
    }
    default:
      return `https://github.com/${owner}/${name}.git`;
  }
}

async function cloneRepo(cloneUrl: string, branch: string, destDir: string): Promise<void> {
  await fs.mkdir(destDir, { recursive: true });

  try {
    await execAsync(
      `git clone --depth 1 --branch '${branch}' '${cloneUrl}' '${destDir}'`,
      { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
    );
  } catch (err) {
    // Strip tokens from error message
    const msg = (err as Error).message.replace(/https:\/\/[^@]+@/g, 'https://***@');
    throw new Error(`Git clone failed: ${msg}`);
  }
}

// ===========================================================================
// Scanner: try Go binary, fallback to built-in Node
// ===========================================================================

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

async function runScanner(workDir: string, scanType: string, log: ReturnType<typeof jobLogger>): Promise<ScanFinding[]> {
  // Try sc-scan Go binary
  const binary = await findBinary('sc-scan');
  if (binary) {
    log.info('Using sc-scan binary', { path: binary });
    return runGoBinary(binary, workDir, scanType, log);
  }

  log.info('sc-scan binary not found, using built-in Node scanner');
  return runBuiltinScanner(workDir, scanType, log);
}

async function findBinary(name: string): Promise<string | null> {
  for (const p of [path.resolve('..', 'go', 'bin', name), `/usr/local/bin/${name}`]) {
    try { await fs.access(p, fs.constants.X_OK); return p; } catch {}
  }
  try { const { stdout } = await execAsync(`which ${name}`); return stdout.trim(); } catch {}
  return null;
}

async function runGoBinary(bin: string, workDir: string, scanType: string, log: ReturnType<typeof jobLogger>): Promise<ScanFinding[]> {
  const args = ['--path', workDir, '--output', 'json', '--no-upload'];
  if (scanType === 'code_dependencies') { args.push('--scan-deps', '--scan-secrets=false'); }
  else if (scanType === 'code_secrets') { args.push('--scan-deps=false', '--scan-secrets'); }

  try {
    const { stdout } = await execFileAsync(bin, args, { timeout: 300_000, maxBuffer: 50 * 1024 * 1024 });
    return JSON.parse(stdout) as ScanFinding[];
  } catch (err) {
    log.warn('sc-scan binary failed, falling back', { error: (err as Error).message });
    return runBuiltinScanner(workDir, scanType, log);
  }
}

// ===========================================================================
// Built-in Node.js scanner (no Go binary needed)
// ===========================================================================

async function runBuiltinScanner(workDir: string, scanType: string, log: ReturnType<typeof jobLogger>): Promise<ScanFinding[]> {
  const findings: ScanFinding[] = [];

  // 1. Dependency scan (SCA) — npm audit, pip-audit, composer audit, bundle-audit
  if (scanType !== 'code_secrets') {
    const depFindings = await scanDependencies(workDir, log);
    findings.push(...depFindings);
  }

  // 2. SAST scan — Semgrep for code-level vulnerabilities (SQL injection, XSS, etc.)
  if (scanType !== 'code_secrets') {
    const sastFindings = await runSemgrep(workDir, log);
    findings.push(...sastFindings);
  }

  // 3. Secret scan — regex patterns for hardcoded credentials
  const secretFindings = await scanSecrets(workDir, log);
  findings.push(...secretFindings);

  return findings;
}

// --- Dependency scanning via native audit tools ---

async function scanDependencies(workDir: string, log: ReturnType<typeof jobLogger>): Promise<ScanFinding[]> {
  const findings: ScanFinding[] = [];

  // npm audit
  if (await fileExists(path.join(workDir, 'package-lock.json')) || await fileExists(path.join(workDir, 'yarn.lock'))) {
    const npmFindings = await runNpmAudit(workDir, log);
    findings.push(...npmFindings);
  }

  // pip-audit
  if (await fileExists(path.join(workDir, 'requirements.txt'))) {
    const pipFindings = await runPipAudit(workDir, log);
    findings.push(...pipFindings);
  }

  // composer audit (PHP)
  if (await fileExists(path.join(workDir, 'composer.lock'))) {
    const composerFindings = await runComposerAudit(workDir, log);
    findings.push(...composerFindings);
  }

  // bundle-audit (Ruby)
  if (await fileExists(path.join(workDir, 'Gemfile.lock'))) {
    const bundleFindings = await runBundleAudit(workDir, log);
    findings.push(...bundleFindings);
  }

  // govulncheck (Go)
  if (await fileExists(path.join(workDir, 'go.sum'))) {
    const goFindings = await runGoVulncheck(workDir, log);
    findings.push(...goFindings);
  }

  // cargo audit (Rust)
  if (await fileExists(path.join(workDir, 'Cargo.lock'))) {
    const rustFindings = await runCargoAudit(workDir, log);
    findings.push(...rustFindings);
  }

  // Maven (Java)
  if (await fileExists(path.join(workDir, 'pom.xml'))) {
    const mavenFindings = await runMvnAudit(workDir, log);
    findings.push(...mavenFindings);
  }

  // Gradle (Java/Kotlin)
  if (!await fileExists(path.join(workDir, 'pom.xml')) &&
      (await fileExists(path.join(workDir, 'build.gradle')) || await fileExists(path.join(workDir, 'build.gradle.kts')))) {
    const gradleFindings = await runGradleAudit(workDir, log);
    findings.push(...gradleFindings);
  }

  // .NET
  if (await fileExists(path.join(workDir, 'packages.config')) ||
      await fileExists(path.join(workDir, 'Directory.Packages.props')) ||
      (await findFileWithExt(workDir, '.csproj'))) {
    const dotnetFindings = await runDotnetAudit(workDir, log);
    findings.push(...dotnetFindings);
  }

  return findings;
}

async function findFileWithExt(dir: string, ext: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dir);
    return entries.some((e) => e.endsWith(ext));
  } catch { return false; }
}

async function fileExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

// ---------------------------------------------------------------------------
// npm audit --json
// ---------------------------------------------------------------------------

interface NpmAuditVuln {
  name: string;
  severity: string;
  via: Array<{ title?: string; url?: string; cwe?: string[]; cvss?: { score: number }; range?: string; source?: number } | string>;
  effects: string[];
  range: string;
  fixAvailable: boolean | { name: string; version: string };
}

async function runNpmAudit(workDir: string, log: ReturnType<typeof jobLogger>): Promise<ScanFinding[]> {
  log.info('Running npm audit', { workDir });

  try {
    // npm audit exits non-zero when vulns found — that's expected
    const { stdout } = await execAsync('npm audit --json 2>/dev/null || true', {
      cwd: workDir,
      timeout: 120_000,
      maxBuffer: 50 * 1024 * 1024,
    });

    if (!stdout.trim()) {
      log.info('npm audit returned empty output');
      return [];
    }

    const audit = JSON.parse(stdout);
    const vulns: Record<string, NpmAuditVuln> = audit.vulnerabilities ?? {};

    const findings: ScanFinding[] = [];
    for (const [pkgName, vuln] of Object.entries(vulns)) {
      // Extract advisory info from `via`
      const advisory = vuln.via.find((v): v is Exclude<typeof v, string> => typeof v !== 'string' && !!v.title);

      const severity = mapNpmSeverity(vuln.severity);
      const title = advisory?.title ?? `Vulnerability in ${pkgName}`;
      const cveUrl = advisory?.url ?? '';
      const cveId = cveUrl.match(/CVE-\d{4}-\d+/)?.[0] ?? cveUrl.match(/GHSA-[a-z0-9-]+/)?.[0] ?? '';
      const cvssScore = advisory?.cvss?.score;

      const fixInfo = typeof vuln.fixAvailable === 'object' ? vuln.fixAvailable : null;

      findings.push({
        type: 'package_vulnerability',
        severity,
        title: `${title} in ${pkgName}`,
        description: `Package ${pkgName} (${vuln.range}) is vulnerable. ${cveUrl ? `Advisory: ${cveUrl}` : ''}`,
        cve_id: cveId || undefined,
        cvss_score: cvssScore,
        detail: {
          package_name: pkgName,
          ecosystem: 'npm',
          affected_range: vuln.range,
          advisory_url: cveUrl,
          cwe: advisory?.cwe,
          effects: vuln.effects,
        },
        remediation: fixInfo
          ? `Upgrade ${fixInfo.name} to ${fixInfo.version}: npm install ${fixInfo.name}@${fixInfo.version}`
          : 'No fix available yet. Check advisory for workarounds.',
        auto_fixable: !!vuln.fixAvailable,
      });
    }

    log.info('npm audit complete', { vulnerabilities: findings.length });
    return findings;
  } catch (err) {
    log.warn('npm audit failed', { error: (err as Error).message });
    return [];
  }
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
// pip-audit --json (or pip audit via pip)
// ---------------------------------------------------------------------------

async function runPipAudit(workDir: string, log: ReturnType<typeof jobLogger>): Promise<ScanFinding[]> {
  log.info('Running pip-audit', { workDir });

  // Try pip-audit first, then fall back to safety
  const cmds = [
    'pip-audit -r requirements.txt --format json 2>/dev/null',
    'python3 -m pip_audit -r requirements.txt --format json 2>/dev/null',
  ];

  for (const cmd of cmds) {
    try {
      const { stdout } = await execAsync(`${cmd} || true`, {
        cwd: workDir,
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
      });

      if (!stdout.trim() || stdout.trim() === '[]') {
        log.info('pip-audit returned no vulnerabilities');
        return [];
      }

      const results = JSON.parse(stdout) as Array<{
        name: string;
        version: string;
        vulns: Array<{ id: string; description: string; fix_versions: string[]; aliases: string[] }>;
      }>;

      const findings: ScanFinding[] = [];
      for (const pkg of results) {
        for (const vuln of pkg.vulns ?? []) {
          const cveId = vuln.aliases?.find((a) => a.startsWith('CVE-')) ?? vuln.id;
          const fixVersion = vuln.fix_versions?.[0];

          findings.push({
            type: 'package_vulnerability',
            severity: 'high', // pip-audit doesn't provide severity; default high
            title: `${cveId} in ${pkg.name}@${pkg.version}`,
            description: vuln.description || `Vulnerability ${vuln.id} in ${pkg.name}`,
            cve_id: cveId.startsWith('CVE-') ? cveId : undefined,
            detail: {
              package_name: pkg.name,
              installed_version: pkg.version,
              ecosystem: 'pypi',
              vuln_id: vuln.id,
              fix_versions: vuln.fix_versions,
            },
            remediation: fixVersion
              ? `Upgrade: pip install ${pkg.name}==${fixVersion}`
              : 'No fix available yet.',
            auto_fixable: !!fixVersion,
          });
        }
      }

      log.info('pip-audit complete', { vulnerabilities: findings.length });
      return findings;
    } catch {
      // Try next command
    }
  }

  log.info('pip-audit not available, skipping Python dependency scan');
  return [];
}

// ---------------------------------------------------------------------------
// composer audit --format=json (PHP)
// ---------------------------------------------------------------------------

async function runComposerAudit(workDir: string, log: ReturnType<typeof jobLogger>): Promise<ScanFinding[]> {
  log.info('Running composer audit', { workDir });

  try {
    const { stdout } = await execAsync('composer audit --format=json 2>/dev/null || true', {
      cwd: workDir,
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024,
    });

    if (!stdout.trim()) return [];

    const audit = JSON.parse(stdout);
    const advisories: Record<string, Array<{ advisoryId: string; packageName: string; title: string; cve: string; affectedVersions: string; reportedAt: string }>> = audit.advisories ?? {};

    const findings: ScanFinding[] = [];
    for (const [, advList] of Object.entries(advisories)) {
      for (const adv of advList) {
        findings.push({
          type: 'package_vulnerability',
          severity: 'high',
          title: `${adv.cve || adv.advisoryId}: ${adv.title}`,
          description: adv.title,
          cve_id: adv.cve || undefined,
          detail: { package_name: adv.packageName, ecosystem: 'composer', affected_versions: adv.affectedVersions, advisory_id: adv.advisoryId },
          remediation: `Update ${adv.packageName} to a patched version: composer update ${adv.packageName}`,
          auto_fixable: true,
        });
      }
    }

    log.info('composer audit complete', { vulnerabilities: findings.length });
    return findings;
  } catch {
    log.info('composer not available, skipping PHP dependency scan');
    return [];
  }
}

// ---------------------------------------------------------------------------
// bundle-audit (Ruby)
// ---------------------------------------------------------------------------

async function runBundleAudit(workDir: string, log: ReturnType<typeof jobLogger>): Promise<ScanFinding[]> {
  log.info('Running bundle-audit', { workDir });

  try {
    const { stdout } = await execAsync('bundle-audit check --format json 2>/dev/null || bundle audit --format json 2>/dev/null || true', {
      cwd: workDir,
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024,
    });

    if (!stdout.trim()) return [];

    // bundle-audit JSON output varies by version; try to parse
    const results = JSON.parse(stdout);
    const findings: ScanFinding[] = [];

    const vulns = results.results ?? results.advisories ?? [];
    for (const v of vulns) {
      findings.push({
        type: 'package_vulnerability',
        severity: mapBundleSeverity(v.criticality ?? 'unknown'),
        title: `${v.cve || v.advisory}: ${v.title ?? 'Vulnerability'} in ${v.gem ?? v.name ?? 'unknown'}`,
        cve_id: v.cve || undefined,
        detail: { package_name: v.gem ?? v.name, ecosystem: 'rubygems', advisory: v.advisory },
        remediation: v.patched_versions ? `Update to: ${v.patched_versions}` : 'No fix available.',
        auto_fixable: !!v.patched_versions,
      });
    }

    log.info('bundle-audit complete', { vulnerabilities: findings.length });
    return findings;
  } catch {
    log.info('bundle-audit not available, skipping Ruby dependency scan');
    return [];
  }
}

function mapBundleSeverity(s: string): ScanFinding['severity'] {
  switch (s.toLowerCase()) {
    case 'critical': return 'critical';
    case 'high': return 'high';
    case 'medium': return 'medium';
    case 'low': return 'low';
    default: return 'high';
  }
}

// ---------------------------------------------------------------------------
// govulncheck (Go)
// ---------------------------------------------------------------------------

async function runGoVulncheck(workDir: string, log: ReturnType<typeof jobLogger>): Promise<ScanFinding[]> {
  log.info('Running govulncheck', { workDir });

  try {
    await execAsync('govulncheck --version', { timeout: 5000 });
  } catch {
    log.info('govulncheck not installed, skipping Go scan. Install with: go install golang.org/x/vuln/cmd/govulncheck@latest');
    return [];
  }

  try {
    const { stdout } = await execAsync('govulncheck -json ./... 2>/dev/null || true', {
      cwd: workDir,
      timeout: 180_000,
      maxBuffer: 50 * 1024 * 1024,
      env: { ...process.env, GOFLAGS: '-mod=readonly' },
    });

    if (!stdout.trim()) return [];

    const findings: ScanFinding[] = [];
    // govulncheck JSON outputs one object per line (NDJSON)
    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        const vuln = entry.finding;
        if (!vuln) continue;

        const osv = entry.osv ?? {};
        const aliases = osv.aliases ?? [];
        const cveId = aliases.find((a: string) => a.startsWith('CVE-')) ?? osv.id ?? '';

        findings.push({
          type: 'package_vulnerability',
          severity: mapGoSeverity(osv.database_specific?.severity ?? ''),
          title: `${cveId || osv.id}: ${osv.summary ?? 'Go vulnerability'}`,
          description: osv.details ?? osv.summary ?? '',
          cve_id: cveId || undefined,
          detail: {
            package_name: vuln.trace?.[0]?.module ?? 'unknown',
            ecosystem: 'go',
            osv_id: osv.id,
            affected_module: vuln.trace?.[0]?.module,
            affected_function: vuln.trace?.[0]?.function,
            fixed_version: osv.affected?.[0]?.ranges?.[0]?.events?.find((e: any) => e.fixed)?.fixed,
          },
          remediation: osv.affected?.[0]?.ranges?.[0]?.events?.find((e: any) => e.fixed)?.fixed
            ? `Update module to version ${osv.affected[0].ranges[0].events.find((e: any) => e.fixed).fixed}`
            : 'No fix available yet. Check advisory for workarounds.',
          auto_fixable: !!osv.affected?.[0]?.ranges?.[0]?.events?.find((e: any) => e.fixed),
        });
      } catch {
        // skip unparseable lines
      }
    }

    log.info('govulncheck complete', { vulnerabilities: findings.length });
    return findings;
  } catch (err) {
    log.warn('govulncheck failed', { error: (err as Error).message.slice(0, 200) });
    return [];
  }
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
// cargo audit (Rust)
// ---------------------------------------------------------------------------

async function runCargoAudit(workDir: string, log: ReturnType<typeof jobLogger>): Promise<ScanFinding[]> {
  log.info('Running cargo audit', { workDir });

  try {
    await execAsync('cargo audit --version', { timeout: 5000 });
  } catch {
    log.info('cargo-audit not installed, skipping Rust scan. Install with: cargo install cargo-audit');
    return [];
  }

  try {
    const { stdout } = await execAsync('cargo audit --json 2>/dev/null || true', {
      cwd: workDir,
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });

    if (!stdout.trim()) return [];

    const audit = JSON.parse(stdout);
    const vulns = audit.vulnerabilities?.list ?? [];
    const findings: ScanFinding[] = [];

    for (const v of vulns) {
      const adv = v.advisory ?? {};
      findings.push({
        type: 'package_vulnerability',
        severity: mapCargoSeverity(adv.cvss?.score),
        title: `${adv.id}: ${adv.title ?? 'Rust vulnerability'} in ${v.package?.name ?? 'unknown'}`,
        description: adv.description ?? adv.title ?? '',
        cve_id: adv.aliases?.find((a: string) => a.startsWith('CVE-')) ?? adv.id ?? undefined,
        cvss_score: adv.cvss?.score,
        detail: {
          package_name: v.package?.name,
          installed_version: v.package?.version,
          ecosystem: 'crates',
          advisory_id: adv.id,
          patched_versions: v.versions?.patched,
          unaffected_versions: v.versions?.unaffected,
        },
        remediation: v.versions?.patched?.length
          ? `Update ${v.package?.name} to: ${v.versions.patched.join(' or ')}`
          : 'No patched version available.',
        auto_fixable: !!v.versions?.patched?.length,
      });
    }

    log.info('cargo audit complete', { vulnerabilities: findings.length });
    return findings;
  } catch (err) {
    log.warn('cargo audit failed', { error: (err as Error).message.slice(0, 200) });
    return [];
  }
}

function mapCargoSeverity(cvss?: number): ScanFinding['severity'] {
  if (!cvss) return 'high';
  if (cvss >= 9.0) return 'critical';
  if (cvss >= 7.0) return 'high';
  if (cvss >= 4.0) return 'medium';
  return 'low';
}

// ---------------------------------------------------------------------------
// Maven dependency-check (Java)
// ---------------------------------------------------------------------------

async function runMvnAudit(workDir: string, log: ReturnType<typeof jobLogger>): Promise<ScanFinding[]> {
  log.info('Running Maven dependency check', { workDir });

  // Try mvn dependency:tree + OWASP dependency-check, or fall back to parsing pom.xml
  try {
    await execAsync('mvn --version', { timeout: 5000 });
  } catch {
    log.info('Maven not installed, trying osv-scanner for Java');
    return runOsvScanner(workDir, 'maven', log);
  }

  try {
    // Use mvn org.owasp:dependency-check-maven:check if plugin is configured,
    // otherwise fall back to osv-scanner
    const { stdout } = await execAsync(
      'mvn org.owasp:dependency-check-maven:check -Dformat=JSON -DprettyPrint=true -DfailBuildOnCVSS=999 -q 2>/dev/null || true',
      { cwd: workDir, timeout: 300_000, maxBuffer: 50 * 1024 * 1024 },
    );

    // Check if the JSON report was generated
    const reportPath = path.join(workDir, 'target', 'dependency-check-report.json');
    if (await fileExists(reportPath)) {
      const reportStr = await fs.readFile(reportPath, 'utf-8');
      return parseDependencyCheckReport(reportStr, 'maven', log);
    }

    // Fallback
    return runOsvScanner(workDir, 'maven', log);
  } catch {
    return runOsvScanner(workDir, 'maven', log);
  }
}

// ---------------------------------------------------------------------------
// Gradle dependency-check (Java/Kotlin)
// ---------------------------------------------------------------------------

async function runGradleAudit(workDir: string, log: ReturnType<typeof jobLogger>): Promise<ScanFinding[]> {
  log.info('Running Gradle dependency check', { workDir });

  try {
    const gradleCmd = await fileExists(path.join(workDir, 'gradlew')) ? './gradlew' : 'gradle';

    const { stdout } = await execAsync(
      `${gradleCmd} dependencyCheckAnalyze -DdependencyCheck.format=JSON -q 2>/dev/null || true`,
      { cwd: workDir, timeout: 300_000, maxBuffer: 50 * 1024 * 1024 },
    );

    const reportPath = path.join(workDir, 'build', 'reports', 'dependency-check-report.json');
    if (await fileExists(reportPath)) {
      const reportStr = await fs.readFile(reportPath, 'utf-8');
      return parseDependencyCheckReport(reportStr, 'gradle', log);
    }

    return runOsvScanner(workDir, 'gradle', log);
  } catch {
    return runOsvScanner(workDir, 'gradle', log);
  }
}

// ---------------------------------------------------------------------------
// OWASP dependency-check JSON report parser (shared by Maven & Gradle)
// ---------------------------------------------------------------------------

function parseDependencyCheckReport(reportStr: string, ecosystem: string, log: ReturnType<typeof jobLogger>): ScanFinding[] {
  try {
    const report = JSON.parse(reportStr);
    const deps = report.dependencies ?? [];
    const findings: ScanFinding[] = [];

    for (const dep of deps) {
      const vulns = dep.vulnerabilities ?? [];
      for (const vuln of vulns) {
        findings.push({
          type: 'package_vulnerability',
          severity: mapCargoSeverity(vuln.cvssv3?.baseScore ?? vuln.cvssv2?.score),
          title: `${vuln.name}: ${vuln.description?.slice(0, 100) ?? 'Vulnerability'} in ${dep.fileName ?? 'unknown'}`,
          description: vuln.description ?? '',
          cve_id: vuln.name?.startsWith('CVE-') ? vuln.name : undefined,
          cvss_score: vuln.cvssv3?.baseScore ?? vuln.cvssv2?.score,
          detail: {
            package_name: dep.fileName,
            ecosystem,
            evidence: dep.evidenceCollected?.vendorEvidence?.slice(0, 3),
          },
          remediation: 'Update the dependency to a non-vulnerable version.',
          auto_fixable: false,
        });
      }
    }

    log.info('Dependency-check report parsed', { ecosystem, vulnerabilities: findings.length });
    return findings;
  } catch {
    log.warn('Failed to parse dependency-check report', { ecosystem });
    return [];
  }
}

// ---------------------------------------------------------------------------
// dotnet list package --vulnerable (.NET / C#)
// ---------------------------------------------------------------------------

async function runDotnetAudit(workDir: string, log: ReturnType<typeof jobLogger>): Promise<ScanFinding[]> {
  log.info('Running dotnet vulnerability check', { workDir });

  try {
    await execAsync('dotnet --version', { timeout: 5000 });
  } catch {
    log.info('dotnet SDK not installed, trying osv-scanner for .NET');
    return runOsvScanner(workDir, 'nuget', log);
  }

  try {
    const { stdout } = await execAsync(
      'dotnet list package --vulnerable --format json 2>/dev/null || true',
      { cwd: workDir, timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
    );

    if (!stdout.trim()) return runOsvScanner(workDir, 'nuget', log);

    // Try to parse .NET 8+ JSON format
    try {
      const report = JSON.parse(stdout);
      const findings: ScanFinding[] = [];

      for (const project of report.projects ?? []) {
        for (const framework of project.frameworks ?? []) {
          for (const pkg of framework.topLevelPackages ?? []) {
            for (const vuln of pkg.vulnerabilities ?? []) {
              findings.push({
                type: 'package_vulnerability',
                severity: mapDotnetSeverity(vuln.severity),
                title: `${vuln.advisoryUrl?.match(/CVE-[\d-]+/)?.[0] ?? 'Vulnerability'} in ${pkg.id}@${pkg.resolvedVersion}`,
                description: `Package ${pkg.id} version ${pkg.resolvedVersion} is vulnerable.`,
                cve_id: vuln.advisoryUrl?.match(/CVE-[\d-]+/)?.[0],
                detail: {
                  package_name: pkg.id,
                  installed_version: pkg.resolvedVersion,
                  ecosystem: 'nuget',
                  advisory_url: vuln.advisoryUrl,
                  framework: framework.framework,
                },
                remediation: `Update: dotnet add package ${pkg.id}`,
                auto_fixable: true,
              });
            }
          }
        }
      }

      log.info('dotnet audit complete', { vulnerabilities: findings.length });
      return findings;
    } catch {
      return runOsvScanner(workDir, 'nuget', log);
    }
  } catch {
    return runOsvScanner(workDir, 'nuget', log);
  }
}

function mapDotnetSeverity(s: string): ScanFinding['severity'] {
  switch (s?.toLowerCase()) {
    case 'critical': return 'critical';
    case 'high': return 'high';
    case 'moderate': case 'medium': return 'medium';
    case 'low': return 'low';
    default: return 'high';
  }
}

// ---------------------------------------------------------------------------
// osv-scanner — universal fallback for any ecosystem
// ---------------------------------------------------------------------------

async function runOsvScanner(workDir: string, ecosystem: string, log: ReturnType<typeof jobLogger>): Promise<ScanFinding[]> {
  try {
    await execAsync('osv-scanner --version', { timeout: 5000 });
  } catch {
    log.info(`osv-scanner not installed, skipping ${ecosystem} fallback scan. Install: go install github.com/google/osv-scanner/cmd/osv-scanner@latest`);
    return [];
  }

  log.info(`Running osv-scanner as fallback for ${ecosystem}`);

  try {
    const { stdout } = await execAsync(
      `osv-scanner --format json --recursive '${workDir}' 2>/dev/null || true`,
      { timeout: 180_000, maxBuffer: 50 * 1024 * 1024 },
    );

    if (!stdout.trim()) return [];

    const output = JSON.parse(stdout);
    const results = output.results ?? [];
    const findings: ScanFinding[] = [];

    for (const result of results) {
      for (const pkg of result.packages ?? []) {
        for (const vuln of pkg.vulnerabilities ?? []) {
          const aliases = vuln.aliases ?? [];
          const cveId = aliases.find((a: string) => a.startsWith('CVE-'));
          const severity = vuln.database_specific?.severity ?? vuln.severity?.[0]?.score;

          findings.push({
            type: 'package_vulnerability',
            severity: typeof severity === 'number' ? mapCargoSeverity(severity) : mapGoSeverity(severity ?? ''),
            title: `${cveId ?? vuln.id}: ${vuln.summary ?? 'Vulnerability'} in ${pkg.package?.name ?? 'unknown'}`,
            description: vuln.details ?? vuln.summary ?? '',
            cve_id: cveId ?? undefined,
            cvss_score: typeof severity === 'number' ? severity : undefined,
            detail: {
              package_name: pkg.package?.name,
              installed_version: pkg.package?.version,
              ecosystem: pkg.package?.ecosystem ?? ecosystem,
              osv_id: vuln.id,
              aliases,
            },
            remediation: vuln.affected?.[0]?.ranges?.[0]?.events?.find((e: any) => e.fixed)
              ? `Update to version ${vuln.affected[0].ranges[0].events.find((e: any) => e.fixed).fixed}`
              : 'No fix available yet.',
            auto_fixable: !!vuln.affected?.[0]?.ranges?.[0]?.events?.find((e: any) => e.fixed),
          });
        }
      }
    }

    log.info(`osv-scanner complete for ${ecosystem}`, { vulnerabilities: findings.length });
    return findings;
  } catch (err) {
    log.warn(`osv-scanner failed for ${ecosystem}`, { error: (err as Error).message.slice(0, 200) });
    return [];
  }
}

// ===========================================================================
// SAST — Semgrep (static application security testing)
// ===========================================================================

/**
 * Runs Semgrep with security-focused rulesets.
 * Falls back gracefully if semgrep is not installed.
 *
 * Rulesets used:
 *   p/owasp-top-ten     — OWASP Top 10 (SQL injection, XSS, SSRF, etc.)
 *   p/security-audit    — General security patterns
 *   p/secrets           — Hardcoded secrets (overlaps with our regex scanner)
 *   p/default           — Semgrep recommended rules
 */
async function runSemgrep(workDir: string, log: ReturnType<typeof jobLogger>): Promise<ScanFinding[]> {
  // Check if semgrep is installed
  try {
    await execAsync('semgrep --version', { timeout: 5000 });
  } catch {
    log.info('Semgrep not installed, skipping SAST scan. Install with: pip install semgrep');
    return [];
  }

  log.info('Running Semgrep SAST scan');

  try {
    // Run semgrep with security rulesets, JSON output, no git tracking
    const { stdout } = await execAsync(
      [
        'semgrep scan',
        '--config auto',           // auto-detect best rules for the codebase
        '--json',                  // structured JSON output
        '--quiet',                 // suppress progress bars
        '--no-git',                // don't require git
        '--timeout 60',            // per-rule timeout
        '--max-target-bytes 1000000', // skip files >1MB
        `'${workDir}'`,
      ].join(' '),
      {
        timeout: 300_000,  // 5 min total timeout
        maxBuffer: 50 * 1024 * 1024,
        env: { ...process.env, SEMGREP_SEND_METRICS: 'off' },
      },
    );

    if (!stdout.trim()) {
      log.info('Semgrep returned no results');
      return [];
    }

    const output = JSON.parse(stdout) as SemgrepOutput;
    const findings = parseSemgrepResults(output, workDir);

    log.info('Semgrep SAST complete', {
      rulesRun: output.results?.length ?? 0,
      findings: findings.length,
      errors: output.errors?.length ?? 0,
    });

    return findings;
  } catch (err) {
    // Semgrep exits non-zero when findings exist — try to parse stdout from error
    const execErr = err as { stdout?: string; stderr?: string; message: string };
    if (execErr.stdout) {
      try {
        const output = JSON.parse(execErr.stdout) as SemgrepOutput;
        const findings = parseSemgrepResults(output, workDir);
        log.info('Semgrep SAST complete (with findings)', { findings: findings.length });
        return findings;
      } catch {
        // JSON parse failed
      }
    }
    log.warn('Semgrep scan failed', { error: (err as Error).message.slice(0, 200) });
    return [];
  }
}

// Semgrep JSON output types
interface SemgrepOutput {
  results?: SemgrepResult[];
  errors?: Array<{ message: string }>;
  version?: string;
}

interface SemgrepResult {
  check_id: string;       // e.g., "javascript.express.security.audit.xss.mustache-escape"
  path: string;           // file path
  start: { line: number; col: number };
  end: { line: number; col: number };
  extra: {
    message: string;
    severity: string;     // ERROR | WARNING | INFO
    metadata?: {
      cwe?: string[];               // e.g., ["CWE-79: XSS"]
      owasp?: string[];             // e.g., ["A7:2017 - Cross-Site Scripting"]
      confidence?: string;          // HIGH | MEDIUM | LOW
      impact?: string;              // HIGH | MEDIUM | LOW
      category?: string;            // security | correctness | performance
      technology?: string[];        // e.g., ["express", "react"]
      references?: string[];
      cve?: string;
      vulnerability_class?: string[];
      subcategory?: string[];
    };
    lines?: string;       // matched source code
    fix?: string;         // suggested fix
  };
}

function parseSemgrepResults(output: SemgrepOutput, workDir: string): ScanFinding[] {
  const results = output.results ?? [];

  return results
    .filter((r) => {
      // Only include security-relevant findings
      const cat = r.extra.metadata?.category;
      const sev = r.extra.severity;
      return cat === 'security' || sev === 'ERROR' || sev === 'WARNING';
    })
    .map((r) => {
      const relPath = r.path.replace(workDir + '/', '').replace(workDir, '');
      const meta = r.extra.metadata ?? {};
      const cweList = meta.cwe ?? [];
      const owaspList = meta.owasp ?? [];

      return {
        type: 'sast',
        severity: mapSemgrepSeverity(r.extra.severity, meta.impact),
        title: buildSastTitle(r),
        description: r.extra.message,
        cve_id: meta.cve || cweList[0]?.match(/CWE-\d+/)?.[0] || undefined,
        detail: {
          file: relPath,
          line: r.start.line,
          end_line: r.end.line,
          col: r.start.col,
          rule_id: r.check_id,
          cwe: cweList,
          owasp: owaspList,
          confidence: meta.confidence,
          category: meta.category,
          technology: meta.technology,
          references: meta.references,
          matched_code: r.extra.lines?.slice(0, 200),
          suggested_fix: r.extra.fix,
          vulnerability_class: meta.vulnerability_class,
        },
        remediation: buildSastRemediation(r),
        auto_fixable: !!r.extra.fix,
      } satisfies ScanFinding;
    });
}

function mapSemgrepSeverity(sev: string, impact?: string): ScanFinding['severity'] {
  // Use impact if available (more accurate than severity)
  if (impact) {
    switch (impact.toUpperCase()) {
      case 'HIGH': return 'high';
      case 'MEDIUM': return 'medium';
      case 'LOW': return 'low';
    }
  }

  switch (sev) {
    case 'ERROR': return 'high';
    case 'WARNING': return 'medium';
    case 'INFO': return 'low';
    default: return 'medium';
  }
}

function buildSastTitle(r: SemgrepResult): string {
  const meta = r.extra.metadata ?? {};
  const vulnClass = meta.vulnerability_class?.[0];
  const relPath = r.path.split('/').slice(-2).join('/');

  if (vulnClass) {
    return `${vulnClass} in ${relPath}:${r.start.line}`;
  }

  // Extract meaningful name from check_id: "javascript.express.security.audit.xss.foo" → "XSS"
  const parts = r.check_id.split('.');
  const ruleName = parts[parts.length - 1].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return `${ruleName} in ${relPath}:${r.start.line}`;
}

function buildSastRemediation(r: SemgrepResult): string {
  const parts: string[] = [];

  if (r.extra.fix) {
    parts.push(`Suggested fix: ${r.extra.fix}`);
  }

  if (r.extra.message) {
    parts.push(r.extra.message);
  }

  const refs = r.extra.metadata?.references;
  if (refs?.length) {
    parts.push(`References: ${refs.slice(0, 3).join(', ')}`);
  }

  return parts.join('\n') || 'Review the code and apply secure coding practices.';
}

// ===========================================================================
// Ecosystem detection
// ===========================================================================

interface EcosystemInfo {
  name: string;
  language: string;
  lockFile: string;
  tools: string[];
}

const ECOSYSTEM_SIGNATURES: Array<{ file: string; ecosystem: EcosystemInfo }> = [
  { file: 'package-lock.json', ecosystem: { name: 'npm', language: 'JavaScript/TypeScript', lockFile: 'package-lock.json', tools: ['npm audit'] } },
  { file: 'yarn.lock', ecosystem: { name: 'yarn', language: 'JavaScript/TypeScript', lockFile: 'yarn.lock', tools: ['npm audit'] } },
  { file: 'pnpm-lock.yaml', ecosystem: { name: 'pnpm', language: 'JavaScript/TypeScript', lockFile: 'pnpm-lock.yaml', tools: ['npm audit'] } },
  { file: 'requirements.txt', ecosystem: { name: 'pypi', language: 'Python', lockFile: 'requirements.txt', tools: ['pip-audit'] } },
  { file: 'Pipfile.lock', ecosystem: { name: 'pypi', language: 'Python', lockFile: 'Pipfile.lock', tools: ['pip-audit'] } },
  { file: 'poetry.lock', ecosystem: { name: 'pypi', language: 'Python', lockFile: 'poetry.lock', tools: ['pip-audit'] } },
  { file: 'composer.lock', ecosystem: { name: 'composer', language: 'PHP', lockFile: 'composer.lock', tools: ['composer audit'] } },
  { file: 'Gemfile.lock', ecosystem: { name: 'rubygems', language: 'Ruby', lockFile: 'Gemfile.lock', tools: ['bundle-audit'] } },
  { file: 'go.sum', ecosystem: { name: 'go', language: 'Go', lockFile: 'go.sum', tools: ['govulncheck'] } },
  { file: 'Cargo.lock', ecosystem: { name: 'crates', language: 'Rust', lockFile: 'Cargo.lock', tools: ['cargo audit'] } },
  { file: 'pom.xml', ecosystem: { name: 'maven', language: 'Java', lockFile: 'pom.xml', tools: ['mvn dependency-check'] } },
  { file: 'build.gradle', ecosystem: { name: 'gradle', language: 'Java/Kotlin', lockFile: 'build.gradle', tools: ['gradle dependencyCheckAnalyze'] } },
  { file: 'build.gradle.kts', ecosystem: { name: 'gradle', language: 'Kotlin', lockFile: 'build.gradle.kts', tools: ['gradle dependencyCheckAnalyze'] } },
  { file: 'Package.swift', ecosystem: { name: 'swiftpm', language: 'Swift', lockFile: 'Package.swift', tools: [] } },
  { file: 'pubspec.lock', ecosystem: { name: 'pub', language: 'Dart/Flutter', lockFile: 'pubspec.lock', tools: [] } },
  { file: 'mix.lock', ecosystem: { name: 'hex', language: 'Elixir', lockFile: 'mix.lock', tools: ['mix audit'] } },
  { file: 'packages.config', ecosystem: { name: 'nuget', language: 'C#/.NET', lockFile: 'packages.config', tools: ['dotnet list package --vulnerable'] } },
  { file: 'Directory.Packages.props', ecosystem: { name: 'nuget', language: 'C#/.NET', lockFile: 'Directory.Packages.props', tools: ['dotnet list package --vulnerable'] } },
];

async function detectEcosystems(workDir: string): Promise<EcosystemInfo[]> {
  const found: EcosystemInfo[] = [];
  const seen = new Set<string>();

  for (const sig of ECOSYSTEM_SIGNATURES) {
    if (await fileExists(path.join(workDir, sig.file)) && !seen.has(sig.ecosystem.name)) {
      found.push(sig.ecosystem);
      seen.add(sig.ecosystem.name);
    }
  }

  return found;
}

// --- Secret scanning ---

const SECRET_PATTERNS = [
  { name: 'AWS Access Key', regex: /AKIA[0-9A-Z]{16}/, severity: 'critical' as const },
  { name: 'AWS Secret Key', regex: /(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[=:]\s*[A-Za-z0-9/+=]{40}/, severity: 'critical' as const },
  { name: 'GitHub PAT', regex: /ghp_[A-Za-z0-9]{36}/, severity: 'high' as const },
  { name: 'GitLab Token', regex: /glpat-[A-Za-z0-9_-]{20,}/, severity: 'high' as const },
  { name: 'Slack Token', regex: /xox[bporas]-[0-9]{10,}-[A-Za-z0-9-]+/, severity: 'high' as const },
  { name: 'Stripe Secret', regex: /sk_live_[0-9a-zA-Z]{24,}/, severity: 'critical' as const },
  { name: 'RSA Private Key', regex: /-----BEGIN RSA PRIVATE KEY-----/, severity: 'critical' as const },
  { name: 'Private Key', regex: /-----BEGIN PRIVATE KEY-----/, severity: 'critical' as const },
  { name: 'PostgreSQL URI', regex: /postgres(?:ql)?:\/\/[^:]+:[^@]+@[^\s]+/, severity: 'high' as const },
  { name: 'MongoDB URI', regex: /mongodb(?:\+srv)?:\/\/[^:]+:[^@]+@[^\s]+/, severity: 'high' as const },
  { name: 'GCP API Key', regex: /AIza[0-9A-Za-z_-]{35}/, severity: 'high' as const },
  { name: 'SendGrid Key', regex: /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/, severity: 'high' as const },
  { name: 'npm Token', regex: /npm_[A-Za-z0-9]{36}/, severity: 'high' as const },
];

const SKIP_DIRS = new Set(['.git', 'node_modules', 'vendor', '__pycache__', 'dist', 'build', '.venv', 'testdata', 'fixtures']);
const SKIP_EXTS = new Set(['.png', '.jpg', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.zip', '.tar', '.gz', '.jar', '.exe', '.pdf', '.svg']);
const SKIP_FILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'Pipfile.lock', 'go.sum', 'Cargo.lock', 'composer.lock']);

async function scanSecrets(workDir: string, log: ReturnType<typeof jobLogger>): Promise<ScanFinding[]> {
  const findings: ScanFinding[] = [];
  const files = await walkDir(workDir);
  log.info('Scanning files for secrets', { fileCount: files.length });

  for (const filePath of files) {
    const relPath = path.relative(workDir, filePath);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        for (const pattern of SECRET_PATTERNS) {
          if (pattern.regex.test(lines[i])) {
            findings.push({
              type: 'secret',
              severity: pattern.severity,
              title: `${pattern.name} detected in ${relPath}`,
              description: `Potential ${pattern.name} found at ${relPath}:${i + 1}`,
              detail: { file: relPath, line: i + 1, pattern_name: pattern.name },
              remediation: 'Remove the secret from source code and rotate the credential immediately',
              auto_fixable: false,
            });
            break; // one finding per line
          }
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  log.info('Secret scan complete', { filesScanned: files.length, secretsFound: findings.length });
  return findings;
}

async function walkDir(dir: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(d: string) {
    const entries = await fs.readdir(d, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && !SKIP_DIRS.has(e.name)) {
        await walk(path.join(d, e.name));
      } else if (e.isFile()) {
        if (!SKIP_EXTS.has(path.extname(e.name).toLowerCase()) && !SKIP_FILES.has(e.name)) {
          const full = path.join(d, e.name);
          const stat = await fs.stat(full);
          if (stat.size <= 1024 * 1024) files.push(full); // skip >1MB
        }
      }
    }
  }

  await walk(dir);
  return files;
}
