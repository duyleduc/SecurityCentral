import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/errors.js';
import { scanOrchestrationQueue } from '../../jobs/queues.js';

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createProject(orgId: string, name: string, description?: string) {
  try {
    return await prisma.project.create({
      data: { orgId, name, description: description ?? null },
    });
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'P2002') {
      throw new AppError('VALIDATION_ERROR', `Project "${name}" already exists`);
    }
    throw err;
  }
}

export async function listProjects(orgId: string) {
  const projects = await prisma.project.findMany({
    where: { orgId },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { repositories: true, servers: true, monitoredEndpoints: true } },
    },
  });

  // Get finding counts per project
  return Promise.all(projects.map(async (p) => {
    const findings = await prisma.finding.count({
      where: {
        orgId,
        repositoryId: { in: (await prisma.repository.findMany({ where: { projectId: p.id }, select: { id: true } })).map((r) => r.id) },
        status: { in: ['open', 'in_progress'] },
      },
    });

    return {
      ...p,
      repoCount: p._count.repositories,
      serverCount: p._count.servers,
      endpointCount: p._count.monitoredEndpoints,
      openFindings: findings,
    };
  }));
}

export async function getProject(orgId: string, projectId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
    include: {
      repositories: { orderBy: { createdAt: 'desc' } },
      servers: { orderBy: { createdAt: 'desc' } },
      monitoredEndpoints: { orderBy: { createdAt: 'desc' } },
    },
  });

  if (!project) throw new AppError('RESOURCE_NOT_FOUND', 'Project not found');
  return project;
}

export async function updateProject(orgId: string, projectId: string, data: { name?: string; description?: string }) {
  const existing = await prisma.project.findFirst({ where: { id: projectId, orgId } });
  if (!existing) throw new AppError('RESOURCE_NOT_FOUND', 'Project not found');

  return prisma.project.update({
    where: { id: projectId },
    data: { name: data.name ?? existing.name, description: data.description ?? existing.description },
  });
}

export async function deleteProject(orgId: string, projectId: string) {
  const existing = await prisma.project.findFirst({ where: { id: projectId, orgId } });
  if (!existing) throw new AppError('RESOURCE_NOT_FOUND', 'Project not found');

  // Unlink assets (don't delete them)
  await prisma.repository.updateMany({ where: { projectId }, data: { projectId: null } });
  await prisma.server.updateMany({ where: { projectId }, data: { projectId: null } });
  await prisma.monitoredEndpoint.updateMany({ where: { projectId }, data: { projectId: null } });

  await prisma.project.delete({ where: { id: projectId } });
}

// ---------------------------------------------------------------------------
// Project summary (dashboard stats)
// ---------------------------------------------------------------------------

export async function getProjectSummary(orgId: string, projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, orgId } });
  if (!project) throw new AppError('RESOURCE_NOT_FOUND', 'Project not found');

  const repoIds = (await prisma.repository.findMany({
    where: { projectId },
    select: { id: true },
  })).map((r) => r.id);

  const serverIds = (await prisma.server.findMany({
    where: { projectId },
    select: { id: true },
  })).map((s) => s.id);

  const hasRepos = repoIds.length > 0;
  const hasServers = serverIds.length > 0;

  // Resolve certificates linked to this project's endpoints
  const endpoints = await prisma.monitoredEndpoint.findMany({
    where: { projectId },
    select: { host: true, port: true },
  });
  const discoveredFromValues = endpoints.map((ep) => `probe:${ep.host}:${ep.port}`);
  const certIds = discoveredFromValues.length > 0
    ? (await prisma.certificate.findMany({
        where: { orgId, discoveredFrom: { in: discoveredFromValues } },
        select: { id: true },
      })).map((c) => c.id)
    : [];
  const hasCerts = certIds.length > 0;

  // Build OR condition for findings linked to project assets
  const findingAssetFilter: Record<string, unknown>[] = [];
  if (hasRepos) findingAssetFilter.push({ repositoryId: { in: repoIds } });
  if (hasServers) findingAssetFilter.push({ serverId: { in: serverIds } });
  if (hasCerts) findingAssetFilter.push({ certificateId: { in: certIds } });

  const openFindingWhere = findingAssetFilter.length > 0
    ? { orgId, status: { in: ['open', 'in_progress'] } as any, OR: findingAssetFilter }
    : null;

  const [
    repoCount,
    serverCount,
    endpointCount,
    severityCounts,
    recentFindings,
    lastScan,
    activeScans,
    certificates,
  ] = await Promise.all([
    prisma.repository.count({ where: { projectId } }),
    prisma.server.count({ where: { projectId } }),
    prisma.monitoredEndpoint.count({ where: { projectId } }),
    // Severity breakdown for open findings (includes repo, server, cert findings)
    openFindingWhere
      ? prisma.finding.groupBy({
          by: ['severity'],
          where: openFindingWhere as any,
          _count: { id: true },
        })
      : Promise.resolve([]),
    // Recent critical/high findings (from all asset types)
    findingAssetFilter.length > 0
      ? prisma.finding.findMany({
          where: {
            orgId,
            status: { in: ['open', 'in_progress'] },
            severity: { in: ['critical', 'high'] },
            OR: findingAssetFilter,
          } as any,
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true, title: true, severity: true, status: true, cveId: true, firstSeenAt: true,
            repository: { select: { name: true, owner: true } },
            certificate: { select: { subjectCn: true } },
          },
        })
      : Promise.resolve([]),
    // Last completed scan
    hasRepos
      ? prisma.scan.findFirst({
          where: { orgId, repositoryId: { in: repoIds }, status: 'completed' },
          orderBy: { completedAt: 'desc' },
          select: { id: true, completedAt: true, scanType: true, findingsTotal: true },
        })
      : Promise.resolve(null),
    // Active scans count
    hasRepos
      ? prisma.scan.count({
          where: { orgId, repositoryId: { in: repoIds }, status: { in: ['pending', 'running'] } },
        })
      : Promise.resolve(0),
    // Certificates linked to project endpoints
    hasCerts
      ? prisma.certificate.findMany({
          where: { orgId, id: { in: certIds } },
          orderBy: { notAfter: 'asc' },
          select: {
            id: true, subjectCn: true, issuerCn: true, notAfter: true, status: true, keyAlgorithm: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const severity: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const row of severityCounts) {
    severity[row.severity] = row._count.id;
  }
  const totalOpen = Object.values(severity).reduce((a, b) => a + b, 0);

  return {
    totalOpenFindings: totalOpen,
    severity,
    assets: { repositories: repoCount, servers: serverCount, endpoints: endpointCount, certificates: certIds.length },
    lastScan,
    activeScans,
    recentFindings,
    certificates,
  };
}

// ---------------------------------------------------------------------------
// Assign assets to project
// ---------------------------------------------------------------------------

export async function assignRepoToProject(orgId: string, repoId: string, projectId: string) {
  const repo = await prisma.repository.findFirst({ where: { id: repoId, orgId } });
  if (!repo) throw new AppError('RESOURCE_NOT_FOUND', 'Repository not found');

  const project = await prisma.project.findFirst({ where: { id: projectId, orgId } });
  if (!project) throw new AppError('RESOURCE_NOT_FOUND', 'Project not found');

  const updated = await prisma.repository.update({ where: { id: repoId }, data: { projectId } });

  // Auto-trigger first scan if repo has never been scanned
  if (!repo.lastScanAt) {
    const activeScan = await prisma.scan.findFirst({
      where: { repositoryId: repoId, status: { in: ['pending', 'running'] } },
    });

    if (!activeScan) {
      const scan = await prisma.scan.create({
        data: { orgId, scanType: 'code_dependencies', status: 'pending', trigger: 'manual', repositoryId: repoId },
      });

      await scanOrchestrationQueue.add('scan-repository', {
        scanId: scan.id, repositoryId: repoId, orgId,
      }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      });
    }
  }

  return updated;
}

export async function removeRepoFromProject(orgId: string, repoId: string, projectId: string) {
  const repo = await prisma.repository.findFirst({ where: { id: repoId, orgId, projectId } });
  if (!repo) throw new AppError('RESOURCE_NOT_FOUND', 'Repository not found in this project');

  return prisma.repository.update({ where: { id: repoId }, data: { projectId: null } });
}

export async function assignServerToProject(orgId: string, serverId: string, projectId: string) {
  const server = await prisma.server.findFirst({ where: { id: serverId, orgId } });
  if (!server) throw new AppError('RESOURCE_NOT_FOUND', 'Server not found');

  return prisma.server.update({ where: { id: serverId }, data: { projectId } });
}

export async function assignEndpointToProject(orgId: string, endpointId: string, projectId: string) {
  const endpoint = await prisma.monitoredEndpoint.findFirst({ where: { id: endpointId, orgId } });
  if (!endpoint) throw new AppError('RESOURCE_NOT_FOUND', 'Endpoint not found');

  return prisma.monitoredEndpoint.update({ where: { id: endpointId }, data: { projectId } });
}
