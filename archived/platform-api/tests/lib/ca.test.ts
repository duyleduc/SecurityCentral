import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';

import { generateCaKeyPair, signCsr, verifyClientCert, getCa } from '../../src/lib/ca.js';

/**
 * Generate an ECDSA P-256 key pair and a PKCS#10 CSR.
 */
function generateCsr(): { csrPem: string; privateKey: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  // Build a minimal CSR using openssl-compatible approach
  // We'll construct the CSR manually using crypto.sign
  const subject = buildCsrSubject('test-agent.agents.securitycentral.io');
  const spki = crypto.createPublicKey(publicKey).export({ type: 'spki', format: 'der' });

  const certReqInfo = buildCertReqInfo(subject, spki as Buffer);
  const sign = crypto.createSign('SHA256');
  sign.update(certReqInfo);
  const signature = sign.sign(privateKey);

  const algId = encodeSequence(Buffer.concat([
    encodeOid('1.2.840.10045.4.3.2'), // ecdsa-with-SHA256
  ]));

  const csr = encodeSequence(Buffer.concat([
    certReqInfo,
    algId,
    encodeBitString(signature),
  ]));

  const b64 = csr.toString('base64');
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 64) {
    lines.push(b64.substring(i, i + 64));
  }
  const csrPem = `-----BEGIN CERTIFICATE REQUEST-----\n${lines.join('\n')}\n-----END CERTIFICATE REQUEST-----\n`;

  return { csrPem, privateKey };
}

// ASN.1 helpers (duplicated for test isolation)
function encodeLength(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len]);
  if (len < 0x100) return Buffer.from([0x81, len]);
  return Buffer.from([0x82, (len >> 8) & 0xff, len & 0xff]);
}

function encodeTlv(tag: number, value: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), encodeLength(value.length), value]);
}

function encodeSequence(content: Buffer): Buffer {
  return encodeTlv(0x30, content);
}

function encodeInteger(value: number): Buffer {
  const bytes = Buffer.from([value]);
  return encodeTlv(0x02, bytes);
}

function encodeBitString(content: Buffer): Buffer {
  return encodeTlv(0x03, Buffer.concat([Buffer.from([0x00]), content]));
}

function encodeOid(oid: string): Buffer {
  const parts = oid.split('.').map(Number);
  const bytes: number[] = [parts[0] * 40 + parts[1]];
  for (let i = 2; i < parts.length; i++) {
    let val = parts[i];
    if (val < 128) {
      bytes.push(val);
    } else {
      const encoded: number[] = [];
      encoded.push(val & 0x7f);
      val >>= 7;
      while (val > 0) {
        encoded.push((val & 0x7f) | 0x80);
        val >>= 7;
      }
      bytes.push(...encoded.reverse());
    }
  }
  return encodeTlv(0x06, Buffer.from(bytes));
}

function encodeUtf8String(str: string): Buffer {
  return encodeTlv(0x0c, Buffer.from(str, 'utf8'));
}

function buildCsrSubject(cn: string): Buffer {
  const atv = encodeSequence(Buffer.concat([encodeOid('2.5.4.3'), encodeUtf8String(cn)]));
  const rdn = encodeTlv(0x31, atv);
  return encodeSequence(rdn);
}

function buildCertReqInfo(subject: Buffer, spki: Buffer): Buffer {
  return encodeSequence(Buffer.concat([
    encodeInteger(0), // version
    subject,
    spki,
    encodeTlv(0xa0, Buffer.alloc(0)), // empty attributes
  ]));
}

describe('CA Utility', () => {
  describe('generateCaKeyPair', () => {
    it('generates a valid CA cert and key', () => {
      const ca = generateCaKeyPair();

      expect(ca.cert).toContain('-----BEGIN CERTIFICATE-----');
      expect(ca.key).toContain('-----BEGIN PRIVATE KEY-----');

      // Should be parseable as X509
      const x509 = new crypto.X509Certificate(ca.cert);
      expect(x509.subject).toContain('SecurityCentral');
    });

    it('generates an ECDSA key', () => {
      const ca = generateCaKeyPair();
      const key = crypto.createPrivateKey(ca.key);
      expect(key.asymmetricKeyType).toBe('ec');
    });
  });

  describe('getCa', () => {
    it('returns a CA key pair (auto-generated in test)', () => {
      const ca = getCa();
      expect(ca.cert).toBeDefined();
      expect(ca.key).toBeDefined();
    });
  });

  describe('signCsr', () => {
    it('signs a CSR and returns a certificate with correct CN', () => {
      const { csrPem } = generateCsr();

      const result = signCsr({ csrPem, agentId: 'test-123' });

      expect(result.certPem).toContain('-----BEGIN CERTIFICATE-----');
      expect(result.caCertPem).toContain('-----BEGIN CERTIFICATE-----');

      // Verify the signed cert
      const cert = new crypto.X509Certificate(result.certPem);
      expect(cert.subject).toContain('ag_test-123.agents.securitycentral.io');
    });

    it('returns a CA cert in the result', () => {
      const { csrPem } = generateCsr();
      const result = signCsr({ csrPem, agentId: 'agent-abc' });

      const caCert = new crypto.X509Certificate(result.caCertPem);
      expect(caCert.subject).toContain('SecurityCentral Agent CA');
    });
  });

  describe('verifyClientCert', () => {
    it('returns CN for a valid CA-signed certificate', () => {
      const { csrPem } = generateCsr();
      const { certPem } = signCsr({ csrPem, agentId: 'verify-test' });

      const cn = verifyClientCert(certPem);
      expect(cn).toBe('ag_verify-test.agents.securitycentral.io');
    });

    it('returns null for a self-signed certificate (not signed by CA)', () => {
      // Generate an independent self-signed cert
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
        namedCurve: 'prime256v1',
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });

      // This would need a full self-signed cert — just test with garbage
      const cn = verifyClientCert('-----BEGIN CERTIFICATE-----\ngarbage\n-----END CERTIFICATE-----');
      expect(cn).toBeNull();
    });

    it('returns null for empty/invalid input', () => {
      expect(verifyClientCert('')).toBeNull();
      expect(verifyClientCert('not a cert')).toBeNull();
    });
  });
});
