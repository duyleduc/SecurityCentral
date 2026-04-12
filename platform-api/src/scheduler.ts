import { prisma } from './lib/prisma.js';
import { logger } from './lib/logger.js';
import { performSslCheck } from './modules/monitoring/monitoring.service.js';
import { emitAgentDisconnected } from './ws/hooks.js';
import { syncFeeds } from './modules/vulndb/vulndb.service.js';

let sslTimer: ReturnType<typeof setInterval> | null = null;
let offlineTimer: ReturnType<typeof setInterval> | null = null;
let vulnFeedTimer: ReturnType<typeof setInterval> | null = null;

const SSL_POLL_INTERVAL = 60_000; // poll every 60s for endpoints due for SSL/DNS check
const OFFLINE_POLL_INTERVAL = 2 * 60_000; // check every 2 min
const OFFLINE_THRESHOLD_MS = 5 * 60_000; // 5 minutes without heartbeat = offline
const DEAD_THRESHOLD_MS = 30 * 60_000; // 30 minutes without heartbeat = dead

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
    const now = Date.now();
    const offlineThreshold = new Date(now - OFFLINE_THRESHOLD_MS);
    const deadThreshold = new Date(now - DEAD_THRESHOLD_MS);

    // Find all servers with agents that have stale heartbeats
    // (includes already-offline servers that may need escalation to dead)
    const staleServers = await prisma.server.findMany({
      where: {
        status: { notIn: ['dead', 'pending_delete'] },
        lastHeartbeat: { lt: offlineThreshold },
        agentId: { not: null },
      },
    });

    for (const server of staleServers) {
      const hb = server.lastHeartbeat ? server.lastHeartbeat.getTime() : 0;
      const isDead = hb < deadThreshold.getTime();
      const newStatus = isDead ? 'dead' : 'offline';

      // Only update if status actually changes
      if (server.status === newStatus) continue;

      await prisma.server.update({
        where: { id: server.id },
        data: { status: newStatus },
      });

      emitAgentDisconnected(server.orgId, { id: server.id, hostname: server.hostname });

      // Auto-create a finding for offline/dead server (dedup by title)
      const title = isDead
        ? `server ${server.hostname} is unreachable (dead)`
        : `server ${server.hostname} is offline`;
      const severity = isDead ? 'critical' : 'high';

      const existing = await prisma.finding.findFirst({
        where: {
          orgId: server.orgId,
          serverId: server.id,
          source: 'infra_agent',
          title: { startsWith: `server ${server.hostname} is` },
          status: { in: ['open', 'in_progress'] },
        },
      });

      if (existing) {
        // Escalate existing offline finding to dead
        if (isDead && existing.severity !== 'critical') {
          await prisma.finding.update({
            where: { id: existing.id },
            data: { severity: 'critical', title, description: `No heartbeat since ${server.lastHeartbeat?.toISOString()}. Server may be down.` },
          });
        }
      } else {
        await prisma.finding.create({
          data: {
            orgId: server.orgId,
            serverId: server.id,
            source: 'infra_agent',
            severity,
            status: 'open',
            title,
            description: `No heartbeat since ${server.lastHeartbeat?.toISOString()}.${isDead ? ' Server may be down or the agent was removed.' : ' Agent may have lost connectivity.'}`,
          },
        });
      }

      logger.warn(`agent marked ${newStatus}`, { serverId: server.id, hostname: server.hostname, lastHeartbeat: server.lastHeartbeat });
    }
  } catch (err) {
    logger.error('scheduler: detectOfflineAgents error', { error: (err as Error).message });
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

const VULN_FEED_INTERVAL = 24 * 60 * 60_000; // sync CVE feeds daily

export function startScheduler(): void {
  logger.info('scheduler started (SSL/DNS + offline detection + vuln feed sync)');
  sslTimer = setInterval(runDueSslChecks, SSL_POLL_INTERVAL);
  offlineTimer = setInterval(detectOfflineAgents, OFFLINE_POLL_INTERVAL);
  vulnFeedTimer = setInterval(() => void syncFeeds(), VULN_FEED_INTERVAL);
  // Initial feed sync on startup (non-blocking).
  void syncFeeds();
}

export function stopScheduler(): void {
  if (sslTimer) { clearInterval(sslTimer); sslTimer = null; }
  if (offlineTimer) { clearInterval(offlineTimer); offlineTimer = null; }
  if (vulnFeedTimer) { clearInterval(vulnFeedTimer); vulnFeedTimer = null; }
  logger.info('scheduler stopped');
}
