import crypto from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/errors.js';
import { matchServerPackages, applyMatchesToFindings, syncFeeds } from '../vulndb/vulndb.service.js';
import { enrichWithCis, cisSummary } from '../../lib/cis-benchmarks.js';
import { logger } from '../../lib/logger.js';

// ---------------------------------------------------------------------------
// Server-side security score computation
// ---------------------------------------------------------------------------

/**
 * Capped deductions per severity tier — keeps the score meaningful.
 * Same formula used client-side in ScoreBadge.tsx.
 *
 *   Critical: 8 pts each, max 35     High: 4 pts each, max 25
 *   Medium:   1 pt each,  max 20     Low:  0.25 each,  max 10
 *
 * Grades: A (90+), B (80+), C (70+), D (60+), F (<60)
 */
const SCORE_TIERS = [
  { sev: 'critical', perItem: 8, cap: 35 },
  { sev: 'high',     perItem: 4, cap: 25 },
  { sev: 'medium',   perItem: 1, cap: 20 },
  { sev: 'low',      perItem: 0.25, cap: 10 },
];

/**
 * Recompute security score for a server from its open findings + security posture.
 * Persists the score on the Server record and appends a history entry (max 1 per day).
 */
export async function recomputeScore(serverId: string): Promise<number> {
  // Count open findings by severity.
  const counts = await prisma.finding.groupBy({
    by: ['severity'],
    where: { serverId, status: { in: ['open', 'in_progress'] } },
    _count: true,
  });

  const sevCounts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const row of counts) {
    if (sevCounts[row.severity] !== undefined) {
      sevCounts[row.severity] = row._count;
    }
  }

  // Firewall penalty.
  const posture = await prisma.securityPosture.findFirst({
    where: { serverId },
    orderBy: { createdAt: 'desc' },
  });
  if (posture && !(posture as any).firewallActive) {
    sevCounts.high += 1;
  }

  let score = 100;
  for (const { sev, perItem, cap } of SCORE_TIERS) {
    const deduction = Math.min((sevCounts[sev] ?? 0) * perItem, cap);
    score -= deduction;
  }
  score = Math.max(0, Math.min(100, Math.round(score)));

  // Persist on server record (raw SQL — Prisma client not yet regenerated).
  await prisma.$executeRawUnsafe(
    'UPDATE servers SET security_score = $1 WHERE id = $2',
    score, serverId,
  );

  // Append history — at most one entry per day per server.
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const existing: Array<{ id: string }> = await prisma.$queryRawUnsafe(
    'SELECT id FROM server_score_history WHERE server_id = $1 AND created_at >= $2 LIMIT 1',
    serverId, todayStart,
  );

  const breakdownJson = JSON.stringify(sevCounts);
  if (existing.length > 0) {
    await prisma.$executeRawUnsafe(
      'UPDATE server_score_history SET score = $1, breakdown = $2::jsonb WHERE id = $3',
      score, breakdownJson, existing[0].id,
    );
  } else {
    const id = crypto.randomUUID();
    await prisma.$executeRawUnsafe(
      'INSERT INTO server_score_history (id, server_id, score, breakdown) VALUES ($1, $2, $3, $4::jsonb)',
      id, serverId, score, breakdownJson,
    );
  }

  logger.info('server score recomputed', { serverId, score, ...sevCounts });
  return score;
}

// BigInt fields from Prisma need conversion to Number for JSON serialization.
function serializeMetric(m: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(m)) {
    out[k] = typeof v === 'bigint' ? Number(v) : v;
  }
  return out;
}

export async function list(orgId: string, projectId?: string | null) {
  return prisma.server.findMany({
    where: projectId ? { orgId, projectId } : { orgId },
    include: {
      project: { select: { id: true, name: true } },
      _count: { select: { metrics: true, findings: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getById(orgId: string, id: string) {
  const server = await prisma.server.findFirst({
    where: { id, orgId },
    include: {
      project: { select: { id: true, name: true } },
      metrics: {
        take: 1,
        orderBy: { createdAt: 'desc' },
      },
      _count: { select: { findings: true } },
    },
  });

  if (!server) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Server not found');
  }

  return {
    ...server,
    metrics: server.metrics.map((m) => serializeMetric(m as unknown as Record<string, unknown>)),
  };
}

export async function getMetrics(orgId: string, serverId: string, hours: number) {
  const server = await prisma.server.findFirst({ where: { id: serverId, orgId } });
  if (!server) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Server not found');
  }

  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  let rows = await prisma.serverMetricSnapshot.findMany({
    where: {
      serverId,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: 'asc' },
  });

  // If no metrics in the requested window and the server is offline/dead,
  // fall back to the most recent available data window so charts still
  // display historical data instead of "Waiting for data...".
  if (rows.length === 0 && ['offline', 'dead'].includes(server.status)) {
    const lastMetric = await prisma.serverMetricSnapshot.findFirst({
      where: { serverId },
      orderBy: { createdAt: 'desc' },
    });

    if (lastMetric) {
      const fallbackSince = new Date(lastMetric.createdAt.getTime() - hours * 60 * 60 * 1000);
      rows = await prisma.serverMetricSnapshot.findMany({
        where: {
          serverId,
          createdAt: { gte: fallbackSince, lte: lastMetric.createdAt },
        },
        orderBy: { createdAt: 'asc' },
      });
    }
  }

  return rows.map((m) => serializeMetric(m as unknown as Record<string, unknown>));
}

export async function updateServer(
  orgId: string,
  serverId: string,
  data: { label?: string; hostname?: string; projectId?: string | null; tags?: Array<{ key: string; value: string }> },
) {
  const server = await prisma.server.findFirst({ where: { id: serverId, orgId } });
  if (!server) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Server not found');
  }

  const update: Record<string, unknown> = {};
  if (data.label !== undefined) update.label = data.label;
  if (data.hostname !== undefined) update.hostname = data.hostname;
  if (data.projectId !== undefined) update.projectId = data.projectId;
  if (data.tags !== undefined) update.tags = JSON.parse(JSON.stringify(data.tags));

  return prisma.server.update({
    where: { id: serverId },
    data: update,
    include: {
      project: { select: { id: true, name: true } },
      _count: { select: { metrics: true, findings: true } },
    },
  });
}

export async function triggerCveScan(orgId: string, serverId: string) {
  const server = await prisma.server.findFirst({ where: { id: serverId, orgId } });
  if (!server) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Server not found');
  }

  // Get the latest package inventory for this server.
  const inventory = await prisma.packageInventory.findFirst({
    where: { serverId },
    orderBy: { collectedAt: 'desc' },
  });

  if (!inventory) {
    throw new AppError('VALIDATION_ERROR', 'No package inventory available. Wait for the agent to send its first daily scan.');
  }

  // Refresh vuln feeds before matching.
  await syncFeeds();

  const packages = inventory.packages as Array<{ name: string; version: string }>;
  const binaryVersions = (inventory as any).binaryVersions as Array<{ name: string; version: string }> | undefined;
  const matches = await matchServerPackages(serverId, inventory.osFamily, packages, binaryVersions);
  const result = await applyMatchesToFindings(orgId, serverId, server.hostname, matches);

  // Recompute score after scan.
  const score = await recomputeScore(serverId);

  logger.info('Manual CVE scan completed', {
    serverId,
    hostname: server.hostname,
    matched: matches.length,
    created: result.created,
    resolved: result.resolved,
    score,
  });

  return {
    matched: matches.length,
    created: result.created,
    resolved: result.resolved,
    packages: packages.length,
    osFamily: inventory.osFamily,
    score,
    scannedAt: new Date().toISOString(),
  };
}

export async function deleteServer(orgId: string, serverId: string) {
  const server = await prisma.server.findFirst({ where: { id: serverId, orgId } });
  if (!server) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Server not found');
  }

  // Mark as pending_delete so the next heartbeat tells the agent to shut down.
  await prisma.server.update({
    where: { id: serverId },
    data: { status: 'pending_delete' },
  });

  // Cascade delete related data, then the server itself.
  // Use raw SQL for tables not yet in the generated Prisma client.
  await prisma.$executeRawUnsafe('DELETE FROM package_inventories WHERE server_id = $1', serverId);
  await prisma.$executeRawUnsafe('DELETE FROM server_score_history WHERE server_id = $1', serverId);
  await prisma.$transaction([
    prisma.serverMetricSnapshot.deleteMany({ where: { serverId } }),
    prisma.securityPosture.deleteMany({ where: { serverId } }),
    prisma.finding.deleteMany({ where: { serverId } }),
    prisma.server.delete({ where: { id: serverId } }),
  ]);

  return { deleted: true, hostname: server.hostname, agentId: server.agentId };
}

export async function getPackageInventory(orgId: string, serverId: string) {
  const server = await prisma.server.findFirst({ where: { id: serverId, orgId } });
  if (!server) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Server not found');
  }

  return prisma.packageInventory.findFirst({
    where: { serverId },
    orderBy: { collectedAt: 'desc' },
  });
}

export async function getVulnerabilities(orgId: string, serverId: string) {
  const server = await prisma.server.findFirst({ where: { id: serverId, orgId } });
  if (!server) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Server not found');
  }

  return prisma.finding.findMany({
    where: {
      serverId,
      source: 'cve_scan',
      status: { in: ['open', 'in_progress'] },
    },
    orderBy: [{ severity: 'asc' }, { createdAt: 'desc' }],
  });
}

export async function getSecurityPosture(orgId: string, serverId: string) {
  const server = await prisma.server.findFirst({ where: { id: serverId, orgId } });
  if (!server) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Server not found');
  }

  const posture = await prisma.securityPosture.findFirst({
    where: { serverId },
    orderBy: { createdAt: 'desc' },
  });

  if (!posture) return null;

  // Enrich audit results with CIS Benchmark mappings.
  const rawAudits = (posture.auditResults as Array<{ id: string; category: string; title: string; status: string; severity: string; detail: string }>) ?? [];
  const enrichedAudits = enrichWithCis(rawAudits);
  const compliance = cisSummary(rawAudits);

  return {
    ...posture,
    auditResults: enrichedAudits,
    cisSummary: compliance,
  };
}

export async function getScoreHistory(orgId: string, serverId: string, days: number = 90) {
  const server = await prisma.server.findFirst({ where: { id: serverId, orgId } });
  if (!server) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Server not found');
  }

  const since = new Date(Date.now() - days * 86_400_000);
  return prisma.$queryRawUnsafe(
    'SELECT score, breakdown, created_at AS "createdAt" FROM server_score_history WHERE server_id = $1 AND created_at >= $2 ORDER BY created_at ASC',
    serverId, since,
  );
}
