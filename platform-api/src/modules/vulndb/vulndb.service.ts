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
const OSV_BATCH_URL = 'https://api.osv.dev/v1/querybatch';

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
  readonly description: string;
  readonly cisaKev: boolean;
}

/**
 * Map OS family to OSV ecosystem name.
 */
function osvEcosystem(osFamily: string): string | null {
  switch (osFamily) {
    case 'debian': return 'Debian';
    case 'ubuntu': return 'Ubuntu';
    case 'alpine': return 'Alpine';
    default: return null;
  }
}

/**
 * Match packages against OSV.dev in batches.
 * OSV querybatch allows up to 1000 queries per request.
 */
export async function matchServerPackages(
  serverId: string,
  osFamily: string,
  packages: readonly PackageInput[],
): Promise<CveMatch[]> {
  const ecosystem = osvEcosystem(osFamily);
  if (!ecosystem) {
    logger.info('CVE matching not yet supported for OS family', { osFamily });
    return [];
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
  const matches: CveMatch[] = [];
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

      const data = await resp.json() as { results: Array<{ vulns?: Array<OsvVuln> }> };

      for (let j = 0; j < data.results.length; j++) {
        const vulns = data.results[j].vulns;
        if (!vulns || vulns.length === 0) continue;

        const pkg = batch[j];
        for (const vuln of vulns) {
          const cveId = extractCveId(vuln);
          if (!cveId) continue;

          const fixedVersion = extractFixedVersion(vuln, pkg.name, ecosystem);
          const isCisaKev = kevSet.has(cveId);
          const severity = isCisaKev ? 'critical' : osvSeverity(vuln);

          matches.push({
            cveId,
            packageName: pkg.name,
            installedVersion: pkg.version,
            fixedVersion,
            severity,
            description: vuln.summary ?? vuln.details?.slice(0, 200) ?? '',
            cisaKev: isCisaKev,
          });
        }
      }
    } catch (err) {
      logger.error('OSV batch query error', { error: (err as Error).message, batch: i });
    }
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
        description: m.description || `${m.packageName} ${m.installedVersion} is vulnerable.${m.fixedVersion ? ` Fixed in ${m.fixedVersion}.` : ' No fix available yet.'}`,
        detail: JSON.parse(JSON.stringify({
          packageName: m.packageName,
          installedVersion: m.installedVersion,
          fixedVersion: m.fixedVersion,
          cisaKev: m.cisaKev,
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
  // OSV id might be CVE directly, or check aliases.
  if (vuln.id.startsWith('CVE-')) return vuln.id;
  for (const alias of vuln.aliases ?? []) {
    if (alias.startsWith('CVE-')) return alias;
  }
  // Use OSV id as fallback (e.g., DSA-XXXX, GHSA-XXXX).
  return vuln.id;
}

function extractFixedVersion(vuln: OsvVuln, pkgName: string, ecosystem: string): string | null {
  for (const aff of vuln.affected ?? []) {
    if (aff.package?.name !== pkgName || aff.package?.ecosystem !== ecosystem) continue;
    for (const range of aff.ranges ?? []) {
      for (const event of range.events) {
        if (event.fixed) return event.fixed;
      }
    }
  }
  return null;
}

function osvSeverity(vuln: OsvVuln): string {
  // Check for CVSS v3 score.
  for (const s of vuln.severity ?? []) {
    if (s.type === 'CVSS_V3') {
      // Parse base score from CVSS vector or score string.
      const score = parseFloat(s.score);
      if (!isNaN(score)) {
        if (score >= 9.0) return 'critical';
        if (score >= 7.0) return 'high';
        if (score >= 4.0) return 'medium';
        return 'low';
      }
    }
  }
  return 'medium'; // Default if no severity info.
}
