import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/errors.js';
import { createCloudClient, type CloudConfig } from '../../lib/cloud/types.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ component: 'cloud-discovery' });

// ---------------------------------------------------------------------------
// Connect cloud provider (validates credentials via test discovery)
// ---------------------------------------------------------------------------

export async function connectCloudProvider(orgId: string, provider: string, config: CloudConfig) {
  // Check for existing integration of this provider type
  const existing = await prisma.integration.findFirst({
    where: { orgId, provider },
  });

  if (existing) {
    throw new AppError('INTEGRATION_ALREADY_EXISTS', `${provider} integration already exists`);
  }

  // Validate credentials by running a test discovery
  const client = createCloudClient(provider, config);
  try {
    await client.discoverInstances();
  } catch (err) {
    throw new AppError('VALIDATION_ERROR', `Failed to connect to ${provider}: ${(err as Error).message}`);
  }

  // Create integration record
  const integration = await prisma.integration.create({
    data: {
      orgId,
      provider,
      status: 'active',
      config: config as any,
    },
  });

  // Run initial discovery
  await discoverResources(orgId, provider);

  log.info('Cloud provider connected', { orgId, provider, integrationId: integration.id });
  return integration;
}

// ---------------------------------------------------------------------------
// Discover resources (fetch from cloud API, upsert, match agents)
// ---------------------------------------------------------------------------

export async function discoverResources(orgId: string, provider: string): Promise<number> {
  const integration = await prisma.integration.findFirst({
    where: { orgId, provider, status: 'active' },
  });

  if (!integration) {
    throw new AppError('RESOURCE_NOT_FOUND', `No active ${provider} integration`);
  }

  const client = createCloudClient(provider, integration.config as CloudConfig);
  const instances = await client.discoverInstances();

  log.info('Discovered cloud instances', { orgId, provider, count: instances.length });

  // Upsert each resource
  for (const inst of instances) {
    await prisma.cloudResource.upsert({
      where: {
        orgId_provider_resourceId: { orgId, provider, resourceId: inst.resourceId },
      },
      create: {
        orgId,
        integrationId: integration.id,
        provider,
        resourceType: inst.resourceType,
        resourceId: inst.resourceId,
        hostname: inst.hostname,
        ipAddress: inst.ipAddress,
        region: inst.region,
        status: inst.status,
        osInfo: inst.osInfo,
        lastSyncedAt: new Date(),
      },
      update: {
        hostname: inst.hostname,
        ipAddress: inst.ipAddress,
        region: inst.region,
        status: inst.status,
        osInfo: inst.osInfo,
        lastSyncedAt: new Date(),
      },
    });
  }

  // Match agents: cloudInstanceId → hostname → IP
  await matchAgents(orgId, provider);

  // Remove stale resources not in latest discovery
  const freshIds = instances.map((i) => i.resourceId);
  if (freshIds.length > 0) {
    await prisma.cloudResource.deleteMany({
      where: {
        orgId,
        provider,
        integrationId: integration.id,
        resourceId: { notIn: freshIds },
      },
    });
  }

  return instances.length;
}

async function matchAgents(orgId: string, provider: string): Promise<void> {
  const resources = await prisma.cloudResource.findMany({
    where: { orgId, provider, serverId: null },
    select: { id: true, resourceId: true, hostname: true, ipAddress: true },
  });

  for (const resource of resources) {
    // Match by cloudInstanceId first (highest confidence)
    let server = await prisma.server.findFirst({
      where: { orgId, cloudInstanceId: resource.resourceId },
      select: { id: true },
    });

    // Fallback: match by hostname
    if (!server && resource.hostname) {
      server = await prisma.server.findFirst({
        where: { orgId, hostname: resource.hostname },
        select: { id: true },
      });
    }

    if (server) {
      await prisma.cloudResource.update({
        where: { id: resource.id },
        data: { serverId: server.id },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// List discovered resources (paginated, with server join)
// ---------------------------------------------------------------------------

export async function listDiscoveredResources(
  orgId: string,
  provider: string,
  query: { page: number; per_page: number; region?: string; status?: string },
) {
  const where: Record<string, unknown> = { orgId, provider };
  if (query.region) where.region = query.region;
  if (query.status) where.status = query.status;

  const skip = (query.page - 1) * query.per_page;

  const [data, total] = await Promise.all([
    prisma.cloudResource.findMany({
      where: where as any,
      skip,
      take: query.per_page,
      orderBy: { lastSyncedAt: 'desc' },
      include: {
        server: {
          select: { id: true, hostname: true, agentVersion: true, lastHeartbeat: true, status: true },
        },
      },
    }),
    prisma.cloudResource.count({ where: where as any }),
  ]);

  return { data, meta: { page: query.page, per_page: query.per_page, total } };
}

// ---------------------------------------------------------------------------
// Unmonitored servers (cloud resources without agents)
// ---------------------------------------------------------------------------

export async function getUnmonitoredServers(orgId: string) {
  return prisma.cloudResource.findMany({
    where: { orgId, serverId: null, status: 'running' },
    orderBy: { lastSyncedAt: 'desc' },
    select: {
      id: true,
      provider: true,
      resourceId: true,
      resourceType: true,
      hostname: true,
      ipAddress: true,
      region: true,
      status: true,
      osInfo: true,
    },
  });
}

// ---------------------------------------------------------------------------
// Coverage stats (per provider + region)
// ---------------------------------------------------------------------------

export async function getCoverageStats(orgId: string) {
  const resources = await prisma.cloudResource.findMany({
    where: { orgId },
    select: { provider: true, region: true, serverId: true },
  });

  const stats = new Map<string, { total: number; monitored: number }>();

  for (const r of resources) {
    const key = `${r.provider}:${r.region ?? 'unknown'}`;
    const entry = stats.get(key) ?? { total: 0, monitored: 0 };
    entry.total++;
    if (r.serverId) entry.monitored++;
    stats.set(key, entry);
  }

  const breakdown = [...stats.entries()].map(([key, val]) => {
    const [provider, region] = key.split(':');
    return {
      provider,
      region,
      total: val.total,
      monitored: val.monitored,
      coverage_pct: val.total > 0 ? Math.round((val.monitored / val.total) * 100) : 0,
    };
  });

  const totalInstances = resources.length;
  const totalMonitored = resources.filter((r) => r.serverId).length;

  return {
    total_instances: totalInstances,
    total_monitored: totalMonitored,
    overall_coverage_pct: totalInstances > 0 ? Math.round((totalMonitored / totalInstances) * 100) : 0,
    breakdown,
  };
}
