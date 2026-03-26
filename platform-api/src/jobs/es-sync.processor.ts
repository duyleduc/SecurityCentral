import { Job } from 'bullmq';

import { prisma } from '../lib/prisma.js';
import { jobLogger } from '../lib/logger.js';
import { upsertFinding, type FindingDocument } from '../lib/elasticsearch.js';
import type { JobContext } from './context.js';

export interface EsSyncJobData extends JobContext {
  findingId: string;
}

/**
 * BullMQ processor: fetches a finding from PostgreSQL and upserts it into Elasticsearch.
 */
export async function processFindingSync(job: Job<EsSyncJobData>): Promise<void> {
  const { findingId, request_id } = job.data;
  const log = jobLogger(job.queueName, job.id ?? 'unknown', request_id);

  const finding = await prisma.finding.findUnique({
    where: { id: findingId },
  });

  if (!finding) {
    log.warn(`Finding ${findingId} not found in database, skipping`);
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
  log.info(`Synced finding ${findingId} to Elasticsearch`);
}
