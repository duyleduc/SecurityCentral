import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/errors.js';
import { calculateScore, type ScoreResult } from '../../lib/scoring.js';
import { emitFindingUpdated, emitFindingResolved } from '../../ws/hooks.js';

// ---------------------------------------------------------------------------
// Findings CRUD
// ---------------------------------------------------------------------------

interface ListOptions {
  readonly orgId: string;
  readonly severity?: string;
  readonly status?: string;
  readonly source?: string;
  readonly repositoryId?: string;
  readonly serverId?: string;
  readonly page: number;
  readonly limit: number;
}

export async function list(opts: ListOptions) {
  const where: Record<string, unknown> = { orgId: opts.orgId };
  if (opts.severity) where.severity = opts.severity;
  if (opts.status) where.status = opts.status;
  if (opts.source) where.source = opts.source;
  if (opts.repositoryId) where.repositoryId = opts.repositoryId;
  if (opts.serverId) where.serverId = opts.serverId;

  const [items, total] = await Promise.all([
    prisma.finding.findMany({
      where,
      include: {
        repository: { select: { id: true, owner: true, name: true, provider: true } },
        server: { select: { id: true, hostname: true } },
      },
      orderBy: [{ severity: 'asc' }, { createdAt: 'desc' }],
      skip: (opts.page - 1) * opts.limit,
      take: opts.limit,
    }),
    prisma.finding.count({ where }),
  ]);

  return { items, total, page: opts.page, limit: opts.limit };
}

export async function getById(orgId: string, id: string) {
  const finding = await prisma.finding.findFirst({
    where: { id, orgId },
    include: {
      repository: { select: { id: true, owner: true, name: true, provider: true } },
      server: { select: { id: true, hostname: true } },
      scan: { select: { id: true, type: true, status: true, createdAt: true } },
    },
  });
  if (!finding) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Finding not found');
  }
  return finding;
}

export async function updateStatus(orgId: string, id: string, status: string) {
  const existing = await prisma.finding.findFirst({ where: { id, orgId } });
  if (!existing) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Finding not found');
  }

  const data: Record<string, unknown> = { status };
  if (status === 'resolved') {
    data.resolvedAt = new Date();
  } else if (existing.status === 'resolved') {
    data.resolvedAt = null;
  }

  const updated = await prisma.finding.update({ where: { id }, data });

  if (status === 'resolved') {
    emitFindingResolved(orgId, { id, title: existing.title });
  } else {
    emitFindingUpdated(orgId, { id, status });
  }

  return updated;
}

// ---------------------------------------------------------------------------
// Scoring — compute score for any asset
// ---------------------------------------------------------------------------

export async function getScoreForRepository(orgId: string, repositoryId: string): Promise<ScoreResult> {
  return getScoreByFilter({ orgId, repositoryId, status: 'open' });
}

export async function getScoreForServer(orgId: string, serverId: string): Promise<ScoreResult> {
  return getScoreByFilter({ orgId, serverId, status: 'open' });
}

export async function getScoreForEndpoint(orgId: string, endpointId: string): Promise<ScoreResult> {
  return getScoreByFilter({ orgId, endpointId, status: 'open' });
}

async function getScoreByFilter(where: Record<string, unknown>): Promise<ScoreResult> {
  const groups = await prisma.finding.groupBy({
    by: ['severity'],
    where,
    _count: true,
  });

  const bySeverity: Record<string, number> = {};
  for (const g of groups) {
    bySeverity[g.severity] = g._count;
  }

  return calculateScore(bySeverity);
}

// ---------------------------------------------------------------------------
// Severity summary for org
// ---------------------------------------------------------------------------

export async function getSeveritySummary(orgId: string) {
  const groups = await prisma.finding.groupBy({
    by: ['severity'],
    where: { orgId, status: 'open' },
    _count: true,
  });

  const result: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const g of groups) {
    result[g.severity] = g._count;
  }
  return result;
}
