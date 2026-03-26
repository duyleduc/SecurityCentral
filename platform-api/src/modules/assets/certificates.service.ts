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

  return cert;
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
