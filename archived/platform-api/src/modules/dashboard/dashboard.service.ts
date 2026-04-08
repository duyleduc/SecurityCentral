import { prisma } from '../../lib/prisma.js';
import { isEsEnabled, getEsClient, FINDINGS_INDEX } from '../../lib/elasticsearch.js';
import { getRedisConnection } from '../../lib/redis.js';

const SUMMARY_TTL = 30;    // seconds
const TOP_RISKS_TTL = 60;  // seconds

// ---------------------------------------------------------------------------
// Redis cache helpers
// ---------------------------------------------------------------------------

async function getCache<T>(key: string): Promise<T | null> {
  try {
    const redis = getRedisConnection();
    const raw = await redis.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

async function setCache(key: string, data: unknown, ttl: number): Promise<void> {
  try {
    const redis = getRedisConnection();
    await redis.set(key, JSON.stringify(data), 'EX', ttl);
  } catch {
    // fail silently — cache is optional
  }
}

/** Invalidate dashboard cache for an org (call on new finding ingestion). */
export async function invalidateCache(orgId: string): Promise<void> {
  try {
    const redis = getRedisConnection();
    await redis.del(`dashboard:summary:${orgId}`, `dashboard:top-risks:${orgId}`);
  } catch {
    // fail silently
  }
}

// ---------------------------------------------------------------------------
// T-3.6.1: Summary
// ---------------------------------------------------------------------------

export interface DashboardSummary {
  readonly findings: {
    readonly total: number;
    readonly by_severity: Record<string, number>;
    readonly open: number;
    readonly resolved: number;
  };
  readonly assets: {
    readonly repositories: number;
    readonly servers: number;
    readonly certificates: number;
  };
}

export async function getSummary(orgId: string): Promise<DashboardSummary> {
  const cacheKey = `dashboard:summary:${orgId}`;
  const cached = await getCache<DashboardSummary>(cacheKey);
  if (cached) return cached;

  // Findings aggregation — use ES when available, fall back to Prisma
  let total = 0;
  let by_severity: Record<string, number> = {};
  let open = 0;
  let resolved = 0;

  if (isEsEnabled()) {
    const client = getEsClient();
    const { body } = await client.search({
      index: FINDINGS_INDEX,
      body: {
        size: 0,
        query: { term: { org_id: orgId } },
        aggs: {
          by_severity: { terms: { field: 'severity', size: 10 } },
          by_status: { terms: { field: 'status', size: 10 } },
        },
      },
    });

    total = typeof body.hits.total === 'number' ? body.hits.total : body.hits.total.value;
    const severityBuckets = body.aggregations.by_severity.buckets as Array<{ key: string; doc_count: number }>;
    const statusBuckets = body.aggregations.by_status.buckets as Array<{ key: string; doc_count: number }>;

    by_severity = Object.fromEntries(severityBuckets.map((b) => [b.key, b.doc_count]));
    const statusMap = Object.fromEntries(statusBuckets.map((b) => [b.key, b.doc_count]));

    open = (statusMap['open'] ?? 0) + (statusMap['in_progress'] ?? 0);
    resolved = (statusMap['resolved'] ?? 0) + (statusMap['suppressed'] ?? 0) + (statusMap['false_positive'] ?? 0);
  } else {
    // Fallback: aggregate from PostgreSQL
    const [severityCounts, statusCounts] = await Promise.all([
      prisma.finding.groupBy({ by: ['severity'], where: { orgId }, _count: { id: true } }),
      prisma.finding.groupBy({ by: ['status'], where: { orgId }, _count: { id: true } }),
    ]);
    by_severity = Object.fromEntries(severityCounts.map((r) => [r.severity, r._count.id]));
    const statusMap = Object.fromEntries(statusCounts.map((r) => [r.status, r._count.id]));
    total = Object.values(statusMap).reduce((a, b) => a + b, 0);
    open = (statusMap['open'] ?? 0) + (statusMap['in_progress'] ?? 0);
    resolved = (statusMap['resolved'] ?? 0) + (statusMap['suppressed'] ?? 0) + (statusMap['false_positive'] ?? 0);
  }

  // Asset counts from PG
  const [repositories, servers, certificates] = await Promise.all([
    prisma.repository.count({ where: { orgId } }),
    prisma.server.count({ where: { orgId, status: { not: 'decommissioned' } } }),
    prisma.certificate.count({ where: { orgId, status: { in: ['active', 'expiring'] } } }),
  ]);

  const summary: DashboardSummary = {
    findings: { total, by_severity, open, resolved },
    assets: { repositories, servers, certificates },
  };

  await setCache(cacheKey, summary, SUMMARY_TTL);
  return summary;
}

// ---------------------------------------------------------------------------
// T-3.6.2: Top Risks
// ---------------------------------------------------------------------------

export async function getTopRisks(orgId: string) {
  const cacheKey = `dashboard:top-risks:${orgId}`;
  const cached = await getCache<unknown[]>(cacheKey);
  if (cached) return cached;

  const findings = await prisma.finding.findMany({
    where: {
      orgId,
      status: { in: ['open', 'in_progress'] },
      cvssScore: { not: null },
    },
    orderBy: { cvssScore: 'desc' },
    take: 10,
    select: {
      id: true,
      title: true,
      severity: true,
      cveId: true,
      cvssScore: true,
      source: true,
      status: true,
      firstSeenAt: true,
      repository: { select: { name: true } },
      server: { select: { hostname: true } },
      certificate: { select: { subjectCn: true } },
    },
  });

  await setCache(cacheKey, findings, TOP_RISKS_TTL);
  return findings;
}

// ---------------------------------------------------------------------------
// T-3.6.3: Assets Overview
// ---------------------------------------------------------------------------

export async function getAssetsOverview(orgId: string) {
  const [
    repoCount,
    serverCount,
    certCount,
    reposWithCritical,
    serversWithCritical,
    certsWithCritical,
  ] = await Promise.all([
    prisma.repository.count({ where: { orgId } }),
    prisma.server.count({ where: { orgId, status: { not: 'decommissioned' } } }),
    prisma.certificate.count({ where: { orgId, status: { in: ['active', 'expiring'] } } }),
    // Repos with critical/high open findings
    prisma.finding.groupBy({
      by: ['repositoryId'],
      where: { orgId, repositoryId: { not: null }, severity: { in: ['critical', 'high'] }, status: { in: ['open', 'in_progress'] } },
    }).then((g) => g.length),
    // Servers with critical/high open findings
    prisma.finding.groupBy({
      by: ['serverId'],
      where: { orgId, serverId: { not: null }, severity: { in: ['critical', 'high'] }, status: { in: ['open', 'in_progress'] } },
    }).then((g) => g.length),
    // Certs with critical/high open findings
    prisma.finding.groupBy({
      by: ['certificateId'],
      where: { orgId, certificateId: { not: null }, severity: { in: ['critical', 'high'] }, status: { in: ['open', 'in_progress'] } },
    }).then((g) => g.length),
  ]);

  const pct = (affected: number, total: number) => total === 0 ? 0 : Math.round((affected / total) * 100);

  return {
    repositories: { total: repoCount, affected: reposWithCritical, health_pct: 100 - pct(reposWithCritical, repoCount) },
    servers: { total: serverCount, affected: serversWithCritical, health_pct: 100 - pct(serversWithCritical, serverCount) },
    certificates: { total: certCount, affected: certsWithCritical, health_pct: 100 - pct(certsWithCritical, certCount) },
  };
}
