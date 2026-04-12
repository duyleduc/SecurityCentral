import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/errors.js';

// BigInt fields from Prisma need conversion to Number for JSON serialization.
function serializeMetric(m: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(m)) {
    out[k] = typeof v === 'bigint' ? Number(v) : v;
  }
  return out;
}

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

  const rows = await prisma.serverMetricSnapshot.findMany({
    where: {
      serverId,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: 'asc' },
  });

  return rows.map((m) => serializeMetric(m as unknown as Record<string, unknown>));
}
