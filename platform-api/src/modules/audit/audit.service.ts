import { prisma } from '../../lib/prisma.js';
import { emitAuditLog } from '../../ws/hooks.js';

interface CreateAuditInput {
  readonly orgId: string;
  readonly actorId?: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId?: string;
  readonly oldValues?: unknown;
  readonly newValues?: unknown;
}

export async function createEntry(input: CreateAuditInput) {
  const entry = await prisma.auditLog.create({
    data: {
      orgId: input.orgId,
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      oldValues: input.oldValues ? JSON.parse(JSON.stringify(input.oldValues)) : undefined,
      newValues: input.newValues ? JSON.parse(JSON.stringify(input.newValues)) : undefined,
    },
  });

  emitAuditLog(input.orgId, {
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    actorId: input.actorId,
  });

  return entry;
}

interface ListOptions {
  readonly orgId: string;
  readonly page: number;
  readonly limit: number;
  readonly entityType?: string;
  readonly action?: string;
}

export async function list(opts: ListOptions) {
  const where: Record<string, unknown> = { orgId: opts.orgId };
  if (opts.entityType) where.entityType = opts.entityType;
  if (opts.action) where.action = opts.action;

  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (opts.page - 1) * opts.limit,
      take: opts.limit,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { items, total, page: opts.page, limit: opts.limit };
}
