import { prisma } from './lib/prisma.js';
import { logger } from './lib/logger.js';
import { performSslCheck } from './modules/monitoring/monitoring.service.js';
import { emitAgentDisconnected } from './ws/hooks.js';

let sslTimer: ReturnType<typeof setInterval> | null = null;
let offlineTimer: ReturnType<typeof setInterval> | null = null;

const SSL_POLL_INTERVAL = 60_000; // poll every 60s for endpoints due for SSL/DNS check
const OFFLINE_POLL_INTERVAL = 5 * 60_000; // check for offline agents every 5 min
const OFFLINE_THRESHOLD_MS = 5 * 60_000; // 5 minutes without heartbeat = offline

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
// Offline agent detection — flag servers that missed heartbeats
// ---------------------------------------------------------------------------

async function detectOfflineAgents(): Promise<void> {
  try {
    const threshold = new Date(Date.now() - OFFLINE_THRESHOLD_MS);
    const staleServers = await prisma.server.findMany({
      where: {
        status: { notIn: ['offline'] },
        lastHeartbeat: { lt: threshold },
        agentId: { not: null },
      },
    });

    for (const server of staleServers) {
      await prisma.server.update({
        where: { id: server.id },
        data: { status: 'offline' },
      });
      emitAgentDisconnected(server.orgId, { id: server.id, hostname: server.hostname });
      logger.warn('agent marked offline', { serverId: server.id, hostname: server.hostname, lastHeartbeat: server.lastHeartbeat });
    }

    if (staleServers.length > 0) {
      logger.info(`offline detection: ${staleServers.length} agent(s) marked offline`);
    }
  } catch (err) {
    logger.error('scheduler: detectOfflineAgents error', { error: (err as Error).message });
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export function startScheduler(): void {
  logger.info('scheduler started (SSL/DNS checks + offline detection — uptime via sc-monitor)');
  sslTimer = setInterval(runDueSslChecks, SSL_POLL_INTERVAL);
  offlineTimer = setInterval(detectOfflineAgents, OFFLINE_POLL_INTERVAL);
}

export function stopScheduler(): void {
  if (sslTimer) { clearInterval(sslTimer); sslTimer = null; }
  if (offlineTimer) { clearInterval(offlineTimer); offlineTimer = null; }
  logger.info('scheduler stopped');
}
