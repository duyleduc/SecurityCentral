import crypto from 'node:crypto';

import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/errors.js';
import { logger } from '../../lib/logger.js';
import { emitAgentConnected, emitServerMetrics } from '../../ws/hooks.js';

// ---------------------------------------------------------------------------
// Install Tokens
// ---------------------------------------------------------------------------

interface CreateInstallTokenInput {
  readonly orgId: string;
  readonly projectId?: string;
  readonly label: string;
  readonly expiresInHours: number;
  readonly tags?: ReadonlyArray<{ key: string; value: string }>;
}

export async function createInstallToken(input: CreateInstallTokenInput) {
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const token = await prisma.installToken.create({
    data: {
      orgId: input.orgId,
      projectId: input.projectId,
      tokenHash,
      label: input.label,
      tags: input.tags ? JSON.parse(JSON.stringify(input.tags)) : [],
      expiresAt: new Date(Date.now() + input.expiresInHours * 60 * 60 * 1000),
    },
  });

  return { id: token.id, rawToken, label: token.label, expiresAt: token.expiresAt };
}

export async function listInstallTokens(orgId: string) {
  return prisma.installToken.findMany({
    where: { orgId },
    select: {
      id: true,
      label: true,
      usedAt: true,
      expiresAt: true,
      createdAt: true,
      project: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

// ---------------------------------------------------------------------------
// Agent Registration
// ---------------------------------------------------------------------------

interface AgentRegisterInput {
  readonly token: string;
  readonly hostname: string;
  readonly osFamily?: string;
  readonly osVersion?: string;
  readonly agentVersion?: string;
}

export async function registerAgent(input: AgentRegisterInput) {
  const tokenHash = crypto.createHash('sha256').update(input.token).digest('hex');

  const installToken = await prisma.installToken.findFirst({
    where: { tokenHash },
  });

  if (!installToken) {
    throw new AppError('INSTALL_TOKEN_INVALID', 'Invalid install token');
  }

  if (installToken.usedAt) {
    throw new AppError('INSTALL_TOKEN_ALREADY_USED', 'Install token has already been used');
  }

  if (installToken.expiresAt < new Date()) {
    throw new AppError('INSTALL_TOKEN_EXPIRED', 'Install token has expired');
  }

  // Generate agent API key
  const agentId = crypto.randomUUID();
  const rawApiKey = `sc_agent_${crypto.randomBytes(32).toString('base64url')}`;
  const apiKeyHash = crypto.createHash('sha256').update(rawApiKey).digest('hex');

  // Create server + consume token in a transaction
  const server = await prisma.$transaction(async (tx) => {
    await tx.installToken.update({
      where: { id: installToken.id },
      data: { usedAt: new Date(), usedBy: agentId },
    });

    return tx.server.create({
      data: {
        orgId: installToken.orgId,
        projectId: installToken.projectId,
        hostname: input.hostname,
        agentId,
        agentVersion: input.agentVersion,
        osFamily: input.osFamily,
        osVersion: input.osVersion,
        status: 'online',
        tags: installToken.tags ?? [],
        lastHeartbeat: new Date(),
        apiKeyHash,
      },
    });
  });

  emitAgentConnected(installToken.orgId, { id: server.id, hostname: input.hostname });

  return {
    serverId: server.id,
    agentId,
    apiKey: rawApiKey,
    orgId: installToken.orgId,
  };
}

// ---------------------------------------------------------------------------
// Agent Heartbeat
// ---------------------------------------------------------------------------

interface HeartbeatInput {
  readonly agentId: string;
  readonly urgent: boolean;
  readonly alerts: ReadonlyArray<{ type: string; value: number; threshold: number; since?: string }>;
  readonly metrics: {
    readonly cpu: { avg: number; max: number; ioWait?: number };
    readonly ram: { avg: number; max: number; swapUsedPct?: number };
    readonly disk: { usage: number; ioErrors: number; readBps?: number; writeBps?: number; ioUtilPct?: number };
    readonly load?: { load1: number; load5: number; load15: number };
    readonly network?: { rxBytesPerSec: number; txBytesPerSec: number; errors: number; drops: number };
    readonly docker?: {
      running: number;
      stopped: number;
      containers: ReadonlyArray<{ id: string; name: string; image: string; state: string; cpu: number; memory: number; restarts: number }>;
    };
  };
  readonly system?: {
    hostname?: string;
    os?: string;
    osVersion?: string;
    kernel?: string;
    arch?: string;
    agentVersion?: string;
    cpuCores?: number;
    cpuModel?: string;
    totalRamMb?: number;
    totalDiskGb?: number;
    ipAddresses?: string[];
  };
}

export async function processHeartbeat(input: HeartbeatInput) {
  const server = await prisma.server.findUnique({ where: { agentId: input.agentId } });
  if (!server) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Agent not registered');
  }

  // If the server was deleted while agent was still running, tell it to shut down.
  if (server.status === 'pending_delete') {
    return { commands: [{ type: 'shutdown' }], config: {} };
  }

  // Determine status from alerts
  let status = 'online';
  if (input.alerts.length > 0) {
    const hasCritical = input.alerts.some(
      (a) => a.type === 'cpu_high' || a.type === 'ram_high' || a.type === 'disk_critical',
    );
    status = hasCritical ? 'critical' : 'warning';
  }

  // Store metric snapshot + update server in transaction
  await prisma.$transaction([
    prisma.serverMetricSnapshot.create({
      data: {
        serverId: server.id,
        cpu: input.metrics.cpu.avg,
        memory: input.metrics.ram.avg,
        disk: input.metrics.disk.usage,
        urgent: input.urgent,
        alerts: JSON.parse(JSON.stringify(input.alerts)),
        cpuIoWait: input.metrics.cpu.ioWait ?? null,
        swapUsedPct: input.metrics.ram.swapUsedPct ?? null,
        loadAvg1: input.metrics.load?.load1 ?? null,
        loadAvg5: input.metrics.load?.load5 ?? null,
        loadAvg15: input.metrics.load?.load15 ?? null,
        diskReadBps: input.metrics.disk.readBps != null ? BigInt(input.metrics.disk.readBps) : null,
        diskWriteBps: input.metrics.disk.writeBps != null ? BigInt(input.metrics.disk.writeBps) : null,
        diskIoUtil: input.metrics.disk.ioUtilPct ?? null,
        netRxBps: input.metrics.network?.rxBytesPerSec != null ? BigInt(input.metrics.network.rxBytesPerSec) : null,
        netTxBps: input.metrics.network?.txBytesPerSec != null ? BigInt(input.metrics.network.txBytesPerSec) : null,
        netErrors: input.metrics.network?.errors ?? null,
        docker: input.metrics.docker ? JSON.parse(JSON.stringify(input.metrics.docker)) : null,
      },
    }),
    prisma.server.update({
      where: { id: server.id },
      data: {
        status,
        lastHeartbeat: new Date(),
        ...(input.system?.agentVersion ? { agentVersion: input.system.agentVersion } : {}),
        ...(input.system?.os ? { osFamily: input.system.os } : {}),
        ...(input.system?.osVersion ? { osVersion: input.system.osVersion } : {}),
        ...(input.system?.hostname ? { hostname: input.system.hostname } : {}),
        ...(input.system?.kernel ? { kernel: input.system.kernel } : {}),
        ...(input.system?.cpuCores ? { cpuCores: input.system.cpuCores } : {}),
        ...(input.system?.cpuModel ? { cpuModel: input.system.cpuModel } : {}),
        ...(input.system?.totalRamMb ? { totalRamMb: input.system.totalRamMb } : {}),
        ...(input.system?.totalDiskGb ? { totalDiskGb: input.system.totalDiskGb } : {}),
        ...(input.system?.ipAddresses ? { ipAddresses: JSON.parse(JSON.stringify(input.system.ipAddresses)) } : {}),
      },
    }),
  ]);

  emitServerMetrics(server.orgId, {
    serverId: server.id,
    cpu: input.metrics.cpu.avg,
    memory: input.metrics.ram.avg,
    disk: input.metrics.disk.usage,
    urgent: input.urgent,
    cpuIoWait: input.metrics.cpu.ioWait ?? 0,
    swapUsedPct: input.metrics.ram.swapUsedPct ?? 0,
    loadAvg1: input.metrics.load?.load1 ?? 0,
    diskReadBps: input.metrics.disk.readBps ?? 0,
    diskWriteBps: input.metrics.disk.writeBps ?? 0,
    diskIoUtil: input.metrics.disk.ioUtilPct ?? 0,
    netRxBps: input.metrics.network?.rxBytesPerSec ?? 0,
    netTxBps: input.metrics.network?.txBytesPerSec ?? 0,
  });

  // Auto-create findings from alerts
  if (input.alerts.length > 0) {
    await createAgentFindings(server.orgId, server.id, server.hostname, input.alerts);
  }

  // Auto-create findings for crash-looping containers
  if (input.metrics.docker?.containers) {
    for (const ctr of input.metrics.docker.containers) {
      if (ctr.restarts > 0) {
        const title = `container ${ctr.name} restarting on ${server.hostname} (${ctr.restarts} restarts)`;
        const existing = await prisma.finding.findFirst({
          where: { orgId: server.orgId, serverId: server.id, title, status: { in: ['open', 'in_progress'] } },
        });
        if (!existing) {
          await prisma.finding.create({
            data: {
              orgId: server.orgId,
              serverId: server.id,
              source: 'infra_agent',
              severity: ctr.restarts >= 5 ? 'high' : 'medium',
              status: 'open',
              title,
              description: `Container ${ctr.name} (${ctr.image}) has restarted ${ctr.restarts} times`,
              detail: JSON.parse(JSON.stringify(ctr)),
            },
          });
        }
      }
    }
  }

  logger.debug('Heartbeat processed', {
    agentId: input.agentId,
    urgent: input.urgent,
    alertCount: input.alerts.length,
  });

  return { commands: [], config: {} };
}

// ---------------------------------------------------------------------------
// Agent Findings
// ---------------------------------------------------------------------------

interface AgentFindingsInput {
  readonly agentId: string;
  readonly findings: ReadonlyArray<{
    source: string;
    severity: string;
    title: string;
    description?: string;
    detail?: Record<string, unknown>;
  }>;
}

export async function ingestFindings(input: AgentFindingsInput) {
  const server = await prisma.server.findUnique({ where: { agentId: input.agentId } });
  if (!server) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Agent not registered');
  }

  const created = await prisma.finding.createMany({
    data: input.findings.map((f) => ({
      orgId: server.orgId,
      serverId: server.id,
      source: f.source,
      severity: f.severity,
      title: f.title,
      description: f.description,
      detail: f.detail ? JSON.parse(JSON.stringify(f.detail)) : undefined,
    })),
  });

  return { created: created.count };
}

// ---------------------------------------------------------------------------
// Agent Key Authentication
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Auto-create findings from heartbeat alerts
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Security Posture
// ---------------------------------------------------------------------------

interface SecurityPostureInput {
  readonly agentId: string;
  readonly collectedAt: string;
  readonly listeningPorts: ReadonlyArray<{ port: number; proto: string; process: string; bind: string }>;
  readonly sshConfig: { rootLogin: string; passwordAuth: string; port: number; permitEmptyPwd: string };
  readonly firewall: { active: boolean; type: string };
  readonly loggedInUsers: ReadonlyArray<{ user: string; from: string; since: string }>;
  readonly sshFailures: number;
  readonly shellUsers: readonly string[];
  readonly pendingReboot: boolean;
  readonly openFDs: { allocated: number; max: number };
}

export async function storeSecurityPosture(input: SecurityPostureInput) {
  const server = await prisma.server.findUnique({ where: { agentId: input.agentId } });
  if (!server) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Agent not registered');
  }

  await prisma.securityPosture.create({
    data: {
      serverId: server.id,
      collectedAt: new Date(input.collectedAt),
      listeningPorts: JSON.parse(JSON.stringify(input.listeningPorts)),
      sshConfig: JSON.parse(JSON.stringify(input.sshConfig)),
      firewallActive: input.firewall.active,
      firewallType: input.firewall.type,
      loggedInUsers: JSON.parse(JSON.stringify(input.loggedInUsers)),
      sshFailures: input.sshFailures,
      shellUsers: JSON.parse(JSON.stringify(input.shellUsers)),
      pendingReboot: input.pendingReboot,
      openFdAlloc: input.openFDs.allocated,
      openFdMax: input.openFDs.max,
    },
  });

  logger.debug('Security posture stored', { agentId: input.agentId, ports: input.listeningPorts.length });
  return { stored: true };
}

const ALERT_SEVERITY: Record<string, string> = {
  cpu_high: 'high',
  ram_high: 'high',
  disk_critical: 'critical',
  disk_high: 'high',
  port_new: 'medium',
  service_down: 'critical',
  io_error: 'high',
  iowait_high: 'high',
  cpu_spike: 'medium',
  ram_spike: 'medium',
  ssh_brute_force: 'high',
};

async function createAgentFindings(
  orgId: string,
  serverId: string,
  hostname: string,
  alerts: ReadonlyArray<{ type: string; value: number; threshold: number }>,
) {
  for (const alert of alerts) {
    const severity = ALERT_SEVERITY[alert.type] ?? 'medium';
    const title = `${alert.type.replace(/_/g, ' ')} on ${hostname} (${alert.value}% > ${alert.threshold}%)`;

    // Dedup: don't create if an open finding with same title exists
    const existing = await prisma.finding.findFirst({
      where: { orgId, serverId, title, status: { in: ['open', 'in_progress'] } },
    });
    if (existing) continue;

    await prisma.finding.create({
      data: {
        orgId,
        serverId,
        source: 'infra_agent',
        severity,
        status: 'open',
        title,
        description: `${alert.type} threshold breached: ${alert.value}% exceeds ${alert.threshold}%`,
        detail: JSON.parse(JSON.stringify(alert)),
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Agent Key Authentication
// ---------------------------------------------------------------------------

export async function authenticateAgentKey(rawKey: string) {
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

  const server = await prisma.server.findFirst({
    where: { apiKeyHash: keyHash },
  });

  if (!server) {
    throw new AppError('AUTH_INVALID_CREDENTIALS', 'Invalid agent key');
  }

  return server;
}
