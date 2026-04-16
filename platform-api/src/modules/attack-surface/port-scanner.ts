/**
 * TCP connect port scanner using Node.js net.Socket.
 * No raw packets, no root required, legal from any host.
 */

import { Socket } from 'node:net';
import { logger } from '../../lib/logger.js';

export interface PortResult {
  readonly port: number;
  readonly open: boolean;
  readonly banner: string | null;
  readonly responseTimeMs: number;
}

interface ScanOptions {
  readonly timeoutMs?: number;       // per-port timeout (default 3000)
  readonly concurrency?: number;     // max parallel connections (default 50)
  readonly grabBanner?: boolean;     // attempt banner grab (default true)
}

/** Top 50 most commonly attacked ports. */
export const DEFAULT_PORTS = [
  21, 22, 23, 25, 53, 80, 110, 111, 135, 139,
  143, 443, 445, 993, 995, 1433, 1521, 2049, 3306, 3389,
  5432, 5900, 5984, 6379, 6443, 8080, 8443, 8888, 9090, 9200,
  9300, 11211, 27017, 27018, 28017, 50000,
];

/**
 * Scan a list of ports on a target IP using TCP connect.
 * Returns results for open ports only.
 */
export async function scanPorts(
  ip: string,
  ports: readonly number[] = DEFAULT_PORTS,
  options: ScanOptions = {},
): Promise<PortResult[]> {
  const timeoutMs = options.timeoutMs ?? 3000;
  const concurrency = options.concurrency ?? 50;
  const grabBanner = options.grabBanner ?? true;

  const results: PortResult[] = [];
  const queue = [...ports];

  const worker = async () => {
    while (queue.length > 0) {
      const port = queue.shift();
      if (port === undefined) break;

      const result = await probePort(ip, port, timeoutMs, grabBanner);
      if (result.open) {
        results.push(result);
      }
    }
  };

  // Launch concurrent workers.
  const workers = Array.from({ length: Math.min(concurrency, ports.length) }, () => worker());
  await Promise.all(workers);

  return results.sort((a, b) => a.port - b.port);
}

function probePort(ip: string, port: number, timeoutMs: number, grabBanner: boolean): Promise<PortResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new Socket();
    let banner: string | null = null;
    let resolved = false;

    const finish = (open: boolean) => {
      if (resolved) return;
      resolved = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve({ port, open, banner, responseTimeMs: Date.now() - start });
    };

    socket.setTimeout(timeoutMs);

    socket.on('connect', () => {
      if (!grabBanner) {
        finish(true);
        return;
      }
      // Wait briefly for a banner.
      socket.once('data', (data) => {
        banner = data.toString('utf8', 0, Math.min(data.length, 512)).trim();
        finish(true);
      });
      // If no banner after 1.5s, still mark as open.
      setTimeout(() => finish(true), 1500);
    });

    socket.on('error', () => finish(false));
    socket.on('timeout', () => finish(false));

    try {
      socket.connect(port, ip);
    } catch {
      finish(false);
    }
  });
}
