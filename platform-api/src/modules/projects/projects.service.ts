import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/errors.js';

interface CreateProjectInput {
  readonly orgId: string;
  readonly name: string;
  readonly description: string;
}

export async function list(orgId: string) {
  return prisma.project.findMany({
    where: { orgId },
    include: {
      _count: {
        select: {
          servers: true,
          monitoredEndpoints: true,
          repositories: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getById(orgId: string, id: string) {
  const project = await prisma.project.findFirst({
    where: { id, orgId },
    include: {
      servers: {
        select: { id: true, hostname: true, status: true, lastHeartbeat: true },
      },
      monitoredEndpoints: {
        select: { id: true, host: true, status: true, lastCheckAt: true },
      },
      repositories: {
        select: { id: true, owner: true, name: true, provider: true, language: true, lastScanAt: true },
      },
      _count: {
        select: { servers: true, monitoredEndpoints: true, repositories: true },
      },
    },
  });

  if (!project) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Project not found');
  }

  return project;
}

export async function create(input: CreateProjectInput) {
  return prisma.project.create({
    data: {
      orgId: input.orgId,
      name: input.name,
      description: input.description,
      notes: '',
    },
  });
}

export async function update(orgId: string, id: string, data: { name?: string; description?: string; notes?: string; banner?: string | null }) {
  const existing = await prisma.project.findFirst({ where: { id, orgId } });
  if (!existing) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Project not found');
  }

  return prisma.project.update({
    where: { id },
    data,
  });
}

export async function remove(orgId: string, id: string) {
  const existing = await prisma.project.findFirst({ where: { id, orgId } });
  if (!existing) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Project not found');
  }

  await prisma.project.delete({ where: { id } });
}

export async function getSummary(orgId: string, id: string) {
  const project = await prisma.project.findFirst({ where: { id, orgId } });
  if (!project) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Project not found');
  }

  const [serverCount, endpointCount, findings] = await Promise.all([
    prisma.server.count({ where: { projectId: id } }),
    prisma.monitoredEndpoint.count({ where: { projectId: id } }),
    prisma.finding.groupBy({
      by: ['severity'],
      where: { orgId, status: 'open' },
      _count: true,
    }),
  ]);

  const findingsBySeverity: Record<string, number> = {};
  for (const f of findings) {
    findingsBySeverity[f.severity] = f._count;
  }

  return {
    project: { id: project.id, name: project.name },
    assets: { servers: serverCount, endpoints: endpointCount },
    findings: findingsBySeverity,
  };
}

// ---------------------------------------------------------------------------
// Tag keys — collect distinct tag keys from all assets in a project (or org-wide)
// ---------------------------------------------------------------------------

export async function getTagKeys(orgId: string, projectId?: string): Promise<string[]> {
  const where = projectId ? { projectId } : { orgId };

  const [endpoints, servers] = await Promise.all([
    prisma.monitoredEndpoint.findMany({ where: { ...where, orgId }, select: { tags: true } }),
    prisma.server.findMany({ where: { ...where, orgId }, select: { tags: true } }),
  ]);

  const keys = new Set<string>();
  for (const item of [...endpoints, ...servers]) {
    const tags = item.tags as Array<{ key: string; value: string }> | null;
    if (Array.isArray(tags)) {
      for (const t of tags) {
        if (t.key) keys.add(t.key);
      }
    }
  }

  return Array.from(keys).sort();
}
