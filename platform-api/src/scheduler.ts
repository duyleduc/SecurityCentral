import { prisma } from './lib/prisma.js';
import { logger } from './lib/logger.js';
import { performCheck } from './modules/monitoring/monitoring.service.js';

let domainCheckTimer: ReturnType<typeof setInterval> | null = null;

const DOMAIN_CHECK_POLL_INTERVAL = 30_000; // 30s polling for due checks

// ---------------------------------------------------------------------------
// Domain check scheduler — polls for endpoints past their nextCheckAt
// ---------------------------------------------------------------------------

async function runDueChecks(): Promise<void> {
  try {
    const now = new Date();
    const dueEndpoints = await prisma.monitoredEndpoint.findMany({
      where: {
        nextCheckAt: { lte: now },
      },
      take: 10, // batch size
      orderBy: { nextCheckAt: 'asc' },
    });

    for (const endpoint of dueEndpoints) {
      try {
        await performCheck(endpoint.id);
        logger.debug('Domain check completed', { endpointId: endpoint.id, host: endpoint.host });
      } catch (err) {
        logger.error('Domain check failed', {
          endpointId: endpoint.id,
          host: endpoint.host,
          error: (err as Error).message,
        });
      }
    }
  } catch (err) {
    logger.error('Scheduler: runDueChecks error', { error: (err as Error).message });
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export function startScheduler(): void {
  logger.info('Scheduler started', { pollInterval: DOMAIN_CHECK_POLL_INTERVAL });
  domainCheckTimer = setInterval(runDueChecks, DOMAIN_CHECK_POLL_INTERVAL);
}

export function stopScheduler(): void {
  if (domainCheckTimer) {
    clearInterval(domainCheckTimer);
    domainCheckTimer = null;
    logger.info('Scheduler stopped');
  }
}
