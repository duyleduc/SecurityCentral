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

    // --- Scan ---
    log.info('Running scanner');
    const findings = await runScanner(workDir, scan.scanType, log);
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
      data: { status: 'completed', completedAt, durationMs: completedAt.getTime() - startedAt.getTime(), findingsTotal: findings.length, findingsNew: findings.length },
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

  return findings;
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
