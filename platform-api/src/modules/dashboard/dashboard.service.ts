import { prisma } from '../../lib/prisma.js';
import { calculateScore } from '../../lib/scoring.js';

// Build a Finding `where` clause that constrains findings to assets owned by
// the given project. Findings have no direct projectId — we route through the
// repository/server relations and a list of endpoint IDs in the project.
async function findingProjectScope(orgId: string, projectId?: string | null) {
  const base = { orgId };
  if (!projectId) return base;
  const endpoints = await prisma.monitoredEndpoint.findMany({
    where: { orgId, projectId },
    select: { id: true },
  });
  const endpointIds = endpoints.map((e) => e.id);
  return {
    ...base,
    OR: [
      { repository: { is: { projectId } } },
      { server: { is: { projectId } } },
      ...(endpointIds.length > 0 ? [{ endpointId: { in: endpointIds } }] : []),
    ],
  };
}

// ---------------------------------------------------------------------------
// GET /api/v1/dashboard/summary
// ---------------------------------------------------------------------------

export async function getSummary(orgId: string, projectId?: string | null) {
  const assetScope = projectId ? { orgId, projectId } : { orgId };
  const findingScope = await findingProjectScope(orgId, projectId);

  const [
    projectCount,
    repositoryCount,
    serverCount,
    endpointCount,
    severityGroups,
    recentFindings,
  ] = await Promise.all([
    prisma.project.count({ where: { orgId } }),
    prisma.repository.count({ where: assetScope }),
    prisma.server.count({ where: assetScope }),
    prisma.monitoredEndpoint.count({ where: assetScope }),
    prisma.finding.groupBy({
      by: ['severity'],
      where: { ...findingScope, status: 'open' },
      _count: true,
    }),
    prisma.finding.count({
      where: { ...findingScope, createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
    }),
  ]);

  const findingsBySeverity: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const g of severityGroups) {
    findingsBySeverity[g.severity] = g._count;
  }
  const totalOpen = Object.values(findingsBySeverity).reduce((a, b) => a + b, 0);
  const overallScore = calculateScore(findingsBySeverity);

  return {
    assets: {
      projects: projectCount,
      repositories: repositoryCount,
      servers: serverCount,
      domains: endpointCount,
    },
    findings: {
      ...findingsBySeverity,
      total: totalOpen,
      last7Days: recentFindings,
    },
    score: overallScore,
  };
}

// ---------------------------------------------------------------------------
// GET /api/v1/dashboard/top-risks
// ---------------------------------------------------------------------------

export async function getTopRisks(orgId: string, projectId?: string | null, limit = 10) {
  const findingScope = await findingProjectScope(orgId, projectId);
  const findings = await prisma.finding.findMany({
    where: { ...findingScope, status: 'open', severity: { in: ['critical', 'high'] } },
    include: {
      repository: { select: { id: true, owner: true, name: true, projectId: true } },
      server: { select: { id: true, hostname: true, projectId: true } },
    },
    orderBy: [{ severity: 'asc' }, { cvssScore: 'desc' }, { createdAt: 'desc' }],
    take: limit,
  });

  return findings;
}

// ---------------------------------------------------------------------------
// GET /api/v1/dashboard/assets
// ---------------------------------------------------------------------------

export async function getAssets(orgId: string, projectId?: string | null) {
  const [repositories, servers, endpoints] = await Promise.all([
    getRepoScores(orgId, projectId),
    getServerScores(orgId, projectId),
    getEndpointScores(orgId, projectId),
  ]);

  return { repositories, servers, endpoints };
}

async function getRepoScores(orgId: string, projectId?: string | null) {
  const repos = await prisma.repository.findMany({
    where: projectId ? { orgId, projectId } : { orgId },
    select: { id: true, owner: true, name: true, provider: true, lastScanAt: true, projectId: true },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  return Promise.all(repos.map(async (r) => {
    const groups = await prisma.finding.groupBy({
      by: ['severity'],
      where: { repositoryId: r.id, status: 'open' },
      _count: true,
    });
    const bySev: Record<string, number> = {};
    for (const g of groups) bySev[g.severity] = g._count;
    return { ...r, type: 'repository' as const, score: calculateScore(bySev) };
  }));
}

async function getServerScores(orgId: string, projectId?: string | null) {
  const servers = await prisma.server.findMany({
    where: projectId ? { orgId, projectId } : { orgId },
    select: { id: true, hostname: true, status: true, lastHeartbeat: true, projectId: true },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  return Promise.all(servers.map(async (s) => {
    const groups = await prisma.finding.groupBy({
      by: ['severity'],
      where: { serverId: s.id, status: 'open' },
      _count: true,
    });
    const bySev: Record<string, number> = {};
    for (const g of groups) bySev[g.severity] = g._count;
    return { ...s, type: 'server' as const, score: calculateScore(bySev) };
  }));
}

async function getEndpointScores(orgId: string, projectId?: string | null) {
  const endpoints = await prisma.monitoredEndpoint.findMany({
    where: projectId ? { orgId, projectId } : { orgId },
    select: { id: true, host: true, status: true, lastCheckAt: true, projectId: true },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  return Promise.all(endpoints.map(async (e) => {
    const groups = await prisma.finding.groupBy({
      by: ['severity'],
      where: { endpointId: e.id, status: 'open' },
      _count: true,
    });
    const bySev: Record<string, number> = {};
    for (const g of groups) bySev[g.severity] = g._count;
    return { ...e, type: 'endpoint' as const, score: calculateScore(bySev) };
  }));
}
