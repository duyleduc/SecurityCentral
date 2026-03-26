import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

import { errorHandler } from '../../src/middleware/errors.js';
import { requireMtls } from '../../src/middleware/mtls.js';
import { signCsr, getCa } from '../../src/lib/ca.js';
import crypto from 'node:crypto';

// Generate a test CSR and signed cert for tests
function getSignedCert(agentId = 'test-agent') {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const spki = crypto.createPublicKey(publicKey).export({ type: 'spki', format: 'der' });
  const subject = buildCsrSubject('test');
  const certReqInfo = buildCertReqInfo(subject, spki as Buffer);
  const sign = crypto.createSign('SHA256');
  sign.update(certReqInfo);
  const signature = sign.sign(privateKey);

  const algId = encodeSequence(encodeOid('1.2.840.10045.4.3.2'));
  const csr = encodeSequence(Buffer.concat([certReqInfo, algId, encodeBitString(signature)]));
  const b64 = csr.toString('base64');
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 64) lines.push(b64.substring(i, i + 64));
  const csrPem = `-----BEGIN CERTIFICATE REQUEST-----\n${lines.join('\n')}\n-----END CERTIFICATE REQUEST-----\n`;

  return signCsr({ csrPem, agentId });
}

// ASN.1 helpers
function encodeLength(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len]);
  if (len < 0x100) return Buffer.from([0x81, len]);
  return Buffer.from([0x82, (len >> 8) & 0xff, len & 0xff]);
}
function encodeTlv(tag: number, value: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), encodeLength(value.length), value]);
}
function encodeSequence(content: Buffer): Buffer { return encodeTlv(0x30, content); }
function encodeInteger(value: number): Buffer { return encodeTlv(0x02, Buffer.from([value])); }
function encodeBitString(content: Buffer): Buffer { return encodeTlv(0x03, Buffer.concat([Buffer.from([0x00]), content])); }
function encodeOid(oid: string): Buffer {
  const parts = oid.split('.').map(Number);
  const bytes: number[] = [parts[0] * 40 + parts[1]];
  for (let i = 2; i < parts.length; i++) {
    let val = parts[i];
    if (val < 128) { bytes.push(val); } else {
      const enc: number[] = []; enc.push(val & 0x7f); val >>= 7;
      while (val > 0) { enc.push((val & 0x7f) | 0x80); val >>= 7; }
      bytes.push(...enc.reverse());
    }
  }
  return encodeTlv(0x06, Buffer.from(bytes));
}
function encodeUtf8String(str: string): Buffer { return encodeTlv(0x0c, Buffer.from(str, 'utf8')); }
function buildCsrSubject(cn: string): Buffer {
  const atv = encodeSequence(Buffer.concat([encodeOid('2.5.4.3'), encodeUtf8String(cn)]));
  return encodeSequence(encodeTlv(0x31, atv));
}
function buildCertReqInfo(subject: Buffer, spki: Buffer): Buffer {
  return encodeSequence(Buffer.concat([encodeInteger(0), subject, spki, encodeTlv(0xa0, Buffer.alloc(0))]));
}

function createApp() {
  const app = express();
  app.get('/agents/test', requireMtls, (req, res) => {
    res.json({ cn: req.agentCn });
  });
  app.use(errorHandler);
  return app;
}

describe('mTLS Middleware', () => {
  it('rejects requests without client cert', async () => {
    const res = await request(createApp()).get('/agents/test');
    expect(res.status).toBe(401);
    expect(res.body.errors[0].code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('accepts request with valid X-Client-Cert header', async () => {
    const { certPem } = getSignedCert('header-agent');

    const res = await request(createApp())
      .get('/agents/test')
      .set('X-Client-Cert', encodeURIComponent(certPem));

    expect(res.status).toBe(200);
    expect(res.body.cn).toBe('ag_header-agent.agents.securitycentral.io');
  });

  it('rejects invalid X-Client-Cert header', async () => {
    const res = await request(createApp())
      .get('/agents/test')
      .set('X-Client-Cert', encodeURIComponent('-----BEGIN CERTIFICATE-----\ngarbage\n-----END CERTIFICATE-----'));

    expect(res.status).toBe(401);
  });
});
