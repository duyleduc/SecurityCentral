/**
 * Vulnerability Database Service
 *
 * Downloads CVE feeds (Debian Security Tracker, CISA KEV) and matches
 * server package lists against them to create findings.
 *
 * Scope: OS packages + system binaries only.
 * Language ecosystem CVEs (npm, pip, maven) are handled by sc-scan.
 */

import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';

const DEBIAN_SECURITY_URL = 'https://security-tracker.debian.org/tracker/data/json';
const CISA_KEV_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';

// ---------------------------------------------------------------------------
// Feed sync
// ---------------------------------------------------------------------------

export async function syncFeeds(): Promise<void> {
  await syncDebianFeed();
  await syncCisaKev();
}

async function syncDebianFeed(): Promise<void> {
  try {
    const resp = await fetch(DEBIAN_SECURITY_URL, { signal: AbortSignal.timeout(30_000) });
    if (!resp.ok) {
      logger.warn('Debian security feed fetch failed', { status: resp.status });
      return;
    }
    const data = await resp.json();

    await prisma.vulnerabilityFeed.upsert({
      where: { source: 'debian' },
      create: { source: 'debian', lastSyncAt: new Date(), data: data as object },
      update: { lastSyncAt: new Date(), data: data as object },
    });

    logger.info('Debian security feed synced', { packages: Object.keys(data as Record<string, unknown>).length });
  } catch (err) {
    logger.error('Debian feed sync error', { error: (err as Error).message });
  }
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
// CVE matching
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
 * Match a server's package list against the Debian security tracker feed.
 * Returns a list of CVE matches.
 */
export async function matchServerPackages(
  serverId: string,
  osFamily: string,
  packages: readonly PackageInput[],
): Promise<CveMatch[]> {
  // Load feeds from DB.
  const [debianFeed, kevFeed] = await Promise.all([
    prisma.vulnerabilityFeed.findUnique({ where: { source: 'debian' } }),
    prisma.vulnerabilityFeed.findUnique({ where: { source: 'cisa_kev' } }),
  ]);

  if (!debianFeed) {
    logger.warn('No Debian security feed available — skipping CVE matching');
    return [];
  }

  // Only match Debian/Ubuntu for now.
  if (osFamily !== 'debian' && osFamily !== 'ubuntu') {
    logger.info('CVE matching not yet supported for OS family', { osFamily });
    return [];
  }

  // Build CISA KEV lookup set.
  const kevSet = new Set<string>();
  if (kevFeed) {
    const kevData = kevFeed.data as { vulnerabilities?: Array<{ cveID?: string }> };
    for (const v of kevData.vulnerabilities ?? []) {
      if (v.cveID) kevSet.add(v.cveID);
    }
  }

  // Debian security tracker format: { "package_name": { "CVE-XXXX": { "releases": { "bookworm": { "status": "resolved", "fixed_version": "1.2.3" } } } } }
  const debianData = debianFeed.data as Record<string, Record<string, {
    description?: string;
    releases?: Record<string, { status?: string; fixed_version?: string; urgency?: string }>;
  }>>;

  const pkgIndex = new Map<string, string>();
  for (const pkg of packages) {
    pkgIndex.set(pkg.name, pkg.version);
  }

  const matches: CveMatch[] = [];

  for (const [pkgName, cves] of Object.entries(debianData)) {
    const installedVersion = pkgIndex.get(pkgName);
    if (!installedVersion) continue;

    for (const [cveId, cveInfo] of Object.entries(cves)) {
      if (!cveId.startsWith('CVE-')) continue;

      // Check across release codenames.
      const releases = cveInfo.releases ?? {};
      for (const releaseInfo of Object.values(releases)) {
        if (releaseInfo.status === 'resolved' && releaseInfo.fixed_version) {
          // If the installed version is older than the fixed version, it's vulnerable.
          // Simple string comparison works for most Debian version schemes.
          if (compareDebianVersions(installedVersion, releaseInfo.fixed_version) < 0) {
            const isCisaKev = kevSet.has(cveId);
            const severity = isCisaKev ? 'critical' : urgencyToSeverity(releaseInfo.urgency);

            matches.push({
              cveId,
              packageName: pkgName,
              installedVersion,
              fixedVersion: releaseInfo.fixed_version,
              severity,
              description: cveInfo.description ?? '',
              cisaKev: isCisaKev,
            });
            break; // One match per CVE per package is enough.
          }
        }

        // If status is "open" (unfixed), still report but with no fixed version.
        if (releaseInfo.status === 'open') {
          const isCisaKev = kevSet.has(cveId);
          matches.push({
            cveId,
            packageName: pkgName,
            installedVersion,
            fixedVersion: null,
            severity: isCisaKev ? 'critical' : urgencyToSeverity(releaseInfo.urgency),
            description: cveInfo.description ?? '',
            cisaKev: isCisaKev,
          });
          break;
        }
      }
    }
  }

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

  // Create new findings for matches.
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

  // Auto-resolve findings for CVEs no longer in the match set (package was updated).
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
// Helpers
// ---------------------------------------------------------------------------

function urgencyToSeverity(urgency?: string): string {
  switch (urgency) {
    case 'high': return 'critical';
    case 'medium': return 'high';
    case 'low': return 'medium';
    case 'unimportant': return 'low';
    default: return 'medium';
  }
}

/**
 * Compare Debian package versions. This is a simplified comparison —
 * a full implementation would use dpkg --compare-versions.
 * For MVP, string comparison catches most cases (epoch:upstream-revision).
 */
function compareDebianVersions(a: string, b: string): number {
  // Extract epoch if present.
  const parseEpoch = (v: string) => {
    const idx = v.indexOf(':');
    if (idx < 0) return { epoch: 0, rest: v };
    return { epoch: parseInt(v.slice(0, idx), 10) || 0, rest: v.slice(idx + 1) };
  };

  const pa = parseEpoch(a);
  const pb = parseEpoch(b);
  if (pa.epoch !== pb.epoch) return pa.epoch - pb.epoch;

  // Compare upstream version parts numerically where possible.
  const partsA = pa.rest.split(/[.\-+~]/);
  const partsB = pb.rest.split(/[.\-+~]/);
  const len = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < len; i++) {
    const sa = partsA[i] ?? '';
    const sb = partsB[i] ?? '';
    const na = parseInt(sa, 10);
    const nb = parseInt(sb, 10);

    if (!isNaN(na) && !isNaN(nb)) {
      if (na !== nb) return na - nb;
    } else {
      if (sa < sb) return -1;
      if (sa > sb) return 1;
    }
  }

  return 0;
}
