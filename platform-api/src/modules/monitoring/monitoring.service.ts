import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/errors.js';
import { checkSsl, checkHttp, checkDns, checkDomain, checkHttpRedirect, enrichSslWithHttpHeaders, type DomainCheckResult } from './domain-check.service.js';

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
  readonly tags?: ReadonlyArray<{ key: string; value: string }>;
}

export async function list(orgId: string, filters?: { status?: string; tags?: string }) {
  const where: Record<string, unknown> = { orgId };

  if (filters?.status) {
    where.status = filters.status;
  }

  const endpoints = await prisma.monitoredEndpoint.findMany({
    where,
    include: {
      project: { select: { id: true, name: true } },
      heartbeats: {
        take: 1,
        orderBy: { createdAt: 'desc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Filter by tags in-memory (MySQL JSON queries are less ergonomic).
  // Tags query format: "key=value,key2=value2" (AND logic).
  let filtered = endpoints;
  if (filters?.tags) {
    const tagFilters = filters.tags.split(',').map((t) => {
      const [key, ...rest] = t.trim().split('=');
      return { key: key.trim(), value: rest.join('=').trim() };
    }).filter((t) => t.key);

    filtered = endpoints.filter((ep) => {
      const epTags = ep.tags as Array<{ key: string; value: string }> | null;
      if (!epTags || !Array.isArray(epTags)) return false;
      return tagFilters.every((tf) =>
        epTags.some((et) => et.key === tf.key && (!tf.value || et.value === tf.value)),
      );
    });
  }

  if (filtered.length === 0) return filtered;

  // Fetch latest SSL heartbeat per endpoint
  const sslHbs = await Promise.all(
    filtered.map((ep) =>
      prisma.endpointHeartbeat.findFirst({
        where: { endpointId: ep.id, sslValid: { not: null } },
        orderBy: { createdAt: 'desc' },
        select: { endpointId: true, sslValid: true, sslDaysLeft: true, details: true },
      }),
    ),
  );

  const sslByEndpoint = new Map<string, { sslValid: boolean | null; sslDaysLeft: number | null; sslGrade: string | null; sslGradeColor: string | null }>();
  for (const hb of sslHbs) {
    if (!hb) continue;
    const details = hb.details as any;
    sslByEndpoint.set(hb.endpointId, {
      sslValid: hb.sslValid,
      sslDaysLeft: hb.sslDaysLeft,
      sslGrade: details?.ssl?.grade ?? null,
      sslGradeColor: details?.ssl?.gradeColor ?? null,
    });
  }

  return filtered.map((ep) => ({
    ...ep,
    latestSsl: sslByEndpoint.get(ep.id) ?? null,
  }));
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
      tags: input.tags ? JSON.parse(JSON.stringify(input.tags)) : [],
      nextCheckAt: new Date(now.getTime() + 1000), // first uptime check almost immediately
    },
  });

  // Run initial SSL/DNS check immediately (fire-and-forget)
  performSslCheck(endpoint.id).catch(() => {});

  return endpoint;
}

export async function update(orgId: string, id: string, data: { uptimeInterval?: number; uptimeTimeout?: number; tags?: Array<{ key: string; value: string }> }) {
  const existing = await prisma.monitoredEndpoint.findFirst({ where: { id, orgId } });
  if (!existing) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Endpoint not found');
  }
  const updateData: Record<string, unknown> = {};
  if (data.uptimeInterval !== undefined) updateData.uptimeInterval = data.uptimeInterval;
  if (data.uptimeTimeout !== undefined) updateData.uptimeTimeout = data.uptimeTimeout;
  if (data.tags !== undefined) updateData.tags = JSON.parse(JSON.stringify(data.tags));
  return prisma.monitoredEndpoint.update({ where: { id }, data: updateData });
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

export async function getLatestSslScan(orgId: string, id: string) {
  const endpoint = await prisma.monitoredEndpoint.findFirst({ where: { id, orgId } });
  if (!endpoint) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Endpoint not found');
  }
  const sslHb = await prisma.endpointHeartbeat.findFirst({
    where: { endpointId: id, sslValid: { not: null } },
    orderBy: { createdAt: 'desc' },
  });
  return sslHb;
}

export async function triggerSslCheck(orgId: string, id: string) {
  const endpoint = await prisma.monitoredEndpoint.findFirst({ where: { id, orgId } });
  if (!endpoint) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Endpoint not found');
  }
  await performSslCheck(endpoint.id);

  // Return the latest SSL heartbeat with full details
  const sslHb = await prisma.endpointHeartbeat.findFirst({
    where: { endpointId: id, sslValid: { not: null } },
    orderBy: { createdAt: 'desc' },
  });
  return sslHb;
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
  const host = extractHostnameHelper(endpoint.host);

  // Run SSL + HTTP (for headers) + DNS + redirect check in parallel
  const [rawSsl, httpResult, dnsResult, httpRedirect] = await Promise.all([
    endpoint.protocol === 'https' ? checkSsl(host, endpoint.port) : Promise.resolve(null),
    checkHttp(host, endpoint.port, endpoint.protocol),
    checkDns(host),
    checkHttpRedirect(host),
  ]);

  // Enrich SSL with HTTP security headers + redirect info
  const ssl = rawSsl ? enrichSslWithHttpHeaders(rawSsl, httpResult, httpRedirect) : null;

  // Store SSL result as a heartbeat with full details
  if (ssl) {
    await prisma.endpointHeartbeat.create({
      data: {
        endpointId,
        isUp: true,
        sslValid: ssl.valid,
        sslExpiry: ssl.expiry,
        sslIssuer: ssl.issuerCn,
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

  // Auto-create findings
  await createDomainFindings(endpoint.orgId, endpointId, endpoint.host, ssl, dnsResult);
}

/** Extract bare hostname from host field (may be full URL). */
function extractHostnameHelper(input: string): string {
  let s = input.trim();
  if (s.startsWith('http://') || s.startsWith('https://')) {
    try { return new URL(s).hostname; } catch {}
  }
  s = s.split('/')[0];
  s = s.split(':')[0];
  return s;
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

  if (ssl) {
    // Certificate expiry
    if (ssl.daysLeft <= 0) {
      findings.push({ title: `SSL certificate for ${host} has expired`, severity: 'critical', description: `Certificate expired ${Math.abs(ssl.daysLeft)} days ago. Browsers will block access.` });
    } else if (ssl.daysLeft <= 7) {
      findings.push({ title: `SSL certificate for ${host} expires in ${ssl.daysLeft} days`, severity: 'critical', description: `Issued by ${ssl.issuerCn}. Renew immediately to avoid downtime.` });
    } else if (ssl.daysLeft <= 30) {
      findings.push({ title: `SSL certificate for ${host} expires in ${ssl.daysLeft} days`, severity: 'medium', description: `Issued by ${ssl.issuerCn}. Renew soon.` });
    }

    // Invalid certificate
    if (!ssl.valid && ssl.daysLeft > 0) {
      findings.push({ title: `Invalid SSL certificate for ${host}`, severity: 'high', description: ssl.error ?? 'Certificate is not trusted by the system.' });
    }

    // Weak protocol
    if (['SSLv2', 'SSLv3'].includes(ssl.tlsVersion)) {
      findings.push({ title: `Critical: ${host} uses ${ssl.tlsVersion}`, severity: 'critical', description: `${ssl.tlsVersion} is obsolete and has known vulnerabilities (POODLE). Upgrade to TLS 1.2+.` });
    } else if (['TLSv1', 'TLSv1.1'].includes(ssl.tlsVersion)) {
      findings.push({ title: `Deprecated TLS version on ${host}: ${ssl.tlsVersion}`, severity: 'high', description: `${ssl.tlsVersion} is deprecated. Upgrade to TLS 1.2 or 1.3.` });
    }

    // Weak cipher
    const weakCiphers = ['RC4', '3DES', 'DES', 'EXPORT', 'NULL', 'ANON'];
    if (weakCiphers.some((wc) => ssl.cipherName.toUpperCase().includes(wc))) {
      findings.push({ title: `Weak cipher suite on ${host}: ${ssl.cipherName}`, severity: 'high', description: 'Switch to AES-GCM or ChaCha20-Poly1305.' });
    }

    // No forward secrecy
    if (!ssl.forwardSecrecy) {
      findings.push({ title: `No forward secrecy on ${host}`, severity: 'medium', description: 'Past traffic can be decrypted if the private key is compromised. Use ECDHE key exchange.' });
    }

    // Weak key
    if (ssl.keyBits != null) {
      if (ssl.keyAlgorithm.includes('RSA') && ssl.keyBits < 2048) {
        findings.push({ title: `Weak RSA key on ${host}: ${ssl.keyBits} bits`, severity: 'high', description: 'Minimum 2048 bits required for RSA.' });
      } else if (ssl.keyAlgorithm.includes('ECDSA') && ssl.keyBits < 256) {
        findings.push({ title: `Weak ECDSA key on ${host}: ${ssl.keyBits} bits`, severity: 'high', description: 'Minimum 256 bits required for ECDSA.' });
      }
    }

    // Self-signed
    if (ssl.isSelfSigned) {
      findings.push({ title: `Self-signed certificate on ${host}`, severity: 'medium', description: 'Browsers will show a security warning. Use a trusted CA.' });
    }

    // Chain invalid
    if (!ssl.chainValid && !ssl.isSelfSigned) {
      findings.push({ title: `Incomplete certificate chain on ${host}`, severity: 'medium', description: 'May break connections on mobile or older browsers. Ensure all intermediate certs are included.' });
    }

    // Missing HSTS
    if (!ssl.hsts) {
      findings.push({ title: `Missing HSTS header on ${host}`, severity: 'low', description: 'Strict-Transport-Security header not found. Users may be vulnerable to protocol downgrade attacks.' });
    }
  }

  // DNS findings
  if (dns.spf === 'missing') {
    findings.push({ title: `Missing SPF record for ${host}`, severity: 'medium', description: 'No SPF DNS record. Email spoofing is possible.' });
  }
  if (dns.dmarc === 'missing') {
    findings.push({ title: `Missing DMARC record for ${host}`, severity: 'medium', description: 'No DMARC DNS record. Email authentication policy not enforced.' });
  }
  if (dns.dkim === 'missing') {
    findings.push({ title: `Missing DKIM record for ${host}`, severity: 'low', description: 'No DKIM DNS record found.' });
  }
  if (dns.caa === 'missing') {
    findings.push({ title: `Missing CAA record for ${host}`, severity: 'low', description: 'No CAA DNS record. Any CA can issue certificates for this domain.' });
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
