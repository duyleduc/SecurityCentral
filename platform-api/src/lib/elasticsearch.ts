import { Client } from '@opensearch-project/opensearch';

import { env } from './env.js';

// ─── Index Configuration (T-1.3.1) ─────────────────────────

export const FINDINGS_INDEX = 'findings';

const FINDINGS_MAPPING = {
  mappings: {
    properties: {
      id: { type: 'keyword' },
      org_id: { type: 'keyword' },
      source: { type: 'keyword' },
      severity: { type: 'keyword' },
      status: { type: 'keyword' },
      title: { type: 'text', fields: { keyword: { type: 'keyword' } } },
      description: { type: 'text' },
      cve_id: { type: 'keyword' },
      cvss_score: { type: 'float' },
      repository_id: { type: 'keyword' },
      server_id: { type: 'keyword' },
      certificate_id: { type: 'keyword' },
      detail: { type: 'object', enabled: true },
      auto_fixable: { type: 'boolean' },
      first_seen_at: { type: 'date' },
      resolved_at: { type: 'date' },
      created_at: { type: 'date' },
    },
  },
  settings: {
    number_of_shards: 1,
    number_of_replicas: 0,
  },
};

// ─── Client Wrapper (T-1.3.2) ──────────────────────────────

let clientInstance: Client | null = null;

export function getEsClient(): Client {
  if (clientInstance) return clientInstance;

  clientInstance = new Client({
    node: env.ELASTICSEARCH_URL,
  });

  return clientInstance;
}

/**
 * Check if OpenSearch/Elasticsearch is reachable.
 */
export async function healthCheck(): Promise<boolean> {
  try {
    const client = getEsClient();
    const { body } = await client.cluster.health();
    return body.status === 'green' || body.status === 'yellow';
  } catch {
    return false;
  }
}

/**
 * Ensure the findings index exists with the correct mapping.
 * Called on server startup.
 */
export async function initializeIndex(): Promise<void> {
  const client = getEsClient();

  const { body: exists } = await client.indices.exists({ index: FINDINGS_INDEX });
  if (!exists) {
    await client.indices.create({
      index: FINDINGS_INDEX,
      body: FINDINGS_MAPPING,
    });
    console.log(`[elasticsearch] Created index "${FINDINGS_INDEX}"`);
  }
}

// ─── Finding Document Operations ────────────────────────────

export interface FindingDocument {
  id: string;
  org_id: string;
  source: string;
  severity: string;
  status: string;
  title: string;
  description: string | null;
  cve_id: string | null;
  cvss_score: number | null;
  repository_id: string | null;
  server_id: string | null;
  certificate_id: string | null;
  detail: Record<string, unknown>;
  auto_fixable: boolean;
  first_seen_at: string;
  resolved_at: string | null;
  created_at: string;
}

/**
 * Upsert a finding document into ES by ID.
 */
export async function upsertFinding(doc: FindingDocument): Promise<void> {
  const client = getEsClient();
  await client.index({
    index: FINDINGS_INDEX,
    id: doc.id,
    body: doc,
    refresh: 'false',
  });
}

/**
 * Get a finding document from ES by ID.
 */
export async function getFinding(id: string): Promise<FindingDocument | null> {
  const client = getEsClient();
  try {
    const { body } = await client.get({ index: FINDINGS_INDEX, id });
    return body._source as FindingDocument;
  } catch (err: unknown) {
    const statusCode = (err as { meta?: { statusCode?: number } })?.meta?.statusCode;
    if (statusCode === 404) return null;
    throw err;
  }
}

/**
 * Search findings by org with optional filters.
 */
export async function searchFindings(
  orgId: string,
  options: {
    query?: string;
    severity?: string;
    status?: string;
    from?: number;
    size?: number;
  } = {},
): Promise<{ hits: FindingDocument[]; total: number }> {
  const client = getEsClient();
  const { query, severity, status, from = 0, size = 20 } = options;

  const must: Record<string, unknown>[] = [{ term: { org_id: orgId } }];

  if (severity) must.push({ term: { severity } });
  if (status) must.push({ term: { status } });
  if (query) must.push({ multi_match: { query, fields: ['title', 'description'] } });

  const { body } = await client.search({
    index: FINDINGS_INDEX,
    body: {
      query: { bool: { must } },
      from,
      size,
      sort: [{ created_at: { order: 'desc' } }],
    },
  });

  const total =
    typeof body.hits.total === 'number' ? body.hits.total : body.hits.total.value;

  return {
    hits: body.hits.hits.map((hit: { _source: FindingDocument }) => hit._source),
    total,
  };
}
