import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { prisma } from '../../lib/prisma.js';
import { signCsr } from '../../lib/ca.js';
import { AppError } from '../../middleware/errors.js';
import { notificationsQueue } from '../../jobs/queues.js';
import type { RegisterAgentInput, HeartbeatInput } from './agents.validation.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VERSION_FILE = path.resolve(__dirname, '..', '..', '..', '..', 'AGENT_VERSION');

let _cachedVersion: string | null = null;
let _cachedAt = 0;
const VERSION_CACHE_MS = 60_000; // re-read file every 60s

function readAgentVersion(): string {
  const now = Date.now();
  if (_cachedVersion && now - _cachedAt < VERSION_CACHE_MS) {
    return _cachedVersion;
  }
  try {
    _cachedVersion = fs.readFileSync(VERSION_FILE, 'utf-8').trim();
  } catch {
    _cachedVersion = '1.0.0';
  }
  _cachedAt = now;
  return _cachedVersion;
}

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
  if (input.systemInfo) {
    metadata.systemInfo = input.systemInfo;
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

  // Build commands (only user-initiated actions, never auto-update)
  const commands: HeartbeatCommand[] = [];

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
    version: readAgentVersion(),
    platforms: {
      'linux/amd64': `${AGENT_DOWNLOAD_BASE}/v${readAgentVersion()}/sc-agent-linux-amd64`,
      'linux/arm64': `${AGENT_DOWNLOAD_BASE}/v${readAgentVersion()}/sc-agent-linux-arm64`,
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
