import tls from 'node:tls';
import crypto from 'node:crypto';
import type { Job } from 'bullmq';

import { prisma } from '../lib/prisma.js';
import { jobLogger } from '../lib/logger.js';
import { domainMonitoringQueue } from './queues.js';
import type { JobContext } from './context.js';

const PROBE_TIMEOUT_MS = 10_000;

export interface DomainCheckJobData extends JobContext {
  endpointId: string;
  host: string;
  port: number;
  orgId: string;
}

/**
 * BullMQ processor: TLS probe for a single endpoint.
 * Connects, extracts cert, measures response time, updates status, creates findings.
 */
export async function processDomainCheck(job: Job<DomainCheckJobData>): Promise<void> {
  const { endpointId, host, port, orgId } = job.data;
  const log = jobLogger(job.queueName, job.id ?? 'unknown', job.data.request_id);

  const start = performance.now();

  try {
    const certInfo = await probeTls(host, port);
    const responseMs = Math.round(performance.now() - start);

    // Update endpoint status
    await prisma.monitoredEndpoint.update({
      where: { id: endpointId },
      data: {
        lastCheckedAt: new Date(),
        lastStatus: 'healthy',
        lastResponseMs: responseMs,
      },
    });

    // Upsert certificate record
    const fingerprint = crypto.createHash('sha256').update(certInfo.raw).digest('hex');
    await prisma.certificate.upsert({
      where: { orgId_fingerprintSha256: { orgId, fingerprintSha256: fingerprint } },
      create: {
        orgId,
        subjectCn: certInfo.subject,
        sans: certInfo.sans,
        issuerCn: certInfo.issuer,
        serialNumber: certInfo.serialNumber,
        fingerprintSha256: fingerprint,
        notBefore: certInfo.notBefore,
        notAfter: certInfo.notAfter,
        keyAlgorithm: certInfo.keyAlgorithm,
        signatureAlgorithm: certInfo.signatureAlgorithm,
        chainValid: certInfo.chainValid,
        chainDepth: certInfo.chainDepth,
        discoveredFrom: `probe:${host}:${port}`,
        status: certStatus(certInfo.notAfter),
      },
      update: {
        status: certStatus(certInfo.notAfter),
        lastCheckedAt: new Date(),
        chainValid: certInfo.chainValid,
      },
    });

    // Generate findings for cert issues
    await generateCertFindings(orgId, host, port, certInfo, fingerprint);

    log.info('Domain check complete', { host, port, responseMs, status: 'healthy' });
  } catch (err) {
    const responseMs = Math.round(performance.now() - start);

    await prisma.monitoredEndpoint.update({
      where: { id: endpointId },
      data: {
        lastCheckedAt: new Date(),
        lastStatus: 'unreachable',
        lastResponseMs: responseMs,
      },
    });

    log.warn('Domain check failed', { host, port, error: (err as Error).message });
  }
}

// ---------------------------------------------------------------------------
// TLS probe
// ---------------------------------------------------------------------------

interface CertInfo {
  subject: string;
  issuer: string;
  sans: string[];
  serialNumber: string;
  notBefore: Date;
  notAfter: Date;
  keyAlgorithm: string;
  signatureAlgorithm: string;
  chainValid: boolean;
  chainDepth: number;
  raw: Buffer;
  isSelfSigned: boolean;
  keyBits?: number;
}

function probeTls(host: string, port: number): Promise<CertInfo> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      { host, port, rejectUnauthorized: false, servername: host, timeout: PROBE_TIMEOUT_MS },
      () => {
        const cert = socket.getPeerCertificate(true);
        if (!cert || !cert.raw) {
          socket.destroy();
          return reject(new Error('No certificate presented'));
        }

        const chainValid = socket.authorized;
        let chainDepth = 1;
        let current = cert;
        while (current.issuerCertificate && current.issuerCertificate !== current) {
          chainDepth++;
          current = current.issuerCertificate;
        }

        const info: CertInfo = {
          subject: cert.subject?.CN ?? '',
          issuer: cert.issuer?.CN ?? '',
          sans: (cert.subjectaltname ?? '').split(',').map((s: string) => s.trim().replace('DNS:', '')).filter(Boolean),
          serialNumber: cert.serialNumber ?? '',
          notBefore: new Date(cert.valid_from),
          notAfter: new Date(cert.valid_to),
          keyAlgorithm: inferKeyAlgorithm(cert),
          signatureAlgorithm: cert.infoAccess ? 'SHA256' : 'unknown',
          chainValid,
          chainDepth,
          raw: cert.raw,
          isSelfSigned: cert.subject?.CN === cert.issuer?.CN && !cert.issuerCertificate,
          keyBits: cert.bits,
        };

        socket.destroy();
        resolve(info);
      },
    );

    socket.on('error', (err) => reject(err));
    socket.setTimeout(PROBE_TIMEOUT_MS, () => {
      socket.destroy();
      reject(new Error('Connection timeout'));
    });
  });
}

function inferKeyAlgorithm(cert: tls.PeerCertificate): string {
  const bits = cert.bits;
  if (!bits) return 'unknown';
  if (bits >= 2048 && bits <= 4096) return `RSA-${bits}`;
  if (bits >= 256 && bits <= 521) return `ECDSA-P${bits}`;
  return `RSA-${bits}`;
}

// ---------------------------------------------------------------------------
// Finding generation for cert issues
// ---------------------------------------------------------------------------

async function generateCertFindings(
  orgId: string,
  host: string,
  port: number,
  cert: CertInfo,
  fingerprint: string,
): Promise<void> {
  const findings: Array<{ severity: string; title: string; description: string }> = [];
  const daysUntilExpiry = Math.floor((cert.notAfter.getTime() - Date.now()) / 86400000);

  // Expiry checks
  if (daysUntilExpiry <= 0) {
    findings.push({ severity: 'critical', title: `EXPIRED certificate: ${cert.subject}`, description: `Certificate for ${host}:${port} expired ${Math.abs(daysUntilExpiry)} days ago` });
  } else if (daysUntilExpiry <= 7) {
    findings.push({ severity: 'critical', title: `Certificate ${cert.subject} expires in ${daysUntilExpiry}d`, description: `Expires ${cert.notAfter.toISOString()}` });
  } else if (daysUntilExpiry <= 30) {
    findings.push({ severity: 'high', title: `Certificate ${cert.subject} expires in ${daysUntilExpiry}d`, description: `Expires ${cert.notAfter.toISOString()}` });
  } else if (daysUntilExpiry <= 60) {
    findings.push({ severity: 'medium', title: `Certificate ${cert.subject} expires in ${daysUntilExpiry}d`, description: `Expires ${cert.notAfter.toISOString()}` });
  } else if (daysUntilExpiry <= 90) {
    findings.push({ severity: 'low', title: `Certificate ${cert.subject} expires in ${daysUntilExpiry}d`, description: `Expires ${cert.notAfter.toISOString()}` });
  }

  // Weak key
  if (cert.keyBits && cert.keyBits < 2048 && cert.keyAlgorithm.startsWith('RSA')) {
    findings.push({ severity: 'high', title: `Weak RSA key (${cert.keyBits} bits) on ${cert.subject}`, description: 'Minimum 2048 bits recommended' });
  }

  // Self-signed
  if (cert.isSelfSigned) {
    findings.push({ severity: 'medium', title: `Self-signed certificate on ${cert.subject}`, description: 'Not issued by a trusted CA' });
  }

  // Incomplete chain
  if (!cert.chainValid) {
    findings.push({ severity: 'medium', title: `Incomplete chain on ${cert.subject}`, description: 'Certificate chain validation failed' });
  }

  // Find the certificate record to link findings
  const certRecord = await prisma.certificate.findFirst({
    where: { orgId, fingerprintSha256: fingerprint },
    select: { id: true },
  });

  for (const f of findings) {
    // Upsert: match by title + cert to avoid duplicates
    const existing = await prisma.finding.findFirst({
      where: { orgId, title: f.title, certificateId: certRecord?.id, status: { in: ['open', 'in_progress'] } },
    });

    if (!existing) {
      await prisma.finding.create({
        data: {
          orgId,
          source: 'cert_monitor',
          severity: f.severity as any,
          status: 'open',
          title: f.title,
          description: f.description,
          certificateId: certRecord?.id ?? null,
          scanId: null as any, // No scan record for probe checks
          detail: { host, port, fingerprint, days_until_expiry: daysUntilExpiry },
          remediation: 'Renew or replace the certificate',
        },
      });
    }
  }
}

function certStatus(notAfter: Date): string {
  const days = Math.floor((notAfter.getTime() - Date.now()) / 86400000);
  if (days <= 0) return 'expired';
  if (days <= 30) return 'expiring';
  return 'active';
}

// ---------------------------------------------------------------------------
// T-18.2.6: Scheduler — enqueue checks for all active endpoints
// ---------------------------------------------------------------------------

const INTERVAL_MS: Record<string, number> = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
};

export async function scheduleEndpointChecks(): Promise<number> {
  const now = Date.now();
  const endpoints = await prisma.monitoredEndpoint.findMany({
    where: { status: 'active' },
    select: { id: true, orgId: true, host: true, port: true, checkInterval: true, lastCheckedAt: true },
  });

  let queued = 0;
  for (const ep of endpoints) {
    const interval = INTERVAL_MS[ep.checkInterval] ?? INTERVAL_MS['1h'];
    const lastCheck = ep.lastCheckedAt?.getTime() ?? 0;

    if (now - lastCheck >= interval) {
      await domainMonitoringQueue.add('check-endpoint', {
        endpointId: ep.id,
        host: ep.host,
        port: ep.port,
        orgId: ep.orgId,
      }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
      });
      queued++;
    }
  }

  return queued;
}
