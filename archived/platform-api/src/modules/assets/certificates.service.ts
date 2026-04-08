import type { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/errors.js';
import type { ListCertsQuery, ExpiringQuery } from './certificates.validation.js';

// ---------------------------------------------------------------------------
// List certificates
// ---------------------------------------------------------------------------

export async function listCertificates(orgId: string, query: ListCertsQuery) {
  const { page, per_page } = query;
  const skip = (page - 1) * per_page;

  const where: Prisma.CertificateWhereInput = { orgId };
  if (query.status) where.status = query.status;

  // Filter by project and/or tags via monitored endpoints
  if (query.project_ids || query.tags) {
    const epWhere: Prisma.MonitoredEndpointWhereInput = { orgId, status: 'active' };

    if (query.project_ids) {
      epWhere.projectId = { in: query.project_ids.split(',') };
    }

    if (query.tags) {
      // tags = "env=prod,team=infra" → AND condition on JSON tags field
      const tagPairs = query.tags.split(',').map((t) => t.trim()).filter(Boolean);
      const tagConditions: Prisma.MonitoredEndpointWhereInput[] = tagPairs.map((pair) => {
        const [key, ...rest] = pair.split('=');
        const value = rest.join('=');
        return { tags: { path: [key], equals: value } };
      });
      epWhere.AND = tagConditions;
    }

    const endpoints = await prisma.monitoredEndpoint.findMany({
      where: epWhere,
      select: { host: true, port: true },
    });

    const discoveredFromValues = endpoints.map((ep) => `probe:${ep.host}:${ep.port}`);
    if (discoveredFromValues.length === 0) {
      return { data: [], meta: { page, per_page, total: 0 } };
    }
    where.discoveredFrom = { in: discoveredFromValues };
  }

  const [data, total] = await Promise.all([
    prisma.certificate.findMany({
      where,
      skip,
      take: per_page,
      orderBy: { notAfter: 'asc' },
      select: {
        id: true,
        subjectCn: true,
        sans: true,
        issuerCn: true,
        notBefore: true,
        notAfter: true,
        keyAlgorithm: true,
        status: true,
        discoveredFrom: true,
        lastCheckedAt: true,
        createdAt: true,
      },
    }),
    prisma.certificate.count({ where }),
  ]);

  return { data, meta: { page, per_page, total } };
}

// ---------------------------------------------------------------------------
// Get certificate detail
// ---------------------------------------------------------------------------

export async function getCertificateById(orgId: string, certId: string) {
  const cert = await prisma.certificate.findFirst({
    where: { id: certId, orgId },
    include: {
      sourceAsset: { select: { id: true, hostname: true } },
      findings: {
        where: { status: { in: ['open', 'in_progress'] } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          title: true,
          severity: true,
          status: true,
          cveId: true,
          firstSeenAt: true,
        },
      },
    },
  });

  if (!cert) {
    throw new AppError('RESOURCE_NOT_FOUND', `Certificate ${certId} not found`);
  }

  // Resolve linked endpoint and project from discoveredFrom (e.g. "probe:host:443")
  let endpoint: { id: string; host: string; port: number; project: { id: string; name: string } | null } | null = null;
  if (cert.discoveredFrom?.startsWith('probe:')) {
    const parts = cert.discoveredFrom.replace('probe:', '').split(':');
    const host = parts.slice(0, -1).join(':'); // handle IPv6
    const port = parseInt(parts[parts.length - 1], 10) || 443;
    const ep = await prisma.monitoredEndpoint.findFirst({
      where: { orgId, host, port },
      select: { id: true, host: true, port: true, project: { select: { id: true, name: true } } },
    });
    if (ep) endpoint = ep;
  }

  return { ...cert, endpoint };
}

// ---------------------------------------------------------------------------
// Expiring certificates
// ---------------------------------------------------------------------------

export async function getExpiringCertificates(orgId: string, query: ExpiringQuery) {
  const { days, page, per_page } = query;
  const skip = (page - 1) * per_page;

  const deadline = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  const where: Prisma.CertificateWhereInput = {
    orgId,
    notAfter: { lte: deadline },
    status: { in: ['active', 'expiring'] },
  };

  const [data, total] = await Promise.all([
    prisma.certificate.findMany({
      where,
      skip,
      take: per_page,
      orderBy: { notAfter: 'asc' },
      select: {
        id: true,
        subjectCn: true,
        sans: true,
        issuerCn: true,
        notAfter: true,
        status: true,
        discoveredFrom: true,
      },
    }),
    prisma.certificate.count({ where }),
  ]);

  return { data, meta: { page, per_page, total } };
}
