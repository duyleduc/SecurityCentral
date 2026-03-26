import { prisma } from '../../lib/prisma.js';
import { getRedisConnection } from '../../lib/redis.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ component: 'vulndb-snapshot' });

const SNAPSHOT_VERSION_KEY = 'vulndb:snapshot:version';
const SNAPSHOT_DATA_KEY = 'vulndb:snapshot:data';

// ---------------------------------------------------------------------------
// T-5.2.1: Build snapshot from vulnerability_affects
// ---------------------------------------------------------------------------

interface SnapshotEntry {
  readonly cve_id: string;
  readonly affected: string;
  readonly fixed: string | null;
  readonly cvss: number | null;
}

export type VulnDbSnapshot = Record<string, Record<string, SnapshotEntry[]>>;

/**
 * Build a JSON snapshot from vulnerability_affects table.
 * Groups by bucket (ecosystem:os_version or just ecosystem) → package_name → entries.
 */
export async function buildSnapshot(): Promise<{ version: string; data: VulnDbSnapshot }> {
  const affects = await prisma.vulnerabilityAffects.findMany({
    include: {
      vulnerability: {
        select: { cvssScore: true },
      },
    },
  });

  const snapshot: VulnDbSnapshot = {};

  for (const a of affects) {
    const bucket = a.osFamily && a.osVersion ? `${a.osFamily}:${a.osVersion}` : a.ecosystem;

    if (!snapshot[bucket]) snapshot[bucket] = {};
    if (!snapshot[bucket][a.packageName]) snapshot[bucket][a.packageName] = [];

    snapshot[bucket][a.packageName].push({
      cve_id: a.vulnerabilityId,
      affected: a.versionRange,
      fixed: a.fixedVersion,
      cvss: a.vulnerability.cvssScore ? Number(a.vulnerability.cvssScore) : null,
    });
  }

  const version = new Date().toISOString();

  // Cache in Redis
  const redis = getRedisConnection();
  await redis.set(SNAPSHOT_VERSION_KEY, version);
  await redis.set(SNAPSHOT_DATA_KEY, JSON.stringify(snapshot));

  log.info('VulnDB snapshot built', { buckets: Object.keys(snapshot).length, entries: affects.length });

  return { version, data: snapshot };
}

// ---------------------------------------------------------------------------
// T-5.2.2: Get latest snapshot version
// ---------------------------------------------------------------------------

export async function getSnapshotVersion(): Promise<string | null> {
  const redis = getRedisConnection();
  return redis.get(SNAPSHOT_VERSION_KEY);
}

// ---------------------------------------------------------------------------
// T-5.2.3: Download snapshot (full or delta)
// ---------------------------------------------------------------------------

export async function downloadSnapshot(since?: string): Promise<{ version: string; data: VulnDbSnapshot; isDelta: boolean }> {
  const redis = getRedisConnection();
  const version = await redis.get(SNAPSHOT_VERSION_KEY);
  const raw = await redis.get(SNAPSHOT_DATA_KEY);

  if (!version || !raw) {
    // No cached snapshot — rebuild
    const fresh = await buildSnapshot();
    return { ...fresh, isDelta: false };
  }

  const fullSnapshot: VulnDbSnapshot = JSON.parse(raw);

  if (!since) {
    return { version, data: fullSnapshot, isDelta: false };
  }

  // Build delta: only entries modified since the given timestamp
  const sinceDate = new Date(since);
  const deltaAffects = await prisma.vulnerabilityAffects.findMany({
    where: { createdAt: { gt: sinceDate } },
    include: { vulnerability: { select: { cvssScore: true } } },
  });

  // Count total entries
  const totalEntries = Object.values(fullSnapshot).reduce(
    (sum, pkgs) => sum + Object.values(pkgs).reduce((s, entries) => s + entries.length, 0),
    0,
  );

  // If delta is >50% of total, serve full
  if (deltaAffects.length > totalEntries * 0.5) {
    return { version, data: fullSnapshot, isDelta: false };
  }

  // Build delta snapshot
  const delta: VulnDbSnapshot = {};
  for (const a of deltaAffects) {
    const bucket = a.osFamily && a.osVersion ? `${a.osFamily}:${a.osVersion}` : a.ecosystem;
    if (!delta[bucket]) delta[bucket] = {};
    if (!delta[bucket][a.packageName]) delta[bucket][a.packageName] = [];

    delta[bucket][a.packageName].push({
      cve_id: a.vulnerabilityId,
      affected: a.versionRange,
      fixed: a.fixedVersion,
      cvss: a.vulnerability.cvssScore ? Number(a.vulnerability.cvssScore) : null,
    });
  }

  return { version, data: delta, isDelta: true };
}
