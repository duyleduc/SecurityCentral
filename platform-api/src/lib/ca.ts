import crypto from 'node:crypto';

import { env } from './env.js';
import { logger } from './logger.js';

const log = logger.child({ component: 'ca' });

// ---------------------------------------------------------------------------
// CA key pair — loaded from env or auto-generated for development
// ---------------------------------------------------------------------------

interface CaKeyPair {
  readonly cert: string;   // PEM
  readonly key: string;    // PEM
}

let caKeyPair: CaKeyPair | null = null;

/**
 * Get or initialize the CA key pair.
 * In production: loaded from AGENT_CA_CERT / AGENT_CA_KEY env vars.
 * In development/test: auto-generated self-signed CA.
 */
export function getCa(): CaKeyPair {
  if (caKeyPair) return caKeyPair;

  if (env.AGENT_CA_CERT && env.AGENT_CA_KEY) {
    caKeyPair = { cert: env.AGENT_CA_CERT, key: env.AGENT_CA_KEY };
    log.info('Loaded CA from environment variables');
    return caKeyPair;
  }

  caKeyPair = generateCaKeyPair();
  log.info('Auto-generated CA key pair for development');
  return caKeyPair;
}

/** Reset the cached CA (useful for testing). */
export function resetCa(): void {
  caKeyPair = null;
}

/**
 * Generate a self-signed CA key pair (ECDSA P-256).
 */
export function generateCaKeyPair(): CaKeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const certDer = buildX509({
    subject: 'CN=SecurityCentral Agent CA,O=SecurityCentral',
    issuer: 'CN=SecurityCentral Agent CA,O=SecurityCentral',
    serialNumber: crypto.randomBytes(16).toString('hex'),
    notBefore: new Date(),
    notAfter: new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000),
    publicKeyPem: publicKey,
    privateKeyPem: privateKey,
    isCA: true,
  });

  return { cert: bufToPem(certDer, 'CERTIFICATE'), key: privateKey };
}

// ---------------------------------------------------------------------------
// CSR Signing
// ---------------------------------------------------------------------------

export interface SignCsrOptions {
  readonly csrPem: string;
  readonly agentId: string;
}

export interface SignedCertResult {
  readonly certPem: string;
  readonly caCertPem: string;
}

/**
 * Sign a PKCS#10 CSR with the platform CA.
 * CN: ag_<agentId>.agents.securitycentral.io, Validity: 1 year.
 */
export function signCsr(options: SignCsrOptions): SignedCertResult {
  const ca = getCa();
  const { csrPem, agentId } = options;

  const cn = `ag_${agentId}.agents.securitycentral.io`;
  const publicKeyPem = extractPublicKeyFromCsr(csrPem);

  const certDer = buildX509({
    subject: `CN=${cn}`,
    issuer: 'CN=SecurityCentral Agent CA,O=SecurityCentral',
    serialNumber: crypto.randomBytes(16).toString('hex'),
    notBefore: new Date(),
    notAfter: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    publicKeyPem,
    privateKeyPem: ca.key,
    isCA: false,
  });

  return { certPem: bufToPem(certDer, 'CERTIFICATE'), caCertPem: ca.cert };
}

// ---------------------------------------------------------------------------
// Verify client certificate
// ---------------------------------------------------------------------------

export function verifyClientCert(certPem: string): string | null {
  try {
    const ca = getCa();
    const clientCert = new crypto.X509Certificate(certPem);
    const caCert = new crypto.X509Certificate(ca.cert);

    if (!clientCert.checkIssued(caCert)) return null;

    const now = new Date();
    if (now < new Date(clientCert.validFrom) || now > new Date(clientCert.validTo)) return null;

    const cnMatch = clientCert.subject.match(/CN=([^,\n]+)/);
    return cnMatch?.[1] ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// PEM helper
// ---------------------------------------------------------------------------

function bufToPem(der: Buffer, label: string): string {
  const b64 = der.toString('base64');
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 64) lines.push(b64.substring(i, i + 64));
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

// ---------------------------------------------------------------------------
// X.509 DER builder
// ---------------------------------------------------------------------------

interface X509Options {
  readonly subject: string;
  readonly issuer: string;
  readonly serialNumber: string;
  readonly notBefore: Date;
  readonly notAfter: Date;
  readonly publicKeyPem: string;
  readonly privateKeyPem: string;
  readonly isCA: boolean;
}

function buildX509(opts: X509Options): Buffer {
  const privateKey = crypto.createPrivateKey(opts.privateKeyPem);
  const publicKey = crypto.createPublicKey(opts.publicKeyPem);

  const tbs = buildTbs(opts, publicKey);
  const sign = crypto.createSign('SHA256');
  sign.update(tbs);
  const signature = sign.sign(privateKey);

  return seq(Buffer.concat([tbs, ecdsaSha256Algo(), bitStr(signature)]));
}

function buildTbs(opts: X509Options, pubKey: crypto.KeyObject): Buffer {
  const parts: Buffer[] = [];
  parts.push(ctxTag(0, intVal(2)));                                // version v3
  parts.push(intVal(BigInt('0x' + opts.serialNumber)));            // serial
  parts.push(ecdsaSha256Algo());                                   // sig algo
  parts.push(dn(opts.issuer));                                     // issuer
  parts.push(seq(Buffer.concat([utcTime(opts.notBefore), utcTime(opts.notAfter)]))); // validity
  parts.push(dn(opts.subject));                                    // subject
  parts.push(pubKey.export({ type: 'spki', format: 'der' }) as Buffer); // SPKI
  // Extensions
  const exts = [ext('2.5.29.19', true, seq(opts.isCA ? boolVal(true) : Buffer.alloc(0)))];
  parts.push(ctxTag(3, seq(Buffer.concat(exts))));
  return seq(Buffer.concat(parts));
}

// ASN.1 primitives
function len(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  if (n < 0x100) return Buffer.from([0x81, n]);
  return Buffer.from([0x82, (n >> 8) & 0xff, n & 0xff]);
}
function tlv(tag: number, v: Buffer): Buffer { return Buffer.concat([Buffer.from([tag]), len(v.length), v]); }
function seq(c: Buffer): Buffer { return tlv(0x30, c); }
function intVal(v: number | bigint): Buffer {
  const h = v.toString(16).padStart(2, '0');
  const p = h.length % 2 ? '0' + h : h;
  const b = Buffer.from(p, 'hex');
  return (b[0] & 0x80) ? tlv(0x02, Buffer.concat([Buffer.from([0]), b])) : tlv(0x02, b);
}
function boolVal(v: boolean): Buffer { return tlv(0x01, Buffer.from([v ? 0xff : 0])); }
function bitStr(c: Buffer): Buffer { return tlv(0x03, Buffer.concat([Buffer.from([0]), c])); }
function oid(s: string): Buffer {
  const p = s.split('.').map(Number);
  const b: number[] = [p[0] * 40 + p[1]];
  for (let i = 2; i < p.length; i++) {
    let v = p[i];
    if (v < 128) { b.push(v); } else {
      const e: number[] = [v & 0x7f]; v >>= 7;
      while (v > 0) { e.push((v & 0x7f) | 0x80); v >>= 7; }
      b.push(...e.reverse());
    }
  }
  return tlv(0x06, Buffer.from(b));
}
function utf8(s: string): Buffer { return tlv(0x0c, Buffer.from(s, 'utf8')); }
function utcTime(d: Date): Buffer {
  const s = d.getUTCFullYear().toString().slice(-2)
    + (d.getUTCMonth()+1).toString().padStart(2,'0')
    + d.getUTCDate().toString().padStart(2,'0')
    + d.getUTCHours().toString().padStart(2,'0')
    + d.getUTCMinutes().toString().padStart(2,'0')
    + d.getUTCSeconds().toString().padStart(2,'0') + 'Z';
  return tlv(0x17, Buffer.from(s, 'ascii'));
}
function ctxTag(t: number, c: Buffer): Buffer { return tlv(0xa0 | t, c); }
function ecdsaSha256Algo(): Buffer { return seq(oid('1.2.840.10045.4.3.2')); }
function ext(o: string, crit: boolean, val: Buffer): Buffer {
  const p = [oid(o)];
  if (crit) p.push(boolVal(true));
  p.push(tlv(0x04, val));
  return seq(Buffer.concat(p));
}
function dn(s: string): Buffer {
  const rdns: Buffer[] = [];
  for (const part of s.split(',').map((x) => x.trim())) {
    const [k, ...r] = part.split('=');
    const v = r.join('=');
    const o = k === 'CN' ? '2.5.4.3' : k === 'O' ? '2.5.4.10' : '2.5.4.3';
    rdns.push(tlv(0x31, seq(Buffer.concat([oid(o), utf8(v)]))));
  }
  return seq(Buffer.concat(rdns));
}

// ---------------------------------------------------------------------------
// CSR parsing — extract public key from PKCS#10 CSR
// ---------------------------------------------------------------------------

function extractPublicKeyFromCsr(csrPem: string): string {
  const b64 = csrPem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  const der = Buffer.from(b64, 'base64');
  const outer = seqContent(der);
  const inner = seqContent(outer);
  let off = skipTlv(inner, 0); // skip version
  off = skipTlv(inner, off);   // skip subject
  const spkiEnd = skipTlv(inner, off);
  return bufToPem(inner.subarray(off, spkiEnd), 'PUBLIC KEY');
}

function seqContent(buf: Buffer): Buffer {
  if (buf[0] !== 0x30) throw new Error('Expected SEQUENCE');
  const { length, end } = readLen(buf, 1);
  return buf.subarray(end, end + length);
}
function readLen(buf: Buffer, off: number): { length: number; end: number } {
  const f = buf[off];
  if (f < 0x80) return { length: f, end: off + 1 };
  const n = f & 0x7f;
  let l = 0;
  for (let i = 0; i < n; i++) l = (l << 8) | buf[off + 1 + i];
  return { length: l, end: off + 1 + n };
}
function skipTlv(buf: Buffer, off: number): number {
  const { length, end } = readLen(buf, off + 1);
  return end + length;
}
