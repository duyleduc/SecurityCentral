import type { Job } from 'bullmq';

import { jobLogger } from '../lib/logger.js';
import { processFindingSync, type EsSyncJobData } from './es-sync.processor.js';
import { processVulnDbSync } from './vuln-db-sync.js';
import { processGitHubPr, type GitHubPrJobData } from './github-pr.processor.js';
import type { JobContext } from './context.js';

/**
 * Placeholder processor — logs and completes.
 * Replace with real logic as each feature is implemented.
 */
async function placeholder(job: Job<JobContext>): Promise<void> {
  const log = jobLogger(job.queueName, job.id ?? 'unknown', job.data.request_id);
  log.info(`Processing ${job.name}`);
}

/**
 * Queue processor registry.
 * Each key matches a queue name from queues.ts.
 */
export const processors: Record<string, { handler: (job: Job) => Promise<void>; concurrency: number }> = {
  'scan-orchestration': { handler: placeholder, concurrency: 5 },
  'finding-ingestion': { handler: placeholder, concurrency: 10 },
  'notifications': { handler: placeholder, concurrency: 10 },
  'vulndb-sync': { handler: processVulnDbSync, concurrency: 1 },
  'github-pr': { handler: (job: Job<GitHubPrJobData>) => processGitHubPr(job), concurrency: 3 },
  'es-sync': { handler: (job: Job<EsSyncJobData>) => processFindingSync(job), concurrency: 10 },
};
