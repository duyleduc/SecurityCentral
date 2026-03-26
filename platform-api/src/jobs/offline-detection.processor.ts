import type { Job } from 'bullmq';

import { jobLogger } from '../lib/logger.js';
import { detectOfflineAgents } from '../modules/agents/agents.service.js';

/**
 * BullMQ processor: checks for offline agents and triggers notifications.
 * Scheduled as a recurring job (every 1 minute).
 */
export async function processOfflineDetection(job: Job): Promise<void> {
  const log = jobLogger(job.queueName, job.id ?? 'unknown');

  const count = await detectOfflineAgents();
  if (count > 0) {
    log.info(`Detected ${count} offline agent(s)`);
  }
}
