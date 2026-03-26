import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { notificationsQueue } from '../../jobs/queues.js';
import { enqueueFindingSyncBatch } from '../findings/sync.js';
import type { SubmitFindingsInput, FindingItem } from './agents.validation.js';

const log = logger.child({ component: 'findings-ingestion' });

// Map scan_type to FindingSource enum
const SOURCE_MAP: Record<string, string> = {
  code_dependencies: 'code_scanner',
  code_secrets: 'code_scanner',
  infra_packages: 'infra_agent',
  infra_compliance: 'infra_agent',
  cert_discovery: 'cert_monitor',
  cert_check: 'cert_monitor',
};

interface IngestionResult {
  readonly scanId: string;
  readonly findingsCreated: number;
  readonly findingsUpdated: number;
  readonly findingsResolved: number;
}

/**
 * Process a batch finding submission from an agent or code scanner.
 *
 * Steps:
 * 1. Create/update scan record
 * 2. Deduplicate findings: match by (CVE+asset) or (title+asset)
 * 3. Auto-resolve: findings for this asset+scan_type not in new batch
 * 4. Enqueue ES sync + notifications
 */
export async function ingestFindings(
  orgId: string,
  input: SubmitFindingsInput,
  requestId?: string,
): Promise<IngestionResult> {
  const source = SOURCE_MAP[input.scan_type] ?? 'code_scanner';

  // Resolve server from agent_id
  const server = await prisma.server.findFirst({
    where: { agentId: input.agent_id },
    select: { id: true },
  });

  const serverId = server?.id ?? null;
  // For code_scanner source, findings are against a repository — the scan_id may link to one
  // For now we leave repositoryId null and let orchestration fill it in

  // 1. Create or update scan record
  const scan = await prisma.scan.create({
    data: {
      orgId,
      scanType: input.scan_type as any,
      status: 'completed',
      trigger: 'agent',
      serverId,
      startedAt: new Date(input.started_at),
      completedAt: new Date(input.completed_at),
      durationMs: new Date(input.completed_at).getTime() - new Date(input.started_at).getTime(),
      findingsTotal: input.findings.length,
    },
  });

  // 2. Deduplicate and upsert findings
  let created = 0;
  let updated = 0;
  const ingestedIds: string[] = [];

  for (const item of input.findings) {
    const result = await upsertFinding(orgId, scan.id, source, serverId, item);
    ingestedIds.push(result.id);
    if (result.isNew) created++;
    else updated++;
  }

  // 3. Auto-resolve: open findings for this asset+scan_type not in the new batch
  const resolved = await autoResolveFindings(orgId, serverId, source, ingestedIds);

  // 4. Update scan counts
  await prisma.scan.update({
    where: { id: scan.id },
    data: {
      findingsNew: created,
      findingsResolved: resolved,
    },
  });

  // 5. Enqueue ES sync for all affected findings
  const allAffectedIds = [...ingestedIds];
  if (allAffectedIds.length > 0) {
    await enqueueFindingSyncBatch(allAffectedIds, requestId);
  }

  // 6. Enqueue notifications for new critical/high findings
  const criticalHighNew = input.findings.filter(
    (f, i) => (f.severity === 'critical' || f.severity === 'high') && i < created,
  );

  if (criticalHighNew.length > 0) {
    await notificationsQueue.add('new-critical-findings', {
      orgId,
      scanId: scan.id,
      count: criticalHighNew.length,
      request_id: requestId,
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 100,
    });
  }

  log.info('Finding ingestion complete', {
    scanId: scan.id,
    created,
    updated,
    resolved,
    total: input.findings.length,
  });

  return {
    scanId: scan.id,
    findingsCreated: created,
    findingsUpdated: updated,
    findingsResolved: resolved,
  };
}

// ---------------------------------------------------------------------------
// Deduplication — match by (CVE+asset) or (title+asset)
// ---------------------------------------------------------------------------

async function upsertFinding(
  orgId: string,
  scanId: string,
  source: string,
  serverId: string | null,
  item: FindingItem,
): Promise<{ id: string; isNew: boolean }> {
  // Build match criteria
  const matchWhere: Record<string, unknown> = {
    orgId,
    source: source as any,
    status: { in: ['open', 'in_progress'] },
  };

  if (serverId) matchWhere.serverId = serverId;

  if (item.cve_id) {
    matchWhere.cveId = item.cve_id;
  } else {
    matchWhere.title = item.title;
  }

  const existing = await prisma.finding.findFirst({
    where: matchWhere as any,
    select: { id: true },
  });

  if (existing) {
    // Update existing finding
    await prisma.finding.update({
      where: { id: existing.id },
      data: {
        severity: item.severity as any,
        cvssScore: item.cvss_score ?? null,
        cvssVector: item.cvss_vector ?? null,
        detail: item.detail,
        remediation: item.remediation ?? null,
        autoFixable: item.auto_fixable,
        scanId,
      },
    });
    return { id: existing.id, isNew: false };
  }

  // Create new finding
  const finding = await prisma.finding.create({
    data: {
      orgId,
      source: source as any,
      severity: item.severity as any,
      status: 'open',
      title: item.title,
      description: item.description ?? null,
      cveId: item.cve_id ?? null,
      cvssScore: item.cvss_score ?? null,
      cvssVector: item.cvss_vector ?? null,
      serverId,
      detail: item.detail,
      remediation: item.remediation ?? null,
      autoFixable: item.auto_fixable,
      scanId,
    },
  });

  return { id: finding.id, isNew: true };
}

// ---------------------------------------------------------------------------
// Auto-resolve: open findings not in the new batch
// ---------------------------------------------------------------------------

async function autoResolveFindings(
  orgId: string,
  serverId: string | null,
  source: string,
  ingestedIds: readonly string[],
): Promise<number> {
  if (!serverId) return 0; // Only auto-resolve for server-based scans

  const staleWhere: Record<string, unknown> = {
    orgId,
    serverId,
    source: source as any,
    status: { in: ['open', 'in_progress'] },
  };

  if (ingestedIds.length > 0) {
    staleWhere.id = { notIn: [...ingestedIds] };
  }

  const result = await prisma.finding.updateMany({
    where: staleWhere as any,
    data: {
      status: 'resolved' as any,
      resolvedAt: new Date(),
    },
  });

  return result.count;
}
