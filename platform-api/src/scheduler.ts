import { prisma } from './lib/prisma.js';
import { logger } from './lib/logger.js';
import { performSslCheck } from './modules/monitoring/monitoring.service.js';

let sslTimer: ReturnType<typeof setInterval> | null = null;

const SSL_POLL_INTERVAL = 60_000; // poll every 60s for endpoints due for SSL/DNS check

// ---------------------------------------------------------------------------
// SSL/DNS checks — full security scan (daily)
// Uptime checks are handled by the sc-monitor Go binary, NOT here.
// ---------------------------------------------------------------------------

async function runDueSslChecks(): Promise<void> {
  try {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const dueEndpoints = await prisma.monitoredEndpoint.findMany({
      where: {
        OR: [
          { lastSslCheckAt: null },
          { lastSslCheckAt: { lte: oneDayAgo } },
        ],
      },
      take: 5,
      orderBy: { lastSslCheckAt: 'asc' },
    });

    for (const endpoint of dueEndpoints) {
      try {
        await performSslCheck(endpoint.id);
        logger.info('SSL/DNS check completed', { endpointId: endpoint.id, host: endpoint.host });
      } catch (err) {
        logger.error('SSL/DNS check failed', { endpointId: endpoint.id, host: endpoint.host, error: (err as Error).message });
      }
    }
  } catch (err) {
    logger.error('scheduler: runDueSslChecks error', { error: (err as Error).message });
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export function startScheduler(): void {
  logger.info('scheduler started (SSL/DNS checks only — uptime via sc-monitor)');
  sslTimer = setInterval(runDueSslChecks, SSL_POLL_INTERVAL);
}

export function stopScheduler(): void {
  if (sslTimer) { clearInterval(sslTimer); sslTimer = null; }
  logger.info('scheduler stopped');
}
