/**
 * Service fingerprinting from port number + banner content.
 * Also probes for exposed admin panels via HTTP HEAD requests.
 */

export interface ServiceInfo {
  readonly service: string;
  readonly version: string | null;
  readonly isAdminPanel: boolean;
  readonly isDatabase: boolean;
  readonly riskLevel: 'critical' | 'high' | 'medium' | 'low';
}

// Known port → service mapping.
const PORT_SERVICE: Record<number, { service: string; isDb: boolean }> = {
  21:    { service: 'FTP', isDb: false },
  22:    { service: 'SSH', isDb: false },
  23:    { service: 'Telnet', isDb: false },
  25:    { service: 'SMTP', isDb: false },
  53:    { service: 'DNS', isDb: false },
  80:    { service: 'HTTP', isDb: false },
  110:   { service: 'POP3', isDb: false },
  111:   { service: 'RPCBind', isDb: false },
  135:   { service: 'MSRPC', isDb: false },
  139:   { service: 'NetBIOS', isDb: false },
  143:   { service: 'IMAP', isDb: false },
  443:   { service: 'HTTPS', isDb: false },
  445:   { service: 'SMB', isDb: false },
  993:   { service: 'IMAPS', isDb: false },
  995:   { service: 'POP3S', isDb: false },
  1433:  { service: 'MSSQL', isDb: true },
  1521:  { service: 'Oracle DB', isDb: true },
  2049:  { service: 'NFS', isDb: false },
  3306:  { service: 'MySQL', isDb: true },
  3389:  { service: 'RDP', isDb: false },
  5432:  { service: 'PostgreSQL', isDb: true },
  5900:  { service: 'VNC', isDb: false },
  5984:  { service: 'CouchDB', isDb: true },
  6379:  { service: 'Redis', isDb: true },
  6443:  { service: 'Kubernetes API', isDb: false },
  8080:  { service: 'HTTP Alt', isDb: false },
  8443:  { service: 'HTTPS Alt', isDb: false },
  9090:  { service: 'Prometheus', isDb: false },
  9200:  { service: 'Elasticsearch', isDb: true },
  9300:  { service: 'Elasticsearch Transport', isDb: true },
  11211: { service: 'Memcached', isDb: true },
  27017: { service: 'MongoDB', isDb: true },
  27018: { service: 'MongoDB', isDb: true },
  28017: { service: 'MongoDB Web', isDb: true },
  50000: { service: 'SAP', isDb: false },
};

// Banner patterns for version extraction.
const BANNER_PATTERNS: Array<{ regex: RegExp; service: string }> = [
  { regex: /OpenSSH[_\s](\S+)/i, service: 'SSH' },
  { regex: /nginx\/(\S+)/i, service: 'nginx' },
  { regex: /Apache\/(\S+)/i, service: 'Apache' },
  { regex: /MySQL.*?(\d+\.\d+\.\d+)/i, service: 'MySQL' },
  { regex: /PostgreSQL\s*(\d+\.\d+)/i, service: 'PostgreSQL' },
  { regex: /redis_version:(\S+)/i, service: 'Redis' },
  { regex: /MongoDB/i, service: 'MongoDB' },
  { regex: /Elasticsearch/i, service: 'Elasticsearch' },
  { regex: /Microsoft.*?SQL/i, service: 'MSSQL' },
  { regex: /ProFTPD\s+(\S+)/i, service: 'ProFTPD' },
  { regex: /vsftpd\s+(\S+)/i, service: 'vsftpd' },
  { regex: /Pure-FTPd/i, service: 'Pure-FTPd' },
];

/**
 * Identify a service from its port number and optional banner text.
 */
export function identifyService(port: number, banner: string | null): ServiceInfo {
  const known = PORT_SERVICE[port];
  let service = known?.service ?? 'Unknown';
  const isDb = known?.isDb ?? false;
  let version: string | null = null;

  // Try to refine from banner.
  if (banner) {
    for (const { regex, service: svc } of BANNER_PATTERNS) {
      const m = banner.match(regex);
      if (m) {
        service = svc;
        version = m[1] ?? null;
        break;
      }
    }
  }

  // Risk assessment.
  let riskLevel: ServiceInfo['riskLevel'] = 'medium';

  // Databases exposed externally = critical.
  if (isDb) riskLevel = 'critical';
  // Legacy/insecure protocols = high.
  if ([23, 21, 111, 135, 139, 445, 5900].includes(port)) riskLevel = 'high';
  // RDP exposed = high (brute force target).
  if (port === 3389) riskLevel = 'high';
  // Standard web ports = lower risk.
  if ([80, 443, 8080, 8443].includes(port)) riskLevel = 'low';
  // SSH on standard port = medium (expected but watch).
  if (port === 22) riskLevel = 'low';

  return { service, version, isAdminPanel: false, isDatabase: isDb, riskLevel };
}

/** Known admin panel paths to probe on HTTP ports. */
const ADMIN_PATHS = [
  '/admin', '/phpmyadmin', '/wp-admin', '/wp-login.php',
  '/grafana', '/kibana', '/jenkins', '/webmin',
  '/cockpit', '/portainer', '/adminer', '/pgadmin',
];

/**
 * Probe HTTP ports for exposed admin panels.
 * Returns list of discovered panel paths.
 */
export async function probeAdminPanels(
  ip: string,
  httpPorts: readonly number[],
): Promise<Array<{ port: number; path: string; status: number }>> {
  const results: Array<{ port: number; path: string; status: number }> = [];

  for (const port of httpPorts) {
    const proto = port === 443 || port === 8443 ? 'https' : 'http';
    for (const path of ADMIN_PATHS) {
      try {
        const url = `${proto}://${ip}:${port}${path}`;
        const resp = await fetch(url, {
          method: 'HEAD',
          signal: AbortSignal.timeout(3000),
          redirect: 'manual',
        });
        // 200 or 301/302 redirect = panel exists.
        if (resp.status < 400) {
          results.push({ port, path, status: resp.status });
        }
      } catch {
        // timeout or connection error — skip.
      }
    }
  }

  return results;
}
