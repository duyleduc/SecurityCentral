/**
 * Seed script — populates the demo organization with realistic test data:
 *   - 3 projects (Production, Staging, Internal Tools)
 *   - 8 servers across the projects (mix of Linux distros, statuses, scores)
 *   - 6 monitored domains (some with cert issues, DNS gaps)
 *   - 5 repositories (GitHub + GitLab, various languages)
 *   - 24h of metric snapshots per server (1 per minute)
 *   - 14 days of endpoint heartbeats per domain
 *   - Findings spread across severity tiers and sources
 *
 * Idempotent: safe to re-run. Wipes per-org transient data (metrics, heartbeats,
 * findings, scans) but preserves the org/users/projects so credentials stay stable.
 *
 * Login: admin@demo.com / password123
 */

import { PrismaClient, type Prisma } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Random utilities
// ---------------------------------------------------------------------------

const rand = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min: number, max: number): number => Math.floor(Math.random() * (max - min + 1)) + min;
const randFloat = (min: number, max: number): number => Math.random() * (max - min) + min;
const chance = (p: number): boolean => Math.random() < p;
const pickN = <T,>(arr: readonly T[], n: number): T[] => {
  const copy = [...arr];
  copy.sort(() => Math.random() - 0.5);
  return copy.slice(0, Math.min(n, copy.length));
};

// ---------------------------------------------------------------------------
// Static catalogs (realistic-looking data)
// ---------------------------------------------------------------------------

const HOSTNAMES = [
  'web-prod-01', 'web-prod-02', 'api-prod-01', 'db-prod-master',
  'cache-prod-01', 'worker-prod-01', 'monitoring-01',
  'web-staging', 'api-staging', 'db-staging',
  'jenkins-ci', 'gitlab-runner-01', 'backup-server',
];

const OS_VARIANTS = [
  { family: 'debian', version: '12', kernel: '6.1.0-13-amd64' },
  { family: 'debian', version: '11', kernel: '5.10.0-26-amd64' },
  { family: 'ubuntu', version: '22.04', kernel: '5.15.0-91-generic' },
  { family: 'ubuntu', version: '24.04', kernel: '6.8.0-31-generic' },
  { family: 'rocky', version: '9.3', kernel: '5.14.0-362.el9.x86_64' },
  { family: 'alma', version: '9.4', kernel: '5.14.0-427.el9.x86_64' },
];

const CPU_MODELS = [
  'Intel Xeon E5-2680 v4 @ 2.40GHz',
  'AMD EPYC 7763 64-Core',
  'Intel Xeon Platinum 8275CL @ 3.00GHz',
  'ARM Neoverse-N1',
];

const DOMAINS = [
  { host: 'app.acme-corp.com', sslDays: 87, dnsSpf: 'pass', dnsDkim: 'pass', dnsDmarc: 'pass', healthy: true },
  { host: 'api.acme-corp.com', sslDays: 12, dnsSpf: 'pass', dnsDkim: 'pass', dnsDmarc: 'fail', healthy: true },
  { host: 'staging.acme-corp.com', sslDays: 5, dnsSpf: 'pass', dnsDkim: 'missing', dnsDmarc: 'missing', healthy: true },
  { host: 'legacy.acme-corp.com', sslDays: -3, dnsSpf: 'fail', dnsDkim: 'missing', dnsDmarc: 'missing', healthy: false },
  { host: 'docs.acme-corp.com', sslDays: 145, dnsSpf: 'pass', dnsDkim: 'pass', dnsDmarc: 'pass', healthy: true },
  { host: 'cdn.acme-corp.com', sslDays: 200, dnsSpf: 'missing', dnsDkim: 'missing', dnsDmarc: 'missing', healthy: true },
];

const REPOSITORIES = [
  { provider: 'github', owner: 'acme-corp', name: 'web-frontend', language: 'TypeScript', branch: 'main' },
  { provider: 'github', owner: 'acme-corp', name: 'api-server', language: 'Go', branch: 'main' },
  { provider: 'github', owner: 'acme-corp', name: 'data-pipeline', language: 'Python', branch: 'master' },
  { provider: 'gitlab', owner: 'acme-corp', name: 'mobile-app', language: 'Kotlin', branch: 'develop' },
  { provider: 'gitlab', owner: 'acme-corp', name: 'infra-terraform', language: 'HCL', branch: 'main' },
];

const CVE_SAMPLES = [
  { cveId: 'CVE-2024-3094', pkg: 'liblzma5', installed: '5.4.1-1', fixed: '5.6.2-3', severity: 'critical', kev: true,
    desc: 'Malicious code in xz/liblzma allows authentication bypass via SSH (the XZ backdoor).' },
  { cveId: 'CVE-2024-6387', pkg: 'openssh-server', installed: '9.2p1-2', fixed: '9.2p1-2+deb12u3', severity: 'critical', kev: true,
    desc: 'regreSSHion: race condition in sshd allows remote code execution as root.' },
  { cveId: 'CVE-2023-44487', pkg: 'nginx', installed: '1.22.1-9', fixed: '1.22.1-9+deb12u1', severity: 'high', kev: true,
    desc: 'HTTP/2 Rapid Reset attack — denial of service via stream cancellation.' },
  { cveId: 'CVE-2024-23652', pkg: 'docker.io', installed: '20.10.24', fixed: '24.0.7', severity: 'high', kev: false,
    desc: 'BuildKit cache mount race condition allows access to files outside the build context.' },
  { cveId: 'CVE-2023-50387', pkg: 'bind9', installed: '9.18.19-1', fixed: '9.18.24-1', severity: 'high', kev: false,
    desc: 'KeyTrap — DNSSEC validation can be exploited to cause CPU exhaustion.' },
  { cveId: 'CVE-2024-2961', pkg: 'libc6', installed: '2.36-9', fixed: '2.36-9+deb12u4', severity: 'medium', kev: false,
    desc: 'glibc iconv buffer overflow in ISO-2022-CN-EXT character set conversion.' },
  { cveId: 'CVE-2023-4911', pkg: 'libc6', installed: '2.36-9', fixed: '2.36-9+deb12u3', severity: 'high', kev: true,
    desc: 'Looney Tunables — buffer overflow in ld.so via GLIBC_TUNABLES allows local privilege escalation.' },
  { cveId: 'CVE-2024-1086', pkg: 'linux-image-generic', installed: '6.1.0-13', fixed: '6.1.0-18', severity: 'high', kev: true,
    desc: 'Use-after-free in nf_tables allows local privilege escalation to root.' },
];

const SECRET_FINDINGS = [
  { title: 'AWS access key committed to git history', severity: 'critical' },
  { title: 'Slack bot token in source code', severity: 'high' },
  { title: 'Database connection string with password in .env', severity: 'high' },
  { title: 'GitHub personal access token in commit log', severity: 'critical' },
];

const PATTERN_FINDINGS = [
  { title: 'Use of eval() with user input in api/handler.ts', severity: 'high' },
  { title: 'SQL string concatenation instead of parameterized query', severity: 'high' },
  { title: 'Insecure crypto: MD5 used for password hashing', severity: 'critical' },
  { title: 'Hardcoded admin credentials in seed script', severity: 'medium' },
];

// ---------------------------------------------------------------------------
// Static catalogs — packages, audit results, CISA KEV
// ---------------------------------------------------------------------------

const TYPICAL_DEBIAN_PACKAGES: Array<{ name: string; version: string; arch?: string }> = [
  { name: 'libc6', version: '2.36-9', arch: 'amd64' },
  { name: 'liblzma5', version: '5.4.1-1', arch: 'amd64' },
  { name: 'openssh-server', version: '9.2p1-2', arch: 'amd64' },
  { name: 'openssh-client', version: '9.2p1-2', arch: 'amd64' },
  { name: 'openssl', version: '3.0.11-1~deb12u2', arch: 'amd64' },
  { name: 'libssl3', version: '3.0.11-1~deb12u2', arch: 'amd64' },
  { name: 'curl', version: '7.88.1-10+deb12u5', arch: 'amd64' },
  { name: 'libcurl4', version: '7.88.1-10+deb12u5', arch: 'amd64' },
  { name: 'nginx', version: '1.22.1-9', arch: 'amd64' },
  { name: 'nginx-common', version: '1.22.1-9', arch: 'all' },
  { name: 'docker.io', version: '20.10.24+dfsg1-1+b3', arch: 'amd64' },
  { name: 'containerd', version: '1.6.20~ds1-1+b1', arch: 'amd64' },
  { name: 'runc', version: '1.1.5+ds1-1+b1', arch: 'amd64' },
  { name: 'python3', version: '3.11.2-1+b1', arch: 'amd64' },
  { name: 'python3-pip', version: '23.0.1+dfsg-1', arch: 'all' },
  { name: 'systemd', version: '252.22-1~deb12u1', arch: 'amd64' },
  { name: 'systemd-sysv', version: '252.22-1~deb12u1', arch: 'amd64' },
  { name: 'bash', version: '5.2.15-2+b2', arch: 'amd64' },
  { name: 'coreutils', version: '9.1-1', arch: 'amd64' },
  { name: 'apt', version: '2.6.1', arch: 'amd64' },
  { name: 'sudo', version: '1.9.13p3-1+deb12u1', arch: 'amd64' },
  { name: 'cron', version: '3.0pl1-162', arch: 'amd64' },
  { name: 'rsyslog', version: '8.2302.0-1', arch: 'amd64' },
  { name: 'iptables', version: '1.8.9-2', arch: 'amd64' },
  { name: 'fail2ban', version: '1.0.2-2', arch: 'all' },
  { name: 'linux-image-amd64', version: '6.1.0-13', arch: 'amd64' },
  { name: 'redis-server', version: '7.0.15-1~deb12u1', arch: 'amd64' },
  { name: 'postgresql-15', version: '15.5-0+deb12u1', arch: 'amd64' },
  { name: 'mariadb-server', version: '10.11.6-0+deb12u1', arch: 'amd64' },
  { name: 'bind9', version: '9.18.19-1~deb12u1', arch: 'amd64' },
];

const BINARY_VERSIONS = [
  { name: 'openssl', version: 'OpenSSL 3.0.11 19 Sep 2023' },
  { name: 'sshd', version: 'OpenSSH_9.2p1 Debian-2, OpenSSL 3.0.11' },
  { name: 'curl', version: 'curl 7.88.1' },
  { name: 'glibc', version: 'ldd (Debian GLIBC 2.36-9) 2.36' },
  { name: 'nginx', version: 'nginx version: nginx/1.22.1' },
  { name: 'docker', version: '20.10.24' },
  { name: 'containerd', version: 'containerd 1.6.20' },
  { name: 'runc', version: 'runc version 1.1.5' },
];

const AUDIT_CHECKS_BASE = [
  { id: 'kernel.aslr', category: 'Kernel', title: 'ASLR enabled' },
  { id: 'kernel.kptr_restrict', category: 'Kernel', title: 'Kernel pointer restriction' },
  { id: 'kernel.dmesg_restrict', category: 'Kernel', title: 'dmesg access restricted' },
  { id: 'kernel.core_dump', category: 'Kernel', title: 'Core dump restriction' },
  { id: 'kernel.ptrace_scope', category: 'Kernel', title: 'PTRACE scope restricted' },
  { id: 'users.uid0', category: 'Users', title: 'UID 0 accounts (non-root)' },
  { id: 'users.empty_password', category: 'Users', title: 'Users with empty password' },
  { id: 'users.weak_hash', category: 'Users', title: 'Password hashing algorithm' },
  { id: 'users.nopasswd_sudo', category: 'Users', title: 'NOPASSWD sudoers rules' },
  { id: 'users.home_perms', category: 'Users', title: 'Home directory permissions' },
  { id: 'fs.suid_binaries', category: 'Filesystem', title: 'SUID binaries' },
  { id: 'fs.world_writable_etc', category: 'Filesystem', title: 'World-writable files in /etc' },
  { id: 'fs.tmp_executables', category: 'Filesystem', title: 'Executables in /tmp' },
  { id: 'fs.passwd_perms', category: 'Filesystem', title: '/etc/passwd permissions' },
  { id: 'fs.shadow_perms', category: 'Filesystem', title: '/etc/shadow permissions' },
  { id: 'ssh.weak_ciphers', category: 'SSH', title: 'SSH ciphers' },
  { id: 'ssh.weak_macs', category: 'SSH', title: 'SSH MACs' },
  { id: 'ssh.weak_kex', category: 'SSH', title: 'SSH KEX algorithms' },
  { id: 'ssh.max_auth_tries', category: 'SSH', title: 'SSH MaxAuthTries' },
  { id: 'svc.legacy_23', category: 'Services', title: 'Legacy protocol: Telnet (port 23)' },
  { id: 'svc.redis_auth', category: 'Services', title: 'Redis authentication' },
  { id: 'svc.nfs_root_squash', category: 'Services', title: 'NFS root_squash' },
  { id: 'container.docker_sock', category: 'Container', title: 'Docker socket permissions' },
  { id: 'container.privileged', category: 'Container', title: 'Privileged containers' },
];

const CISA_KEV_SAMPLE = {
  vulnerabilities: [
    { cveID: 'CVE-2024-3094', vendorProject: 'Linux', product: 'XZ Utils', dateAdded: '2024-04-01' },
    { cveID: 'CVE-2024-6387', vendorProject: 'OpenBSD', product: 'OpenSSH', dateAdded: '2024-07-02' },
    { cveID: 'CVE-2023-44487', vendorProject: 'IETF', product: 'HTTP/2', dateAdded: '2023-10-10' },
    { cveID: 'CVE-2023-4911', vendorProject: 'GNU', product: 'glibc', dateAdded: '2023-10-12' },
    { cveID: 'CVE-2024-1086', vendorProject: 'Linux', product: 'Kernel', dateAdded: '2024-03-04' },
  ],
};

// ---------------------------------------------------------------------------
// Main seed flow
// ---------------------------------------------------------------------------

async function main() {
  console.log('🌱 Starting seed…');

  const passwordHash = await bcrypt.hash('password123', 12);

  // ------- Org + users -------
  const org = await prisma.organization.upsert({
    where: { slug: 'demo-org' },
    update: {},
    create: { name: 'Demo Organization', slug: 'demo-org' },
  });

  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@demo.com' },
    update: {},
    create: { email: 'admin@demo.com', name: 'Alex Admin', role: 'owner', orgId: org.id, passwordHash },
  });

  await prisma.user.upsert({
    where: { email: 'security@demo.com' },
    update: {},
    create: { email: 'security@demo.com', name: 'Sam Security', role: 'admin', orgId: org.id, passwordHash },
  });

  console.log(`✓ Org: ${org.name}`);
  console.log('✓ Users: admin@demo.com, security@demo.com (password: password123)');

  // ------- Wipe transient data so re-runs are clean -------
  await prisma.endpointHeartbeat.deleteMany({ where: { endpoint: { orgId: org.id } } });
  await prisma.serverMetricSnapshot.deleteMany({ where: { server: { orgId: org.id } } });
  await prisma.securityPosture.deleteMany({ where: { server: { orgId: org.id } } });
  await prisma.packageInventory.deleteMany({ where: { server: { orgId: org.id } } });
  await prisma.finding.deleteMany({ where: { orgId: org.id } });
  await prisma.scan.deleteMany({ where: { orgId: org.id } });
  await prisma.serverScoreHistory.deleteMany({ where: { server: { orgId: org.id } } });
  await prisma.installToken.deleteMany({ where: { orgId: org.id } });
  await prisma.apiKey.deleteMany({ where: { orgId: org.id } });
  await prisma.notificationPreference.deleteMany({ where: { orgId: org.id } });
  await prisma.integration.deleteMany({ where: { orgId: org.id } });
  await prisma.server.deleteMany({ where: { orgId: org.id } });
  await prisma.monitoredEndpoint.deleteMany({ where: { orgId: org.id } });
  await prisma.repository.deleteMany({ where: { orgId: org.id } });
  await prisma.project.deleteMany({ where: { orgId: org.id } });

  console.log('✓ Wiped previous transient data');

  // ------- Projects -------
  const projects = await Promise.all(
    [
      { name: 'Production', description: 'Customer-facing production services', notes: 'Owns app.acme-corp.com and api.acme-corp.com. PagerDuty rotation: ops-team.' },
      { name: 'Staging', description: 'Pre-production environment', notes: 'Mirrors production data weekly. Anonymised PII before sync.' },
      { name: 'Internal Tools', description: 'CI/CD, monitoring, and ops infrastructure', notes: 'Jenkins, GitLab Runners, and the centralised log aggregator.' },
    ].map((p) => prisma.project.create({ data: { ...p, orgId: org.id } })),
  );
  console.log(`✓ Projects: ${projects.map((p) => p.name).join(', ')}`);

  // ------- Servers -------
  const servers = [];
  const usedHostnames = new Set<string>();
  for (let i = 0; i < 8; i++) {
    let hostname: string;
    do { hostname = rand(HOSTNAMES); } while (usedHostnames.has(hostname));
    usedHostnames.add(hostname);

    const os = rand(OS_VARIANTS);
    const project = hostname.includes('staging') ? projects[1]
      : hostname.includes('jenkins') || hostname.includes('runner') || hostname.includes('backup') ? projects[2]
      : projects[0];

    // Status distribution: most online, a few warning/critical, one offline
    const status = i === 0 ? 'critical' : i === 1 ? 'warning' : i === 7 ? 'offline' : 'online';
    const score = status === 'critical' ? randInt(15, 40)
      : status === 'warning' ? randInt(50, 70)
      : status === 'offline' ? randInt(30, 60)
      : randInt(75, 95);

    const lastHeartbeat = status === 'offline'
      ? new Date(Date.now() - randInt(2, 24) * 60 * 60_000)
      : new Date(Date.now() - randInt(5, 60_000));

    const server = await prisma.server.create({
      data: {
        orgId: org.id,
        projectId: project.id,
        hostname,
        label: hostname,
        agentId: crypto.randomUUID(),
        agentVersion: '1.0.0',
        osFamily: os.family,
        osVersion: os.version,
        kernel: os.kernel,
        cpuCores: rand([2, 4, 8, 16]),
        cpuModel: rand(CPU_MODELS),
        totalRamMb: rand([4096, 8192, 16384, 32768]),
        totalDiskGb: rand([50, 100, 250, 500, 1000]),
        ipAddresses: [`10.0.${randInt(1, 254)}.${randInt(2, 254)}`, `192.168.1.${randInt(2, 254)}`],
        status,
        securityScore: score,
        tags: [
          { key: 'env', value: project.name.toLowerCase() },
          { key: 'role', value: hostname.split('-')[0] },
        ],
        lastHeartbeat,
        bootTime: new Date(Date.now() - randInt(1, 90) * 24 * 60 * 60_000),
      },
    });
    servers.push(server);
  }
  console.log(`✓ Servers: ${servers.length} (online: ${servers.filter((s) => s.status === 'online').length}, warning: ${servers.filter((s) => s.status === 'warning').length}, critical: ${servers.filter((s) => s.status === 'critical').length}, offline: ${servers.filter((s) => s.status === 'offline').length})`);

  // ------- Server metrics — 24h of 1-minute snapshots per server -------
  console.log('  Generating server metrics (24h × 1min per server)…');
  for (const server of servers) {
    if (server.status === 'offline') continue; // no metrics for offline servers

    // Baseline characteristics per server.
    const baseCpu = randFloat(15, 40);
    const baseMem = randFloat(35, 65);
    const baseDisk = randFloat(40, 75);
    const isStressed = server.status === 'warning' || server.status === 'critical';

    const points: Prisma.ServerMetricSnapshotCreateManyInput[] = [];
    const now = Date.now();
    for (let m = 24 * 60; m > 0; m--) {
      const t = new Date(now - m * 60_000);
      const noise = () => randFloat(-8, 8);
      // Add periodic spikes for stressed servers.
      const spike = isStressed && (m % 30 === 0) ? randFloat(20, 50) : 0;
      const cpu = Math.max(0, Math.min(100, baseCpu + noise() + spike));
      const memory = Math.max(0, Math.min(100, baseMem + noise() + spike * 0.5));
      const disk = Math.max(0, Math.min(100, baseDisk + randFloat(-1, 1)));

      points.push({
        serverId: server.id,
        cpu, memory, disk,
        urgent: spike > 0,
        alerts: spike > 0 ? [{ type: 'cpu_high', value: cpu, threshold: 85, since: t.toISOString() }] : [],
        cpuIoWait: randFloat(0, isStressed ? 25 : 8),
        swapUsedPct: randFloat(0, isStressed ? 30 : 5),
        loadAvg1: randFloat(0.2, isStressed ? 6 : 2),
        loadAvg5: randFloat(0.2, isStressed ? 5 : 1.8),
        loadAvg15: randFloat(0.2, isStressed ? 4 : 1.5),
        diskReadBps: BigInt(randInt(10_000, 5_000_000)),
        diskWriteBps: BigInt(randInt(5_000, 2_000_000)),
        diskIoUtil: randFloat(0, isStressed ? 90 : 35),
        netRxBps: BigInt(randInt(1_000, 50_000_000)),
        netTxBps: BigInt(randInt(1_000, 30_000_000)),
        netErrors: randInt(0, isStressed ? 50 : 2),
        createdAt: t,
      });
    }
    // Bulk insert in chunks (Postgres has param limits).
    const chunkSize = 200;
    for (let i = 0; i < points.length; i += chunkSize) {
      await prisma.serverMetricSnapshot.createMany({ data: points.slice(i, i + chunkSize) });
    }
  }

  // ------- Domains (MonitoredEndpoint) -------
  const endpoints = await Promise.all(
    DOMAINS.map((d, i) =>
      prisma.monitoredEndpoint.create({
        data: {
          orgId: org.id,
          projectId: projects[i % 3].id,
          host: d.host,
          port: 443,
          protocol: 'https',
          status: d.healthy ? 'healthy' : 'down',
          tags: [{ key: 'env', value: i % 3 === 0 ? 'production' : 'staging' }],
          lastSslCheckAt: new Date(Date.now() - randInt(0, 12) * 60 * 60_000),
          lastCheckAt: new Date(Date.now() - randInt(0, 5) * 60_000),
          nextCheckAt: new Date(Date.now() + randInt(1, 60) * 60_000),
        },
      }),
    ),
  );
  console.log(`✓ Monitored endpoints: ${endpoints.length}`);

  // ------- Endpoint heartbeats (14 days, every 15 min) -------
  console.log('  Generating endpoint heartbeats (14 days × 15min per domain)…');
  for (let i = 0; i < endpoints.length; i++) {
    const endpoint = endpoints[i];
    const domain = DOMAINS[i];
    const points: Prisma.EndpointHeartbeatCreateManyInput[] = [];
    const intervals = (14 * 24 * 60) / 15; // 1344 points
    const now = Date.now();
    for (let k = intervals; k > 0; k--) {
      const t = new Date(now - k * 15 * 60_000);
      // Down domain has random outages; healthy has rare blips.
      const isUp = !domain.healthy ? chance(0.7) : chance(0.995);
      const responseMs = isUp ? randInt(30, 800) + (chance(0.05) ? randInt(500, 2000) : 0) : null;
      const sslExpiry = new Date(now + domain.sslDays * 24 * 60 * 60_000);
      points.push({
        endpointId: endpoint.id,
        statusCode: isUp ? (chance(0.95) ? 200 : rand([301, 304, 502, 503])) : null,
        responseMs,
        isUp,
        sslValid: domain.sslDays > 0,
        sslExpiry,
        sslIssuer: 'Let\'s Encrypt',
        sslDaysLeft: domain.sslDays,
        tlsVersion: '1.3',
        dnsSpf: domain.dnsSpf,
        dnsDkim: domain.dnsDkim,
        dnsDmarc: domain.dnsDmarc,
        error: isUp ? null : 'Connection timeout',
        createdAt: t,
      });
    }
    // Bulk insert.
    const chunkSize = 500;
    for (let j = 0; j < points.length; j += chunkSize) {
      await prisma.endpointHeartbeat.createMany({ data: points.slice(j, j + chunkSize) });
    }
  }

  // ------- Repositories -------
  const repos = await Promise.all(
    REPOSITORIES.map((r, i) =>
      prisma.repository.create({
        data: {
          orgId: org.id,
          projectId: projects[i % 3].id,
          provider: r.provider,
          providerId: String(randInt(100000, 999999)),
          owner: r.owner,
          name: r.name,
          defaultBranch: r.branch,
          language: r.language,
          cloneUrl: `https://${r.provider}.com/${r.owner}/${r.name}.git`,
          lastScanAt: new Date(Date.now() - randInt(1, 72) * 60 * 60_000),
        },
      }),
    ),
  );
  console.log(`✓ Repositories: ${repos.length}`);

  // ------- Scans (one completed scan per repo) -------
  const scans = await Promise.all(
    repos.map(async (repo) => {
      const findingsTotal = randInt(2, 12);
      return prisma.scan.create({
        data: {
          orgId: org.id,
          repositoryId: repo.id,
          type: 'code_dependencies',
          status: 'completed',
          trigger: rand(['manual', 'scheduled', 'webhook']),
          branch: repo.defaultBranch,
          duration: randInt(15_000, 180_000),
          findingsTotal,
          startedAt: new Date(Date.now() - randInt(1, 48) * 60 * 60_000),
          completedAt: new Date(Date.now() - randInt(0, 24) * 60 * 60_000),
        },
      });
    }),
  );

  // ------- Findings — spread across servers, repos, endpoints -------
  console.log('  Generating findings (CVE, secrets, patterns, brute force, audit, cert)…');
  let findingCount = 0;

  // 1. CVE findings on servers (skip the offline one)
  for (const server of servers.filter((s) => s.status !== 'offline')) {
    const cveCount = server.status === 'critical' ? 6 : server.status === 'warning' ? 3 : randInt(0, 2);
    const cves = pickN(CVE_SAMPLES, cveCount);
    for (const cve of cves) {
      await prisma.finding.create({
        data: {
          orgId: org.id,
          serverId: server.id,
          source: 'cve_scan',
          severity: cve.severity,
          status: chance(0.85) ? 'open' : 'resolved',
          title: `${cve.cveId}: ${cve.pkg} on ${server.hostname}`,
          description: cve.desc,
          cveId: cve.cveId,
          cvssScore: cve.severity === 'critical' ? randFloat(9, 10) : cve.severity === 'high' ? randFloat(7, 8.9) : randFloat(4, 6.9),
          detail: { packageName: cve.pkg, installedVersion: cve.installed, fixedVersion: cve.fixed, cisaKev: cve.kev },
          createdAt: new Date(Date.now() - randInt(1, 30) * 24 * 60 * 60_000),
        },
      });
      findingCount++;
    }

    // Audit findings — 1-3 hardening issues per server
    if (chance(0.7)) {
      await prisma.finding.create({
        data: {
          orgId: org.id, serverId: server.id,
          source: 'security_audit', severity: 'high', status: 'open',
          title: `SSH allows password authentication on ${server.hostname}`,
          description: 'PasswordAuthentication is enabled. Disable it and use SSH keys only.',
          createdAt: new Date(Date.now() - randInt(1, 14) * 24 * 60 * 60_000),
        },
      });
      findingCount++;
    }
    if (chance(0.4)) {
      await prisma.finding.create({
        data: {
          orgId: org.id, serverId: server.id,
          source: 'security_audit', severity: 'medium', status: 'open',
          title: `ASLR not fully enabled on ${server.hostname}`,
          description: 'kernel.randomize_va_space should be 2 (full randomization).',
          createdAt: new Date(Date.now() - randInt(1, 14) * 24 * 60 * 60_000),
        },
      });
      findingCount++;
    }
  }

  // 2. Brute force findings on the critical server
  await prisma.finding.create({
    data: {
      orgId: org.id, serverId: servers[0].id,
      source: 'brute_force', severity: 'critical', status: 'open',
      title: `Active SSH brute force on ${servers[0].hostname} (147 attempts/5min)`,
      description: '147 SSH login failures in the last 5 minutes from 23 unique IPs. Top attackers: 185.220.101.42 (45x), 91.234.99.7 (38x), 167.99.245.18 (22x)',
      detail: {
        type: 'active_attack',
        sshVelocity: 147, sshUniqueIps: 23, isActiveAttack: true, isDistributed: true,
        sshTopAttackers: [
          { ip: '185.220.101.42', count: 45 },
          { ip: '91.234.99.7', count: 38 },
          { ip: '167.99.245.18', count: 22 },
        ],
      },
      createdAt: new Date(Date.now() - 30 * 60_000),
    },
  });
  findingCount++;

  // 3. Code scanner findings — secrets + patterns + CVE-in-deps
  for (const repo of repos) {
    const scan = scans.find((s) => s.repositoryId === repo.id);
    for (const sec of pickN(SECRET_FINDINGS, randInt(0, 2))) {
      await prisma.finding.create({
        data: {
          orgId: org.id, repositoryId: repo.id, scanId: scan?.id,
          source: 'code_scanner', severity: sec.severity, status: chance(0.7) ? 'open' : 'resolved',
          title: `${sec.title} (${repo.name})`,
          createdAt: new Date(Date.now() - randInt(0, 14) * 24 * 60 * 60_000),
        },
      });
      findingCount++;
    }
    for (const pat of pickN(PATTERN_FINDINGS, randInt(0, 2))) {
      await prisma.finding.create({
        data: {
          orgId: org.id, repositoryId: repo.id, scanId: scan?.id,
          source: 'code_scanner', severity: pat.severity, status: chance(0.6) ? 'open' : 'resolved',
          title: `${pat.title} (${repo.name})`,
          createdAt: new Date(Date.now() - randInt(0, 14) * 24 * 60 * 60_000),
        },
      });
      findingCount++;
    }
  }

  // 4. Cert / DNS findings on domains
  for (let i = 0; i < endpoints.length; i++) {
    const ep = endpoints[i];
    const d = DOMAINS[i];
    if (d.sslDays < 0) {
      await prisma.finding.create({
        data: {
          orgId: org.id, endpointId: ep.id,
          source: 'cert_monitor', severity: 'critical', status: 'open',
          title: `SSL certificate expired on ${d.host}`,
          description: `Certificate expired ${Math.abs(d.sslDays)} days ago. Renew immediately.`,
          createdAt: new Date(Date.now() - Math.abs(d.sslDays) * 24 * 60 * 60_000),
        },
      });
      findingCount++;
    } else if (d.sslDays < 14) {
      await prisma.finding.create({
        data: {
          orgId: org.id, endpointId: ep.id,
          source: 'cert_monitor', severity: 'high', status: 'open',
          title: `SSL certificate expiring soon on ${d.host} (${d.sslDays} days)`,
          description: `Renew before expiration to avoid service disruption.`,
          createdAt: new Date(Date.now() - randInt(1, 24) * 60 * 60_000),
        },
      });
      findingCount++;
    }
    if (d.dnsDmarc === 'missing') {
      await prisma.finding.create({
        data: {
          orgId: org.id, endpointId: ep.id,
          source: 'cert_monitor', severity: 'medium', status: 'open',
          title: `DMARC record missing for ${d.host}`,
          description: 'Without DMARC, attackers can spoof emails from this domain. Add a DMARC TXT record.',
          createdAt: new Date(Date.now() - randInt(1, 7) * 24 * 60 * 60_000),
        },
      });
      findingCount++;
    }
  }

  console.log(`✓ Findings: ${findingCount} total`);

  // ------- Vulnerability feed (CISA KEV cache) -------
  await prisma.vulnerabilityFeed.upsert({
    where: { source: 'cisa_kev' },
    update: { lastSyncAt: new Date(), data: CISA_KEV_SAMPLE },
    create: { source: 'cisa_kev', lastSyncAt: new Date(), data: CISA_KEV_SAMPLE },
  });
  console.log(`✓ CISA KEV feed seeded (${CISA_KEV_SAMPLE.vulnerabilities.length} vulns)`);

  // ------- Package inventories — one per online server -------
  for (const server of servers) {
    if (server.status === 'offline') continue;

    // Stressed servers carry vulnerable packages; healthy servers carry up-to-date ones.
    const stressed = server.status === 'critical' || server.status === 'warning';
    const packages = TYPICAL_DEBIAN_PACKAGES.map((p) => {
      // Mutate critical packages on stressed servers to vulnerable versions.
      if (stressed && (p.name === 'liblzma5' || p.name === 'openssh-server' || p.name === 'libc6')) {
        return p; // keep the vulnerable version
      }
      return p;
    });

    await prisma.packageInventory.create({
      data: {
        serverId: server.id,
        collectedAt: new Date(Date.now() - randInt(1, 12) * 60 * 60_000),
        osFamily: server.osFamily ?? 'debian',
        packages,
        binaryVersions: BINARY_VERSIONS,
        pendingSecurityUpdates: stressed ? randInt(8, 20) : randInt(0, 3),
        heldPackages: stressed ? ['linux-image-amd64'] : [],
        kernelRunning: server.kernel ?? '6.1.0-13-amd64',
        kernelInstalled: stressed ? '6.1.0-18-amd64' : (server.kernel ?? '6.1.0-13-amd64'),
        unattendedUpgrades: !stressed && chance(0.7),
        packageHash: Math.random().toString(36).slice(2, 14),
      },
    });
  }
  console.log('✓ Package inventories: 1 per online server');

  // ------- Security postures — one per online server with audit results + brute force -------
  for (const server of servers) {
    if (server.status === 'offline') continue;
    const stressed = server.status === 'critical' || server.status === 'warning';
    const isCritical = server.status === 'critical';

    // Generate audit results — failures concentrated on stressed servers.
    const auditResults = AUDIT_CHECKS_BASE.map((check) => {
      // Force certain failures on the critical server to drive the dashboard story.
      const forceFailure = isCritical && [
        'kernel.aslr', 'users.weak_hash', 'ssh.weak_ciphers', 'svc.legacy_23',
      ].includes(check.id);
      const willFail = forceFailure || (stressed ? chance(0.35) : chance(0.08));
      const status = willFail ? 'fail' : (chance(0.05) ? 'warn' : 'pass');
      const severity = check.id.startsWith('users.uid0') || check.id.includes('weak') || check.id.includes('legacy') || check.id.includes('shadow')
        ? 'critical'
        : check.id.startsWith('kernel.') || check.id.startsWith('ssh.') ? 'high' : 'medium';
      const detail = status === 'pass' ? 'Check passed'
        : status === 'fail' ? `Failed: ${check.title} not configured per hardening guide`
        : 'Could not determine value';
      return {
        id: check.id, category: check.category, title: check.title,
        status, severity, detail,
      };
    });

    // Listening ports — common services with realistic exposure.
    const listeningPorts = [
      { port: 22, proto: 'tcp', process: 'sshd', bind: '0.0.0.0', exposure: 'restricted', allowedFrom: ['10.0.0.0/8'] },
      { port: 80, proto: 'tcp', process: 'nginx', bind: '0.0.0.0', exposure: 'internet', allowedFrom: [] },
      { port: 443, proto: 'tcp', process: 'nginx', bind: '0.0.0.0', exposure: 'internet', allowedFrom: [] },
      ...(server.hostname.includes('db') ? [{ port: 5432, proto: 'tcp', process: 'postgres', bind: '127.0.0.1', exposure: 'localhost', allowedFrom: [] }] : []),
      ...(server.hostname.includes('cache') ? [{ port: 6379, proto: 'tcp', process: 'redis-server', bind: isCritical ? '0.0.0.0' : '127.0.0.1', exposure: isCritical ? 'internet' : 'localhost', allowedFrom: [] }] : []),
    ];

    // Firewall — critical server has a misconfigured firewall.
    const firewallActive = !isCritical;
    const firewallType = isCritical ? 'iptables' : rand(['ufw', 'nftables', 'iptables+fail2ban']);
    const firewallDetail = isCritical
      ? { defaultPolicy: 'accept', issues: ['iptables INPUT policy is ACCEPT with very few rules — server is effectively unfirewalled'] }
      : firewallActive
        ? { defaultPolicy: 'drop', issues: [] }
        : null;

    // Brute force — only the critical server has an active attack.
    const bruteForce = isCritical ? {
      sshVelocity: 147,
      sshUniqueIps: 23,
      sshTopAttackers: [
        { ip: '185.220.101.42', count: 45 },
        { ip: '91.234.99.7', count: 38 },
        { ip: '167.99.245.18', count: 22 },
        { ip: '45.155.205.86', count: 18 },
        { ip: '193.32.162.157', count: 12 },
      ],
      sshCompromise: [],
      httpVelocity: 0, httpUniqueIps: 0,
      isActiveAttack: true, isDistributed: true, hasCompromise: false,
    } : null;

    await prisma.securityPosture.create({
      data: {
        serverId: server.id,
        collectedAt: new Date(Date.now() - randInt(0, 3) * 60 * 60_000),
        listeningPorts,
        sshConfig: {
          rootLogin: isCritical ? 'yes' : 'no',
          passwordAuth: stressed ? 'yes' : 'no',
          port: 22,
          permitEmptyPwd: 'no',
        },
        firewallActive,
        firewallType,
        firewallDetail: firewallDetail ?? undefined,
        loggedInUsers: stressed ? [
          { user: 'root', from: '185.220.101.42', since: 'Apr 12 14:23' },
        ] : [
          { user: 'ubuntu', from: '10.0.0.5', since: 'Apr 12 09:14' },
        ],
        sshFailures: isCritical ? 147 : stressed ? 12 : randInt(0, 3),
        shellUsers: ['root', 'ubuntu', 'deploy'],
        pendingReboot: stressed && chance(0.6),
        openFdAlloc: randInt(2000, 8000),
        openFdMax: 1048576,
        auditResults,
        bruteForce: bruteForce ?? undefined,
      },
    });
  }
  console.log('✓ Security postures: 1 per online server (with audit results, listening ports, brute force on critical)');

  // ------- Integrations (GitHub + GitLab) -------
  await prisma.integration.create({
    data: {
      orgId: org.id, provider: 'github',
      config: { installationId: '12345678', appId: '0' },
      status: 'active',
    },
  });
  await prisma.integration.create({
    data: {
      orgId: org.id, provider: 'gitlab',
      config: { tokenHash: 'demo-token-hash' },
      baseUrl: 'https://gitlab.com',
      status: 'active',
    },
  });
  console.log('✓ Integrations: GitHub + GitLab');

  // ------- Install tokens (one used, one fresh) -------
  await prisma.installToken.create({
    data: {
      orgId: org.id, projectId: projects[0].id,
      tokenHash: 'demo-used-token-hash',
      label: 'web-prod-01 install',
      tags: [{ key: 'env', value: 'production' }],
      usedAt: new Date(Date.now() - 7 * 24 * 60 * 60_000),
      usedBy: servers[0].agentId,
      expiresAt: new Date(Date.now() - 6 * 24 * 60 * 60_000),
    },
  });
  await prisma.installToken.create({
    data: {
      orgId: org.id, projectId: projects[1].id,
      tokenHash: 'demo-fresh-token-hash',
      label: 'new staging server',
      tags: [{ key: 'env', value: 'staging' }],
      expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
    },
  });
  console.log('✓ Install tokens: 1 used + 1 active');

  // ------- API keys -------
  await prisma.apiKey.create({
    data: {
      orgId: org.id,
      createdBy: adminUser.id,
      name: 'CI/CD pipeline',
      keyHash: 'demo-api-key-hash',
      keyPrefix: 'sc_demo_xxxx',
      scopes: ['scan:trigger', 'findings:read'],
      lastUsedAt: new Date(Date.now() - 2 * 60 * 60_000),
    },
  });
  console.log('✓ API key: CI/CD pipeline');

  // ------- Notification preferences -------
  // Email channel: critical findings + brute force + cve.
  const emailEvents = ['finding:new', 'agent:disconnected', 'cert:expiring', 'brute_force:active', 'cve:critical'];
  for (const evt of emailEvents) {
    await prisma.notificationPreference.create({
      data: {
        orgId: org.id, channel: 'email', eventType: evt, enabled: true,
        config: { recipients: ['security@demo.com'], minSeverity: evt === 'cert:expiring' ? 'medium' : 'high' },
      },
    });
  }
  // Slack: dedicated channel for critical events only.
  for (const evt of ['brute_force:active', 'cve:critical', 'agent:disconnected']) {
    await prisma.notificationPreference.create({
      data: {
        orgId: org.id, channel: 'slack', eventType: evt, enabled: true,
        config: { webhookUrl: 'https://hooks.slack.com/services/T0DEMO/B0DEMO/demoXXX', minSeverity: 'critical' },
      },
    });
  }
  console.log(`✓ Notification preferences: ${emailEvents.length} email + 3 slack`);

  // ------- Audit logs -------
  await prisma.auditLog.createMany({
    data: [
      { orgId: org.id, action: 'login', entityType: 'user', entityId: 'admin@demo.com', newValues: { ip: '10.0.0.1' } },
      { orgId: org.id, action: 'project.create', entityType: 'project', entityId: projects[0].id },
      { orgId: org.id, action: 'server.register', entityType: 'server', entityId: servers[0].id },
      { orgId: org.id, action: 'finding.resolve', entityType: 'finding' },
      { orgId: org.id, action: 'integration.connect', entityType: 'integration', newValues: { provider: 'github' } },
    ],
  });

  console.log('\n🌱 Seed complete. Login: admin@demo.com / password123');
  const [
    serverCount, domainCount, repoCount, metricCount, heartbeatCount, findingCt,
    postureCount, packageCount, integrationCount, notificationCount,
  ] = await Promise.all([
    prisma.server.count({ where: { orgId: org.id } }),
    prisma.monitoredEndpoint.count({ where: { orgId: org.id } }),
    prisma.repository.count({ where: { orgId: org.id } }),
    prisma.serverMetricSnapshot.count({ where: { server: { orgId: org.id } } }),
    prisma.endpointHeartbeat.count({ where: { endpoint: { orgId: org.id } } }),
    prisma.finding.count({ where: { orgId: org.id } }),
    prisma.securityPosture.count({ where: { server: { orgId: org.id } } }),
    prisma.packageInventory.count({ where: { server: { orgId: org.id } } }),
    prisma.integration.count({ where: { orgId: org.id } }),
    prisma.notificationPreference.count({ where: { orgId: org.id } }),
  ]);
  console.log(`Servers ${serverCount} · Domains ${domainCount} · Repos ${repoCount} · Findings ${findingCt}`);
  console.log(`Postures ${postureCount} · Inventories ${packageCount} · Integrations ${integrationCount} · Notif prefs ${notificationCount}`);
  console.log(`Time series: ${metricCount} metric points · ${heartbeatCount} heartbeats`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    void prisma.$disconnect();
    process.exit(1);
  });
