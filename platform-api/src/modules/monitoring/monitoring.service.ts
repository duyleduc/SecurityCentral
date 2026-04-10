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

  // Auto-create findings from check results
  await createDomainFindings(endpoint.orgId, endpointId, endpoint.host, result);

  return result;
}

// ---------------------------------------------------------------------------
// Auto-create findings from domain check results
// ---------------------------------------------------------------------------

async function createDomainFindings(
  orgId: string,
  endpointId: string,
  host: string,
  result: DomainCheckResult,
): Promise<void> {
  const findings: Array<{ title: string; severity: string; description: string }> = [];

  // SSL issues
  if (result.ssl && !result.ssl.valid) {
    findings.push({
      title: `Invalid SSL certificate for ${host}`,
      severity: 'high',
      description: result.ssl.error ?? 'SSL certificate is invalid or expired',
    });
  } else if (result.ssl && result.ssl.daysLeft <= 7) {
    findings.push({
      title: `SSL certificate for ${host} expires in ${result.ssl.daysLeft} days`,
      severity: 'critical',
      description: `Certificate issued by ${result.ssl.issuer} expires on ${result.ssl.expiry.toISOString()}`,
    });
  } else if (result.ssl && result.ssl.daysLeft <= 30) {
    findings.push({
      title: `SSL certificate for ${host} expires in ${result.ssl.daysLeft} days`,
      severity: 'medium',
      description: `Certificate issued by ${result.ssl.issuer} expires on ${result.ssl.expiry.toISOString()}`,
    });
  }

  // Downtime
  if (!result.http.isUp) {
    findings.push({
      title: `${host} is down`,
      severity: 'critical',
      description: result.http.error ?? `HTTP check failed with status ${result.http.statusCode}`,
    });
  }

  // DNS security gaps
  if (result.dns.spf === 'missing') {
    findings.push({ title: `Missing SPF record for ${host}`, severity: 'medium', description: 'No SPF DNS record found. Email spoofing is possible.' });
  }
  if (result.dns.dmarc === 'missing') {
    findings.push({ title: `Missing DMARC record for ${host}`, severity: 'medium', description: 'No DMARC DNS record found. Email authentication policy not enforced.' });
  }
  if (result.dns.dkim === 'missing') {
    findings.push({ title: `Missing DKIM record for ${host}`, severity: 'low', description: 'No DKIM DNS record found.' });
  }

  // Upsert findings (dedup by title + endpointId)
  for (const f of findings) {
    const existing = await prisma.finding.findFirst({
      where: { orgId, endpointId, title: f.title, status: { in: ['open', 'in_progress'] } },
    });
    if (!existing) {
      await prisma.finding.create({
        data: {
          orgId,
          endpointId,
          source: 'cert_monitor',
          severity: f.severity,
          status: 'open',
          title: f.title,
          description: f.description,
        },
      });
    }
  }

  // Auto-resolve findings that are no longer applicable
  const activeTitles = new Set(findings.map((f) => f.title));
  const stale = await prisma.finding.findMany({
    where: { orgId, endpointId, source: 'cert_monitor', status: 'open' },
  });
  const toResolve = stale.filter((f) => !activeTitles.has(f.title));
  if (toResolve.length > 0) {
    await prisma.finding.updateMany({
      where: { id: { in: toResolve.map((f) => f.id) } },
      data: { status: 'resolved', resolvedAt: new Date() },
    });
  }
}
