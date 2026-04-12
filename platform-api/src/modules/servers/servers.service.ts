import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/errors.js';
import { matchServerPackages, applyMatchesToFindings, syncFeeds } from '../vulndb/vulndb.service.js';
import { logger } from '../../lib/logger.js';

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
  data: { hostname?: string; projectId?: string | null; tags?: Array<{ key: string; value: string }> },
) {
  const server = await prisma.server.findFirst({ where: { id: serverId, orgId } });
  if (!server) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Server not found');
  }

  const update: Record<string, unknown> = {};
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
  const matches = await matchServerPackages(serverId, inventory.osFamily, packages);
  const result = await applyMatchesToFindings(orgId, serverId, server.hostname, matches);

  logger.info('Manual CVE scan completed', {
    serverId,
    hostname: server.hostname,
    matched: matches.length,
    created: result.created,
    resolved: result.resolved,
  });

  return {
    matched: matches.length,
    created: result.created,
    resolved: result.resolved,
    packages: packages.length,
    osFamily: inventory.osFamily,
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

  // Return the latest posture report.
  return prisma.securityPosture.findFirst({
    where: { serverId },
    orderBy: { createdAt: 'desc' },
  });
}
