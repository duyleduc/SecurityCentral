import { prisma } from '../../lib/prisma.js';
import { calculateScore } from '../../lib/scoring.js';

// ---------------------------------------------------------------------------
// GET /api/v1/dashboard/summary
// ---------------------------------------------------------------------------

export async function getSummary(orgId: string) {
  const [
    projectCount,
    repositoryCount,
    serverCount,
    endpointCount,
    severityGroups,
    recentFindings,
  ] = await Promise.all([
    prisma.project.count({ where: { orgId } }),
    prisma.repository.count({ where: { orgId } }),
    prisma.server.count({ where: { orgId } }),
    prisma.monitoredEndpoint.count({ where: { orgId } }),
    prisma.finding.groupBy({
      by: ['severity'],
      where: { orgId, status: 'open' },
      _count: true,
    }),
    prisma.finding.count({
      where: { orgId, createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
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

export async function getTopRisks(orgId: string, limit = 10) {
  const findings = await prisma.finding.findMany({
    where: { orgId, status: 'open', severity: { in: ['critical', 'high'] } },
    include: {
      repository: { select: { id: true, owner: true, name: true } },
      server: { select: { id: true, hostname: true } },
    },
    orderBy: [{ severity: 'asc' }, { cvssScore: 'desc' }, { createdAt: 'desc' }],
    take: limit,
  });

  return findings;
}

// ---------------------------------------------------------------------------
// GET /api/v1/dashboard/assets
// ---------------------------------------------------------------------------

export async function getAssets(orgId: string) {
  const [repositories, servers, endpoints] = await Promise.all([
    getRepoScores(orgId),
    getServerScores(orgId),
    getEndpointScores(orgId),
  ]);

  return { repositories, servers, endpoints };
}

async function getRepoScores(orgId: string) {
  const repos = await prisma.repository.findMany({
    where: { orgId },
    select: { id: true, owner: true, name: true, provider: true, lastScanAt: true },
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

async function getServerScores(orgId: string) {
  const servers = await prisma.server.findMany({
    where: { orgId },
    select: { id: true, hostname: true, status: true, lastHeartbeat: true },
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

async function getEndpointScores(orgId: string) {
  const endpoints = await prisma.monitoredEndpoint.findMany({
    where: { orgId },
    select: { id: true, host: true, status: true, lastCheckAt: true },
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
