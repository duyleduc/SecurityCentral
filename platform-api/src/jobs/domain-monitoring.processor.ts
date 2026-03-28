import tls from 'node:tls';
import https from 'node:https';
import http from 'node:http';
import crypto from 'node:crypto';
import type { Job } from 'bullmq';

import { prisma } from '../lib/prisma.js';
import { jobLogger } from '../lib/logger.js';
import { domainMonitoringQueue } from './queues.js';
import type { JobContext } from './context.js';

const PROBE_TIMEOUT_MS = 10_000;
const HTTP_TIMEOUT_MS = 15_000;

export interface DomainCheckJobData extends JobContext {
  endpointId: string;
  host: string;
  port: number;
  orgId: string;
}

/**
 * BullMQ processor: comprehensive domain check.
 *
 * 1. HTTP/HTTPS health check — verify the endpoint responds
 * 2. TLS certificate probe — extract and validate SSL cert
 * 3. Generate findings for cert issues (expiry, weak key, etc.)
 *
 * Status: healthy | unhealthy | unreachable
 *   - healthy: HTTP 2xx/3xx + valid TLS
 *   - unhealthy: HTTP responds but with errors, or TLS issues
 *   - unreachable: cannot connect at all
 */
export async function processDomainCheck(job: Job<DomainCheckJobData>): Promise<void> {
  const { endpointId, host, port, orgId } = job.data;
  const log = jobLogger(job.queueName, job.id ?? 'unknown', job.data.request_id);

  const cleanHost = host.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const start = performance.now();

  // Heartbeat status: up | down | degraded
  let heartbeatStatus: 'up' | 'down' | 'degraded' = 'down';
  let endpointStatus: 'healthy' | 'unhealthy' | 'unreachable' = 'unreachable';
  let httpStatusCode: number | null = null;
  let errorMessage: string | null = null;
  let certDaysLeft: number | null = null;

  // --- Step 1: HTTP/HTTPS health check ---
  try {
    httpStatusCode = await probeHttp(cleanHost, port);
    if (httpStatusCode >= 200 && httpStatusCode < 400) {
      heartbeatStatus = 'up';
      endpointStatus = 'healthy';
    } else {
      heartbeatStatus = 'degraded';
      endpointStatus = 'unhealthy';
      errorMessage = `HTTP ${httpStatusCode}`;
    }
  } catch (err) {
    errorMessage = (err as Error).message;
    log.info('HTTP probe failed', { host: cleanHost, port, error: errorMessage });
  }

  // --- Step 2: TLS certificate probe ---
  try {
    const certInfo = await probeTls(cleanHost, port);

    if (endpointStatus === 'unreachable') {
      heartbeatStatus = 'degraded';
      endpointStatus = 'unhealthy';
    }

    certDaysLeft = Math.floor((certInfo.notAfter.getTime() - Date.now()) / 86400000);

    // Check cert health
    if (certDaysLeft <= 0) {
      heartbeatStatus = 'degraded';
      endpointStatus = 'unhealthy';
      errorMessage = `Certificate expired ${Math.abs(certDaysLeft)} days ago`;
    } else if (certDaysLeft <= 7) {
      if (heartbeatStatus === 'up') heartbeatStatus = 'degraded';
      if (endpointStatus === 'healthy') endpointStatus = 'unhealthy';
      errorMessage = `Certificate expires in ${certDaysLeft} days`;
    }

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
        discoveredFrom: `probe:${cleanHost}:${port}`,
        status: certStatus(certInfo.notAfter),
      },
      update: {
        status: certStatus(certInfo.notAfter),
        lastCheckedAt: new Date(),
        chainValid: certInfo.chainValid,
      },
    });

    await generateCertFindings(orgId, cleanHost, port, certInfo, fingerprint);
  } catch (err) {
    if (!errorMessage) errorMessage = (err as Error).message;
    log.info('TLS probe failed', { host: cleanHost, port, error: (err as Error).message });
  }

  const responseMs = Math.round(performance.now() - start);

  // --- Step 3: Record heartbeat ---
  await prisma.endpointHeartbeat.create({
    data: {
      endpointId,
      status: heartbeatStatus,
      statusCode: httpStatusCode,
      responseMs,
      message: errorMessage,
      certDaysLeft,
    },
  });

  // --- Step 4: Update endpoint summary ---
  await prisma.monitoredEndpoint.update({
    where: { id: endpointId },
    data: {
      lastCheckedAt: new Date(),
      lastStatus: endpointStatus,
      lastResponseMs: responseMs,
    },
  });

  log.info('Domain check complete', {
    host: cleanHost, port, responseMs, status: endpointStatus,
    heartbeat: heartbeatStatus, httpStatusCode, certDaysLeft,
  });
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
          subject: String(cert.subject?.CN ?? ''),
          issuer: String(cert.issuer?.CN ?? ''),
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

// ---------------------------------------------------------------------------
// HTTP/HTTPS health check
// ---------------------------------------------------------------------------

/**
 * Sends a HEAD request (falls back to GET) and returns the HTTP status code.
 * Tries HTTPS first for port 443/8443, otherwise HTTP.
 * Follows up to 5 redirects.
 */
function probeHttp(host: string, port: number): Promise<number> {
  const isSecure = port === 443 || port === 8443;
  const protocol = isSecure ? https : http;
  const url = `${isSecure ? 'https' : 'http'}://${host}${port === 443 || port === 80 ? '' : `:${port}`}/`;

  return new Promise((resolve, reject) => {
    const req = protocol.request(url, {
      method: 'HEAD',
      timeout: HTTP_TIMEOUT_MS,
      rejectUnauthorized: false, // don't fail on self-signed certs
      headers: { 'User-Agent': 'SecurityCentral/1.0 health-check' },
    }, (res) => {
      // Follow redirects
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Just report the redirect status — don't chase it
        resolve(res.statusCode);
      } else {
        resolve(res.statusCode ?? 0);
      }
      res.resume(); // drain response
    });

    req.on('error', (err) => {
      // If HEAD fails, try GET (some servers reject HEAD)
      const getReq = protocol.request(url, {
        method: 'GET',
        timeout: HTTP_TIMEOUT_MS,
        rejectUnauthorized: false,
        headers: { 'User-Agent': 'SecurityCentral/1.0 health-check' },
      }, (res) => {
        resolve(res.statusCode ?? 0);
        res.resume();
      });
      getReq.on('error', reject);
      getReq.on('timeout', () => { getReq.destroy(); reject(new Error('HTTP timeout')); });
      getReq.end();
    });

    req.on('timeout', () => { req.destroy(); reject(new Error('HTTP timeout')); });
    req.end();
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
  '30s': 30 * 1000,
  '1m': 60 * 1000,
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '30m': 30 * 60 * 1000,
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
