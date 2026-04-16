/**
 * External Attack Surface Scanner.
 *
 * Scans a server's public IP from the platform side (not the agent) to discover
 * what's externally reachable. Generates findings for exposed services.
 */

import crypto from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/errors.js';
import { logger } from '../../lib/logger.js';
import { scanPorts, DEFAULT_PORTS } from './port-scanner.js';
import { identifyService, probeAdminPanels } from './service-fingerprint.js';

// RFC 1918 / private IP ranges — don't scan these externally.
function isPrivateIP(ip: string): boolean {
  if (ip.startsWith('10.') || ip.startsWith('127.') || ip.startsWith('192.168.')) return true;
  if (ip.startsWith('172.')) {
    const second = parseInt(ip.split('.')[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  if (ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80')) return true;
  return false;
}

export interface ScanResult {
  scanId: string;
  status: 'running' | 'completed' | 'failed';
  targetIp: string;
  openPorts: Array<{
    port: number;
    service: string;
    version: string | null;
    banner: string | null;
    riskLevel: string;
    isDatabase: boolean;
    responseMs: number;
  }>;
  adminPanels: Array<{ port: number; path: string; status: number }>;
  summary: { totalOpen: number; critical: number; high: number; medium: number; low: number; adminPanels: number };
}

/**
 * Trigger an attack surface scan for a server.
 * Runs asynchronously — returns scan ID immediately, results populate later.
 */
export async function triggerScan(
  orgId: string,
  serverId: string,
  options: { checkAdminPanels?: boolean } = {},
): Promise<{ scanId: string; targetIp: string }> {
  const server = await prisma.server.findFirst({ where: { id: serverId, orgId } });
  if (!server) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Server not found');
  }

  // Get the server's public IP.
  const ips = (server.ipAddresses as string[]) ?? [];
  const publicIp = ips.find((ip) => !isPrivateIP(ip));
  if (!publicIp) {
    throw new AppError('VALIDATION_ERROR', 'Server has no public IP address. Attack surface scan requires an internet-facing IP.');
  }

  const scanId = crypto.randomUUID();

  // Store scan record (raw SQL — model not yet in generated Prisma client).
  await prisma.$executeRawUnsafe(
    `INSERT INTO attack_surface_scans (id, server_id, org_id, target_ip, status) VALUES (?, ?, ?, ?, 'running')`,
    scanId, serverId, orgId, publicIp,
  );

  // Run scan async — don't block the request.
  void executeScan(scanId, serverId, orgId, publicIp, server.hostname, options.checkAdminPanels ?? true);

  return { scanId, targetIp: publicIp };
}

async function executeScan(
  scanId: string,
  serverId: string,
  orgId: string,
  ip: string,
  hostname: string,
  checkAdminPanels: boolean,
): Promise<void> {
  try {
    logger.info('Attack surface scan started', { scanId, ip });

    // 1. Port scan.
    const portResults = await scanPorts(ip, DEFAULT_PORTS, { timeoutMs: 3000, concurrency: 30 });

    // 2. Fingerprint services.
    const openPorts = portResults.map((r) => {
      const info = identifyService(r.port, r.banner);
      return {
        port: r.port,
        service: info.service,
        version: info.version,
        banner: r.banner,
        riskLevel: info.riskLevel,
        isDatabase: info.isDatabase,
        responseMs: r.responseTimeMs,
      };
    });

    // 3. Probe admin panels on HTTP ports.
    let adminPanels: Array<{ port: number; path: string; status: number }> = [];
    if (checkAdminPanels) {
      const httpPorts = openPorts.filter((p) => ['HTTP', 'HTTPS', 'HTTP Alt', 'HTTPS Alt', 'nginx', 'Apache'].includes(p.service)).map((p) => p.port);
      if (httpPorts.length > 0) {
        adminPanels = await probeAdminPanels(ip, httpPorts);
      }
    }

    // 4. Summary.
    const summary = {
      totalOpen: openPorts.length,
      critical: openPorts.filter((p) => p.riskLevel === 'critical').length,
      high: openPorts.filter((p) => p.riskLevel === 'high').length,
      medium: openPorts.filter((p) => p.riskLevel === 'medium').length,
      low: openPorts.filter((p) => p.riskLevel === 'low').length,
      adminPanels: adminPanels.length,
    };

    // 5. Persist results.
    await prisma.$executeRawUnsafe(
      `UPDATE attack_surface_scans SET status = 'completed', open_ports = ?, admin_panels = ?, summary = ?, started_at = ?, completed_at = ? WHERE id = ?`,
      JSON.stringify(openPorts),
      JSON.stringify(adminPanels),
      JSON.stringify(summary),
      new Date(),
      new Date(),
      scanId,
    );

    // 6. Create findings.
    await createScanFindings(orgId, serverId, hostname, openPorts, adminPanels);

    logger.info('Attack surface scan completed', { scanId, ip, ...summary });
  } catch (err) {
    logger.error('Attack surface scan failed', { scanId, error: (err as Error).message });
    await prisma.$executeRawUnsafe(
      `UPDATE attack_surface_scans SET status = 'failed', completed_at = ? WHERE id = ?`,
      new Date(), scanId,
    );
  }
}

async function createScanFindings(
  orgId: string,
  serverId: string,
  hostname: string,
  openPorts: Array<{ port: number; service: string; riskLevel: string; isDatabase: boolean }>,
  adminPanels: Array<{ port: number; path: string }>,
): Promise<void> {
  // Exposed databases.
  for (const p of openPorts.filter((o) => o.isDatabase)) {
    const title = `Exposed ${p.service} (port ${p.port}) on ${hostname}`;
    const existing = await prisma.finding.findFirst({
      where: { orgId, serverId, source: 'attack_surface', title, status: { in: ['open', 'in_progress'] } },
    });
    if (!existing) {
      await prisma.finding.create({
        data: {
          orgId, serverId,
          source: 'attack_surface',
          severity: 'critical',
          status: 'open',
          title,
          description: `${p.service} on port ${p.port} is reachable from the internet. Databases should never be directly exposed. Restrict access via firewall or bind to 127.0.0.1.`,
          detail: JSON.parse(JSON.stringify({ port: p.port, service: p.service, remediation: `Restrict ${p.service} to localhost: bind to 127.0.0.1 and block port ${p.port} in firewall.` })),
        },
      });
    }
  }

  // Exposed admin panels.
  for (const panel of adminPanels) {
    const title = `Exposed admin panel ${panel.path} (port ${panel.port}) on ${hostname}`;
    const existing = await prisma.finding.findFirst({
      where: { orgId, serverId, source: 'attack_surface', title, status: { in: ['open', 'in_progress'] } },
    });
    if (!existing) {
      await prisma.finding.create({
        data: {
          orgId, serverId,
          source: 'attack_surface',
          severity: 'high',
          status: 'open',
          title,
          description: `Admin panel at ${panel.path} on port ${panel.port} is accessible from the internet. Restrict access via IP whitelist, VPN, or authentication.`,
          detail: JSON.parse(JSON.stringify({ port: panel.port, path: panel.path, remediation: `Block public access to ${panel.path} via nginx/firewall IP whitelist or move behind VPN.` })),
        },
      });
    }
  }

  // High-risk legacy protocols.
  for (const p of openPorts.filter((o) => o.riskLevel === 'high' && !o.isDatabase)) {
    const title = `${p.service} exposed (port ${p.port}) on ${hostname}`;
    const existing = await prisma.finding.findFirst({
      where: { orgId, serverId, source: 'attack_surface', title, status: { in: ['open', 'in_progress'] } },
    });
    if (!existing) {
      await prisma.finding.create({
        data: {
          orgId, serverId,
          source: 'attack_surface',
          severity: 'high',
          status: 'open',
          title,
          description: `${p.service} on port ${p.port} is accessible from the internet. This service is a common attack target.`,
          detail: JSON.parse(JSON.stringify({ port: p.port, service: p.service, remediation: `Disable ${p.service} if not needed, or restrict to trusted IPs via firewall.` })),
        },
      });
    }
  }
}

/**
 * Get the latest scan result for a server.
 */
export async function getLatestScan(orgId: string, serverId: string): Promise<unknown> {
  const server = await prisma.server.findFirst({ where: { id: serverId, orgId } });
  if (!server) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Server not found');
  }

  const rows: unknown[] = await prisma.$queryRawUnsafe(
    `SELECT id, target_ip AS targetIp, status, open_ports AS openPorts, admin_panels AS adminPanels, summary, started_at AS startedAt, completed_at AS completedAt, created_at AS createdAt
     FROM attack_surface_scans WHERE server_id = ? ORDER BY created_at DESC LIMIT 1`,
    serverId,
  );

  return (rows as unknown[])[0] ?? null;
}

/**
 * List scan history for a server.
 */
export async function listScans(orgId: string, serverId: string): Promise<unknown[]> {
  const server = await prisma.server.findFirst({ where: { id: serverId, orgId } });
  if (!server) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Server not found');
  }

  return prisma.$queryRawUnsafe(
    `SELECT id, target_ip AS targetIp, status, summary, completed_at AS completedAt, created_at AS createdAt
     FROM attack_surface_scans WHERE server_id = ? ORDER BY created_at DESC LIMIT 20`,
    serverId,
  );
}
