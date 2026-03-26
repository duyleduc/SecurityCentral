import { prisma } from './prisma.js';

// ---------------------------------------------------------------------------
// Audit log creation (fire-and-forget — never blocks the caller)
// ---------------------------------------------------------------------------

export interface AuditEntry {
  readonly orgId: string;
  readonly actorType: 'user' | 'agent' | 'system';
  readonly actorId: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly oldValue?: unknown;
  readonly newValue?: unknown;
}

/**
 * Write an audit log entry. Non-blocking — failures are logged but never thrown.
 */
export function audit(entry: AuditEntry): void {
  prisma.auditLog
    .create({
      data: {
        orgId: entry.orgId,
        actorType: entry.actorType,
        actorId: entry.actorId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        oldValue: entry.oldValue ?? undefined,
        newValue: entry.newValue ?? undefined,
      },
    })
    .catch((err) => {
      console.error('[audit] Failed to write audit log:', err);
    });
}

// ---------------------------------------------------------------------------
// Audit log query
// ---------------------------------------------------------------------------

export interface ListAuditLogsQuery {
  readonly entity_type?: string;
  readonly entity_id?: string;
  readonly actor_id?: string;
  readonly from?: string;  // ISO date
  readonly to?: string;    // ISO date
  readonly page: number;
  readonly per_page: number;
}

export async function listAuditLogs(orgId: string, query: ListAuditLogsQuery) {
  const { page, per_page } = query;
  const skip = (page - 1) * per_page;

  const where: Record<string, unknown> = { orgId };
  if (query.entity_type) where.entityType = query.entity_type;
  if (query.entity_id) where.entityId = query.entity_id;
  if (query.actor_id) where.actorId = query.actor_id;

  if (query.from || query.to) {
    const createdAt: Record<string, Date> = {};
    if (query.from) createdAt.gte = new Date(query.from);
    if (query.to) createdAt.lte = new Date(query.to);
    where.createdAt = createdAt;
  }

  const [data, total] = await Promise.all([
    prisma.auditLog.findMany({
      where: where as any,
      skip,
      take: per_page,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.auditLog.count({ where: where as any }),
  ]);

  return { data, meta: { page, per_page, total } };
}
