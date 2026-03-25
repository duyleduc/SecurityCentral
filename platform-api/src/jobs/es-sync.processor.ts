import { Job } from 'bullmq';

import { prisma } from '../lib/prisma.js';
import { upsertFinding, type FindingDocument } from '../lib/elasticsearch.js';

export interface EsSyncJobData {
  findingId: string;
}

/**
 * BullMQ processor: fetches a finding from PostgreSQL and upserts it into Elasticsearch.
 */
export async function processFindingSync(job: Job<EsSyncJobData>): Promise<void> {
  const { findingId } = job.data;

  const finding = await prisma.finding.findUnique({
    where: { id: findingId },
  });

  if (!finding) {
    console.warn(`[es-sync] Finding ${findingId} not found in database, skipping`);
    return;
  }

  const doc: FindingDocument = {
    id: finding.id,
    org_id: finding.orgId,
    source: finding.source,
    severity: finding.severity,
    status: finding.status,
    title: finding.title,
    description: finding.description,
    cve_id: finding.cveId,
    cvss_score: finding.cvssScore ? Number(finding.cvssScore) : null,
    repository_id: finding.repositoryId,
    server_id: finding.serverId,
    certificate_id: finding.certificateId,
    detail: finding.detail as Record<string, unknown>,
    auto_fixable: finding.autoFixable,
    first_seen_at: finding.firstSeenAt.toISOString(),
    resolved_at: finding.resolvedAt?.toISOString() ?? null,
    created_at: finding.createdAt.toISOString(),
  };

  await upsertFinding(doc);
}
