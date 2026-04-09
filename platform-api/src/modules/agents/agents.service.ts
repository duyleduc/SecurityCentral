import crypto from 'node:crypto';

import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/errors.js';
import { logger } from '../../lib/logger.js';

// ---------------------------------------------------------------------------
// Install Tokens
// ---------------------------------------------------------------------------

interface CreateInstallTokenInput {
  readonly orgId: string;
  readonly projectId?: string;
  readonly label: string;
  readonly expiresInHours: number;
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
        lastHeartbeat: new Date(),
        apiKeyHash,
      },
    });
  });

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
    readonly cpu: { avg: number; max: number };
    readonly ram: { avg: number; max: number };
    readonly disk: { usage: number; ioErrors: number };
  };
  readonly system?: { hostname?: string; os?: string; agentVersion?: string };
}

export async function processHeartbeat(input: HeartbeatInput) {
  const server = await prisma.server.findUnique({ where: { agentId: input.agentId } });
  if (!server) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Agent not registered');
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
      },
    }),
    prisma.server.update({
      where: { id: server.id },
      data: {
        status,
        lastHeartbeat: new Date(),
        ...(input.system?.agentVersion ? { agentVersion: input.system.agentVersion } : {}),
        ...(input.system?.os ? { osFamily: input.system.os } : {}),
        ...(input.system?.hostname ? { hostname: input.system.hostname } : {}),
      },
    }),
  ]);

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
