import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Seeding database...');

  // ── Organization ──────────────────────────────────────────
  const org = await prisma.organization.upsert({
    where: { slug: 'acme-corp' },
    update: {},
    create: {
      name: 'Acme Corp',
      slug: 'acme-corp',
      plan: 'growth',
      settings: { defaultSeverityThreshold: 'medium' },
    },
  });
  console.log(`  Organization: ${org.name} (${org.id})`);

  // ── Users ─────────────────────────────────────────────────
  const admin = await prisma.user.upsert({
    where: { email: 'admin@acme.dev' },
    update: {},
    create: {
      orgId: org.id,
      email: 'admin@acme.dev',
      name: 'Alice Admin',
      role: 'owner',
      passwordHash: '$2b$10$placeholder_hash_for_seed_data_only',
    },
  });

  const member = await prisma.user.upsert({
    where: { email: 'dev@acme.dev' },
    update: {},
    create: {
      orgId: org.id,
      email: 'dev@acme.dev',
      name: 'Bob Developer',
      role: 'member',
      passwordHash: '$2b$10$placeholder_hash_for_seed_data_only',
    },
  });
  console.log(`  Users: ${admin.name}, ${member.name}`);

  // ── Repository ────────────────────────────────────────────
  const repo = await prisma.repository.upsert({
    where: {
      orgId_provider_providerId: {
        orgId: org.id,
        provider: 'github',
        providerId: '123456',
      },
    },
    update: {},
    create: {
      orgId: org.id,
      provider: 'github',
      providerId: '123456',
      owner: 'acme-corp',
      name: 'backend-api',
      defaultBranch: 'main',
      language: 'TypeScript',
    },
  });
  console.log(`  Repository: ${repo.owner}/${repo.name}`);

  // ── Server ────────────────────────────────────────────────
  const server = await prisma.server.upsert({
    where: { agentId: 'ag_seed_001' },
    update: {},
    create: {
      orgId: org.id,
      agentId: 'ag_seed_001',
      hostname: 'prod-web-01.acme.internal',
      osFamily: 'ubuntu',
      osVersion: '22.04',
      arch: 'amd64',
      cloudProvider: 'aws',
      cloudRegion: 'us-east-1',
      cloudInstanceId: 'i-0abc123def456',
      environment: 'production',
      agentVersion: '0.1.0',
      status: 'active',
      metadata: { instanceType: 't3.medium' },
    },
  });
  console.log(`  Server: ${server.hostname}`);

  // ── Certificate ───────────────────────────────────────────
  const cert = await prisma.certificate.upsert({
    where: {
      orgId_fingerprintSha256: {
        orgId: org.id,
        fingerprintSha256: 'A1:B2:C3:D4:E5:F6:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99',
      },
    },
    update: {},
    create: {
      orgId: org.id,
      subjectCn: '*.acme.dev',
      sans: ['acme.dev', '*.acme.dev'],
      issuerCn: "Let's Encrypt Authority X3",
      serialNumber: '03:AB:CD:EF:12:34:56:78',
      fingerprintSha256: 'A1:B2:C3:D4:E5:F6:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99',
      notBefore: new Date('2024-01-01T00:00:00Z'),
      notAfter: new Date('2025-04-01T00:00:00Z'),
      keyAlgorithm: 'ECDSA-P256',
      signatureAlgorithm: 'SHA256withECDSA',
      chainValid: true,
      chainDepth: 3,
      discoveredFrom: 'alb:arn:aws:elasticloadbalancing:us-east-1:123456789:loadbalancer/app/prod-alb/abc123',
      status: 'active',
    },
  });
  console.log(`  Certificate: ${cert.subjectCn}`);

  // ── Scan ──────────────────────────────────────────────────
  const scan = await prisma.scan.create({
    data: {
      orgId: org.id,
      scanType: 'code_dependencies',
      status: 'completed',
      trigger: 'manual',
      repositoryId: repo.id,
      findingsTotal: 3,
      findingsNew: 3,
      findingsResolved: 0,
      startedAt: new Date('2024-03-01T10:00:00Z'),
      completedAt: new Date('2024-03-01T10:00:45Z'),
      durationMs: 45000,
      metadata: { scannerVersion: '0.1.0', commitSha: 'abc123def' },
    },
  });
  console.log(`  Scan: ${scan.scanType} (${scan.status})`);

  // ── Findings ──────────────────────────────────────────────
  const findings = await Promise.all([
    prisma.finding.create({
      data: {
        orgId: org.id,
        source: 'code_scanner',
        severity: 'critical',
        status: 'open',
        title: 'Prototype Pollution in lodash',
        description: 'lodash before 4.17.21 is vulnerable to prototype pollution via the merge function.',
        cveId: 'CVE-2021-23337',
        cvssScore: 7.2,
        cvssVector: 'CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:H/A:H',
        repositoryId: repo.id,
        detail: {
          packageName: 'lodash',
          installedVersion: '4.17.15',
          fixedVersion: '4.17.21',
          lockfilePath: 'package-lock.json',
        },
        remediation: 'Upgrade lodash to version 4.17.21 or later.',
        autoFixable: true,
        scanId: scan.id,
      },
    }),
    prisma.finding.create({
      data: {
        orgId: org.id,
        source: 'code_scanner',
        severity: 'high',
        status: 'open',
        title: 'Regular Expression Denial of Service in minimatch',
        description: 'minimatch before 3.0.5 is vulnerable to ReDoS.',
        cveId: 'CVE-2022-3517',
        cvssScore: 7.5,
        cvssVector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H',
        repositoryId: repo.id,
        detail: {
          packageName: 'minimatch',
          installedVersion: '3.0.4',
          fixedVersion: '3.0.5',
          lockfilePath: 'package-lock.json',
        },
        remediation: 'Upgrade minimatch to version 3.0.5 or later.',
        autoFixable: true,
        scanId: scan.id,
      },
    }),
    prisma.finding.create({
      data: {
        orgId: org.id,
        source: 'code_scanner',
        severity: 'medium',
        status: 'open',
        title: 'Hardcoded AWS Access Key detected',
        description: 'An AWS access key was found in source code.',
        repositoryId: repo.id,
        detail: {
          secretType: 'aws_access_key',
          filePath: 'src/config/legacy.ts',
          lineNumber: 42,
        },
        remediation: 'Remove the hardcoded key and use environment variables or AWS IAM roles.',
        autoFixable: false,
        scanId: scan.id,
      },
    }),
  ]);
  console.log(`  Findings: ${findings.length} created`);

  // ── Vulnerability ─────────────────────────────────────────
  const vuln = await prisma.vulnerability.upsert({
    where: { id: 'CVE-2021-23337' },
    update: {},
    create: {
      id: 'CVE-2021-23337',
      title: 'Prototype Pollution in lodash',
      description: 'lodash versions prior to 4.17.21 are vulnerable to Regular Expression Denial of Service (ReDoS) via the toNumber, trim and trimEnd functions.',
      cvssScore: 7.2,
      cvssVector: 'CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:H/A:H',
      severity: 'high',
      publishedAt: new Date('2021-02-15T00:00:00Z'),
      modifiedAt: new Date('2021-03-20T00:00:00Z'),
      references: [
        'https://nvd.nist.gov/vuln/detail/CVE-2021-23337',
        'https://github.com/lodash/lodash/commit/3469357cff396a26c363f8c1b5a91dde28ba4b1c',
      ],
    },
  });

  await prisma.vulnerabilityAffects.create({
    data: {
      vulnerabilityId: vuln.id,
      ecosystem: 'npm',
      packageName: 'lodash',
      versionRange: '>=0.0.0 <4.17.21',
      fixedVersion: '4.17.21',
    },
  });
  console.log(`  Vulnerability: ${vuln.id} with 1 affected package`);

  // ── Integration ───────────────────────────────────────────
  const integration = await prisma.integration.upsert({
    where: {
      orgId_provider: {
        orgId: org.id,
        provider: 'github',
      },
    },
    update: {},
    create: {
      orgId: org.id,
      provider: 'github',
      status: 'active',
      config: { installationId: '12345678', appId: '987654' },
    },
  });
  console.log(`  Integration: ${integration.provider} (${integration.status})`);

  // ── Notification Preferences ──────────────────────────────
  await prisma.notificationPreference.createMany({
    data: [
      { userId: admin.id, channel: 'email', eventType: 'critical_finding', enabled: true },
      { userId: admin.id, channel: 'slack', eventType: 'critical_finding', enabled: true },
      { userId: admin.id, channel: 'email', eventType: 'cert_expiry', enabled: true },
      { userId: member.id, channel: 'email', eventType: 'scan_complete', enabled: true },
    ],
    skipDuplicates: true,
  });
  console.log('  Notification preferences: 4 created');

  console.log('\nSeed completed successfully!');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
