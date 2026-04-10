import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/errors.js';

interface ListOptions {
  readonly orgId: string;
  readonly projectId?: string;
  readonly provider?: string;
  readonly page: number;
  readonly limit: number;
}

export async function list(opts: ListOptions) {
  const where: Record<string, unknown> = { orgId: opts.orgId };
  if (opts.projectId) where.projectId = opts.projectId;
  if (opts.provider) where.provider = opts.provider;

  const [items, total] = await Promise.all([
    prisma.repository.findMany({
      where,
      include: {
        _count: { select: { scans: true, findings: { where: { status: 'open' } } } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (opts.page - 1) * opts.limit,
      take: opts.limit,
    }),
    prisma.repository.count({ where }),
  ]);

  return { items, total, page: opts.page, limit: opts.limit };
}

export async function getById(orgId: string, id: string) {
  const repo = await prisma.repository.findFirst({
    where: { id, orgId },
    include: {
      project: { select: { id: true, name: true } },
      integration: { select: { id: true, provider: true, status: true } },
      _count: { select: { scans: true, findings: { where: { status: 'open' } } } },
    },
  });

  if (!repo) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Repository not found');
  }

  // Severity breakdown for open findings
  const severityGroups = await prisma.finding.groupBy({
    by: ['severity'],
    where: { repositoryId: id, status: 'open' },
    _count: true,
  });

  const findingCounts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const g of severityGroups) {
    findingCounts[g.severity] = g._count;
  }

  return { ...repo, findingCounts };
}

export async function remove(orgId: string, id: string) {
  const existing = await prisma.repository.findFirst({ where: { id, orgId } });
  if (!existing) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Repository not found');
  }
  await prisma.repository.delete({ where: { id } });
}

export async function getScanHistory(orgId: string, repoId: string, page: number, limit: number) {
  const repo = await prisma.repository.findFirst({ where: { id: repoId, orgId } });
  if (!repo) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Repository not found');
  }

  const [items, total] = await Promise.all([
    prisma.scan.findMany({
      where: { repositoryId: repoId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.scan.count({ where: { repositoryId: repoId } }),
  ]);

  return { items, total, page, limit };
}
