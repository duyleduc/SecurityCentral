import type { Job } from 'bullmq';

import { prisma } from '../lib/prisma.js';
import { getRedisConnection } from '../lib/redis.js';
import { jobLogger } from '../lib/logger.js';
import type { JobContext } from './context.js';

// ---------------------------------------------------------------------------
// Redis keys for tracking last sync timestamps
// ---------------------------------------------------------------------------

const LAST_SYNC_KEY = 'vulndb:last_sync';

async function getLastSync(source: string): Promise<string | null> {
  const redis = getRedisConnection();
  return redis.hget(LAST_SYNC_KEY, source);
}

async function setLastSync(source: string, timestamp: string): Promise<void> {
  const redis = getRedisConnection();
  await redis.hset(LAST_SYNC_KEY, source, timestamp);
}

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

interface RawVulnerability {
  readonly id: string;           // CVE-XXXX-YYYY
  readonly title: string;
  readonly description?: string;
  readonly cvssScore?: number;
  readonly cvssVector?: string;
  readonly severity: string;
  readonly publishedAt?: string;
  readonly modifiedAt?: string;
  readonly references?: string[];
  readonly affects?: ReadonlyArray<{
    readonly ecosystem: string;
    readonly packageName: string;
    readonly versionRange: string;
    readonly fixedVersion?: string;
    readonly osFamily?: string;
    readonly osVersion?: string;
  }>;
}

// ---------------------------------------------------------------------------
// T-5.1.1: NVD Sync
// ---------------------------------------------------------------------------

export async function syncNvd(): Promise<number> {
  const lastSync = await getLastSync('nvd');
  const since = lastSync ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // NVD API 2.0: https://services.nvd.nist.gov/rest/json/cves/2.0
  const baseUrl = 'https://services.nvd.nist.gov/rest/json/cves/2.0';
  const params = new URLSearchParams({
    lastModStartDate: since,
    lastModEndDate: new Date().toISOString(),
    resultsPerPage: '100',
  });

  let totalSynced = 0;
  let startIndex = 0;
  let hasMore = true;

  while (hasMore) {
    params.set('startIndex', String(startIndex));
    const url = `${baseUrl}?${params}`;

    const response = await fetch(url, {
      headers: { 'User-Agent': 'SecurityCentral/1.0' },
    });

    if (!response.ok) {
      throw new Error(`NVD API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      totalResults: number;
      resultsPerPage: number;
      startIndex: number;
      vulnerabilities: Array<{ cve: NvdCve }>;
    };

    const vulns = data.vulnerabilities.map((v) => mapNvdCve(v.cve));
    await upsertVulnerabilities(vulns, 'nvd');
    totalSynced += vulns.length;

    hasMore = startIndex + data.resultsPerPage < data.totalResults;
    startIndex += data.resultsPerPage;
  }

  await setLastSync('nvd', new Date().toISOString());
  return totalSynced;
}

interface NvdCve {
  id: string;
  descriptions: Array<{ lang: string; value: string }>;
  metrics?: {
    cvssMetricV31?: Array<{
      cvssData: { baseScore: number; vectorString: string; baseSeverity: string };
    }>;
  };
  published?: string;
  lastModified?: string;
  references?: Array<{ url: string }>;
}

function mapNvdCve(cve: NvdCve): RawVulnerability {
  const desc = cve.descriptions.find((d) => d.lang === 'en')?.value ?? cve.id;
  const cvss = cve.metrics?.cvssMetricV31?.[0]?.cvssData;

  return {
    id: cve.id,
    title: desc.length > 200 ? desc.slice(0, 200) + '...' : desc,
    description: desc,
    cvssScore: cvss?.baseScore,
    cvssVector: cvss?.vectorString,
    severity: mapCvssSeverity(cvss?.baseSeverity),
    publishedAt: cve.published,
    modifiedAt: cve.lastModified,
    references: cve.references?.map((r) => r.url) ?? [],
  };
}

// ---------------------------------------------------------------------------
// T-5.1.2: GitHub Advisory DB Sync
// ---------------------------------------------------------------------------

export async function syncGithubAdvisory(): Promise<number> {
  const lastSync = await getLastSync('github');
  const since = lastSync ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // GitHub GraphQL API for security advisories
  const ghToken = process.env.GITHUB_TOKEN;
  if (!ghToken) return 0; // Skip if no token configured

  const query = `
    query($since: DateTime!) {
      securityAdvisories(first: 100, updatedSince: $since, orderBy: { field: UPDATED_AT, direction: ASC }) {
        nodes {
          ghsaId
          summary
          description
          severity
          cvss { score vectorString }
          publishedAt
          updatedAt
          references { url }
          vulnerabilities(first: 25) {
            nodes {
              package { ecosystem name }
              vulnerableVersionRange
              firstPatchedVersion { identifier }
            }
          }
        }
      }
    }
  `;

  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${ghToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables: { since } }),
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status}`);
  }

  const { data } = (await response.json()) as { data: { securityAdvisories: { nodes: GhAdvisory[] } } };
  const vulns = data.securityAdvisories.nodes.map(mapGhAdvisory);
  await upsertVulnerabilities(vulns, 'github');

  await setLastSync('github', new Date().toISOString());
  return vulns.length;
}

interface GhAdvisory {
  ghsaId: string;
  summary: string;
  description: string;
  severity: string;
  cvss: { score: number; vectorString: string } | null;
  publishedAt: string;
  updatedAt: string;
  references: Array<{ url: string }>;
  vulnerabilities: { nodes: Array<{ package: { ecosystem: string; name: string }; vulnerableVersionRange: string; firstPatchedVersion: { identifier: string } | null }> };
}

function mapGhAdvisory(adv: GhAdvisory): RawVulnerability {
  const ecosystemMap: Record<string, string> = { NPM: 'npm', PIP: 'pypi', MAVEN: 'maven', RUBYGEMS: 'rubygems', NUGET: 'nuget', GO: 'go' };

  return {
    id: adv.ghsaId,
    title: adv.summary,
    description: adv.description,
    cvssScore: adv.cvss?.score,
    cvssVector: adv.cvss?.vectorString,
    severity: adv.severity?.toLowerCase() ?? 'medium',
    publishedAt: adv.publishedAt,
    modifiedAt: adv.updatedAt,
    references: adv.references.map((r) => r.url),
    affects: adv.vulnerabilities.nodes.map((v) => ({
      ecosystem: ecosystemMap[v.package.ecosystem] ?? v.package.ecosystem.toLowerCase(),
      packageName: v.package.name,
      versionRange: v.vulnerableVersionRange,
      fixedVersion: v.firstPatchedVersion?.identifier,
    })),
  };
}

// ---------------------------------------------------------------------------
// T-5.1.3: OSV.dev Sync
// ---------------------------------------------------------------------------

export async function syncOsv(): Promise<number> {
  const lastSync = await getLastSync('osv');
  const since = lastSync ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // OSV uses a query API — fetch recent vulns for the ecosystems we care about
  const ecosystems = ['npm', 'PyPI', 'Maven', 'crates.io'];
  let totalSynced = 0;

  for (const ecosystem of ecosystems) {
    const response = await fetch('https://api.osv.dev/v1/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        package: { ecosystem },
        // OSV doesn't support time-based queries natively; we fetch recent and dedup
      }),
    });

    if (!response.ok) continue;

    const data = (await response.json()) as { vulns?: OsvVuln[] };
    if (!data.vulns) continue;

    // Filter to recently modified
    const sinceDate = new Date(since);
    const recent = data.vulns.filter((v) => new Date(v.modified) > sinceDate);

    const vulns = recent.map((v) => mapOsvVuln(v, ecosystem.toLowerCase()));
    await upsertVulnerabilities(vulns, 'osv');
    totalSynced += vulns.length;
  }

  await setLastSync('osv', new Date().toISOString());
  return totalSynced;
}

interface OsvVuln {
  id: string;
  summary: string;
  details?: string;
  severity?: Array<{ type: string; score: string }>;
  modified: string;
  published?: string;
  references?: Array<{ type: string; url: string }>;
  affected?: Array<{
    package: { ecosystem: string; name: string };
    ranges?: Array<{ type: string; events: Array<{ introduced?: string; fixed?: string }> }>;
  }>;
}

function mapOsvVuln(vuln: OsvVuln, ecosystem: string): RawVulnerability {
  const cvss = vuln.severity?.find((s) => s.type === 'CVSS_V3');
  const score = cvss ? parseFloat(cvss.score) : undefined;

  const affects = vuln.affected?.flatMap((a) =>
    (a.ranges ?? []).map((r) => {
      const introduced = r.events.find((e) => e.introduced)?.introduced ?? '0';
      const fixed = r.events.find((e) => e.fixed)?.fixed;
      return {
        ecosystem: a.package.ecosystem.toLowerCase(),
        packageName: a.package.name,
        versionRange: fixed ? `>=${introduced} <${fixed}` : `>=${introduced}`,
        fixedVersion: fixed,
      };
    }),
  );

  return {
    id: vuln.id,
    title: vuln.summary || vuln.id,
    description: vuln.details,
    cvssScore: score,
    severity: score ? scoreSeverity(score) : 'medium',
    publishedAt: vuln.published,
    modifiedAt: vuln.modified,
    references: vuln.references?.map((r) => r.url) ?? [],
    affects,
  };
}

// ---------------------------------------------------------------------------
// T-5.1.4: Deduplication + upsert
// ---------------------------------------------------------------------------

async function upsertVulnerabilities(vulns: readonly RawVulnerability[], source: 'nvd' | 'github' | 'osv'): Promise<void> {
  for (const vuln of vulns) {
    const existing = await prisma.vulnerability.findUnique({ where: { id: vuln.id } });

    if (existing) {
      // Deduplication rules:
      // - NVD: prefer for CVSS scores and descriptions
      // - GitHub: prefer for affected version ranges
      const updates: Record<string, unknown> = { modifiedAt: vuln.modifiedAt ? new Date(vuln.modifiedAt) : undefined };

      if (source === 'nvd') {
        // NVD is authoritative for CVSS and descriptions
        if (vuln.cvssScore !== undefined) updates.cvssScore = vuln.cvssScore;
        if (vuln.cvssVector) updates.cvssVector = vuln.cvssVector;
        if (vuln.description) updates.description = vuln.description;
        if (vuln.title) updates.title = vuln.title;
        if (vuln.severity) updates.severity = vuln.severity as any;
      }

      if (vuln.references?.length) {
        const merged = [...new Set([...existing.references, ...vuln.references])];
        updates.references = merged;
      }

      await prisma.vulnerability.update({ where: { id: vuln.id }, data: updates as any });
    } else {
      await prisma.vulnerability.create({
        data: {
          id: vuln.id,
          title: vuln.title,
          description: vuln.description ?? null,
          cvssScore: vuln.cvssScore ?? null,
          cvssVector: vuln.cvssVector ?? null,
          severity: (vuln.severity as any) ?? 'medium',
          publishedAt: vuln.publishedAt ? new Date(vuln.publishedAt) : null,
          modifiedAt: vuln.modifiedAt ? new Date(vuln.modifiedAt) : null,
          references: vuln.references ?? [],
        },
      });
    }

    // Upsert affected packages (GitHub/OSV are preferred for these)
    if (vuln.affects && (source === 'github' || source === 'osv')) {
      for (const affect of vuln.affects) {
        const existingAffect = await prisma.vulnerabilityAffects.findFirst({
          where: {
            vulnerabilityId: vuln.id,
            ecosystem: affect.ecosystem,
            packageName: affect.packageName,
          },
        });

        if (existingAffect) {
          await prisma.vulnerabilityAffects.update({
            where: { id: existingAffect.id },
            data: {
              versionRange: affect.versionRange,
              fixedVersion: affect.fixedVersion ?? null,
              osFamily: affect.osFamily ?? null,
              osVersion: affect.osVersion ?? null,
            },
          });
        } else {
          await prisma.vulnerabilityAffects.create({
            data: {
              vulnerabilityId: vuln.id,
              ecosystem: affect.ecosystem,
              packageName: affect.packageName,
              versionRange: affect.versionRange,
              fixedVersion: affect.fixedVersion ?? null,
              osFamily: affect.osFamily ?? null,
              osVersion: affect.osVersion ?? null,
            },
          });
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// T-5.1.5: BullMQ processor
// ---------------------------------------------------------------------------

export async function processVulnDbSync(job: Job<JobContext>): Promise<void> {
  const log = jobLogger(job.queueName, job.id ?? 'unknown', job.data?.request_id);

  log.info('Starting vulnerability database sync');

  const nvdCount = await syncNvd().catch((err) => {
    log.error(`NVD sync failed: ${(err as Error).message}`);
    return 0;
  });

  const ghCount = await syncGithubAdvisory().catch((err) => {
    log.error(`GitHub Advisory sync failed: ${(err as Error).message}`);
    return 0;
  });

  const osvCount = await syncOsv().catch((err) => {
    log.error(`OSV sync failed: ${(err as Error).message}`);
    return 0;
  });

  log.info('Vulnerability database sync complete', { nvd: nvdCount, github: ghCount, osv: osvCount });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapCvssSeverity(severity?: string): string {
  switch (severity?.toUpperCase()) {
    case 'CRITICAL': return 'critical';
    case 'HIGH': return 'high';
    case 'MEDIUM': return 'medium';
    case 'LOW': return 'low';
    default: return 'info';
  }
}

function scoreSeverity(score: number): string {
  if (score >= 9.0) return 'critical';
  if (score >= 7.0) return 'high';
  if (score >= 4.0) return 'medium';
  if (score >= 0.1) return 'low';
  return 'info';
}
