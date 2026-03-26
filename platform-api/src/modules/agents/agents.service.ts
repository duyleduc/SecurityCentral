import { prisma } from '../../lib/prisma.js';
import { signCsr } from '../../lib/ca.js';
import { AppError } from '../../middleware/errors.js';
import { notificationsQueue } from '../../jobs/queues.js';
import type { RegisterAgentInput, HeartbeatInput } from './agents.validation.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LATEST_AGENT_VERSION = '1.0.0';
const AGENT_DOWNLOAD_BASE = 'https://releases.securitycentral.io/agent';
const OFFLINE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------

export async function registerAgent(orgId: string, input: RegisterAgentInput) {
  // Sign the CSR
  const server = await prisma.server.create({
    data: {
      orgId,
      hostname: input.hostname,
      osFamily: input.osFamily,
      osVersion: input.osVersion,
      arch: input.arch,
      cloudProvider: input.cloudProvider ?? null,
      cloudRegion: input.cloudRegion ?? null,
      cloudInstanceId: input.cloudInstanceId ?? null,
      environment: input.environment,
      status: 'active',
      lastHeartbeat: new Date(),
    },
  });

  // Generate agent_id from server record, then set it
  const agentId = server.id;
  await prisma.server.update({
    where: { id: server.id },
    data: { agentId },
  });

  // Sign the CSR with the platform CA
  const { certPem, caCertPem } = signCsr({ csrPem: input.csr, agentId });

  return {
    agentId,
    signedCert: certPem,
    caCert: caCertPem,
  };
}

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

interface HeartbeatCommand {
  readonly type: 'scan_now' | 'update_agent' | 'update_vulndb';
  readonly payload?: Record<string, unknown>;
}

export async function processHeartbeat(agentId: string, input: HeartbeatInput) {
  const server = await prisma.server.findFirst({
    where: { agentId },
  });

  if (!server) {
    throw new AppError('RESOURCE_NOT_FOUND', `Agent ${agentId} not found`);
  }

  // Update server record
  const metadata = server.metadata as Record<string, unknown>;
  if (input.resourceUsage) {
    metadata.resourceUsage = input.resourceUsage;
  }

  await prisma.server.update({
    where: { id: server.id },
    data: {
      lastHeartbeat: new Date(),
      agentVersion: input.agentVersion,
      hostname: input.hostname ?? server.hostname,
      osFamily: input.osFamily ?? server.osFamily,
      osVersion: input.osVersion ?? server.osVersion,
      metadata,
    },
  });

  // Build commands
  const commands: HeartbeatCommand[] = [];

  // Check if agent needs update
  if (input.agentVersion !== LATEST_AGENT_VERSION) {
    commands.push({
      type: 'update_agent',
      payload: { version: LATEST_AGENT_VERSION },
    });
  }

  // Check for pending scans
  const pendingScan = await prisma.scan.findFirst({
    where: { serverId: server.id, status: 'pending' },
  });
  if (pendingScan) {
    commands.push({
      type: 'scan_now',
      payload: { scanId: pendingScan.id, scanType: pendingScan.scanType },
    });
  }

  return { commands };
}

// ---------------------------------------------------------------------------
// Agent version
// ---------------------------------------------------------------------------

export function getLatestVersion() {
  return {
    version: LATEST_AGENT_VERSION,
    platforms: {
      'linux/amd64': `${AGENT_DOWNLOAD_BASE}/v${LATEST_AGENT_VERSION}/sc-agent-linux-amd64`,
      'linux/arm64': `${AGENT_DOWNLOAD_BASE}/v${LATEST_AGENT_VERSION}/sc-agent-linux-arm64`,
    },
  };
}

// ---------------------------------------------------------------------------
// Offline detection (BullMQ recurring job processor)
// ---------------------------------------------------------------------------

export async function detectOfflineAgents(): Promise<number> {
  const threshold = new Date(Date.now() - OFFLINE_THRESHOLD_MS);

  const offlineServers = await prisma.server.findMany({
    where: {
      status: 'active',
      lastHeartbeat: { lt: threshold },
    },
    select: { id: true, orgId: true, hostname: true, lastHeartbeat: true },
  });

  for (const server of offlineServers) {
    // Mark as inactive
    await prisma.server.update({
      where: { id: server.id },
      data: { status: 'inactive' },
    });

    // Enqueue notification
    await notificationsQueue.add('agent-offline', {
      orgId: server.orgId,
      serverId: server.id,
      hostname: server.hostname,
      lastHeartbeat: server.lastHeartbeat?.toISOString(),
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 100,
    });
  }

  return offlineServers.length;
}
