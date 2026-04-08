import tls from 'node:tls';
import https from 'node:https';
import http from 'node:http';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
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
  let hasHsts = false;
  let tlsInfo: Record<string, unknown> | null = null;

  // --- Step 1: HTTP/HTTPS health check ---
  try {
    const httpResult = await probeHttp(cleanHost, port);
    httpStatusCode = httpResult.statusCode;
    hasHsts = httpResult.hasHsts;
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

    // Build TLS scan info for persistence
    const cipherUpper = (certInfo.cipherName ?? '').toUpperCase();
    const hasForwardSecrecy = cipherUpper.includes('ECDHE') || cipherUpper.includes('DHE');
    tlsInfo = {
      tlsVersion: certInfo.tlsVersion ?? null,
      cipherName: certInfo.cipherName ?? null,
      cipherVersion: certInfo.cipherVersion ?? null,
      forwardSecrecy: hasForwardSecrecy,
      hsts: hasHsts,
      keyAlgorithm: certInfo.keyAlgorithm,
      signatureAlgorithm: certInfo.signatureAlgorithm,
      validationLevel: certInfo.validationLevel ?? 'unknown',
      subjectCn: certInfo.subject,
      issuerCn: certInfo.issuer,
      certDaysLeft,
      certNotAfter: certInfo.notAfter.toISOString(),
      chainValid: certInfo.chainValid,
      chainDepth: certInfo.chainDepth,
      isSelfSigned: certInfo.isSelfSigned,
      keyBits: certInfo.keyBits ?? null,
      sans: certInfo.sans,
      scannedAt: new Date().toISOString(),
    };

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
        issuerCn: certInfo.issuer,
        status: certStatus(certInfo.notAfter),
        lastCheckedAt: new Date(),
        chainValid: certInfo.chainValid,
      },
    });

    await generateCertFindings(orgId, cleanHost, port, certInfo, fingerprint);

    // --- Step 2b: HSTS header check (only for HTTPS endpoints) ---
    if ((port === 443 || port === 8443) && !hasHsts) {
      await generateSecurityHeaderFindings(orgId, cleanHost, port);
    }

    // --- Step 2c: CAA DNS record check ---
    await generateCaaFindings(orgId, cleanHost, port);
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
      lastTlsInfo: tlsInfo as any,
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
  // TLS connection metadata
  tlsVersion?: string;       // TLSv1.3, TLSv1.2, etc.
  cipherName?: string;        // e.g. TLS_AES_256_GCM_SHA384
  cipherVersion?: string;     // e.g. TLSv1.3
  // Certificate policy (DV/OV/EV)
  validationLevel?: 'DV' | 'OV' | 'EV' | 'unknown';
  // Issuer org for OV/EV detection
  subjectOrg?: string;
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

        // Extract TLS connection metadata
        const cipher = socket.getCipher();
        const protocol = socket.getProtocol();

        const info: CertInfo = {
          subject: String(cert.subject?.CN ?? ''),
          issuer: buildIssuerName(cert.issuer as any),
          sans: (cert.subjectaltname ?? '').split(',').map((s: string) => s.trim().replace('DNS:', '')).filter(Boolean),
          serialNumber: cert.serialNumber ?? '',
          notBefore: new Date(cert.valid_from),
          notAfter: new Date(cert.valid_to),
          keyAlgorithm: inferKeyAlgorithm(cert),
          signatureAlgorithm: inferSignatureAlgorithm(cert),
          chainValid,
          chainDepth,
          raw: cert.raw,
          isSelfSigned: cert.subject?.CN === cert.issuer?.CN && cert.subject?.O === cert.issuer?.O && !cert.issuerCertificate,
          keyBits: cert.bits,
          tlsVersion: protocol ?? undefined,
          cipherName: cipher?.name,
          cipherVersion: cipher?.version,
          validationLevel: detectValidationLevel(cert),
          subjectOrg: Array.isArray(cert.subject?.O) ? cert.subject?.O[0] : cert.subject?.O,
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

/**
 * Build a human-readable issuer name from the certificate issuer fields.
 * Prefers Organization (O) which shows e.g. "Let's Encrypt", falls back to CN.
 */
function buildIssuerName(issuer: { O?: string; CN?: string } | undefined): string {
  if (!issuer) return '';
  const org = issuer.O?.trim();
  const cn = issuer.CN?.trim();
  if (org && cn && org !== cn) return `${org} (${cn})`;
  return org || cn || '';
}

// ---------------------------------------------------------------------------
// HTTP/HTTPS health check
// ---------------------------------------------------------------------------

interface HttpProbeResult {
  statusCode: number;
  hasHsts: boolean;
}

/**
 * Sends a HEAD request (falls back to GET) and returns the HTTP status code + security headers.
 * Tries HTTPS first for port 443/8443, otherwise HTTP.
 */
function probeHttp(host: string, port: number): Promise<HttpProbeResult> {
  const isSecure = port === 443 || port === 8443;
  const protocol = isSecure ? https : http;
  const url = `${isSecure ? 'https' : 'http'}://${host}${port === 443 || port === 80 ? '' : `:${port}`}/`;

  return new Promise((resolve, reject) => {
    const req = protocol.request(url, {
      method: 'HEAD',
      timeout: HTTP_TIMEOUT_MS,
      rejectUnauthorized: false,
      headers: { 'User-Agent': 'SecurityCentral/1.0 health-check' },
    }, (res) => {
      const hasHsts = Boolean(res.headers['strict-transport-security']);
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve({ statusCode: res.statusCode, hasHsts });
      } else {
        resolve({ statusCode: res.statusCode ?? 0, hasHsts });
      }
      res.resume();
    });

    req.on('error', () => {
      // If HEAD fails, try GET (some servers reject HEAD)
      const getReq = protocol.request(url, {
        method: 'GET',
        timeout: HTTP_TIMEOUT_MS,
        rejectUnauthorized: false,
        headers: { 'User-Agent': 'SecurityCentral/1.0 health-check' },
      }, (res) => {
        const hasHsts = Boolean(res.headers['strict-transport-security']);
        resolve({ statusCode: res.statusCode ?? 0, hasHsts });
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
  // ECDSA keys are typically 256, 384, or 521 bits
  if (bits >= 256 && bits <= 521) return `ECDSA-P${bits}`;
  // RSA keys are 1024+ bits
  return `RSA-${bits}`;
}

/**
 * Extract the actual signature algorithm from the certificate's raw ASN.1 data.
 * Node's PeerCertificate doesn't expose signatureAlgorithm directly, so we
 * parse the fingerprint256 hash name and OID-based heuristics.
 */
function inferSignatureAlgorithm(cert: tls.PeerCertificate): string {
  // Node.js exposes the signature algorithm OID indirectly via the fingerprint
  // The most reliable approach: parse the X509Certificate if available (Node 15+)
  try {
    const x509 = new crypto.X509Certificate(cert.raw);
    // x509.sigAlgName is not directly available, but we can check via toString()
    const pem = x509.toString();
    // Parse from the text representation
    const sigMatch = pem.match(/Signature Algorithm:\s*(\S+)/i);
    if (sigMatch) return sigMatch[1].toUpperCase().replace('WITHRSAENCRYPTION', '').replace('WITH', '-');
  } catch {
    // Fallback below
  }

  // Heuristic: modern certs are SHA256, but we flag if we can't determine
  // Check for known weak signatures by examining raw cert bytes for SHA-1 OID
  const sha1OID = Buffer.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x05]); // sha1WithRSAEncryption
  if (cert.raw && cert.raw.includes(sha1OID)) return 'SHA1';

  const md5OID = Buffer.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x04]); // md5WithRSAEncryption
  if (cert.raw && cert.raw.includes(md5OID)) return 'MD5';

  return 'SHA256'; // safe default for modern certificates
}

/**
 * Detect certificate validation level (DV/OV/EV) from certificate policies.
 * EV certs have specific OIDs; OV certs have Organization in subject; DV is the rest.
 */
function detectValidationLevel(cert: tls.PeerCertificate): 'DV' | 'OV' | 'EV' | 'unknown' {
  // EV certificates contain specific policy OIDs — check via X509Certificate
  try {
    const x509 = new crypto.X509Certificate(cert.raw);
    const info = x509.toString();
    // Known EV policy OIDs patterns
    const evIndicators = [
      '2.16.840.1.114412.2.1',   // DigiCert EV
      '2.16.840.1.113733.1.7.23.6', // Symantec/VeriSign EV
      '1.3.6.1.4.1.6449.1.2.1.5.1', // Comodo/Sectigo EV
      '2.16.840.1.114028.10.1.2',    // Entrust EV
      '1.3.6.1.4.1.8024.0.2.100.1.2', // QuoVadis EV
      'Policy: 2.23.140.1.1',          // CA/Browser Forum EV OID
    ];
    if (evIndicators.some((oid) => info.includes(oid))) return 'EV';
  } catch {
    // Fall through to simpler checks
  }

  // OV: has Organization in subject
  const subjectOrg = cert.subject?.O;
  const orgStr = Array.isArray(subjectOrg) ? subjectOrg[0] : subjectOrg;
  if (orgStr && orgStr.trim().length > 0) return 'OV';

  // DV: no org, just domain validation
  return 'DV';
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
  const findings: Array<{ severity: string; title: string; description: string; remediation: string }> = [];
  const daysUntilExpiry = Math.floor((cert.notAfter.getTime() - Date.now()) / 86400000);

  // --- 1. Certificate Identity & Validity ---

  // Expiry checks
  if (daysUntilExpiry <= 0) {
    findings.push({ severity: 'critical', title: `EXPIRED certificate: ${cert.subject}`, description: `Certificate for ${host}:${port} expired ${Math.abs(daysUntilExpiry)} days ago`, remediation: 'Renew the certificate immediately' });
  } else if (daysUntilExpiry <= 7) {
    findings.push({ severity: 'critical', title: `Certificate ${cert.subject} expires in ${daysUntilExpiry}d`, description: `Expires ${cert.notAfter.toISOString()}`, remediation: 'Renew the certificate before expiration' });
  } else if (daysUntilExpiry <= 30) {
    findings.push({ severity: 'high', title: `Certificate ${cert.subject} expires in ${daysUntilExpiry}d`, description: `Expires ${cert.notAfter.toISOString()}`, remediation: 'Renew the certificate before expiration' });
  } else if (daysUntilExpiry <= 60) {
    findings.push({ severity: 'medium', title: `Certificate ${cert.subject} expires in ${daysUntilExpiry}d`, description: `Expires ${cert.notAfter.toISOString()}`, remediation: 'Schedule certificate renewal' });
  } else if (daysUntilExpiry <= 90) {
    findings.push({ severity: 'low', title: `Certificate ${cert.subject} expires in ${daysUntilExpiry}d`, description: `Expires ${cert.notAfter.toISOString()}`, remediation: 'Plan certificate renewal' });
  }

  // Hostname mismatch: verify CN or SAN matches the probed domain
  if (!isHostnameMatch(host, cert.subject, cert.sans)) {
    findings.push({
      severity: 'critical',
      title: `Hostname mismatch on ${host}`,
      description: `Certificate subject "${cert.subject}" and SANs [${cert.sans.join(', ')}] do not match the probed domain "${host}"`,
      remediation: 'Reissue the certificate with the correct domain in SAN/CN',
    });
  }

  // Self-signed
  if (cert.isSelfSigned) {
    findings.push({ severity: 'medium', title: `Self-signed certificate on ${cert.subject}`, description: 'Certificate is not issued by a trusted Certificate Authority', remediation: 'Replace with a certificate from a trusted CA (e.g., Let\'s Encrypt, AWS ACM)' });
  }

  // Incomplete chain
  if (!cert.chainValid) {
    findings.push({ severity: 'medium', title: `Incomplete certificate chain on ${cert.subject}`, description: 'Certificate chain validation failed — may break mobile or older browser connections', remediation: 'Ensure the server presents the full chain including intermediate certificates' });
  }

  // --- 2. Cryptographic Strength ---

  // Weak RSA key
  if (cert.keyBits && cert.keyBits < 2048 && cert.keyAlgorithm.startsWith('RSA')) {
    findings.push({ severity: 'high', title: `Weak RSA key (${cert.keyBits} bits) on ${cert.subject}`, description: `RSA key is only ${cert.keyBits} bits; minimum 2048 bits recommended, 4096 preferred`, remediation: 'Regenerate certificate with at least RSA-2048 or use ECDSA P-256' });
  }

  // Weak ECDSA key
  if (cert.keyBits && cert.keyBits < 256 && cert.keyAlgorithm.startsWith('ECDSA')) {
    findings.push({ severity: 'high', title: `Weak ECDSA key (${cert.keyBits} bits) on ${cert.subject}`, description: `ECDSA key is only ${cert.keyBits} bits; minimum 256 bits required`, remediation: 'Regenerate certificate with at least ECDSA P-256' });
  }

  // Weak signature algorithm (SHA-1 or MD5)
  const sigAlg = cert.signatureAlgorithm.toUpperCase();
  if (sigAlg.includes('SHA1') || sigAlg === 'SHA1') {
    findings.push({ severity: 'high', title: `SHA-1 signature on ${cert.subject}`, description: 'SHA-1 is cryptographically broken and rejected by modern browsers', remediation: 'Reissue certificate with SHA-256 or stronger signature algorithm' });
  }
  if (sigAlg.includes('MD5') || sigAlg === 'MD5') {
    findings.push({ severity: 'critical', title: `MD5 signature on ${cert.subject}`, description: 'MD5 is cryptographically broken and trivially forgeable', remediation: 'Reissue certificate with SHA-256 immediately' });
  }

  // --- 3. Protocol & Cipher Suite ---

  // Weak TLS version
  if (cert.tlsVersion) {
    const weakProtocols = ['SSLv2', 'SSLv3', 'TLSv1', 'TLSv1.1'];
    if (weakProtocols.includes(cert.tlsVersion)) {
      findings.push({
        severity: cert.tlsVersion.startsWith('SSL') ? 'critical' : 'high',
        title: `Weak protocol ${cert.tlsVersion} on ${host}:${port}`,
        description: `Server negotiated ${cert.tlsVersion} which has known vulnerabilities (POODLE, BEAST). Only TLS 1.2+ should be enabled`,
        remediation: 'Disable SSL 2.0, SSL 3.0, TLS 1.0, and TLS 1.1. Enable only TLS 1.2 and TLS 1.3',
      });
    }
  }

  // Weak cipher suite
  if (cert.cipherName) {
    const cipher = cert.cipherName.toUpperCase();
    const weakCiphers = ['RC4', '3DES', 'DES', 'EXPORT', 'NULL', 'ANON'];
    const matchedWeak = weakCiphers.find((wc) => cipher.includes(wc));
    if (matchedWeak) {
      findings.push({
        severity: matchedWeak === 'NULL' || matchedWeak === 'ANON' ? 'critical' : 'high',
        title: `Weak cipher ${cert.cipherName} on ${host}:${port}`,
        description: `Cipher suite contains ${matchedWeak} which is cryptographically weak. Prefer AEAD ciphers (AES-GCM, CHACHA20-POLY1305)`,
        remediation: 'Configure server to use only strong cipher suites with AEAD (AES-GCM, CHACHA20-POLY1305)',
      });
    }

    // No forward secrecy
    if (!cipher.includes('ECDHE') && !cipher.includes('DHE')) {
      findings.push({
        severity: 'medium',
        title: `No forward secrecy on ${host}:${port}`,
        description: `Cipher ${cert.cipherName} does not use ephemeral key exchange (ECDHE/DHE). Past traffic can be decrypted if the private key is compromised`,
        remediation: 'Enable ECDHE cipher suites to ensure forward secrecy',
      });
    }
  }

  // Find the certificate record to link findings
  const certRecord = await prisma.certificate.findFirst({
    where: { orgId, fingerprintSha256: fingerprint },
    select: { id: true },
  });

  for (const f of findings) {
    const existing = await prisma.finding.findFirst({
      where: { orgId, title: f.title, certificateId: certRecord?.id, status: { in: ['open', 'in_progress'] } },
    });

    if (!existing) {
      await prisma.finding.create({
        data: {
          organization: { connect: { id: orgId } },
          source: 'cert_monitor',
          severity: f.severity as any,
          status: 'open',
          title: f.title,
          description: f.description,
          ...(certRecord ? { certificate: { connect: { id: certRecord.id } } } : {}),
          detail: { host, port, fingerprint, days_until_expiry: daysUntilExpiry, tls_version: cert.tlsVersion, cipher: cert.cipherName, validation_level: cert.validationLevel } as any,
          remediation: f.remediation,
        },
      });
    }
  }
}

/**
 * Check if a hostname matches the certificate's CN or any SAN entry.
 * Supports wildcard matching (e.g., *.example.com matches sub.example.com).
 */
function isHostnameMatch(hostname: string, cn: string, sans: string[]): boolean {
  const candidates = sans.length > 0 ? sans : [cn];
  const lower = hostname.toLowerCase();

  return candidates.some((name) => {
    const pattern = name.toLowerCase();
    if (pattern === lower) return true;
    // Wildcard: *.example.com matches foo.example.com but not foo.bar.example.com
    if (pattern.startsWith('*.')) {
      const wildBase = pattern.slice(2); // example.com
      const hostParts = lower.split('.');
      if (hostParts.length < 2) return false;
      const hostBase = hostParts.slice(1).join('.'); // example.com from foo.example.com
      return hostBase === wildBase;
    }
    return false;
  });
}

// ---------------------------------------------------------------------------
// HSTS header finding
// ---------------------------------------------------------------------------

async function generateSecurityHeaderFindings(orgId: string, host: string, port: number): Promise<void> {
  const title = `Missing HSTS header on ${host}:${port}`;
  const existing = await prisma.finding.findFirst({
    where: { orgId, title, status: { in: ['open', 'in_progress'] } },
  });

  if (!existing) {
    await prisma.finding.create({
      data: {
        organization: { connect: { id: orgId } },
        source: 'cert_monitor',
        severity: 'medium' as any,
        status: 'open',
        title,
        description: 'The server does not send the Strict-Transport-Security (HSTS) header, leaving users vulnerable to protocol downgrade attacks and cookie hijacking',
        detail: { host, port, check_type: 'hsts_missing' } as any,
        remediation: 'Add the Strict-Transport-Security header: `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`',
      },
    });
  }
}

// ---------------------------------------------------------------------------
// CAA DNS record check
// ---------------------------------------------------------------------------

async function generateCaaFindings(orgId: string, host: string, port: number): Promise<void> {
  try {
    const records = await dns.resolveCaa(host);
    // CAA records exist — no finding needed
    if (records && records.length > 0) return;
  } catch (err) {
    // ENODATA or ENOTFOUND means no CAA records — that's the finding
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENODATA' && code !== 'ENOTFOUND' && code !== 'ESERVFAIL') {
      return; // DNS error unrelated to CAA, skip silently
    }
  }

  const title = `No CAA DNS record for ${host}`;
  const existing = await prisma.finding.findFirst({
    where: { orgId, title, status: { in: ['open', 'in_progress'] } },
  });

  if (!existing) {
    await prisma.finding.create({
      data: {
        organization: { connect: { id: orgId } },
        source: 'cert_monitor',
        severity: 'low' as any,
        status: 'open',
        title,
        description: 'No CAA (Certificate Authority Authorization) DNS record found. Any CA can issue certificates for this domain, increasing the risk of unauthorized certificate issuance',
        detail: { host, port, check_type: 'caa_missing' } as any,
        remediation: 'Add a CAA DNS record specifying which CAs are authorized to issue certificates for this domain (e.g., `0 issue "letsencrypt.org"`)',
      },
    });
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
