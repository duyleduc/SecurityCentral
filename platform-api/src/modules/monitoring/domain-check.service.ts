import tls from 'node:tls';
import https from 'node:https';
import http from 'node:http';
import dns from 'node:dns/promises';

import { logger } from '../../lib/logger.js';

export interface SslCheckResult {
  readonly valid: boolean;
  readonly issuer: string;
  readonly expiry: Date;
  readonly daysLeft: number;
  readonly tlsVersion: string;
  readonly error?: string;
}

export interface HttpCheckResult {
  readonly isUp: boolean;
  readonly statusCode: number | null;
  readonly responseMs: number;
  readonly error?: string;
}

export interface DnsCheckResult {
  readonly spf: 'pass' | 'missing';
  readonly dkim: 'pass' | 'missing';
  readonly dmarc: 'pass' | 'missing';
}

export interface DomainCheckResult {
  readonly ssl: SslCheckResult | null;
  readonly http: HttpCheckResult;
  readonly dns: DnsCheckResult;
}

// ---------------------------------------------------------------------------
// SSL/TLS check
// ---------------------------------------------------------------------------

export function checkSsl(host: string, port: number): Promise<SslCheckResult> {
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false }, () => {
      try {
        const cert = socket.getPeerCertificate();
        const protocol = socket.getProtocol() ?? 'unknown';
        socket.end();

        if (!cert || !cert.valid_to) {
          resolve({
            valid: false,
            issuer: '',
            expiry: new Date(),
            daysLeft: 0,
            tlsVersion: protocol,
            error: 'No certificate found',
          });
          return;
        }

        const expiry = new Date(cert.valid_to);
        const daysLeft = Math.floor((expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        const issuerStr = cert.issuer
          ? Object.entries(cert.issuer).map(([k, v]) => `${k}=${v}`).join(', ')
          : 'unknown';

        resolve({
          valid: daysLeft > 0 && socket.authorized,
          issuer: issuerStr,
          expiry,
          daysLeft,
          tlsVersion: protocol,
        });
      } catch (err) {
        socket.end();
        resolve({
          valid: false,
          issuer: '',
          expiry: new Date(),
          daysLeft: 0,
          tlsVersion: 'unknown',
          error: (err as Error).message,
        });
      }
    });

    socket.setTimeout(10_000);
    socket.on('timeout', () => {
      socket.destroy();
      resolve({
        valid: false,
        issuer: '',
        expiry: new Date(),
        daysLeft: 0,
        tlsVersion: 'unknown',
        error: 'Connection timed out',
      });
    });
    socket.on('error', (err) => {
      resolve({
        valid: false,
        issuer: '',
        expiry: new Date(),
        daysLeft: 0,
        tlsVersion: 'unknown',
        error: err.message,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// HTTP uptime check
// ---------------------------------------------------------------------------

export function checkHttp(host: string, port: number, protocol: string): Promise<HttpCheckResult> {
  return new Promise((resolve) => {
    const start = performance.now();
    const isDefaultPort = (protocol === 'https' && port === 443) || (protocol === 'http' && port === 80);
    const url = isDefaultPort ? `${protocol}://${host}` : `${protocol}://${host}:${port}`;
    const client = protocol === 'https' ? https : http;

    const req = client.get(url, { timeout: 10_000, rejectUnauthorized: false }, (res) => {
      const responseMs = Math.round(performance.now() - start);
      // Consume response body to free resources
      res.resume();
      resolve({
        isUp: true,
        statusCode: res.statusCode ?? null,
        responseMs,
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        isUp: false,
        statusCode: null,
        responseMs: Math.round(performance.now() - start),
        error: 'Connection timed out',
      });
    });

    req.on('error', (err) => {
      resolve({
        isUp: false,
        statusCode: null,
        responseMs: Math.round(performance.now() - start),
        error: err.message,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// DNS security check (SPF / DKIM / DMARC)
// ---------------------------------------------------------------------------

export async function checkDns(host: string): Promise<DnsCheckResult> {
  const result: DnsCheckResult = { spf: 'missing', dkim: 'missing', dmarc: 'missing' };

  try {
    // SPF — look for "v=spf1" in TXT records
    const txtRecords = await dns.resolveTxt(host).catch(() => []);
    const flat = txtRecords.map((r) => r.join('')).join(' ');
    if (flat.includes('v=spf1')) {
      (result as { spf: string }).spf = 'pass';
    }

    // DKIM — check default selector
    const dkimRecords = await dns.resolveTxt(`default._domainkey.${host}`).catch(() => []);
    const dkimFlat = dkimRecords.map((r) => r.join('')).join(' ');
    if (dkimFlat.includes('v=DKIM1') || dkimFlat.includes('p=')) {
      (result as { dkim: string }).dkim = 'pass';
    }

    // DMARC — check _dmarc subdomain
    const dmarcRecords = await dns.resolveTxt(`_dmarc.${host}`).catch(() => []);
    const dmarcFlat = dmarcRecords.map((r) => r.join('')).join(' ');
    if (dmarcFlat.includes('v=DMARC1')) {
      (result as { dmarc: string }).dmarc = 'pass';
    }
  } catch (err) {
    logger.warn('DNS check failed', { host, error: (err as Error).message });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Combined domain check
// ---------------------------------------------------------------------------

export async function checkDomain(rawHost: string, port: number, protocol: string): Promise<DomainCheckResult> {
  // Extract bare hostname — users may enter full URLs like "https://example.com/path"
  const host = extractHostname(rawHost);

  const [ssl, httpResult, dnsResult] = await Promise.all([
    protocol === 'https' ? checkSsl(host, port) : Promise.resolve(null),
    checkHttp(host, port, protocol),
    checkDns(host),
  ]);

  return { ssl, http: httpResult, dns: dnsResult };
}

/** Extract bare hostname from a value that might be a full URL or just a hostname. */
function extractHostname(input: string): string {
  let s = input.trim();
  // If it looks like a URL, parse it
  if (s.startsWith('http://') || s.startsWith('https://')) {
    try {
      return new URL(s).hostname;
    } catch {
      // fallthrough
    }
  }
  // Strip trailing slashes and paths
  s = s.split('/')[0];
  // Strip port if present
  s = s.split(':')[0];
  return s;
}
