import type { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/errors.js';
import { scanOrchestrationQueue } from '../../jobs/queues.js';
import type { ListReposQuery } from './repositories.validation.js';

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export async function listRepositories(orgId: string, query: ListReposQuery) {
  const { page, per_page } = query;
  const skip = (page - 1) * per_page;

  const where: Prisma.RepositoryWhereInput = { orgId };
  if (query.provider) where.provider = query.provider;
  if (query.language) where.language = query.language;

  const [data, total] = await Promise.all([
    prisma.repository.findMany({
      where,
      skip,
      take: per_page,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.repository.count({ where }),
  ]);

  return { data, meta: { page, per_page, total } };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

interface CreateRepoInput {
  readonly provider: string;
  readonly providerId: string;
  readonly owner: string;
  readonly name: string;
  readonly defaultBranch: string;
  readonly language?: string;
}

export async function createRepository(orgId: string, input: CreateRepoInput) {
  try {
    return await prisma.repository.create({
      data: {
        orgId,
        provider: input.provider,
        providerId: input.providerId,
        owner: input.owner,
        name: input.name,
        defaultBranch: input.defaultBranch,
        language: input.language ?? null,
      },
    });
  } catch (err: unknown) {
    // Prisma unique constraint violation
    if ((err as { code?: string }).code === 'P2002') {
      throw new AppError('INTEGRATION_ALREADY_EXISTS', 'Repository already registered for this org/provider');
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Get by ID (with scan summary + finding counts)
// ---------------------------------------------------------------------------

export async function getRepositoryById(orgId: string, repoId: string) {
  const repo = await prisma.repository.findFirst({
    where: { id: repoId, orgId },
  });

  if (!repo) {
    throw new AppError('RESOURCE_NOT_FOUND', `Repository ${repoId} not found`);
  }

  // Latest scan
  const latestScan = await prisma.scan.findFirst({
    where: { repositoryId: repoId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      scanType: true,
      status: true,
      findingsTotal: true,
      findingsNew: true,
      findingsResolved: true,
      startedAt: true,
      completedAt: true,
      durationMs: true,
    },
  });

  // Finding counts by severity
  const findingCounts = await prisma.finding.groupBy({
    by: ['severity'],
    where: { repositoryId: repoId, orgId, status: { in: ['open', 'in_progress'] } },
    _count: { id: true },
  });

  const severityCounts = Object.fromEntries(
    findingCounts.map((g) => [g.severity, g._count.id]),
  );

  return { ...repo, latestScan, findingCounts: severityCounts };
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deleteRepository(orgId: string, repoId: string) {
  const repo = await prisma.repository.findFirst({
    where: { id: repoId, orgId },
  });

  if (!repo) {
    throw new AppError('RESOURCE_NOT_FOUND', `Repository ${repoId} not found`);
  }

  // Delete findings, scans, then repo (cascade)
  await prisma.finding.deleteMany({ where: { repositoryId: repoId } });
  await prisma.scan.deleteMany({ where: { repositoryId: repoId } });
  await prisma.repository.delete({ where: { id: repoId } });
}

// ---------------------------------------------------------------------------
// Trigger scan
// ---------------------------------------------------------------------------

export async function triggerScan(orgId: string, repoId: string, requestId?: string) {
  const repo = await prisma.repository.findFirst({
    where: { id: repoId, orgId },
  });

  if (!repo) {
    throw new AppError('RESOURCE_NOT_FOUND', `Repository ${repoId} not found`);
  }

  // Check for active scan
  const activeScan = await prisma.scan.findFirst({
    where: {
      repositoryId: repoId,
      status: { in: ['pending', 'running'] },
    },
  });

  if (activeScan) {
    throw new AppError('SCAN_ALREADY_RUNNING', 'Repository already has an active scan');
  }

  // Create pending scan record
  const scan = await prisma.scan.create({
    data: {
      orgId,
      scanType: 'code_dependencies',
      status: 'pending',
      trigger: 'manual',
      repositoryId: repoId,
    },
  });

  // Enqueue job
  await scanOrchestrationQueue.add('scan-repository', {
    scanId: scan.id,
    repositoryId: repoId,
    orgId,
    request_id: requestId,
  }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  });

  return scan;
}
