import type { Request, Response, NextFunction } from 'express';
import type { TLSSocket } from 'node:tls';

import { verifyClientCert } from '../lib/ca.js';
import { AppError } from './errors.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Agent CN from mTLS client certificate (e.g., ag_<id>.agents.securitycentral.io) */
      agentCn?: string;
    }
  }
}

/**
 * mTLS middleware for agent routes.
 *
 * Verifies the client certificate was signed by the platform CA.
 * Extracts the agent CN and attaches it to `req.agentCn`.
 *
 * Two modes:
 * 1. Direct TLS: reads cert from `req.socket` (when Node.js terminates TLS)
 * 2. Proxy header: reads PEM from `X-Client-Cert` header (when behind a TLS-terminating LB)
 */
export function requireMtls(req: Request, _res: Response, next: NextFunction): void {
  // Try direct TLS socket first
  const tlsSocket = req.socket as TLSSocket;
  if (tlsSocket.getPeerCertificate) {
    const peerCert = tlsSocket.getPeerCertificate(true);
    if (peerCert?.raw) {
      const pemCert = derToPem(peerCert.raw);
      const cn = verifyClientCert(pemCert);
      if (cn) {
        req.agentCn = cn;
        return next();
      }
    }
  }

  // Fallback: proxy-forwarded client cert header
  const headerCert = req.headers['x-client-cert'] as string | undefined;
  if (headerCert) {
    const pem = decodeURIComponent(headerCert);
    const cn = verifyClientCert(pem);
    if (cn) {
      req.agentCn = cn;
      return next();
    }
  }

  next(new AppError('AUTH_INVALID_CREDENTIALS', 'Valid mTLS client certificate required'));
}

function derToPem(der: Buffer): string {
  const b64 = der.toString('base64');
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 64) {
    lines.push(b64.substring(i, i + 64));
  }
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
}
