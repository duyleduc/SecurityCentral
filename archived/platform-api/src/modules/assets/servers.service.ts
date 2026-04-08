import type { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/errors.js';
import type { ListServersQuery, UpdateServerConfigInput } from './servers.validation.js';

// ---------------------------------------------------------------------------
// List servers
// ---------------------------------------------------------------------------

export async function listServers(orgId: string, query: ListServersQuery) {
  const { page, per_page } = query;
  const skip = (page - 1) * per_page;

  const where: Prisma.ServerWhereInput = { orgId };
  if (query.status) {
    where.status = query.status;
  } else {
    where.status = { not: 'decommissioned' };
  }
  if (query.environment) where.environment = query.environment;
  if (query.os_family) where.osFamily = query.os_family;

  const [servers, total] = await Promise.all([
    prisma.server.findMany({
      where,
      skip,
      take: per_page,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.server.count({ where }),
  ]);

  // Attach open finding counts per server
  const serverIds = servers.map((s) => s.id);
  const findingCounts = serverIds.length > 0
    ? await prisma.finding.groupBy({
        by: ['serverId'],
        where: { serverId: { in: serverIds }, status: { in: ['open', 'in_progress'] } },
        _count: { id: true },
      })
    : [];

  const countMap = new Map(
    findingCounts.map((g) => [g.serverId, g._count.id]),
  );

  const data = servers.map((s) => ({
    ...s,
    openFindingCount: countMap.get(s.id) ?? 0,
  }));

  return { data, meta: { page, per_page, total } };
}

// ---------------------------------------------------------------------------
// Get server detail
// ---------------------------------------------------------------------------

export async function getServerById(orgId: string, serverId: string) {
  const server = await prisma.server.findFirst({
    where: { id: serverId, orgId },
    include: {
      project: { select: { id: true, name: true } },
    },
  });

  if (!server) {
    throw new AppError('RESOURCE_NOT_FOUND', `Server ${serverId} not found`);
  }

  // Recent findings
  const recentFindings = await prisma.finding.findMany({
    where: { serverId, orgId, status: { in: ['open', 'in_progress'] } },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      title: true,
      severity: true,
      status: true,
      cveId: true,
      cvssScore: true,
      firstSeenAt: true,
    },
  });

  // Finding counts by severity
  const findingCounts = await prisma.finding.groupBy({
    by: ['severity'],
    where: { serverId, orgId, status: { in: ['open', 'in_progress'] } },
    _count: { id: true },
  });

  const severityCounts = Object.fromEntries(
    findingCounts.map((g) => [g.severity, g._count.id]),
  );

  return { ...server, recentFindings, findingCounts: severityCounts };
}

// ---------------------------------------------------------------------------
// Update server config (tags, scan settings, heartbeat interval)
// ---------------------------------------------------------------------------

export async function updateServerConfig(orgId: string, serverId: string, input: UpdateServerConfigInput) {
  const server = await prisma.server.findFirst({
    where: { id: serverId, orgId },
  });

  if (!server) {
    throw new AppError('RESOURCE_NOT_FOUND', `Server ${serverId} not found`);
  }

  const metadata = server.metadata as Record<string, unknown>;
  const currentConfig = (metadata.config ?? {}) as Record<string, unknown>;

  const updatedConfig = { ...currentConfig };

  if (input.scan) {
    const currentScan = (currentConfig.scan ?? {}) as Record<string, unknown>;
    updatedConfig.scan = { ...currentScan, ...input.scan };
  }
  if (input.heartbeat) {
    const currentHeartbeat = (currentConfig.heartbeat ?? {}) as Record<string, unknown>;
    updatedConfig.heartbeat = { ...currentHeartbeat, ...input.heartbeat };
  }

  metadata.config = updatedConfig;

  const updated = await prisma.server.update({
    where: { id: serverId },
    data: {
      ...(input.tags !== undefined ? { tags: input.tags as object } : {}),
      metadata: metadata as object,
    },
  });

  return { ...updated, config: updatedConfig };
}

// ---------------------------------------------------------------------------
// Decommission (soft delete)
// ---------------------------------------------------------------------------

export async function decommissionServer(orgId: string, serverId: string) {
  const server = await prisma.server.findFirst({
    where: { id: serverId, orgId },
  });

  if (!server) {
    throw new AppError('RESOURCE_NOT_FOUND', `Server ${serverId} not found`);
  }

  return prisma.server.update({
    where: { id: serverId },
    data: { status: 'decommissioned', projectId: null },
  });
}
