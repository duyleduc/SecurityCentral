import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/errors.js';
import { checkDomain, type DomainCheckResult } from './domain-check.service.js';

const INTERVAL_MS: Record<string, number> = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
};

interface CreateEndpointInput {
  readonly orgId: string;
  readonly projectId?: string;
  readonly host: string;
  readonly port: number;
  readonly protocol: string;
  readonly checkInterval: string;
}

export async function list(orgId: string) {
  return prisma.monitoredEndpoint.findMany({
    where: { orgId },
    include: {
      project: { select: { id: true, name: true } },
      heartbeats: {
        take: 1,
        orderBy: { createdAt: 'desc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getById(orgId: string, id: string) {
  const endpoint = await prisma.monitoredEndpoint.findFirst({
    where: { id, orgId },
    include: {
      project: { select: { id: true, name: true } },
    },
  });

  if (!endpoint) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Endpoint not found');
  }

  return endpoint;
}

export async function create(input: CreateEndpointInput) {
  const intervalMs = INTERVAL_MS[input.checkInterval] ?? INTERVAL_MS['1h'];
  const now = new Date();

  return prisma.monitoredEndpoint.create({
    data: {
      orgId: input.orgId,
      projectId: input.projectId,
      host: input.host,
      port: input.port,
      protocol: input.protocol,
      checkInterval: input.checkInterval,
      nextCheckAt: new Date(now.getTime() + 1000), // check almost immediately
    },
  });
}

export async function remove(orgId: string, id: string) {
  const existing = await prisma.monitoredEndpoint.findFirst({ where: { id, orgId } });
  if (!existing) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Endpoint not found');
  }

  await prisma.monitoredEndpoint.delete({ where: { id } });
}

export async function triggerCheck(orgId: string, id: string) {
  const endpoint = await prisma.monitoredEndpoint.findFirst({ where: { id, orgId } });
  if (!endpoint) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Endpoint not found');
  }

  return performCheck(endpoint.id);
}

export async function getHeartbeats(orgId: string, endpointId: string, limit: number, offset: number) {
  const endpoint = await prisma.monitoredEndpoint.findFirst({ where: { id: endpointId, orgId } });
  if (!endpoint) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Endpoint not found');
  }

  const [heartbeats, total] = await Promise.all([
    prisma.endpointHeartbeat.findMany({
      where: { endpointId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.endpointHeartbeat.count({ where: { endpointId } }),
  ]);

  return { heartbeats, total };
}

// ---------------------------------------------------------------------------
// Perform a domain check and store results
// ---------------------------------------------------------------------------

export async function performCheck(endpointId: string): Promise<DomainCheckResult> {
  const endpoint = await prisma.monitoredEndpoint.findUniqueOrThrow({ where: { id: endpointId } });

  const result = await checkDomain(endpoint.host, endpoint.port, endpoint.protocol);
  const intervalMs = INTERVAL_MS[endpoint.checkInterval] ?? INTERVAL_MS['1h'];
  const now = new Date();

  // Determine overall status
  let status = 'healthy';
  if (!result.http.isUp) {
    status = 'down';
  } else if (result.ssl && !result.ssl.valid) {
    status = 'degraded';
  } else if (result.ssl && result.ssl.daysLeft <= 14) {
    status = 'degraded';
  }

  // Store heartbeat and update endpoint in a transaction
  await prisma.$transaction([
    prisma.endpointHeartbeat.create({
      data: {
        endpointId,
        statusCode: result.http.statusCode,
        responseMs: result.http.responseMs,
        isUp: result.http.isUp,
        sslValid: result.ssl?.valid ?? null,
        sslExpiry: result.ssl?.expiry ?? null,
        sslIssuer: result.ssl?.issuer ?? null,
        sslDaysLeft: result.ssl?.daysLeft ?? null,
        tlsVersion: result.ssl?.tlsVersion ?? null,
        dnsSpf: result.dns.spf,
        dnsDkim: result.dns.dkim,
        dnsDmarc: result.dns.dmarc,
        error: result.http.error ?? result.ssl?.error ?? null,
        details: JSON.parse(JSON.stringify(result)),
      },
    }),
    prisma.monitoredEndpoint.update({
      where: { id: endpointId },
      data: {
        status,
        lastCheckAt: now,
        nextCheckAt: new Date(now.getTime() + intervalMs),
      },
    }),
  ]);

  return result;
}
