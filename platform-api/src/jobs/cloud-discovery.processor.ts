import type { Job } from 'bullmq';

import { prisma } from '../lib/prisma.js';
import { jobLogger } from '../lib/logger.js';
import { discoverResources } from '../modules/integrations/cloud-discovery.service.js';
import type { JobContext } from './context.js';

const CLOUD_PROVIDERS = ['aws', 'azure', 'gcp', 'proxmox'];

/**
 * BullMQ processor: periodic cloud resource discovery.
 * Iterates all active cloud integrations and refreshes the resource cache.
 */
export async function processCloudDiscovery(job: Job<JobContext>): Promise<void> {
  const log = jobLogger(job.queueName, job.id ?? 'unknown', job.data?.request_id);

  log.info('Starting periodic cloud discovery');

  const integrations = await prisma.integration.findMany({
    where: { provider: { in: CLOUD_PROVIDERS }, status: 'active' },
    select: { id: true, orgId: true, provider: true },
  });

  log.info('Found cloud integrations', { count: integrations.length });

  let totalDiscovered = 0;
  for (const integration of integrations) {
    try {
      const count = await discoverResources(integration.orgId, integration.provider);
      totalDiscovered += count;
      log.info('Discovery complete for integration', {
        integrationId: integration.id,
        provider: integration.provider,
        orgId: integration.orgId,
        discovered: count,
      });
    } catch (err) {
      log.error('Discovery failed for integration', {
        integrationId: integration.id,
        provider: integration.provider,
        error: (err as Error).message,
      });
    }
  }

  log.info('Periodic cloud discovery complete', { total: totalDiscovered, integrations: integrations.length });
}
