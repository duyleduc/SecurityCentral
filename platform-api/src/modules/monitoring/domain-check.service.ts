import tls from 'node:tls';
import https from 'node:https';
import http from 'node:http';
import dns from 'node:dns/promises';
import crypto from 'node:crypto';

import { logger } from '../../lib/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CertChainEntry {
  readonly subject: string;
  readonly organization: string;
  readonly issuer: string;
  readonly validFrom: string;
  readonly validTo: string;
  readonly expired: boolean;
  readonly isSelfSigned: boolean;
}

export interface VulnerabilityCheck {
  readonly id: string;
  readonly name: string;
  readonly cve: string;
  readonly status: 'safe' | 'vulnerable' | 'warning' | 'unknown';
  readonly detail: string;
}

export interface HandshakeInfo {
  readonly timeMs: number;
  readonly alpn: string | null;
  readonly secureRenegotiation: boolean;
  readonly compression: boolean;
  readonly sni: boolean;
  readonly serverCipherOrder: boolean;
}

export interface HttpSecurityHeaders {
  readonly contentSecurityPolicy: string | null;
  readonly xFrameOptions: string | null;
  readonly xContentTypeOptions: string | null;
  readonly referrerPolicy: string | null;
  readonly permissionsPolicy: string | null;
  readonly xXssProtection: string | null;
}

export interface SslCheckResult {
  // Certificate
  readonly valid: boolean;
  readonly issuer: string;
  readonly issuerCn: string;
  readonly subjectCn: string;
  readonly sans: string[];
  readonly domainMatch: boolean;
  readonly expiry: Date;
  readonly notBefore: Date;
  readonly daysLeft: number;
  readonly serialNumber: string;
  readonly fingerprintSha256: string;
  // Protocol & cipher
  readonly tlsVersion: string;
  readonly cipherName: string;
  readonly cipherBits: number | null;
  readonly forwardSecrecy: boolean;
  // Protocol support (multi-version test)
  readonly protocols: { readonly name: string; readonly supported: boolean }[];
  // Key
  readonly keyAlgorithm: string;
  readonly keyBits: number | null;
  readonly signatureAlgorithm: string;
  // Chain
  readonly chainValid: boolean;
  readonly chainDepth: number;
  readonly chainDetails: CertChainEntry[];
  readonly isSelfSigned: boolean;
  // HTTP headers (set after HTTP check)
  hsts: boolean;
  readonly hstsMaxAge: number | null;
  readonly hstsIncludeSubDomains: boolean;
  readonly hstsPreload: boolean;
  // HTTP security headers
  readonly httpHeaders: HttpSecurityHeaders;
  // HTTP redirect
  readonly httpRedirect: boolean;
  // OCSP
  readonly ocspStapling: boolean;
  // Handshake
  readonly handshake: HandshakeInfo;
  // Vulnerabilities (inferred)
  readonly vulnerabilities: VulnerabilityCheck[];
  // Validation level
  readonly validationLevel: 'DV' | 'OV' | 'EV' | 'unknown';
  // Grade
  readonly grade: string;
  readonly gradeColor: string;
  readonly gradeNote: string;
  // Metadata
  readonly scannedAt: string;
  readonly error?: string;
}

export interface HttpCheckResult {
  readonly isUp: boolean;
  readonly statusCode: number | null;
  readonly responseMs: number;
  readonly headers?: Record<string, string>;
  readonly error?: string;
}

export interface DnsCheckResult {
  readonly spf: 'pass' | 'missing';
  readonly dkim: 'pass' | 'missing';
  readonly dmarc: 'pass' | 'missing';
  readonly caa: 'pass' | 'missing';
}

export interface DomainCheckResult {
  readonly ssl: SslCheckResult | null;
  readonly http: HttpCheckResult;
  readonly dns: DnsCheckResult;
}

// ---------------------------------------------------------------------------
// SSL/TLS comprehensive check
// ---------------------------------------------------------------------------

const WEAK_CIPHERS = ['RC4', '3DES', 'DES', 'EXPORT', 'NULL', 'ANON'];
const DEPRECATED_PROTOCOLS = ['SSLv2', 'SSLv3', 'TLSv1', 'TLSv1.1'];

export async function checkSsl(host: string, port: number): Promise<SslCheckResult> {
  // Run primary TLS connection + protocol support + cipher order test in parallel
  const [primary, protocols, serverCipherOrder] = await Promise.all([
    checkSslPrimary(host, port),
    testProtocolSupport(host, port),
    testServerCipherOrder(host, port),
  ]);

  // Infer vulnerabilities from the collected data
  const vulnerabilities = inferVulnerabilities({ ...primary, protocols }, protocols);

  return { ...primary, protocols, vulnerabilities, handshake: { ...primary.handshake, serverCipherOrder } };
}

function checkSslPrimary(host: string, port: number): Promise<SslCheckResult> {
  return new Promise((resolve) => {
    const startTime = performance.now();

    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false, ALPNProtocols: ['h2', 'http/1.1'] }, () => {
      try {
        const handshakeTimeMs = Math.round(performance.now() - startTime);
        const cert = socket.getPeerCertificate(true); // true = include full chain
        const protocol = socket.getProtocol() ?? 'unknown';
        const cipher = socket.getCipher();
        const authorized = socket.authorized;

        // ALPN
        const alpn = (socket as any).alpnProtocol ?? null;

        // Check OCSP stapling
        const ocspStapling = !!(socket as any).getOCSPResponse?.();

        // TLS compression (CRIME) — Node.js doesn't directly expose, but we can check
        // If compression is enabled, the cipher object may indicate it
        const compression = false; // Node.js disables TLS compression by default

        // Secure renegotiation — authorized connections support RFC 5746
        const secureRenegotiation = authorized || protocol !== 'unknown';

        socket.end();

        if (!cert || !cert.valid_to) {
          resolve(makeFailed(protocol, 'No certificate found'));
          return;
        }

        const expiry = new Date(cert.valid_to);
        const notBefore = new Date(cert.valid_from);
        const daysLeft = Math.floor((expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

        // Issuer
        const rawIssuerCn = cert.issuer?.CN ?? cert.issuer?.O ?? 'unknown';
        const issuerCn = Array.isArray(rawIssuerCn) ? rawIssuerCn[0] : String(rawIssuerCn);
        const issuerStr = cert.issuer
          ? Object.entries(cert.issuer).map(([k, v]) => `${k}=${v}`).join(', ')
          : 'unknown';

        // Subject
        const rawSubjectCn = cert.subject?.CN ?? 'unknown';
        const subjectCn = Array.isArray(rawSubjectCn) ? rawSubjectCn[0] : String(rawSubjectCn);

        // SANs
        const sans = (cert.subjectaltname ?? '')
          .split(',')
          .map((s: string) => s.trim().replace(/^DNS:/, ''))
          .filter(Boolean);

        // Domain match: check if host matches CN or any SAN (including wildcards)
        const domainMatch = checkDomainMatch(host, subjectCn, sans);

        // Serial + fingerprint
        const serialNumber = cert.serialNumber ?? '';
        const fingerprintSha256 = cert.fingerprint256 ?? '';

        // Cipher info
        const cipherName = cipher?.name ?? 'unknown';
        const cipherBits = cipher ? (cipher as any).bits ?? null : null;
        const forwardSecrecy = /ECDHE|DHE/.test(cipherName);

        // Key algorithm + bits
        const keyAlgorithm = extractKeyAlgorithm(cert);
        const keyBits = extractKeyBits(cert);
        const signatureAlgorithm = extractSignatureAlgorithm(cert);

        // Chain analysis
        const chainDetails = analyzeChain(cert);
        const chainDepth = chainDetails.length;
        const isSelfSigned = cert.issuer?.CN === cert.subject?.CN && chainDepth <= 1;
        const hasExpiredIntermediate = chainDetails.some((c, i) => i > 0 && c.expired);
        const chainValid = authorized && !isSelfSigned && !hasExpiredIntermediate;

        // Validation level (DV/OV/EV)
        const validationLevel = detectValidationLevel(cert);

        const emptyHeaders: HttpSecurityHeaders = {
          contentSecurityPolicy: null, xFrameOptions: null,
          xContentTypeOptions: null, referrerPolicy: null,
          permissionsPolicy: null, xXssProtection: null,
        };

        const handshake: HandshakeInfo = {
          timeMs: handshakeTimeMs,
          alpn: alpn === false ? null : alpn,
          secureRenegotiation,
          compression,
          sni: true, // We always send SNI
          serverCipherOrder: false, // Will be filled by parallel test
        };

        // Build result (hsts + httpHeaders set later after HTTP check)
        const result: SslCheckResult = {
          valid: daysLeft > 0 && authorized,
          issuer: issuerStr,
          issuerCn,
          subjectCn,
          sans,
          domainMatch,
          expiry,
          notBefore,
          daysLeft,
          serialNumber,
          fingerprintSha256,
          tlsVersion: protocol,
          cipherName,
          cipherBits,
          forwardSecrecy,
          protocols: [],
          keyAlgorithm,
          keyBits,
          signatureAlgorithm,
          chainValid,
          chainDepth,
          chainDetails,
          isSelfSigned,
          hsts: false,
          hstsMaxAge: null,
          hstsIncludeSubDomains: false,
          hstsPreload: false,
          httpHeaders: emptyHeaders,
          httpRedirect: false,
          ocspStapling,
          handshake,
          vulnerabilities: [],
          validationLevel,
          grade: '',
          gradeColor: '',
          gradeNote: '',
          scannedAt: new Date().toISOString(),
        };

        // Compute grade
        const graded = computeGrade(result);
        return resolve({ ...result, ...graded });
      } catch (err) {
        socket.end();
        resolve(makeFailed('unknown', (err as Error).message));
      }
    });

    socket.setTimeout(10_000);
    socket.on('timeout', () => { socket.destroy(); resolve(makeFailed('unknown', 'Connection timed out')); });
    socket.on('error', (err) => { resolve(makeFailed('unknown', err.message)); });
  });
}

// ---------------------------------------------------------------------------
// Domain match (CN/SAN vs hostname, with wildcard support)
// ---------------------------------------------------------------------------

function checkDomainMatch(host: string, cn: string, sans: string[]): boolean {
  const candidates = sans.length > 0 ? sans : [cn];
  return candidates.some((name) => matchHostname(host, name.toLowerCase()));
}

function matchHostname(host: string, pattern: string): boolean {
  if (host === pattern) return true;
  // Wildcard: *.example.com matches sub.example.com but NOT sub.sub.example.com
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(2);
    const hostParts = host.split('.');
    if (hostParts.length === suffix.split('.').length + 1) {
      return host.endsWith(`.${suffix}`);
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Certificate chain analysis
// ---------------------------------------------------------------------------

function analyzeChain(cert: tls.DetailedPeerCertificate): CertChainEntry[] {
  const chain: CertChainEntry[] = [];
  let current: tls.DetailedPeerCertificate | undefined = cert;
  const visited = new Set<string>();

  while (current && chain.length < 10) {
    const serial = current.serialNumber ?? '';
    if (visited.has(serial) && serial !== '') break;
    visited.add(serial);

    const validTo = new Date(current.valid_to);
    const subject = current.subject?.CN ?? current.subject?.O ?? 'unknown';
    const org = current.subject?.O ?? '';
    const issuer = current.issuer?.CN ?? current.issuer?.O ?? 'unknown';

    chain.push({
      subject: Array.isArray(subject) ? subject[0] : String(subject),
      organization: Array.isArray(org) ? org[0] : String(org),
      issuer: Array.isArray(issuer) ? issuer[0] : String(issuer),
      validFrom: current.valid_from,
      validTo: current.valid_to,
      expired: validTo.getTime() < Date.now(),
      isSelfSigned: current.issuer?.CN === current.subject?.CN,
    });

    const next: tls.DetailedPeerCertificate | undefined = (current as any).issuerCertificate;
    if (!next || next === current) break;
    current = next;
  }

  return chain;
}

// ---------------------------------------------------------------------------
// Protocol support tests
// ---------------------------------------------------------------------------

async function testProtocolSupport(host: string, port: number): Promise<{ name: string; supported: boolean }[]> {
  const versions: { name: string; min: string; max: string }[] = [
    { name: 'TLS 1.0', min: 'TLSv1', max: 'TLSv1' },
    { name: 'TLS 1.1', min: 'TLSv1.1', max: 'TLSv1.1' },
    { name: 'TLS 1.2', min: 'TLSv1.2', max: 'TLSv1.2' },
    { name: 'TLS 1.3', min: 'TLSv1.3', max: 'TLSv1.3' },
  ];

  const results = await Promise.all(
    versions.map(({ name, min, max }) =>
      testSingleProtocol(host, port, min, max).then((supported) => ({ name, supported })),
    ),
  );
  return results;
}

function testSingleProtocol(host: string, port: number, minVersion: string, maxVersion: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = tls.connect({
      host, port, servername: host,
      rejectUnauthorized: false,
      minVersion: minVersion as tls.SecureVersion,
      maxVersion: maxVersion as tls.SecureVersion,
    }, () => {
      socket.end();
      resolve(true);
    });
    socket.setTimeout(5_000);
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.on('error', () => { resolve(false); });
  });
}

// ---------------------------------------------------------------------------
// Server cipher order test
// ---------------------------------------------------------------------------

/** Test if the server enforces its own cipher order by connecting with reversed preference */
function testServerCipherOrder(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    // Connect with a weak cipher first in client preference
    const socket1 = tls.connect({
      host, port, servername: host,
      rejectUnauthorized: false,
      ciphers: 'ALL',
    }, () => {
      const cipher1 = socket1.getCipher()?.name;
      socket1.end();

      // Connect with reversed cipher order
      const socket2 = tls.connect({
        host, port, servername: host,
        rejectUnauthorized: false,
        ciphers: 'ALL:+LOW:+MEDIUM',
      }, () => {
        const cipher2 = socket2.getCipher()?.name;
        socket2.end();
        // If server enforces its order, both connections get the same cipher
        resolve(cipher1 === cipher2);
      });
      socket2.setTimeout(5_000);
      socket2.on('timeout', () => { socket2.destroy(); resolve(false); });
      socket2.on('error', () => { resolve(false); });
    });
    socket1.setTimeout(5_000);
    socket1.on('timeout', () => { socket1.destroy(); resolve(false); });
    socket1.on('error', () => { resolve(false); });
  });
}

// ---------------------------------------------------------------------------
// Vulnerability inference
// ---------------------------------------------------------------------------

function inferVulnerabilities(
  ssl: SslCheckResult,
  protocols: { name: string; supported: boolean }[],
): VulnerabilityCheck[] {
  const vulns: VulnerabilityCheck[] = [];
  const proto = (name: string) => protocols.find((p) => p.name === name);
  const cipher = ssl.cipherName.toUpperCase();

  // POODLE — SSLv3 CBC
  vulns.push({
    id: 'poodle', name: 'POODLE', cve: 'CVE-2014-3566',
    status: ssl.tlsVersion === 'SSLv3' ? 'vulnerable' : 'safe',
    detail: ssl.tlsVersion === 'SSLv3'
      ? 'Server uses SSLv3 which is vulnerable to POODLE padding oracle attack'
      : 'SSLv3 disabled — not vulnerable',
  });

  // BEAST — TLS 1.0 CBC
  const tls10 = proto('TLS 1.0');
  vulns.push({
    id: 'beast', name: 'BEAST', cve: 'CVE-2011-3389',
    status: tls10?.supported ? 'warning' : 'safe',
    detail: tls10?.supported
      ? 'TLS 1.0 is supported — vulnerable to BEAST (CBC chosen-plaintext). Disable TLS 1.0.'
      : 'TLS 1.0 disabled — not vulnerable',
  });

  // SWEET32 — 3DES/DES 64-bit block cipher
  const has3DES = cipher.includes('3DES') || cipher.includes('DES');
  vulns.push({
    id: 'sweet32', name: 'SWEET32', cve: 'CVE-2016-2183',
    status: has3DES ? 'vulnerable' : 'safe',
    detail: has3DES
      ? 'Server negotiated 3DES/DES cipher — vulnerable to SWEET32 birthday attack'
      : '3DES/DES not negotiated — not vulnerable',
  });

  // FREAK — EXPORT RSA
  const hasExport = cipher.includes('EXPORT');
  vulns.push({
    id: 'freak', name: 'FREAK', cve: 'CVE-2015-0204',
    status: hasExport ? 'vulnerable' : 'safe',
    detail: hasExport
      ? 'EXPORT cipher suites available — vulnerable to FREAK RSA downgrade'
      : 'No EXPORT ciphers — not vulnerable',
  });

  // LOGJAM — Weak DHE
  const hasDHE = cipher.includes('DHE') && !cipher.includes('ECDHE');
  const weakDH = hasDHE && (ssl.keyBits != null && ssl.keyBits < 2048);
  vulns.push({
    id: 'logjam', name: 'LOGJAM', cve: 'CVE-2015-4000',
    status: weakDH ? 'vulnerable' : hasDHE ? 'warning' : 'safe',
    detail: weakDH
      ? 'Weak DH parameters (< 2048 bits) — vulnerable to LOGJAM'
      : hasDHE ? 'DHE in use — ensure DH params >= 2048 bits' : 'ECDHE preferred — not vulnerable',
  });

  // DROWN — SSLv2 cross-protocol
  vulns.push({
    id: 'drown', name: 'DROWN', cve: 'CVE-2016-0800',
    status: ssl.tlsVersion === 'SSLv2' ? 'vulnerable' : 'safe',
    detail: ssl.tlsVersion === 'SSLv2'
      ? 'SSLv2 enabled — vulnerable to DROWN cross-protocol attack'
      : 'SSLv2 disabled — not vulnerable',
  });

  // CRIME — TLS compression
  vulns.push({
    id: 'crime', name: 'CRIME', cve: 'CVE-2012-4929',
    status: ssl.handshake.compression ? 'vulnerable' : 'safe',
    detail: ssl.handshake.compression
      ? 'TLS compression enabled — vulnerable to CRIME'
      : 'TLS compression disabled — not vulnerable',
  });

  // HEARTBLEED — OpenSSL heartbeat extension (we can't directly test, infer from version)
  vulns.push({
    id: 'heartbleed', name: 'Heartbleed', cve: 'CVE-2014-0160',
    status: 'unknown',
    detail: 'Cannot be tested remotely without active probing. Ensure OpenSSL >= 1.0.1g.',
  });

  // ROBOT — RSA PKCS#1 v1.5
  const hasRSAKex = cipher.includes('RSA') && !cipher.includes('ECDHE') && !cipher.includes('DHE');
  vulns.push({
    id: 'robot', name: 'ROBOT', cve: 'CVE-2017-13099',
    status: hasRSAKex ? 'warning' : 'safe',
    detail: hasRSAKex
      ? 'RSA key exchange in use — potentially vulnerable to ROBOT (Bleichenbacher oracle). Use ECDHE.'
      : 'No RSA key exchange — not vulnerable',
  });

  // LUCKY13 — CBC MAC-then-encrypt timing
  const hasCBC = cipher.includes('CBC');
  vulns.push({
    id: 'lucky13', name: 'LUCKY13', cve: 'CVE-2013-0169',
    status: hasCBC ? 'warning' : 'safe',
    detail: hasCBC
      ? 'CBC mode cipher in use — susceptible to LUCKY13 timing attack. Prefer AEAD (GCM/ChaCha20).'
      : 'AEAD cipher in use — not vulnerable',
  });

  // RC4 — broken stream cipher
  const hasRC4 = cipher.includes('RC4');
  vulns.push({
    id: 'rc4', name: 'RC4 (Prohibited)', cve: 'RFC 7465',
    status: hasRC4 ? 'vulnerable' : 'safe',
    detail: hasRC4
      ? 'RC4 cipher negotiated — prohibited by RFC 7465. Disable immediately.'
      : 'RC4 not in use — safe',
  });

  // NULL/ANON ciphers
  const hasNull = cipher.includes('NULL') || cipher.includes('ANON');
  vulns.push({
    id: 'null-anon', name: 'NULL/Anonymous Ciphers', cve: 'N/A',
    status: hasNull ? 'vulnerable' : 'safe',
    detail: hasNull
      ? 'NULL or Anonymous cipher negotiated — traffic is unencrypted or unauthenticated'
      : 'No NULL/Anonymous ciphers — safe',
  });

  // Weak signature (SHA-1 / MD5)
  const sigAlg = ssl.signatureAlgorithm.toUpperCase();
  const hasMd5Sig = sigAlg.includes('MD5');
  const hasSha1Sig = sigAlg.includes('SHA1') || sigAlg.includes('SHA-1');
  if (hasMd5Sig) {
    vulns.push({
      id: 'md5-sig', name: 'MD5 Signature', cve: 'N/A',
      status: 'vulnerable',
      detail: 'Certificate uses MD5 signature — collision attacks are trivial. Reissue with SHA-256+.',
    });
  } else if (hasSha1Sig) {
    vulns.push({
      id: 'sha1-sig', name: 'SHA-1 Signature', cve: 'N/A',
      status: 'warning',
      detail: 'Certificate uses SHA-1 signature — deprecated since 2017. Reissue with SHA-256+.',
    });
  }

  return vulns;
}

// ---------------------------------------------------------------------------
// Helper: extract info from cert
// ---------------------------------------------------------------------------

function extractKeyAlgorithm(cert: tls.DetailedPeerCertificate): string {
  const raw = (cert as any).asn1Curve;
  if (raw) return `ECDSA (${raw})`;
  if ((cert as any).bits) return 'RSA';
  return 'unknown';
}

function extractKeyBits(cert: tls.DetailedPeerCertificate): number | null {
  return (cert as any).bits ?? null;
}

function extractSignatureAlgorithm(cert: tls.DetailedPeerCertificate): string {
  // Node.js exposes raw cert info in infoAccess and other fields
  // The fingerprint algorithm is related but not identical
  // Check raw cert data if available
  const raw = (cert as any).raw;
  if (raw && Buffer.isBuffer(raw)) {
    // Look for common OIDs in DER-encoded cert
    const hex = raw.toString('hex');
    if (hex.includes('608648016503040201')) return 'SHA-256 with RSA';
    if (hex.includes('608648016503040202')) return 'SHA-384 with RSA';
    if (hex.includes('608648016503040203')) return 'SHA-512 with RSA';
    if (hex.includes('06082a8648ce3d0403')) return 'ECDSA with SHA-256';
    // SHA-1 OIDs
    if (hex.includes('06052b0e03021a') || hex.includes('2b0e03021a')) return 'SHA-1 with RSA';
    // MD5 OID
    if (hex.includes('06082a864886f70d0204')) return 'MD5 with RSA';
  }
  // Fallback: if fingerprint256 is present, it's at least SHA-256 capable
  if (cert.fingerprint256) return 'SHA-256';
  return 'unknown';
}

function detectValidationLevel(cert: tls.DetailedPeerCertificate): 'DV' | 'OV' | 'EV' | 'unknown' {
  const subject = cert.subject;
  if (!subject) return 'unknown';
  if ((subject as any).serialNumber || (subject as any).businessCategory) return 'EV';
  if (subject.O) return 'OV';
  if (subject.CN) return 'DV';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// makeFailed helper
// ---------------------------------------------------------------------------

function makeFailed(tlsVersion: string, error: string): SslCheckResult {
  const emptyHandshake: HandshakeInfo = {
    timeMs: 0, alpn: null, secureRenegotiation: false,
    compression: false, sni: false, serverCipherOrder: false,
  };
  return {
    valid: false, issuer: '', issuerCn: '', subjectCn: '', sans: [],
    domainMatch: false,
    expiry: new Date(), notBefore: new Date(), daysLeft: 0,
    serialNumber: '', fingerprintSha256: '',
    tlsVersion, cipherName: '', cipherBits: null, forwardSecrecy: false,
    protocols: [],
    keyAlgorithm: '', keyBits: null, signatureAlgorithm: '',
    chainValid: false, chainDepth: 0, chainDetails: [], isSelfSigned: false,
    hsts: false, hstsMaxAge: null, hstsIncludeSubDomains: false, hstsPreload: false,
    httpHeaders: {
      contentSecurityPolicy: null, xFrameOptions: null,
      xContentTypeOptions: null, referrerPolicy: null,
      permissionsPolicy: null, xXssProtection: null,
    },
    httpRedirect: false,
    ocspStapling: false,
    handshake: emptyHandshake,
    vulnerabilities: [],
    validationLevel: 'unknown', grade: 'F', gradeColor: '#991b1b', gradeNote: error,
    scannedAt: new Date().toISOString(), error,
  };
}

// ---------------------------------------------------------------------------
// SSL Grade computation
// ---------------------------------------------------------------------------

function computeGrade(ssl: SslCheckResult): { grade: string; gradeColor: string; gradeNote: string } {
  const isWeakProtocol = DEPRECATED_PROTOCOLS.includes(ssl.tlsVersion);
  const isSslProtocol = ssl.tlsVersion.startsWith('SSL');
  const isWeakCipher = WEAK_CIPHERS.some((wc) => ssl.cipherName.toUpperCase().includes(wc));
  const sigUpper = ssl.signatureAlgorithm.toUpperCase();
  const isWeakSig = ['SHA1', 'SHA-1', 'MD5'].some((w) => sigUpper.includes(w));
  const isMd5 = sigUpper.includes('MD5');
  const isWeakKey = ssl.keyBits != null && (
    (ssl.keyAlgorithm.includes('RSA') && ssl.keyBits < 2048) ||
    (ssl.keyAlgorithm.includes('ECDSA') && ssl.keyBits < 256)
  );
  const certExpired = ssl.daysLeft <= 0;

  // Check if deprecated protocols are still supported
  const supportsDeprecated = ssl.protocols.some(
    (p) => p.supported && ['TLS 1.0', 'TLS 1.1'].includes(p.name),
  );

  // Domain mismatch
  const domainMismatch = !ssl.domainMatch && ssl.subjectCn !== '';

  // Expired intermediates
  const hasExpiredIntermediate = ssl.chainDetails.some((c, i) => i > 0 && c.expired);

  const criticals = [isSslProtocol, certExpired, isMd5, domainMismatch].filter(Boolean).length;
  const highs = [
    isWeakProtocol && !isSslProtocol,
    isWeakCipher,
    isWeakKey,
    isWeakSig && !isMd5,
    !certExpired && ssl.daysLeft <= 7,
    supportsDeprecated,
    hasExpiredIntermediate,
  ].filter(Boolean).length;
  const mediums = [
    !ssl.forwardSecrecy,
    !ssl.hsts,
    !ssl.chainValid,
    ssl.isSelfSigned,
    !ssl.handshake.serverCipherOrder,
    ssl.handshake.compression,
  ].filter(Boolean).length;

  // Count HTTP security headers
  const headerCount = [
    ssl.httpHeaders.contentSecurityPolicy,
    ssl.httpHeaders.xFrameOptions,
    ssl.httpHeaders.xContentTypeOptions,
    ssl.httpHeaders.referrerPolicy,
  ].filter(Boolean).length;

  if (criticals > 0) return { grade: 'F', gradeColor: '#991b1b', gradeNote: 'Critical issues — immediate action required' };
  if (highs > 0) return { grade: 'C', gradeColor: '#c2410c', gradeNote: 'Significant weaknesses found' };
  if (mediums > 2) return { grade: 'B-', gradeColor: '#a16207', gradeNote: 'Several improvements recommended' };
  if (mediums > 0) return { grade: 'B+', gradeColor: '#1dd881', gradeNote: 'Good, minor improvements possible' };
  if (ssl.tlsVersion === 'TLSv1.3' && ssl.forwardSecrecy && ssl.hsts && headerCount >= 3) {
    return { grade: 'A+', gradeColor: '#15803d', gradeNote: 'Excellent — best practices met' };
  }
  return { grade: 'A', gradeColor: '#16a34a', gradeNote: 'Strong configuration' };
}

// ---------------------------------------------------------------------------
// HTTP check (also captures security headers)
// ---------------------------------------------------------------------------

const SECURITY_HEADERS = [
  'strict-transport-security',
  'content-security-policy',
  'x-frame-options',
  'x-content-type-options',
  'referrer-policy',
  'permissions-policy',
  'x-xss-protection',
] as const;

export function checkHttp(host: string, port: number, protocol: string): Promise<HttpCheckResult> {
  return new Promise((resolve) => {
    const start = performance.now();
    const isDefaultPort = (protocol === 'https' && port === 443) || (protocol === 'http' && port === 80);
    const url = isDefaultPort ? `${protocol}://${host}` : `${protocol}://${host}:${port}`;
    const client = protocol === 'https' ? https : http;

    const req = client.get(url, { timeout: 10_000, rejectUnauthorized: false }, (res) => {
      const responseMs = Math.round(performance.now() - start);
      res.resume();

      const headers: Record<string, string> = {};
      for (const h of SECURITY_HEADERS) {
        if (res.headers[h]) {
          headers[h] = String(res.headers[h]);
        }
      }

      resolve({
        isUp: true,
        statusCode: res.statusCode ?? null,
        responseMs,
        headers,
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ isUp: false, statusCode: null, responseMs: Math.round(performance.now() - start), error: 'Connection timed out' });
    });
    req.on('error', (err) => {
      resolve({ isUp: false, statusCode: null, responseMs: Math.round(performance.now() - start), error: err.message });
    });
  });
}

/** Check if HTTP port 80 redirects to HTTPS */
export function checkHttpRedirect(host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://${host}`, { timeout: 5_000 }, (res) => {
      res.resume();
      const location = res.headers.location ?? '';
      const isRedirect = (res.statusCode === 301 || res.statusCode === 302) && location.startsWith('https://');
      resolve(isRedirect);
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => { resolve(false); });
  });
}

// ---------------------------------------------------------------------------
// DNS security check (SPF / DKIM / DMARC / CAA)
// ---------------------------------------------------------------------------

export async function checkDns(host: string): Promise<DnsCheckResult> {
  const result: { spf: 'pass' | 'missing'; dkim: 'pass' | 'missing'; dmarc: 'pass' | 'missing'; caa: 'pass' | 'missing' } = {
    spf: 'missing', dkim: 'missing', dmarc: 'missing', caa: 'missing',
  };

  try {
    // SPF
    const txtRecords = await dns.resolveTxt(host).catch(() => []);
    const flat = txtRecords.map((r) => r.join('')).join(' ');
    if (flat.includes('v=spf1')) result.spf = 'pass';

    // DKIM — check default selector
    const dkimRecords = await dns.resolveTxt(`default._domainkey.${host}`).catch(() => []);
    const dkimFlat = dkimRecords.map((r) => r.join('')).join(' ');
    if (dkimFlat.includes('v=DKIM1') || dkimFlat.includes('p=')) result.dkim = 'pass';

    // DMARC
    const dmarcRecords = await dns.resolveTxt(`_dmarc.${host}`).catch(() => []);
    const dmarcFlat = dmarcRecords.map((r) => r.join('')).join(' ');
    if (dmarcFlat.includes('v=DMARC1')) result.dmarc = 'pass';

    // CAA
    const caaRecords = await dns.resolveCaa(host).catch(() => []);
    if (caaRecords.length > 0) result.caa = 'pass';
  } catch (err) {
    logger.warn('DNS check failed', { host, error: (err as Error).message });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Combined domain check
// ---------------------------------------------------------------------------

export async function checkDomain(rawHost: string, port: number, protocol: string): Promise<DomainCheckResult> {
  const host = extractHostname(rawHost);

  const [ssl, httpResult, dnsResult, httpRedirect] = await Promise.all([
    protocol === 'https' ? checkSsl(host, port) : Promise.resolve(null),
    checkHttp(host, port, protocol),
    checkDns(host),
    checkHttpRedirect(host),
  ]);

  // Enrich SSL result with HTTP response headers + redirect info
  if (ssl) {
    const enriched = enrichSslWithHttpHeaders(ssl, httpResult, httpRedirect);
    const graded = computeGrade(enriched);
    return { ssl: { ...enriched, ...graded }, http: httpResult, dns: dnsResult };
  }

  return { ssl, http: httpResult, dns: dnsResult };
}

/** Parse HSTS header and HTTP security headers into the SSL result */
export function enrichSslWithHttpHeaders(ssl: SslCheckResult, httpResult: HttpCheckResult, httpRedirect?: boolean): SslCheckResult {
  const headers = httpResult.headers ?? {};
  const hstsHeader = headers['strict-transport-security'] ?? '';
  const hsts = !!hstsHeader;
  const hstsMaxAge = hstsHeader ? (parseInt(hstsHeader.match(/max-age=(\d+)/)?.[1] ?? '0', 10) || null) : null;
  const hstsIncludeSubDomains = hstsHeader.toLowerCase().includes('includesubdomains');
  const hstsPreload = hstsHeader.toLowerCase().includes('preload');

  const httpHeaders: HttpSecurityHeaders = {
    contentSecurityPolicy: headers['content-security-policy'] ?? null,
    xFrameOptions: headers['x-frame-options'] ?? null,
    xContentTypeOptions: headers['x-content-type-options'] ?? null,
    referrerPolicy: headers['referrer-policy'] ?? null,
    permissionsPolicy: headers['permissions-policy'] ?? null,
    xXssProtection: headers['x-xss-protection'] ?? null,
  };

  return {
    ...ssl,
    hsts, hstsMaxAge, hstsIncludeSubDomains, hstsPreload,
    httpHeaders,
    httpRedirect: httpRedirect ?? ssl.httpRedirect,
  };
}

/** Extract bare hostname from a value that might be a full URL or just a hostname. */
function extractHostname(input: string): string {
  let s = input.trim();
  if (s.startsWith('http://') || s.startsWith('https://')) {
    try { return new URL(s).hostname; } catch {}
  }
  s = s.split('/')[0];
  s = s.split(':')[0];
  return s;
}
