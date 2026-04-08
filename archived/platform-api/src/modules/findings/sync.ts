import { esSyncQueue } from '../../jobs/queues.js';
import type { EsSyncJobData } from '../../jobs/es-sync.processor.js';

/**
 * Enqueue an ES sync job for a finding.
 * Call this after any finding INSERT or UPDATE in PostgreSQL.
 */
export async function enqueueFindingSync(findingId: string, requestId?: string): Promise<void> {
  const data: EsSyncJobData = { findingId, request_id: requestId };

  await esSyncQueue.add('sync-finding', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  });
}

/**
 * Enqueue ES sync jobs for multiple findings (batch).
 */
export async function enqueueFindingSyncBatch(findingIds: readonly string[], requestId?: string): Promise<void> {
  const jobs = findingIds.map((findingId) => ({
    name: 'sync-finding',
    data: { findingId, request_id: requestId } satisfies EsSyncJobData,
    opts: {
      attempts: 3,
      backoff: { type: 'exponential' as const, delay: 1000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  }));

  await esSyncQueue.addBulk(jobs);
}
