import type { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/errors.js';
import type { ListScansQuery } from './scans.validation.js';

// ---------------------------------------------------------------------------
// List scans
// ---------------------------------------------------------------------------

export async function listScans(orgId: string, query: ListScansQuery) {
  const { page, per_page } = query;
  const skip = (page - 1) * per_page;

  const where: Prisma.ScanWhereInput = { orgId };
  if (query.scan_type) where.scanType = query.scan_type as any;
  if (query.status) where.status = query.status as any;
  if (query.repository_id) where.repositoryId = query.repository_id;
  if (query.server_id) where.serverId = query.server_id;

  const [data, total] = await Promise.all([
    prisma.scan.findMany({
      where,
      skip,
      take: per_page,
      orderBy: { createdAt: 'desc' },
      include: {
        repository: { select: { name: true, owner: true } },
        server: { select: { hostname: true } },
      },
    }),
    prisma.scan.count({ where }),
  ]);

  return { data, meta: { page, per_page, total } };
}

// ---------------------------------------------------------------------------
// Get scan detail
// ---------------------------------------------------------------------------

export async function getScanById(orgId: string, scanId: string) {
  const scan = await prisma.scan.findFirst({
    where: { id: scanId, orgId },
    include: {
      repository: { select: { id: true, name: true, owner: true } },
      server: { select: { id: true, hostname: true } },
    },
  });

  if (!scan) {
    throw new AppError('RESOURCE_NOT_FOUND', `Scan ${scanId} not found`);
  }

  return scan;
}

// ---------------------------------------------------------------------------
// Cancel scan
// ---------------------------------------------------------------------------

const CANCELLABLE = new Set(['pending', 'running']);

export async function cancelScan(orgId: string, scanId: string) {
  const scan = await prisma.scan.findFirst({
    where: { id: scanId, orgId },
  });

  if (!scan) {
    throw new AppError('RESOURCE_NOT_FOUND', `Scan ${scanId} not found`);
  }

  if (!CANCELLABLE.has(scan.status)) {
    throw new AppError('VALIDATION_ERROR', `Cannot cancel scan in "${scan.status}" status`);
  }

  return prisma.scan.update({
    where: { id: scanId },
    data: { status: 'cancelled' },
  });
}
