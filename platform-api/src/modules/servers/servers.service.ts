import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/errors.js';

export async function list(orgId: string) {
  return prisma.server.findMany({
    where: { orgId },
    include: {
      _count: { select: { metrics: true, findings: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getById(orgId: string, id: string) {
  const server = await prisma.server.findFirst({
    where: { id, orgId },
    include: {
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

  return server;
}

export async function getMetrics(orgId: string, serverId: string, hours: number) {
  const server = await prisma.server.findFirst({ where: { id: serverId, orgId } });
  if (!server) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Server not found');
  }

  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  return prisma.serverMetricSnapshot.findMany({
    where: {
      serverId,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: 'asc' },
  });
}
