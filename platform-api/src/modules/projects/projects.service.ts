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
