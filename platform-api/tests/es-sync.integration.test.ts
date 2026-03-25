/**
 * Integration test: Finding → PostgreSQL → BullMQ → Elasticsearch roundtrip.
 *
 * Prerequisites: PostgreSQL, Redis, and OpenSearch must be running.
 * Run with: DATABASE_URL=... npx vitest run tests/es-sync.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Worker } from 'bullmq';

import { prisma } from '../src/lib/prisma.js';
import { getRedisConnection } from '../src/lib/redis.js';
import {
  getEsClient,
  initializeIndex,
  getFinding,
  FINDINGS_INDEX,
} from '../src/lib/elasticsearch.js';
import { esSyncQueue } from '../src/jobs/queues.js';
import { processFindingSync, type EsSyncJobData } from '../src/jobs/es-sync.processor.js';
import { enqueueFindingSync } from '../src/modules/findings/sync.js';

// Test data IDs — cleaned up after each run
let testOrgId: string;
let testScanId: string;
let testFindingId: string;

describe('Finding → ES sync roundtrip', () => {
  let worker: Worker<EsSyncJobData>;

  beforeAll(async () => {
    // Ensure ES index exists
    await initializeIndex();

    // Start a temporary worker for the es-sync queue
    worker = new Worker<EsSyncJobData>('es-sync', processFindingSync, {
      connection: getRedisConnection(),
    });

    // Create test org + scan (required FKs)
    const org = await prisma.organization.create({
      data: {
        name: 'Test Org (ES Sync)',
        slug: `test-es-sync-${Date.now()}`,
        plan: 'starter',
      },
    });
    testOrgId = org.id;

    const scan = await prisma.scan.create({
      data: {
        orgId: testOrgId,
        scanType: 'code_dependencies',
        status: 'completed',
        trigger: 'manual',
      },
    });
    testScanId = scan.id;
  });

  afterAll(async () => {
    // Clean up test data
    if (testFindingId) {
      await prisma.finding.delete({ where: { id: testFindingId } }).catch(() => {});
      // Remove from ES
      const esClient = getEsClient();
      await esClient.delete({ index: FINDINGS_INDEX, id: testFindingId }).catch(() => {});
    }
    if (testScanId) {
      await prisma.scan.delete({ where: { id: testScanId } }).catch(() => {});
    }
    if (testOrgId) {
      await prisma.organization.delete({ where: { id: testOrgId } }).catch(() => {});
    }

    // Shut down worker and connections
    await worker.close();
    await esSyncQueue.close();
    getRedisConnection().disconnect();
    await prisma.$disconnect();
  });

  it('syncs a finding from PostgreSQL to Elasticsearch via BullMQ', async () => {
    // 1. Insert finding into PostgreSQL
    const finding = await prisma.finding.create({
      data: {
        orgId: testOrgId,
        source: 'code_scanner',
        severity: 'high',
        status: 'open',
        title: 'Test Finding for ES Sync',
        description: 'This finding should appear in Elasticsearch.',
        cveId: 'CVE-2099-99999',
        cvssScore: 8.5,
        cvssVector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N',
        detail: { packageName: 'test-pkg', installedVersion: '1.0.0' },
        autoFixable: true,
        scanId: testScanId,
      },
    });
    testFindingId = finding.id;

    // 2. Enqueue sync job
    await enqueueFindingSync(finding.id);

    // 3. Wait for the job to be processed (poll ES with timeout)
    const maxWaitMs = 10_000;
    const pollIntervalMs = 500;
    let elapsed = 0;
    let esDoc = null;

    while (elapsed < maxWaitMs) {
      // Force refresh so the document is searchable immediately
      const esClient = getEsClient();
      await esClient.indices.refresh({ index: FINDINGS_INDEX });

      esDoc = await getFinding(finding.id);
      if (esDoc) break;

      await new Promise((r) => setTimeout(r, pollIntervalMs));
      elapsed += pollIntervalMs;
    }

    // 4. Assert the finding appears in ES with correct data
    expect(esDoc).not.toBeNull();
    expect(esDoc!.id).toBe(finding.id);
    expect(esDoc!.org_id).toBe(testOrgId);
    expect(esDoc!.source).toBe('code_scanner');
    expect(esDoc!.severity).toBe('high');
    expect(esDoc!.status).toBe('open');
    expect(esDoc!.title).toBe('Test Finding for ES Sync');
    expect(esDoc!.cve_id).toBe('CVE-2099-99999');
    expect(esDoc!.cvss_score).toBeCloseTo(8.5);
    expect(esDoc!.auto_fixable).toBe(true);
    expect(esDoc!.first_seen_at).toBeDefined();
    expect(esDoc!.created_at).toBeDefined();
  }, 15_000);
});
