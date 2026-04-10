import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/errors.js';
import { checkSsl, checkHttp, checkDns, checkDomain, type DomainCheckResult } from './domain-check.service.js';

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

interface CreateEndpointInput {
  readonly orgId: string;
  readonly projectId?: string;
  readonly host: string;
  readonly port: number;
  readonly protocol: string;
  readonly uptimeInterval?: number;
  readonly uptimeTimeout?: number;
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
    include: { project: { select: { id: true, name: true } } },
  });
  if (!endpoint) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Endpoint not found');
  }
  return endpoint;
}

export async function create(input: CreateEndpointInput) {
  const now = new Date();

  const endpoint = await prisma.monitoredEndpoint.create({
    data: {
      orgId: input.orgId,
      projectId: input.projectId,
      host: input.host,
      port: input.port,
      protocol: input.protocol,
      uptimeInterval: input.uptimeInterval ?? 15,
      uptimeTimeout: input.uptimeTimeout ?? 30,
      nextCheckAt: new Date(now.getTime() + 1000), // first uptime check almost immediately
    },
  });

  // Run initial SSL/DNS check immediately (fire-and-forget)
  performSslCheck(endpoint.id).catch(() => {});

  return endpoint;
}

export async function update(orgId: string, id: string, data: { uptimeInterval?: number; uptimeTimeout?: number }) {
  const existing = await prisma.monitoredEndpoint.findFirst({ where: { id, orgId } });
  if (!existing) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Endpoint not found');
  }
  return prisma.monitoredEndpoint.update({ where: { id }, data });
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
  // Run both checks
  const result = await performFullCheck(endpoint.id);
  return result;
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
// Uptime check — fast HTTP ping (runs every uptimeInterval seconds)
// ---------------------------------------------------------------------------

export async function performUptimeCheck(endpointId: string): Promise<void> {
  const endpoint = await prisma.monitoredEndpoint.findUniqueOrThrow({ where: { id: endpointId } });

  const httpResult = await checkHttp(endpoint.host, endpoint.port, endpoint.protocol);

  const status = httpResult.isUp ? 'healthy' : 'down';
  const now = new Date();
  const nextCheckAt = new Date(now.getTime() + (endpoint.uptimeInterval * 1000));

  await prisma.$transaction([
    prisma.endpointHeartbeat.create({
      data: {
        endpointId,
        statusCode: httpResult.statusCode,
        responseMs: httpResult.responseMs,
        isUp: httpResult.isUp,
        error: httpResult.error ?? null,
      },
    }),
    prisma.monitoredEndpoint.update({
      where: { id: endpointId },
      data: { status, lastCheckAt: now, nextCheckAt },
    }),
  ]);
}

// ---------------------------------------------------------------------------
// SSL/DNS check — full security scan (runs on create, then daily at midnight)
// ---------------------------------------------------------------------------

export async function performSslCheck(endpointId: string): Promise<void> {
  const endpoint = await prisma.monitoredEndpoint.findUniqueOrThrow({ where: { id: endpointId } });

  const [ssl, dnsResult] = await Promise.all([
    endpoint.protocol === 'https' ? checkSsl(endpoint.host, endpoint.port) : Promise.resolve(null),
    checkDns(endpoint.host),
  ]);

  // Store SSL result as a heartbeat with SSL fields
  if (ssl) {
    await prisma.endpointHeartbeat.create({
      data: {
        endpointId,
        isUp: true, // SSL check is not an uptime check
        sslValid: ssl.valid,
        sslExpiry: ssl.expiry,
        sslIssuer: ssl.issuer,
        sslDaysLeft: ssl.daysLeft,
        tlsVersion: ssl.tlsVersion,
        dnsSpf: dnsResult.spf,
        dnsDkim: dnsResult.dkim,
        dnsDmarc: dnsResult.dmarc,
        details: JSON.parse(JSON.stringify({ ssl, dns: dnsResult })),
      },
    });
  }

  // Update endpoint SSL check timestamp
  let status = endpoint.status;
  if (ssl && !ssl.valid) status = 'degraded';
  if (ssl && ssl.daysLeft <= 14) status = 'degraded';

  await prisma.monitoredEndpoint.update({
    where: { id: endpointId },
    data: { lastSslCheckAt: new Date(), status },
  });

  // Auto-create findings from SSL/DNS issues
  await createDomainFindings(endpoint.orgId, endpointId, endpoint.host, ssl, dnsResult);
}

// ---------------------------------------------------------------------------
// Full check — both uptime + SSL/DNS (manual trigger)
// ---------------------------------------------------------------------------

export async function performFullCheck(endpointId: string): Promise<DomainCheckResult> {
  const endpoint = await prisma.monitoredEndpoint.findUniqueOrThrow({ where: { id: endpointId } });

  const result = await checkDomain(endpoint.host, endpoint.port, endpoint.protocol);
  const now = new Date();
  const nextCheckAt = new Date(now.getTime() + (endpoint.uptimeInterval * 1000));

  let status = 'healthy';
  if (!result.http.isUp) {
    status = 'down';
  } else if (result.ssl && !result.ssl.valid) {
    status = 'degraded';
  } else if (result.ssl && result.ssl.daysLeft <= 14) {
    status = 'degraded';
  }

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
      data: { status, lastCheckAt: now, lastSslCheckAt: now, nextCheckAt },
    }),
  ]);

  await createDomainFindings(endpoint.orgId, endpointId, endpoint.host, result.ssl, result.dns);

  return result;
}

// ---------------------------------------------------------------------------
// Auto-create findings from SSL/DNS check results
// ---------------------------------------------------------------------------

async function createDomainFindings(
  orgId: string,
  endpointId: string,
  host: string,
  ssl: Awaited<ReturnType<typeof checkSsl>> | null,
  dns: Awaited<ReturnType<typeof checkDns>>,
): Promise<void> {
  const findings: Array<{ title: string; severity: string; description: string }> = [];

  if (ssl && !ssl.valid) {
    findings.push({
      title: `Invalid SSL certificate for ${host}`,
      severity: 'high',
      description: ssl.error ?? 'SSL certificate is invalid or expired',
    });
  } else if (ssl && ssl.daysLeft <= 7) {
    findings.push({
      title: `SSL certificate for ${host} expires in ${ssl.daysLeft} days`,
      severity: 'critical',
      description: `Certificate issued by ${ssl.issuer} expires on ${ssl.expiry.toISOString()}`,
    });
  } else if (ssl && ssl.daysLeft <= 30) {
    findings.push({
      title: `SSL certificate for ${host} expires in ${ssl.daysLeft} days`,
      severity: 'medium',
      description: `Certificate issued by ${ssl.issuer} expires on ${ssl.expiry.toISOString()}`,
    });
  }

  if (dns.spf === 'missing') {
    findings.push({ title: `Missing SPF record for ${host}`, severity: 'medium', description: 'No SPF DNS record found.' });
  }
  if (dns.dmarc === 'missing') {
    findings.push({ title: `Missing DMARC record for ${host}`, severity: 'medium', description: 'No DMARC DNS record found.' });
  }
  if (dns.dkim === 'missing') {
    findings.push({ title: `Missing DKIM record for ${host}`, severity: 'low', description: 'No DKIM DNS record found.' });
  }

  for (const f of findings) {
    const existing = await prisma.finding.findFirst({
      where: { orgId, endpointId, title: f.title, status: { in: ['open', 'in_progress'] } },
    });
    if (!existing) {
      await prisma.finding.create({
        data: { orgId, endpointId, source: 'cert_monitor', severity: f.severity, status: 'open', title: f.title, description: f.description },
      });
    }
  }

  // Auto-resolve stale
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
