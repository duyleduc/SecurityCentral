import type { Job } from 'bullmq';

import { processFindingSync, type EsSyncJobData } from './es-sync.processor.js';

/**
 * Placeholder processor — logs and completes.
 * Replace with real logic as each feature is implemented.
 */
async function placeholder(job: Job): Promise<void> {
  console.log(`[worker] Processing ${job.queueName}/${job.name} (id=${job.id})`);
}

/**
 * Queue processor registry.
 * Each key matches a queue name from queues.ts.
 */
export const processors: Record<string, { handler: (job: Job) => Promise<void>; concurrency: number }> = {
  'scan-orchestration': { handler: placeholder, concurrency: 5 },
  'finding-ingestion': { handler: placeholder, concurrency: 10 },
  'notifications': { handler: placeholder, concurrency: 10 },
  'vulndb-sync': { handler: placeholder, concurrency: 2 },
  'github-pr': { handler: placeholder, concurrency: 3 },
  'es-sync': { handler: (job: Job<EsSyncJobData>) => processFindingSync(job), concurrency: 10 },
};
