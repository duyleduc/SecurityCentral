import type { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { isEsEnabled, getEsClient, FINDINGS_INDEX } from '../../lib/elasticsearch.js';
import { AppError } from '../../middleware/errors.js';
import { enqueueFindingSync } from './sync.js';
import type { ListFindingsQuery, TrendsQuery } from './findings.validation.js';

// ---------------------------------------------------------------------------
// Severity ordering for Prisma sort
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

// ---------------------------------------------------------------------------
// T-3.1.2: List findings (PG for simple, ES for full-text)
// ---------------------------------------------------------------------------

interface PaginatedResult<T> {
  readonly data: readonly T[];
  readonly meta: { readonly page: number; readonly per_page: number; readonly total: number };
}

export async function listFindings(
  orgId: string,
  query: ListFindingsQuery,
  requestId?: string,
): Promise<PaginatedResult<unknown>> {
  const { page, per_page } = query;
  const skip = (page - 1) * per_page;

  // Route to ES when full-text search is present and ES is available
  if (query.q && isEsEnabled()) {
    return listFindingsFromEs(orgId, query, skip);
  }

  return listFindingsFromPg(orgId, query, skip);
}

async function listFindingsFromPg(
  orgId: string,
  query: ListFindingsQuery,
  skip: number,
): Promise<PaginatedResult<unknown>> {
  const where: Prisma.FindingWhereInput = { orgId };

  if (query.severity) {
    where.severity = { in: query.severity.split(',') as any[] };
  }
  if (query.status) {
    where.status = { in: query.status.split(',') as any[] };
  }
  if (query.source) {
    where.source = { in: query.source.split(',') as any[] };
  }
  if (query.cve_id) {
    where.cveId = query.cve_id;
  }
  if (query.repository_id) {
    where.repositoryId = query.repository_id;
  }
  if (query.server_id) {
    where.serverId = query.server_id;
  }
  if (query.certificate_id) {
    where.certificateId = query.certificate_id;
  }
  if (query.project_id) {
    where.repository = { projectId: query.project_id };
  }
  if (query.q) {
    where.OR = [
      { title: { contains: query.q, mode: 'insensitive' } },
      { cveId: { contains: query.q, mode: 'insensitive' } },
    ];
  }

  const isSeveritySort = query.sort === 'severity';
  const orderBy = buildPrismaSort(query.sort, query.order);

  const [rawData, total] = await Promise.all([
    prisma.finding.findMany({
      where,
      skip,
      take: query.per_page,
      orderBy,
      include: {
        repository: { select: { name: true, owner: true, projectId: true, project: { select: { id: true, name: true } } } },
        server: { select: { hostname: true } },
        certificate: { select: { subjectCn: true } },
      },
    }),
    prisma.finding.count({ where }),
  ]);

  // Prisma can't sort enums by custom order, so sort severity in-memory
  const data = isSeveritySort
    ? [...rawData].sort((a, b) => {
        const dir = (query.order ?? 'desc') === 'asc' ? 1 : -1;
        return dir * ((SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99));
      })
    : rawData;

  return { data, meta: { page: query.page, per_page: query.per_page, total } };
}

function buildPrismaSort(
  sort?: string,
  order?: string,
): Prisma.FindingOrderByWithRelationInput {
  const direction = (order ?? 'desc') as 'asc' | 'desc';

  switch (sort) {
    case 'cvss_score':
      return { cvssScore: direction };
    case 'first_seen_at':
      return { firstSeenAt: direction };
    case 'created_at':
      return { createdAt: direction };
    case 'severity':
      // Prisma doesn't natively sort by enum order, fall through to createdAt
      return { createdAt: direction };
    default:
      return { createdAt: direction };
  }
}

async function listFindingsFromEs(
  orgId: string,
  query: ListFindingsQuery,
  skip: number,
): Promise<PaginatedResult<unknown>> {
  const client = getEsClient();

  const must: Record<string, unknown>[] = [{ term: { org_id: orgId } }];

  if (query.q) {
    must.push({ multi_match: { query: query.q, fields: ['title', 'description', 'cve_id'] } });
  }
  if (query.severity) {
    must.push({ terms: { severity: query.severity.split(',') } });
  }
  if (query.status) {
    must.push({ terms: { status: query.status.split(',') } });
  }
  if (query.source) {
    must.push({ terms: { source: query.source.split(',') } });
  }
  if (query.cve_id) {
    must.push({ term: { cve_id: query.cve_id } });
  }
  if (query.repository_id) {
    must.push({ term: { repository_id: query.repository_id } });
  }
  if (query.server_id) {
    must.push({ term: { server_id: query.server_id } });
  }
  if (query.certificate_id) {
    must.push({ term: { certificate_id: query.certificate_id } });
  }

  const sortField = query.sort === 'cvss_score' ? 'cvss_score' :
    query.sort === 'first_seen_at' ? 'first_seen_at' :
    query.sort === 'severity' ? 'severity' : 'created_at';

  const { body } = await client.search({
    index: FINDINGS_INDEX,
    body: {
      query: { bool: { must } },
      from: skip,
      size: query.per_page,
      sort: [{ [sortField]: { order: query.order ?? 'desc' } }],
    },
  });

  const total = typeof body.hits.total === 'number' ? body.hits.total : body.hits.total.value;

  return {
    data: body.hits.hits.map((hit: { _source: unknown }) => hit._source),
    meta: { page: query.page, per_page: query.per_page, total },
  };
}

// ---------------------------------------------------------------------------
// T-3.1.3: Get finding by ID
// ---------------------------------------------------------------------------

export async function getFindingById(orgId: string, findingId: string) {
  const finding = await prisma.finding.findFirst({
    where: { id: findingId, orgId },
    include: {
      repository: { select: { id: true, name: true, owner: true, provider: true } },
      server: { select: { id: true, hostname: true, osFamily: true, osVersion: true } },
      certificate: { select: { id: true, subjectCn: true, issuerCn: true, notAfter: true } },
      scan: { select: { id: true, scanType: true, status: true, completedAt: true } },
    },
  });

  if (!finding) {
    throw new AppError('RESOURCE_NOT_FOUND', `Finding ${findingId} not found`);
  }

  return finding;
}

// ---------------------------------------------------------------------------
// T-3.1.4: Update finding status
// ---------------------------------------------------------------------------

const RESOLUTION_STATUSES = new Set(['resolved', 'suppressed', 'false_positive']);

export async function updateFindingStatus(
  orgId: string,
  findingId: string,
  newStatus: string,
  requestId?: string,
) {
  const existing = await prisma.finding.findFirst({
    where: { id: findingId, orgId },
  });

  if (!existing) {
    throw new AppError('RESOURCE_NOT_FOUND', `Finding ${findingId} not found`);
  }

  const isResolving = RESOLUTION_STATUSES.has(newStatus);
  const isReopening = newStatus === 'open' && RESOLUTION_STATUSES.has(existing.status);

  const updated = await prisma.finding.update({
    where: { id: findingId },
    data: {
      status: newStatus as any,
      resolvedAt: isResolving ? new Date() : isReopening ? null : undefined,
    },
    include: {
      repository: { select: { name: true, owner: true } },
      server: { select: { hostname: true } },
      certificate: { select: { subjectCn: true } },
    },
  });

  // Sync updated finding to ES
  await enqueueFindingSync(findingId, requestId);

  return updated;
}

// ---------------------------------------------------------------------------
// T-3.1.5: Stats (ES aggregations)
// ---------------------------------------------------------------------------

export async function getStats(orgId: string, source?: string) {
  if (!isEsEnabled()) {
    return { total: 0, by_severity: {}, by_status: {}, by_source: {} };
  }
  const client = getEsClient();

  const must: Record<string, unknown>[] = [{ term: { org_id: orgId } }];
  if (source) {
    must.push({ terms: { source: source.split(',') } });
  }

  const { body } = await client.search({
    index: FINDINGS_INDEX,
    body: {
      size: 0,
      query: { bool: { must } },
      aggs: {
        by_severity: { terms: { field: 'severity', size: 10 } },
        by_status: { terms: { field: 'status', size: 10 } },
        by_source: { terms: { field: 'source', size: 10 } },
      },
    },
  });

  const mapBuckets = (agg: { buckets: Array<{ key: string; doc_count: number }> }) =>
    Object.fromEntries(agg.buckets.map((b) => [b.key, b.doc_count]));

  return {
    total: typeof body.hits.total === 'number' ? body.hits.total : body.hits.total.value,
    by_severity: mapBuckets(body.aggregations.by_severity),
    by_status: mapBuckets(body.aggregations.by_status),
    by_source: mapBuckets(body.aggregations.by_source),
  };
}

// ---------------------------------------------------------------------------
// T-3.1.6: Trends (ES date histogram)
// ---------------------------------------------------------------------------

export async function getTrends(orgId: string, query: TrendsQuery) {
  if (!isEsEnabled()) {
    return { interval: query.interval, days: query.days, new_findings: [], resolved_findings: [] };
  }
  const client = getEsClient();
  const { interval, days } = query;

  const calendarInterval = interval === 'week' ? '1w' : '1d';
  const gte = `now-${days}d/d`;

  const { body } = await client.search({
    index: FINDINGS_INDEX,
    body: {
      size: 0,
      query: {
        bool: {
          must: [{ term: { org_id: orgId } }],
          filter: [{ range: { created_at: { gte } } }],
        },
      },
      aggs: {
        new_findings: {
          date_histogram: {
            field: 'created_at',
            calendar_interval: calendarInterval,
            format: 'yyyy-MM-dd',
            min_doc_count: 0,
          },
        },
        resolved_findings: {
          filter: { exists: { field: 'resolved_at' } },
          aggs: {
            over_time: {
              date_histogram: {
                field: 'resolved_at',
                calendar_interval: calendarInterval,
                format: 'yyyy-MM-dd',
                min_doc_count: 0,
              },
            },
          },
        },
      },
    },
  });

  const mapTimeSeries = (buckets: Array<{ key_as_string: string; doc_count: number }>) =>
    buckets.map((b) => ({ date: b.key_as_string, count: b.doc_count }));

  return {
    interval,
    days,
    new_findings: mapTimeSeries(body.aggregations.new_findings.buckets),
    resolved_findings: mapTimeSeries(body.aggregations.resolved_findings.over_time.buckets),
  };
}
