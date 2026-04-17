import crypto from 'node:crypto';

import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/errors.js';
import { logger } from '../../lib/logger.js';
import { emitAgentConnected, emitServerMetrics } from '../../ws/hooks.js';
import { matchServerPackages, applyMatchesToFindings } from '../vulndb/vulndb.service.js';
import { getCisControl } from '../../lib/cis-benchmarks.js';

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

  // Set label (raw SQL — field not yet in generated Prisma client).
  const label = installToken.label || input.hostname;
  await prisma.$executeRawUnsafe('UPDATE servers SET label = ? WHERE id = ?', label, server.id);

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

  // Auto-resolve offline/dead findings when agent comes back
  if (server.status === 'offline' || server.status === 'dead') {
    await prisma.finding.updateMany({
      where: {
        orgId: server.orgId,
        serverId: server.id,
        source: 'infra_agent',
        title: { startsWith: `server ${server.hostname} is` },
        status: { in: ['open', 'in_progress'] },
      },
      data: { status: 'resolved', resolvedAt: new Date() },
    });
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

interface AuditResultItem {
  readonly id: string;
  readonly category: string;
  readonly title: string;
  readonly status: 'pass' | 'fail' | 'warn';
  readonly severity: 'critical' | 'high' | 'medium' | 'low';
  readonly detail: string;
}

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
  readonly auditResults?: readonly AuditResultItem[];
  readonly bruteForce?: {
    readonly sshVelocity: number;
    readonly sshUniqueIps: number;
    readonly sshTopAttackers: ReadonlyArray<{ ip: string; count: number }>;
    readonly sshCompromise: ReadonlyArray<{ ip: string; failuresBefore: number; successUser: string; successAt: string }>;
    readonly httpVelocity: number;
    readonly httpUniqueIps: number;
    readonly isActiveAttack: boolean;
    readonly isDistributed: boolean;
    readonly hasCompromise: boolean;
  };
}

export async function storeSecurityPosture(input: SecurityPostureInput) {
  const server = await prisma.server.findUnique({ where: { agentId: input.agentId } });
  if (!server) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Agent not registered');
  }

  const posture = await prisma.securityPosture.create({
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
      openFdMax: Math.min(input.openFDs.max, 2_147_483_647),
      auditResults: input.auditResults ? JSON.parse(JSON.stringify(input.auditResults)) : undefined,
    },
  });

  // Store bruteForce data (raw SQL — field not yet in generated Prisma client).
  if (input.bruteForce) {
    await prisma.$executeRawUnsafe(
      'UPDATE security_postures SET brute_force = ? WHERE id = ?',
      JSON.stringify(input.bruteForce), (posture as any).id,
    );
  }

  // Create findings for brute force events.
  if (input.bruteForce) {
    const bf = input.bruteForce;
    if (bf.isActiveAttack) {
      const title = `Active SSH brute force on ${server.hostname} (${bf.sshVelocity} attempts/5min)`;
      const existing = await prisma.finding.findFirst({
        where: { orgId: server.orgId, serverId: server.id, source: 'brute_force', title: { startsWith: 'Active SSH brute force' }, status: { in: ['open', 'in_progress'] } },
      });
      if (!existing) {
        await prisma.finding.create({
          data: {
            orgId: server.orgId, serverId: server.id,
            source: 'brute_force', severity: 'critical', status: 'open', title,
            description: `${bf.sshVelocity} SSH login failures in the last 5 minutes from ${bf.sshUniqueIps} unique IPs. Top attackers: ${(bf.sshTopAttackers ?? []).map((a: { ip: string; count: number }) => `${a.ip} (${a.count}x)`).join(', ')}`,
            detail: JSON.parse(JSON.stringify({ type: 'active_attack', ...bf })),
          },
        });
      }
    }
    if (bf.isDistributed) {
      const title = `Distributed SSH attack on ${server.hostname} from ${bf.sshUniqueIps} IPs`;
      const existing = await prisma.finding.findFirst({
        where: { orgId: server.orgId, serverId: server.id, source: 'brute_force', title: { startsWith: 'Distributed SSH' }, status: { in: ['open', 'in_progress'] } },
      });
      if (!existing) {
        await prisma.finding.create({
          data: {
            orgId: server.orgId, serverId: server.id,
            source: 'brute_force', severity: 'high', status: 'open', title,
            description: `SSH login attempts from ${bf.sshUniqueIps} distinct IP addresses in a 5-minute window. This indicates a coordinated attack.`,
            detail: JSON.parse(JSON.stringify({ type: 'distributed_attack', ...bf })),
          },
        });
      }
    }
    if (bf.hasCompromise) {
      for (const c of bf.sshCompromise ?? []) {
        const title = `Potential SSH compromise on ${server.hostname}: login from attacker IP ${(c as { ip: string }).ip}`;
        const existing = await prisma.finding.findFirst({
          where: { orgId: server.orgId, serverId: server.id, source: 'brute_force', title, status: { in: ['open', 'in_progress'] } },
        });
        if (!existing) {
          await prisma.finding.create({
            data: {
              orgId: server.orgId, serverId: server.id,
              source: 'brute_force', severity: 'critical', status: 'open', title,
              description: `IP ${(c as { ip: string }).ip} had ${(c as { failuresBefore: number }).failuresBefore} failed SSH attempts, then successfully logged in as "${(c as { successUser: string }).successUser}". This strongly indicates a compromised account. Change passwords immediately and review access logs.`,
              detail: JSON.parse(JSON.stringify({ type: 'compromise', ...c })),
            },
          });
        }
      }
    }
    if (bf.httpVelocity > 100) {
      const title = `HTTP brute force on ${server.hostname} (${bf.httpVelocity} failures/5min)`;
      const existing = await prisma.finding.findFirst({
        where: { orgId: server.orgId, serverId: server.id, source: 'brute_force', title: { startsWith: 'HTTP brute force' }, status: { in: ['open', 'in_progress'] } },
      });
      if (!existing) {
        await prisma.finding.create({
          data: {
            orgId: server.orgId, serverId: server.id,
            source: 'brute_force', severity: 'high', status: 'open', title,
            description: `${bf.httpVelocity} HTTP 401/403 responses in 5 minutes from ${bf.httpUniqueIps} IPs. Web application may be under credential stuffing attack.`,
            detail: JSON.parse(JSON.stringify({ type: 'http_brute_force', ...bf })),
          },
        });
      }
    }
  }

  // Auto-create findings from failed audit checks.
  if (input.auditResults) {
    for (const check of input.auditResults) {
      if (check.status !== 'fail') continue;

      const title = `${check.title} on ${server.hostname}`;
      const existing = await prisma.finding.findFirst({
        where: { orgId: server.orgId, serverId: server.id, source: 'security_audit', title, status: { in: ['open', 'in_progress'] } },
      });
      if (existing) continue;

      await prisma.finding.create({
        data: {
          orgId: server.orgId,
          serverId: server.id,
          source: 'security_audit',
          severity: check.severity,
          status: 'open',
          title,
          description: check.detail,
          detail: JSON.parse(JSON.stringify({
            checkId: check.id,
            category: check.category,
            cis: getCisControl(check.id),
          })),
        },
      });
    }

    // Auto-resolve findings for checks that now pass.
    const passingIds = input.auditResults.filter((c) => c.status === 'pass').map((c) => c.title);
    if (passingIds.length > 0) {
      const openAuditFindings = await prisma.finding.findMany({
        where: { orgId: server.orgId, serverId: server.id, source: 'security_audit', status: { in: ['open', 'in_progress'] } },
      });
      for (const f of openAuditFindings) {
        const checkTitle = f.title.replace(` on ${server.hostname}`, '');
        if (passingIds.includes(checkTitle)) {
          await prisma.finding.update({ where: { id: f.id }, data: { status: 'resolved', resolvedAt: new Date() } });
        }
      }
    }
  }

  logger.debug('Security posture stored', {
    agentId: input.agentId,
    ports: input.listeningPorts.length,
    audits: input.auditResults?.length ?? 0,
  });

  // Recompute score — audit failures affect it.
  try {
    const { recomputeScore } = await import('../servers/servers.service.js');
    await recomputeScore(server.id);
  } catch (err) {
    logger.warn('Score recompute failed after posture update', { error: (err as Error).message });
  }

  return { stored: true };
}

// ---------------------------------------------------------------------------
// Package Inventory + CVE Matching
// ---------------------------------------------------------------------------

interface PackageInventoryInput {
  readonly agentId: string;
  readonly collectedAt: string;
  readonly osFamily: string;
  readonly packages: ReadonlyArray<{ name: string; version: string; arch?: string }>;
  readonly binaryVersions: ReadonlyArray<{ name: string; version: string }>;
  readonly pendingSecurityUpdates: number;
  readonly heldPackages: readonly string[];
  readonly kernelRunning?: string;
  readonly kernelInstalled?: string;
  readonly unattendedUpgrades: boolean;
  readonly packageHash: string;
}

export async function storePackageInventory(input: PackageInventoryInput) {
  const server = await prisma.server.findUnique({ where: { agentId: input.agentId } });
  if (!server) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Agent not registered');
  }

  // Check if package list changed — skip CVE re-matching if identical.
  const latest = await prisma.packageInventory.findFirst({
    where: { serverId: server.id },
    orderBy: { collectedAt: 'desc' },
    select: { packageHash: true },
  });

  const changed = !latest || latest.packageHash !== input.packageHash;

  // Always store the inventory record.
  await prisma.packageInventory.create({
    data: {
      serverId: server.id,
      collectedAt: new Date(input.collectedAt),
      osFamily: input.osFamily,
      packages: JSON.parse(JSON.stringify(input.packages)),
      binaryVersions: JSON.parse(JSON.stringify(input.binaryVersions)),
      pendingSecurityUpdates: input.pendingSecurityUpdates,
      heldPackages: JSON.parse(JSON.stringify(input.heldPackages)),
      kernelRunning: input.kernelRunning,
      kernelInstalled: input.kernelInstalled,
      unattendedUpgrades: input.unattendedUpgrades,
      packageHash: input.packageHash,
    },
  });

  // Run CVE matching only if packages changed.
  let cveResult = { created: 0, resolved: 0 };
  if (changed) {
    try {
      const matches = await matchServerPackages(server.id, input.osFamily, input.packages, input.binaryVersions);
      cveResult = await applyMatchesToFindings(server.orgId, server.id, server.hostname, matches);
      logger.info('CVE matching completed', {
        serverId: server.id,
        matched: matches.length,
        created: cveResult.created,
        resolved: cveResult.resolved,
      });

      // Recompute security score after CVE changes.
      const { recomputeScore } = await import('../servers/servers.service.js');
      await recomputeScore(server.id);
    } catch (err) {
      logger.error('CVE matching failed', { serverId: server.id, error: (err as Error).message });
    }
  }

  return {
    stored: true,
    packagesChanged: changed,
    cveMatches: cveResult.created,
    cveResolved: cveResult.resolved,
  };
}

// ---------------------------------------------------------------------------
// Suspicious Process Detection
// ---------------------------------------------------------------------------

interface SuspiciousProcessInput {
  readonly agentId: string;
  readonly collectedAt: string;
  readonly detections: ReadonlyArray<{
    pid: number;
    name: string;
    user: string;
    cpu: number;
    ram: number;
    cmdline: string;
    parentName: string;
    reason: string;
    hasNetwork: boolean;
    duration: number;
  }>;
}

const REASON_SEVERITY: Record<string, string> = {
  known_miner: 'critical',
  reverse_shell: 'critical',
  suspicious_path: 'high',
  high_cpu_sustained: 'high',
};

const REASON_TITLE: Record<string, string> = {
  known_miner: 'Crypto miner detected',
  reverse_shell: 'Potential reverse shell',
  suspicious_path: 'Suspicious binary location',
  high_cpu_sustained: 'Sustained high CPU process',
};

export async function processSuspiciousDetections(input: SuspiciousProcessInput) {
  const server = await prisma.server.findUnique({ where: { agentId: input.agentId } });
  if (!server) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Agent not registered');
  }

  let created = 0;
  for (const det of input.detections) {
    const severity = REASON_SEVERITY[det.reason] ?? 'high';
    const titlePrefix = REASON_TITLE[det.reason] ?? 'Suspicious process';
    const title = `${titlePrefix}: ${det.name} (PID ${det.pid}) on ${server.hostname}`;

    // Dedup by title.
    const existing = await prisma.finding.findFirst({
      where: { orgId: server.orgId, serverId: server.id, source: 'suspicious_process', title, status: { in: ['open', 'in_progress'] } },
    });
    if (existing) continue;

    await prisma.finding.create({
      data: {
        orgId: server.orgId,
        serverId: server.id,
        source: 'suspicious_process',
        severity,
        status: 'open',
        title,
        description: det.reason === 'known_miner'
          ? `Crypto mining process "${det.name}" detected running as ${det.user}. This process is consuming ${det.cpu.toFixed(1)}% CPU. Immediate action recommended: kill the process and investigate how it was installed.`
          : det.reason === 'reverse_shell'
          ? `Process "${det.name}" (PID ${det.pid}) has an active network connection and was spawned by shell "${det.parentName}". This pattern indicates a potential reverse shell. Investigate immediately.`
          : det.reason === 'suspicious_path'
          ? `Process "${det.name}" is running from a suspicious location (temp/writable directory). Binary: ${det.cmdline.slice(0, 200)}`
          : `Process "${det.name}" has been consuming ${det.cpu.toFixed(1)}% CPU for ${Math.round(det.duration / 60)} minutes. Investigate if this is expected workload.`,
        detail: JSON.parse(JSON.stringify({
          pid: det.pid,
          name: det.name,
          user: det.user,
          cpu: det.cpu,
          ram: det.ram,
          cmdline: det.cmdline,
          parentName: det.parentName,
          reason: det.reason,
          hasNetwork: det.hasNetwork,
          duration: det.duration,
          remediation: det.reason === 'known_miner'
            ? `sudo kill -9 ${det.pid} && sudo find /tmp /dev/shm /var/tmp -name "${det.name}" -delete`
            : det.reason === 'reverse_shell'
            ? `sudo kill -9 ${det.pid} && sudo netstat -tlnp | grep ${det.pid}`
            : null,
        })),
      },
    });
    created++;
  }

  if (created > 0) {
    try {
      const { recomputeScore } = await import('../servers/servers.service.js');
      await recomputeScore(server.id);
    } catch (err) {
      logger.warn('Score recompute failed after suspicious process', { error: (err as Error).message });
    }
  }

  logger.info('Suspicious process detections processed', {
    serverId: server.id,
    detections: input.detections.length,
    created,
  });

  return { processed: input.detections.length, created };
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
  crypto_miner_detected: 'critical',
  reverse_shell_detected: 'critical',
  sustained_high_cpu_process: 'high',
  suspicious_binary_path: 'high',
  ssh_active_attack: 'critical',
  ssh_distributed_attack: 'high',
  ssh_potential_compromise: 'critical',
  http_brute_force: 'high',
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
