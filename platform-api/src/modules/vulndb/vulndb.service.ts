/**
 * Vulnerability Database Service
 *
 * Uses the OSV.dev API for real-time CVE matching (no giant feed download)
 * and CISA KEV for actively-exploited flagging.
 *
 * Scope: OS packages + system binaries only.
 * Language ecosystem CVEs (npm, pip, maven) are handled by sc-scan.
 */

import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';

const CISA_KEV_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';
const EPSS_URL = 'https://api.first.org/data/v1/epss';
const OSV_BATCH_URL = 'https://api.osv.dev/v1/querybatch';
const OSV_VULN_URL = 'https://api.osv.dev/v1/vulns';

// ---------------------------------------------------------------------------
// Feed sync (only CISA KEV — small, ~1MB)
// ---------------------------------------------------------------------------

export async function syncFeeds(): Promise<void> {
  await syncCisaKev();
}

async function syncCisaKev(): Promise<void> {
  try {
    const resp = await fetch(CISA_KEV_URL, { signal: AbortSignal.timeout(15_000) });
    if (!resp.ok) {
      logger.warn('CISA KEV feed fetch failed', { status: resp.status });
      return;
    }
    const data = await resp.json();

    await prisma.vulnerabilityFeed.upsert({
      where: { source: 'cisa_kev' },
      create: { source: 'cisa_kev', lastSyncAt: new Date(), data: data as object },
      update: { lastSyncAt: new Date(), data: data as object },
    });

    const count = (data as { vulnerabilities?: unknown[] }).vulnerabilities?.length ?? 0;
    logger.info('CISA KEV feed synced', { vulnerabilities: count });
  } catch (err) {
    logger.error('CISA KEV feed sync error', { error: (err as Error).message });
  }
}

// ---------------------------------------------------------------------------
// CVE matching via OSV.dev API
// ---------------------------------------------------------------------------

interface PackageInput {
  readonly name: string;
  readonly version: string;
}

interface CveMatch {
  readonly cveId: string;
  readonly packageName: string;
  readonly installedVersion: string;
  readonly fixedVersion: string | null;
  readonly severity: string;
  readonly cvssScore: number | null;
  readonly description: string;
  readonly cisaKev: boolean;
  readonly epss: number | null;      // 0.0–1.0 probability of exploitation in 30 days
  readonly epssPercentile: number | null;
  readonly remediation: string | null;
}

// ---------------------------------------------------------------------------
// EPSS (Exploit Prediction Scoring System) from FIRST.org
// ---------------------------------------------------------------------------

/** Fetch EPSS scores for a batch of CVE IDs. Returns map of cveId → {epss, percentile}. */
async function fetchEpssScores(cveIds: readonly string[]): Promise<Map<string, { epss: number; percentile: number }>> {
  const result = new Map<string, { epss: number; percentile: number }>();
  // Only query actual CVE IDs (not DSA-xxx etc.)
  const validIds = cveIds.filter((id) => id.startsWith('CVE-'));
  if (validIds.length === 0) return result;

  // EPSS API accepts up to 100 CVEs per request via comma-separated query param.
  const chunkSize = 100;
  for (let i = 0; i < validIds.length; i += chunkSize) {
    const chunk = validIds.slice(i, i + chunkSize);
    try {
      const url = `${EPSS_URL}?cve=${chunk.join(',')}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!resp.ok) {
        logger.warn('EPSS API failed', { status: resp.status, chunk: i });
        continue;
      }
      const data = await resp.json() as {
        data: Array<{ cve: string; epss: string; percentile: string }>;
      };
      for (const entry of data.data ?? []) {
        result.set(entry.cve, {
          epss: parseFloat(entry.epss),
          percentile: parseFloat(entry.percentile),
        });
      }
    } catch (err) {
      logger.warn('EPSS fetch error', { error: (err as Error).message, chunk: i });
    }
  }

  logger.info('EPSS scores fetched', { requested: validIds.length, received: result.size });
  return result;
}

// ---------------------------------------------------------------------------
// Remediation command generator
// ---------------------------------------------------------------------------

function buildRemediation(osFamily: string, packageName: string, fixedVersion: string | null): string | null {
  if (!fixedVersion) return null;
  switch (osFamily) {
    case 'debian':
    case 'ubuntu':
      return `sudo apt update && sudo apt install --only-upgrade ${packageName}`;
    case 'rhel':
    case 'centos':
    case 'rocky':
    case 'alma':
    case 'almalinux':
    case 'oracle':
      return `sudo yum update ${packageName}`;
    case 'fedora':
      return `sudo dnf update ${packageName}`;
    case 'amazon':
      return `sudo yum update ${packageName}`;
    case 'alpine':
      return `sudo apk upgrade ${packageName}`;
    default:
      return `Update ${packageName} to ${fixedVersion}`;
  }
}

/**
 * Map OS family to OSV ecosystem name.
 */
function osvEcosystem(osFamily: string): string | null {
  switch (osFamily) {
    case 'debian': return 'Debian';
    case 'ubuntu': return 'Ubuntu';
    case 'alpine': return 'Alpine';
    case 'rhel':
    case 'centos':
    case 'rocky':
    case 'alma':
    case 'almalinux':
    case 'fedora':
    case 'oracle':
    case 'amazon':
      return 'Linux';
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Binary version parsing + OSV mapping
// ---------------------------------------------------------------------------

interface BinaryInput {
  readonly name: string;
  readonly version: string; // raw version string from the agent
}

/** Map binary probe name → OSV package name per ecosystem. */
function binaryToOsv(name: string, ecosystem: string): { pkg: string; ecosystem: string } | null {
  // Package names differ by distro ecosystem.
  const map: Record<string, Record<string, string>> = {
    openssl:    { Debian: 'openssl', Linux: 'openssl' },
    sshd:       { Debian: 'openssh', Linux: 'openssh' },
    curl:       { Debian: 'curl', Linux: 'curl' },
    nginx:      { Debian: 'nginx', Linux: 'nginx' },
    glibc:      { Debian: 'glibc', Linux: 'glibc' },
    docker:     { Debian: 'docker.io', Linux: 'docker' },
    containerd: { Debian: 'containerd', Linux: 'containerd.io' },
    runc:       { Debian: 'runc', Linux: 'runc' },
  };
  const entry = map[name];
  if (!entry) return null;
  const pkg = entry[ecosystem];
  if (!pkg) return null;
  return { pkg, ecosystem };
}

/** Extract a semver-like version from a raw binary output string. */
function parseBinaryVersion(name: string, raw: string): string | null {
  // OpenSSL 3.5.5 27 Jan 2026 → 3.5.5
  // curl 8.14.1 (aarch64-...) → 8.14.1
  // ldd (Debian GLIBC 2.41-12+deb13u2) 2.41 → 2.41
  // OpenSSH_10.0p2 Debian-7+deb13u1 → 10.0p2 → not semver, use Debian pkg version
  // nginx version: nginx/1.24.0 → 1.24.0
  // containerd containerd.io 1.6.28 → 1.6.28

  // Try to extract N.N.N or N.N pattern
  const m = raw.match(/(\d+\.\d+(?:\.\d+)?(?:[-.]\d+[^\s,)]*)?)/);
  if (m) return m[1];
  return null;
}

/**
 * Match packages against OSV.dev in batches.
 * Also matches system binary versions when provided.
 * OSV querybatch allows up to 1000 queries per request.
 */
export async function matchServerPackages(
  serverId: string,
  osFamily: string,
  packages: readonly PackageInput[],
  binaryVersions?: readonly BinaryInput[],
): Promise<CveMatch[]> {
  const ecosystem = osvEcosystem(osFamily);
  if (!ecosystem) {
    logger.info('CVE matching not yet supported for OS family', { osFamily });
    return [];
  }

  // Build additional package queries from binary versions.
  const binaryPackages: Array<PackageInput & { ecosystem: string; binaryName: string }> = [];
  for (const bin of binaryVersions ?? []) {
    const mapping = binaryToOsv(bin.name, ecosystem);
    if (!mapping) continue;
    const ver = parseBinaryVersion(bin.name, bin.version);
    if (!ver) continue;
    binaryPackages.push({ name: mapping.pkg, version: ver, ecosystem: mapping.ecosystem, binaryName: bin.name });
  }
  if (binaryPackages.length > 0) {
    logger.info('Binary versions to match', {
      serverId,
      binaries: binaryPackages.map((b) => `${b.name}@${b.version}`),
    });
  }

  // Load CISA KEV for cross-reference.
  const kevFeed = await prisma.vulnerabilityFeed.findUnique({ where: { source: 'cisa_kev' } });
  const kevSet = new Set<string>();
  if (kevFeed) {
    const kevData = kevFeed.data as { vulnerabilities?: Array<{ cveID?: string }> };
    for (const v of kevData.vulnerabilities ?? []) {
      if (v.cveID) kevSet.add(v.cveID);
    }
  }

  // Query OSV in batches of 1000.
  // Step 1: batch query returns lightweight {id, modified} per vuln.
  // Step 2: fetch full vuln details (in parallel) to get CVSS severity.
  const rawHits: Array<{ vulnId: string; pkg: PackageInput }> = [];
  const batchSize = 1000;

  for (let i = 0; i < packages.length; i += batchSize) {
    const batch = packages.slice(i, i + batchSize);
    const queries = batch.map((pkg) => ({
      package: { name: pkg.name, ecosystem },
      version: pkg.version,
    }));

    try {
      const resp = await fetch(OSV_BATCH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queries }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!resp.ok) {
        logger.warn('OSV batch query failed', { status: resp.status, batch: i });
        continue;
      }

      const data = await resp.json() as { results: Array<{ vulns?: Array<{ id: string }> }> };

      for (let j = 0; j < data.results.length; j++) {
        const vulns = data.results[j].vulns;
        if (!vulns || vulns.length === 0) continue;
        const pkg = batch[j];
        for (const v of vulns) {
          rawHits.push({ vulnId: v.id, pkg });
        }
      }
    } catch (err) {
      logger.error('OSV batch query error', { error: (err as Error).message, batch: i });
    }
  }

  // Also query binary versions (separate batch — may use different ecosystems).
  if (binaryPackages.length > 0) {
    const binQueries = binaryPackages.map((b) => ({
      package: { name: b.name, ecosystem: b.ecosystem },
      version: b.version,
    }));
    try {
      const resp = await fetch(OSV_BATCH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queries: binQueries }),
        signal: AbortSignal.timeout(30_000),
      });
      if (resp.ok) {
        const data = await resp.json() as { results: Array<{ vulns?: Array<{ id: string }> }> };
        for (let j = 0; j < data.results.length; j++) {
          const vulns = data.results[j].vulns;
          if (!vulns || vulns.length === 0) continue;
          const bin = binaryPackages[j];
          for (const v of vulns) {
            rawHits.push({ vulnId: v.id, pkg: { name: `${bin.name} (binary)`, version: bin.version } });
          }
        }
        logger.info('Binary CVE matching done', { binaries: binaryPackages.length, hits: rawHits.length });
      }
    } catch (err) {
      logger.warn('Binary OSV batch query failed', { error: (err as Error).message });
    }
  }

  if (rawHits.length === 0) {
    logger.info('OSV matching completed — no hits', { serverId, queried: packages.length });
    return [];
  }

  // Step 2: fetch full details for unique vuln IDs (parallel, 20 at a time).
  const uniqueIds = [...new Set(rawHits.map((h) => h.vulnId))];
  const vulnCache = new Map<string, OsvVuln>();
  const chunkSize = 20;

  for (let i = 0; i < uniqueIds.length; i += chunkSize) {
    const chunk = uniqueIds.slice(i, i + chunkSize);
    const results = await Promise.allSettled(
      chunk.map(async (vid) => {
        const r = await fetch(`${OSV_VULN_URL}/${vid}`, { signal: AbortSignal.timeout(10_000) });
        if (!r.ok) return null;
        return r.json() as Promise<OsvVuln>;
      }),
    );
    for (let j = 0; j < results.length; j++) {
      const res = results[j];
      if (res.status === 'fulfilled' && res.value) {
        vulnCache.set(chunk[j], res.value);
      }
    }
  }

  logger.info('OSV vuln details fetched', { unique: uniqueIds.length, fetched: vulnCache.size });

  // Step 3: collect unique CVE IDs for EPSS lookup.
  const prelimCves: string[] = [];
  for (const { vulnId } of rawHits) {
    const vuln = vulnCache.get(vulnId);
    if (!vuln) continue;
    const cveId = extractCveId(vuln);
    if (cveId) prelimCves.push(cveId);
  }
  const epssMap = await fetchEpssScores([...new Set(prelimCves)]);

  // Step 4: build matches with severity, EPSS, CVSS, and remediation.
  const matches: CveMatch[] = [];
  const seen = new Set<string>(); // dedup by cveId+packageName

  for (const { vulnId, pkg } of rawHits) {
    const vuln = vulnCache.get(vulnId);
    if (!vuln) continue;

    const cveId = extractCveId(vuln);
    if (!cveId) continue;

    const dedupKey = `${cveId}:${pkg.name}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    const fixedVersion = extractFixedVersion(vuln, pkg.name, ecosystem);
    const isCisaKev = kevSet.has(cveId);
    const severity = isCisaKev ? 'critical' : osvSeverity(vuln);
    const cvssScore = osvCvssScore(vuln);
    const epssEntry = epssMap.get(cveId);

    matches.push({
      cveId,
      packageName: pkg.name,
      installedVersion: pkg.version,
      fixedVersion,
      severity,
      cvssScore,
      description: vuln.summary ?? vuln.details?.slice(0, 200) ?? '',
      cisaKev: isCisaKev,
      epss: epssEntry?.epss ?? null,
      epssPercentile: epssEntry?.percentile ?? null,
      remediation: buildRemediation(osFamily, pkg.name, fixedVersion),
    });
  }

  logger.info('OSV matching completed', { serverId, queried: packages.length, matched: matches.length });
  return matches;
}

/**
 * Create/update Finding records from CVE matches. Auto-resolve stale ones.
 */
export async function applyMatchesToFindings(
  orgId: string,
  serverId: string,
  hostname: string,
  matches: readonly CveMatch[],
): Promise<{ created: number; resolved: number }> {
  const matchedCveIds = new Set(matches.map((m) => m.cveId));
  let created = 0;
  let resolved = 0;

  for (const m of matches) {
    const title = `${m.cveId}: ${m.packageName} on ${hostname}`;
    const existing = await prisma.finding.findFirst({
      where: { orgId, serverId, cveId: m.cveId, source: 'cve_scan', status: { in: ['open', 'in_progress'] } },
    });
    if (existing) continue;

    await prisma.finding.create({
      data: {
        orgId,
        serverId,
        source: 'cve_scan',
        severity: m.severity,
        status: 'open',
        title,
        cveId: m.cveId,
        cvssScore: m.cvssScore,
        description: m.description || `${m.packageName} ${m.installedVersion} is vulnerable.${m.fixedVersion ? ` Fixed in ${m.fixedVersion}.` : ' No fix available yet.'}`,
        detail: JSON.parse(JSON.stringify({
          packageName: m.packageName,
          installedVersion: m.installedVersion,
          fixedVersion: m.fixedVersion,
          cisaKev: m.cisaKev,
          epss: m.epss,
          epssPercentile: m.epssPercentile,
          remediation: m.remediation,
        })),
      },
    });
    created++;
  }

  // Auto-resolve findings for CVEs no longer matched (package was updated).
  const staleFindings = await prisma.finding.findMany({
    where: {
      orgId,
      serverId,
      source: 'cve_scan',
      status: { in: ['open', 'in_progress'] },
      cveId: { not: null },
    },
  });

  for (const f of staleFindings) {
    if (f.cveId && !matchedCveIds.has(f.cveId)) {
      await prisma.finding.update({
        where: { id: f.id },
        data: { status: 'resolved', resolvedAt: new Date() },
      });
      resolved++;
    }
  }

  return { created, resolved };
}

// ---------------------------------------------------------------------------
// OSV response types and helpers
// ---------------------------------------------------------------------------

interface OsvVuln {
  id: string;
  aliases?: string[];
  summary?: string;
  details?: string;
  severity?: Array<{ type: string; score: string }>;
  affected?: Array<{
    package?: { name: string; ecosystem: string };
    ranges?: Array<{
      type: string;
      events: Array<{ introduced?: string; fixed?: string }>;
    }>;
  }>;
}

function extractCveId(vuln: OsvVuln): string | null {
  // OSV id might be CVE directly.
  if (vuln.id.startsWith('CVE-')) return vuln.id;
  // Check aliases for a bare CVE ID.
  for (const alias of vuln.aliases ?? []) {
    if (alias.startsWith('CVE-')) return alias;
  }
  // Extract CVE from composite IDs like DEBIAN-CVE-2026-26103.
  const cveMatch = vuln.id.match(/CVE-\d{4}-\d+/);
  if (cveMatch) return cveMatch[0];
  // Use OSV id as fallback (e.g., DSA-XXXX, GHSA-XXXX).
  return vuln.id;
}

function extractFixedVersion(vuln: OsvVuln, pkgName: string, ecosystem: string): string | null {
  for (const aff of vuln.affected ?? []) {
    if (aff.package?.name !== pkgName) continue;
    // OSV uses versioned ecosystems like "Debian:13" — match prefix.
    const affEco = aff.package?.ecosystem ?? '';
    if (affEco !== ecosystem && !affEco.startsWith(`${ecosystem}:`)) continue;
    for (const range of aff.ranges ?? []) {
      for (const event of range.events) {
        if (event.fixed) return event.fixed;
      }
    }
  }
  return null;
}

/**
 * Parse a CVSS v3 base score from either a numeric string ("9.8")
 * or a CVSS vector ("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H").
 * OSV.dev returns the vector string in the `score` field.
 */
function parseCvssScore(raw: string): number | null {
  // Try direct numeric first.
  const num = parseFloat(raw);
  if (!isNaN(num) && num >= 0 && num <= 10) return num;

  // Parse CVSS v3 vector — compute approximate base score from metrics.
  // Format: CVSS:3.x/AV:X/AC:X/PR:X/UI:X/S:X/C:X/I:X/A:X
  if (!raw.startsWith('CVSS:3')) return null;

  const metrics: Record<string, string> = {};
  for (const part of raw.split('/')) {
    const [k, v] = part.split(':');
    if (k && v) metrics[k] = v;
  }

  // Impact weights (simplified CVSS v3.1 base score approximation)
  const avW: Record<string, number> = { N: 0.85, A: 0.62, L: 0.55, P: 0.20 };
  const acW: Record<string, number> = { L: 0.77, H: 0.44 };
  const prW: Record<string, number> = { N: 0.85, L: 0.62, H: 0.27 };
  const uiW: Record<string, number> = { N: 0.85, R: 0.62 };
  const ciaW: Record<string, number> = { H: 0.56, L: 0.22, N: 0 };

  const av = avW[metrics['AV'] ?? ''] ?? 0.55;
  const ac = acW[metrics['AC'] ?? ''] ?? 0.44;
  const pr = prW[metrics['PR'] ?? ''] ?? 0.62;
  const ui = uiW[metrics['UI'] ?? ''] ?? 0.62;
  const c = ciaW[metrics['C'] ?? ''] ?? 0;
  const i = ciaW[metrics['I'] ?? ''] ?? 0;
  const a = ciaW[metrics['A'] ?? ''] ?? 0;

  // ISS = 1 - [(1-C) * (1-I) * (1-A)]
  const iss = 1 - (1 - c) * (1 - i) * (1 - a);
  if (iss <= 0) return 0;

  const scopeChanged = metrics['S'] === 'C';
  const impact = scopeChanged ? 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15) : 6.42 * iss;
  const exploitability = 8.22 * av * ac * pr * ui;
  const raw_score = scopeChanged
    ? Math.min(1.08 * (impact + exploitability), 10)
    : Math.min(impact + exploitability, 10);

  return Math.round(raw_score * 10) / 10;
}

function osvCvssScore(vuln: OsvVuln): number | null {
  for (const s of vuln.severity ?? []) {
    if (s.type === 'CVSS_V3') {
      return parseCvssScore(s.score);
    }
  }
  return null;
}

function osvSeverity(vuln: OsvVuln): string {
  for (const s of vuln.severity ?? []) {
    if (s.type === 'CVSS_V3') {
      const score = parseCvssScore(s.score);
      if (score != null) {
        if (score >= 9.0) return 'critical';
        if (score >= 7.0) return 'high';
        if (score >= 4.0) return 'medium';
        return 'low';
      }
    }
  }
  return 'medium'; // Default if no severity info.
}
